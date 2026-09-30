# Monitoring

`prometheus.yml` scrapes the server's `/metrics` endpoint (standard process and Python metrics) every 30 seconds. Prometheus and Grafana only start with the monitoring profile:

```bash
docker compose --profile monitoring up -d
```

Grafana is then on port 3000 and Prometheus on port 9090.
