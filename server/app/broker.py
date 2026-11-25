"""The MQTT broker's side of pairing: one broker login per device, limited to that device's own topics."""

import secrets
from typing import Protocol


class BrokerError(RuntimeError):
    pass


class BrokerAdmin(Protocol):
    def create_device(self, device_id: str, secret: str) -> None: ...

    def set_secret(self, device_id: str, secret: str) -> None: ...

    def delete_device(self, device_id: str) -> None: ...


class NullBroker:
    """Used while MQTT is not configured. Pairing still works over HTTP."""

    def create_device(self, device_id: str, secret: str) -> None:
        return None

    def set_secret(self, device_id: str, secret: str) -> None:
        return None

    def delete_device(self, device_id: str) -> None:
        return None


DYNSEC_TOPIC = "$CONTROL/dynamic-security/v1"
HUB_ROLE = "hub"
INGEST_ROLE = "ingest"
TOPIC_ROOT = "melophos"
HUB_KINDS = ("notes", "session", "status")
# the server shares one subscription between its processes and the plugin checks the whole filter
DEFAULT_GROUP = "melophos-server"


def shared_filter(group: str = DEFAULT_GROUP) -> str:
    """The subscription all server processes of one group share, so each message goes to one of them."""
    return f"$share/{group}/{TOPIC_ROOT}/+/+"


SHARED_FILTER = shared_filter()


