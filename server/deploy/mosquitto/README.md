# Mosquitto

`mosquitto.conf` configures the MQTT broker the hubs publish to on port 1883.

> [!WARNING]
> Anonymous access is on for a trusted home network only. Before exposing the broker, create a password file with `mosquitto_passwd` and set `allow_anonymous false`.
