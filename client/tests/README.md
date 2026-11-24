# Client tests

```bash
pytest
```

| File | Covers |
| --- | --- |
| `test_simulator.py` | Simulated sessions pair every press with a release, stay in time order, respect the instrument's range, work for guitars and match the server's session shape |
| `test_client.py` | Credentials sent for account and device calls, paging, redirects refused, the saved identity is owner-only, MQTT batching and the pairing flow |

The run against a real broker and server is `server/tests/test_mqtt_e2e.py`.
