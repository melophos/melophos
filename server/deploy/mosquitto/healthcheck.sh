#!/bin/sh
# Healthy when the broker answers the administrator and lists its own "admin" role. The password goes to mosquitto_ctrl
# through an options file that only this user can read and that is gone when the check ends, never as an argument,
# because the arguments of a running program can be read from the host's process list.
# mosquitto_ctrl exits 0 even when it cannot connect, so the answer is read and not the exit status.
set -eu
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
umask 077
{
    echo "-i healthcheck"
    echo "-h 127.0.0.1"
    echo "-p 1883"
    echo "-u ${MQTT_ADMIN_USERNAME}"
    echo "-P ${MQTT_ADMIN_PASSWORD}"
} > "$dir/mosquitto_ctrl"
XDG_CONFIG_HOME="$dir" mosquitto_ctrl dynsec listRoles 2> /dev/null | grep -qx admin
