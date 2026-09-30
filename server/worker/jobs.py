"""Import jobs. Transcription is slow, so the API queues them and the worker runs them."""

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class ImportKind(StrEnum):
    midi = "midi"  # parsed directly, no model needed
    audio = "audio"  # polyphonic transcription (Basic Pitch or Transkun)
    video = "video"  # falling-note tutorial video, read by computer vision


@dataclass(frozen=True)
class ImportJob:
    song_id: str
    kind: ImportKind
    source: Path


SUFFIXES = {
    ".mid": ImportKind.midi,
    ".midi": ImportKind.midi,
    ".wav": ImportKind.audio,
    ".mp3": ImportKind.audio,
    ".flac": ImportKind.audio,
    ".mp4": ImportKind.video,
    ".mkv": ImportKind.video,
    ".webm": ImportKind.video,
}


def kind_for(path: Path) -> ImportKind | None:
    return SUFFIXES.get(path.suffix.lower())


def run(job: ImportJob) -> None:
    # each importer lands as its own milestone in docs/roadmap.md
    raise NotImplementedError(f"{job.kind} import is not implemented yet")
