"""Worker entry point: `python -m worker.main`."""

from .jobs import ImportKind


def main() -> None:
    print("melophos worker ready, importers:", ", ".join(k.value for k in ImportKind))


if __name__ == "__main__":
    main()
