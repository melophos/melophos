# Engine wheel

The scoring engine's Linux wheel goes here before the image is built. CI downloads it from the `melophos-core-wheel` artifact. Locally run `deploy/build-engine-wheel.sh`, which builds it with Docker from `core/`. The wheel files are not committed.
