"""The hub's identity on disk, so the simulator keeps its pairing between runs."""

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Credentials:
    server: str
    device_id: str
    device_secret: str
    boot: int = 0

    def save(self, path: Path) -> None:
        # owner-only from the first byte, the secret grants the hub's whole identity
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(asdict(self), handle)

    @classmethod
    def load(cls, path: Path) -> "Credentials":
        data = json.loads(path.read_text())
        return cls(
            server=str(data["server"]),
            device_id=str(data["device_id"]),
            device_secret=str(data["device_secret"]),
            boot=int(data.get("boot", 0)),
        )
