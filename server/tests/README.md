# Server tests

```bash
pytest
```

| File | Covers |
| --- | --- |
| `test_health.py` | The health route |
| `test_sessions.py` | Creating, listing and fetching sessions, validation and missing sessions |
| `test_stats.py` | Session summaries and the per-key heatmap |
| `test_mqtt.py` | Hub topic validation, including wildcard rejection |
| `test_integrations.py` | Spotify scopes and settings, WLED colours |
| `test_profiles.py` | Every instrument profile against the schema (monorepo only) |
