# Mosquitto

The MQTT broker the hubs publish to on port 1883. It is built from a small image so the first start can create its administrator.

Nobody connects anonymously. Access is decided by Mosquitto's dynamic security plugin, whose rules the server writes:

| Role | May do |
| --- | --- |
| `hub` (one login per paired hub, named by its device id) | Publish to `melophos/<its own device id>/+`. Nothing else and it cannot subscribe to anything |
| `ingest` (the server's own login) | Read `melophos/+/+` through one shared subscription |

The broker stores each password hashed. A hub's login is created when it asks for a pairing code, changed when its credential is rotated and deleted when it is unpaired. The rules file lives on the `mqtt-data` volume. Messages over 2 MiB are refused by the broker itself.

> [!WARNING]
> Port 1883 is plain text. Keep it on the local network or behind a VPN or add a TLS listener, before hubs connect from elsewhere.
