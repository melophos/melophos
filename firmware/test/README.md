# Firmware tests

Unity tests for the libraries in [`../lib/`](../lib/), run on the development machine:

```bash
pio test -e native
```

| Test | Covers |
| --- | --- |
| `test_keymap` | Black-key detection, per-key and strip mapping, range checks and reversed bars |
| `test_notebus` | Event ordering, overflow handling and the dropped-event counter |
