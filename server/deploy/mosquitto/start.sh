#!/bin/sh
# first start only: create the plugin's rules file with one administrator. The server adds the roles and the
# ingest login itself and one login per paired hub.
#
# every start: write the listeners. With a certificate mounted at /mosquitto/certs (server.crt holding the full
# chain and server.key) the broker also listens with TLS on 8883.
set -eu
: "${MQTT_ADMIN_USERNAME:?set MQTT_ADMIN_USERNAME}"
: "${MQTT_ADMIN_PASSWORD:?set MQTT_ADMIN_PASSWORD}"
file=/mosquitto/data/dynamic-security.json
if [ ! -f "$file" ]; then
    mosquitto_ctrl dynsec init "$file" "$MQTT_ADMIN_USERNAME" "$MQTT_ADMIN_PASSWORD"
fi

listeners=/mosquitto/conf.d/listeners.conf
: > "$listeners"
if [ -f /mosquitto/certs/server.crt ] && [ -f /mosquitto/certs/server.key ]; then
    {
        echo "listener 8883"
        echo "max_packet_size 131072"
        echo "max_connections 500"
        echo "certfile /mosquitto/certs/server.crt"
        echo "keyfile /mosquitto/certs/server.key"
    } >> "$listeners"
fi
# the plain listener always stays: the server and the worker reach the broker over the private compose network.
# Keep it away from the outside by publishing it on the loopback address only, see MQTT_PLAIN_BIND
{
    echo "listener 1883"
    echo "max_packet_size 131072"
    echo "max_connections 500"
} >> "$listeners"
exec mosquitto -c /mosquitto/config/mosquitto.conf
