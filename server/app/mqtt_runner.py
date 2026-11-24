"""The server's MQTT subscription. Messages go to IngestHandler, which never raises.

Two layers keep one bad message from stopping ingest for everyone. The handler catches everything per message and
the callback here catches again around it. A supervisor thread watches the client's network thread and starts a
new client if it ever dies and `healthy()` feeds the readiness route so a dead ingest is visible from outside.
"""

import logging
import threading

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

from .broker import DEFAULT_GROUP, shared_filter
from .ingest import IngestHandler

log = logging.getLogger("melophos.mqtt")

CHECK_SECONDS = 2.0
# the session lives a week at the broker while the server is away, so hub messages wait for it. The broker holds at
# most 20 000 messages or 64 MiB for it and beyond that it drops the newest, which a hub that was already
# acknowledged cannot resend. Keep outages well inside that: about 80 minutes for one hub playing, less for many
SESSION_EXPIRY_SECONDS = 7 * 24 * 3600


class MqttIngest:
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        handler: IngestHandler,
        client_id: str = "melophos-server",
        group: str = DEFAULT_GROUP,
        session_expiry: int = SESSION_EXPIRY_SECONDS,
    ) -> None:
        self.client_id = client_id
        self.group = group
        self._session_expiry = session_expiry
        self._host, self._port = host, port
        self._username, self._password = username, password
        self._handler = handler
        self._client: mqtt.Client | None = None
        self._stop = threading.Event()
        self._supervisor: threading.Thread | None = None
        self.subscribed = False
        self.restarts = 0

    def _build(self) -> mqtt.Client:
        client = mqtt.Client(
            CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
            protocol=mqtt.MQTTv5,
        )
        client.username_pw_set(self._username, self._password)
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.on_disconnect = self._on_disconnect
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        return client

    def _on_connect(self, client: mqtt.Client, _u: object, _f: object, reason: object, _p: object) -> None:
        if getattr(reason, "is_failure", False):
            log.error("the broker refused the server login: %s", reason)
            return
        client.subscribe(shared_filter(self.group), qos=1)
        self.subscribed = True

    def _on_disconnect(self, _c: mqtt.Client, _u: object, _f: object, _reason: object, _p: object) -> None:
        self.subscribed = False

    def _on_message(self, _c: mqtt.Client, _u: object, message: mqtt.MQTTMessage) -> None:
        try:
            self._handler.handle(message.topic, bytes(message.payload))
        except BaseException:
            # the handler already catches everything, so this is the last line: an exception here would end the
            # client's network thread and silence every hub
            log.exception("ingest callback failed")

    def _launch(self) -> None:
        self._client = self._build()
        # a fixed client id and no clean start: the broker keeps the subscription and queues what arrives while the
        # server is away and hands it over when the same id returns. Each server process needs its own id
        properties = Properties(PacketTypes.CONNECT)  # type: ignore[no-untyped-call]
        properties.SessionExpiryInterval = self._session_expiry
        self._client.connect_async(
            self._host, self._port, keepalive=30, clean_start=False, properties=properties
        )
        self._client.loop_start()

    def thread_alive(self) -> bool:
        thread = getattr(self._client, "_thread", None) if self._client else None
        return bool(thread is not None and thread.is_alive())

    def healthy(self) -> bool:
        """Ingest works only while the thread is alive and the broker connection is up and subscribed."""
        return self.thread_alive() and self.subscribed

    def _replace_dead_client(self) -> None:
        """Close everything the dead client held, then start a new one. Its socket would otherwise stay open."""
        self.subscribed = False
        old = self._client
        if old is not None:
            for close in (old.loop_stop, old.disconnect, getattr(old, "_sock_close", None)):
                if close is not None:
                    try:
                        close()
                    except Exception:
                        log.debug("closing the dead ingest client", exc_info=True)
        self._launch()

    def _watch(self) -> None:
        while not self._stop.wait(CHECK_SECONDS):
            if not self.thread_alive():
                log.error("the ingest thread died, starting a new one")
                self.restarts += 1
                self._replace_dead_client()

    def start(self) -> None:
        self._launch()
        self._supervisor = threading.Thread(target=self._watch, name="ingest-supervisor", daemon=True)
        self._supervisor.start()

    def stop(self) -> None:
        self._stop.set()
        if self._client is not None:
            self._client.disconnect()
            self._client.loop_stop()