class DynsecBroker:
    """Writes the broker's rules through Mosquitto's dynamic security plugin.

    The broker, not this server, decides who may publish where: the role `hub` allows publishing only to
    `melophos/%u/+` and `%u` is the login name, which is the device id. So a hub that holds a valid secret
    still cannot publish under another hub's id. The broker stores each password hashed (PBKDF2), so the
    server never keeps a device secret in the clear either.
    """

    def __init__(
        self, host: str, port: int, admin_user: str, admin_password: str, timeout: float = 5.0
    ) -> None:
        self._host, self._port = host, port
        self._user, self._password = admin_user, admin_password
        self._timeout = timeout

    def _send(self, commands: list[dict[str, object]]) -> list[dict[str, object]]:
        import json
        import threading

        import paho.mqtt.client as mqtt
        from paho.mqtt.enums import CallbackAPIVersion

        done = threading.Event()
        subscribed = threading.Event()
        answer: dict[str, object] = {}
        # every admin client hears every reply on the one response topic, so each command carries a tag of its own
        # and only a reply that carries all of ours is taken. Without it a caller could read another call's answer
        tag = secrets.token_hex(8)
        tagged = [{**command, "correlationData": f"{tag}-{i}"} for i, command in enumerate(commands)]

        client = mqtt.Client(
            CallbackAPIVersion.VERSION2,
            client_id="melophos-admin-" + secrets.token_hex(4),
            protocol=mqtt.MQTTv5,
        )
        client.username_pw_set(self._user, self._password)

        def on_connect(c: mqtt.Client, _u: object, _f: object, reason: object, _p: object) -> None:
            if getattr(reason, "is_failure", False):
                done.set()
                return
            c.subscribe(DYNSEC_TOPIC + "/response", qos=1)

        def on_subscribe(c: mqtt.Client, *_args: object) -> None:
            subscribed.set()
            c.publish(DYNSEC_TOPIC, json.dumps({"commands": tagged}), qos=1)

        def on_message(_c: mqtt.Client, _u: object, message: mqtt.MQTTMessage) -> None:
            try:
                payload = json.loads(message.payload)
            except ValueError:
                return
            replies = payload.get("responses") if isinstance(payload, dict) else None
            if not isinstance(replies, list) or len(replies) != len(tagged):
                return
            if any(
                not isinstance(r, dict) or r.get("correlationData") != f"{tag}-{i}"
                for i, r in enumerate(replies)
            ):
                return
            answer.update(payload)
            done.set()

        client.on_connect, client.on_subscribe, client.on_message = on_connect, on_subscribe, on_message
        try:
            client.connect(self._host, self._port, keepalive=10)
        except OSError as error:
            raise BrokerError(f"cannot reach the broker: {error}") from error
        client.loop_start()
        try:
            if not done.wait(self._timeout) or "responses" not in answer:
                raise BrokerError("the broker did not answer a dynamic security command")
        finally:
            client.disconnect()
            client.loop_stop()
        responses = answer["responses"]
        assert isinstance(responses, list)
        return [r for r in responses if isinstance(r, dict)]

    def _run(self, commands: list[dict[str, object]], tolerate: tuple[str, ...] = ()) -> None:
        for response in self._send(commands):
            error = response.get("error")
            if error and not any(t in str(error) for t in tolerate):
                raise BrokerError(f"{response.get('command')}: {error}")

    @staticmethod
    def _acl(role: str, acltype: str, topic: str) -> dict[str, object]:
        return {
            "command": "addRoleACL",
            "rolename": role,
            "acltype": acltype,
            "topic": topic,
            "allow": True,
            "priority": 0,
        }

    def ensure_roles(self) -> None:
        """Idempotent: create the two roles and deny everything not granted. Safe on every start."""
        self._run(
            [
                {
                    "command": "setDefaultACLAccess",
                    "acls": [
                        {"acltype": kind, "allow": False}
                        for kind in ("publishClientSend", "publishClientReceive", "subscribe", "unsubscribe")
                    ],
                },
                {"command": "createRole", "rolename": HUB_ROLE},
                {"command": "createRole", "rolename": INGEST_ROLE},
                # the three topics a hub may publish to, spelled out. No wildcard, so no other last level exists
                *[self._acl(HUB_ROLE, "publishClientSend", f"{TOPIC_ROOT}/%u/{kind}") for kind in HUB_KINDS],
                self._acl(INGEST_ROLE, "subscribeLiteral", SHARED_FILTER),
                self._acl(INGEST_ROLE, "publishClientReceive", f"{TOPIC_ROOT}/+/+"),
            ],
            tolerate=("already exists", "already"),
        )
        self.upgrade()

    def upgrade(self) -> None:
        """Bring a broker made by an older version up to date: drop the old wildcard rule for hubs and bind every
        existing hub login to its own client id. Safe to run on every start."""
        self._run(
            [
                {
                    "command": "removeRoleACL",
                    "rolename": HUB_ROLE,
                    "acltype": "publishClientSend",
                    "topic": f"{TOPIC_ROOT}/%u/+",
                }
            ],
            tolerate=("not found", "does not exist", "ACL"),
        )
        for device_id in sorted(self.list_devices()):
            self._run([{"command": "setClientId", "username": device_id, "clientid": device_id}])

    def ensure_ingest_user(
        self, username: str, password: str, clientid: str | None = None, group: str = DEFAULT_GROUP
    ) -> None:
        """The server's own login. With a client id the login works only under that id, so another client cannot
        take the server's connection over and each server process has a login and an id of its own."""
        create: dict[str, object] = {
            "command": "createClient",
            "username": username,
            "password": password,
            "roles": [{"rolename": INGEST_ROLE}],
        }
        if clientid:
            create["clientid"] = clientid
        self._run([create], tolerate=("already exists",))
        if group != DEFAULT_GROUP:
            self._run(
                [self._acl(INGEST_ROLE, "subscribeLiteral", shared_filter(group))], tolerate=("already",)
            )
        self._run([{"command": "setClientPassword", "username": username, "password": password}])
        if clientid:
            self._run([{"command": "setClientId", "username": username, "clientid": clientid}])

    def create_device(self, device_id: str, secret: str) -> None:
        self._run(
            [
                {
                    "command": "createClient",
                    "username": device_id,
                    "password": secret,
                    # the login only works with this client id, so one hub cannot take another's connection over
                    "clientid": device_id,
                    "roles": [{"rolename": HUB_ROLE}],
                }
            ],
            tolerate=("already exists",),
        )
        self._run([{"command": "setClientPassword", "username": device_id, "password": secret}])

    def set_secret(self, device_id: str, secret: str) -> None:
        self._run([{"command": "setClientPassword", "username": device_id, "password": secret}])

    def delete_device(self, device_id: str) -> None:
        self._run([{"command": "deleteClient", "username": device_id}], tolerate=("not found",))

    def list_devices(self) -> set[str]:
        """Every login on the broker except the two the server itself uses (the hubs are named hub-...)."""
        found: set[str] = set()
        offset = 0
        while True:
            reply = self._send([{"command": "listClients", "verbose": False, "count": 200, "offset": offset}])
            data = reply[0].get("data", {})
            assert isinstance(data, dict)
            names = [str(n) for n in data.get("clients", [])]
            found |= {n for n in names if n.startswith("hub-")}
            offset += len(names)
            if not names or offset >= int(data.get("totalCount", 0)):
                return found


def reconcile(broker: DynsecBroker, due: set[str]) -> list[str]:
    """Delete every hub login the database no longer wants (a purged or removed device). Returns what it removed."""
    extra = sorted(broker.list_devices() - due)
    for device_id in extra:
        broker.delete_device(device_id)
    return extra
