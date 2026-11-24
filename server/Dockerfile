# builds the one image the server, the worker and the two one-shot steps all run (they differ only in their command).
#
# The scoring engine is a Rust crate in core/, built here from the `core` build context so each platform gets its own
# native wheel. Pass it with `--build-context core=<folder>` (CI and deploy/build-local.sh do). A wheel already built
# in server/wheels/ (deploy/build-engine-wheel.sh) is used too. With neither, the build stops.

FROM scratch AS core

FROM rust:1.85-slim-bookworm@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36 AS engine
# python is pinned to the exact versions of this base image's Debian release. When Debian replaces one the build stops
# here on purpose (the old version is gone from the mirror) and the numbers are moved forward by hand. The packages
# these depend on are not pinned, only the base image's digest holds them
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
        python3=3.11.2-1+b1 python3-venv=3.11.2-1+b1 python3.11=3.11.2-6+deb12u9 python3.11-venv=3.11.2-6+deb12u9 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-engine.lock /tmp/requirements-engine.lock
COPY --from=core . /src
RUN mkdir /out && if [ -f /src/python/Cargo.toml ]; then \
        python3 -m venv /v && /v/bin/pip install -q --require-hashes --no-deps -r /tmp/requirements-engine.lock \
        && /v/bin/pip check \
        && cd /src && CARGO_TARGET_DIR=/tmp/target /v/bin/maturin build --release --locked \
            --manifest-path python/Cargo.toml --out /out; \
    fi

# the Python that CI tests (3.12 and 3.14), pinned by digest
FROM python:3.14.10-slim@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f

# the time this image was built from, as epoch seconds (CI passes the commit's time). The server refuses to start on a
# clock that says it is earlier, see app/clock.py
ARG BUILD_EPOCH=
WORKDIR /srv
ENV MELOPHOS_BUILD_EPOCH=$BUILD_EPOCH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MIGRATIONS_DIR=/srv/db/migrations ENV_EXAMPLE_PATH=/srv/deploy/.env.example

COPY pyproject.toml README.md requirements.lock requirements-build.lock ./
COPY app ./app
COPY worker ./worker
COPY db ./db
# the example file, so the start-up check can tell a copied example value from a real one
COPY deploy/.env.example ./deploy/.env.example
COPY wheels ./wheels
COPY --from=engine /out ./wheels-built
RUN (ls wheels/melophos_core-*.whl wheels-built/melophos_core-*.whl 2> /dev/null | grep -q melophos_core) \
    || (echo "no melophos_core wheel: pass --build-context core=<core folder> or run deploy/build-engine-wheel.sh" >&2; exit 1)
# every package comes from a lock file with hashes: pip refuses anything else. The engine is the wheel built above
RUN pip install --no-cache-dir --no-index --no-deps --find-links wheels --find-links wheels-built melophos-core \
    && pip install --no-cache-dir --require-hashes --no-deps -r requirements-build.lock -r requirements.lock \
    && pip install --no-cache-dir --no-deps --no-build-isolation --no-index . \
    && pip check \
    && pip uninstall -y setuptools \
    && rm -rf wheels wheels-built requirements.lock requirements-build.lock

# run as an unprivileged user, the container never needs root after install
RUN useradd --system --uid 10001 melophos
USER melophos

EXPOSE 8000
# no image-level health check: the server and the worker are different programs, so each has its own in the compose file
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
