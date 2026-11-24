FROM eclipse-mosquitto:2.1.4@sha256:fa12172a051310efe5bcb7a6a11b77bd5faacb82cbacd7742aa758bf024fd8e4

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY start.sh /start.sh
COPY healthcheck.sh /healthcheck.sh

# the data folder holds the rules file, so it must be writable by the broker's own user and kept on a volume
RUN mkdir -p /mosquitto/data /mosquitto/conf.d /mosquitto/certs \
    && chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/conf.d
VOLUME /mosquitto/data
USER mosquitto

EXPOSE 1883 8883
ENTRYPOINT ["/start.sh"]
