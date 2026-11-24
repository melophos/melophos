# common tasks across every component. Run `make help` for the list.

# builds the images from this checkout. A release uses the published ones, see docs/self-hosting.md
COMPOSE = server/deploy/build-local.sh

.PHONY: help up down logs lint test test-core test-core-wasm test-core-python test-server test-client test-studio test-site test-firmware sim

help:
	@echo "up             start the server stack (db, redis, mqtt, minio, server, worker)"
	@echo "down           stop the stack, keeping data volumes"
	@echo "logs           follow the stack logs"
	@echo "lint           lint every component"
	@echo "test           test every component"
	@echo "sim            run the hub simulator against a local server"

up:
	$(COMPOSE)

# stop, never down -v: down -v deletes the database volume
down:
	$(COMPOSE) stop

logs:
	$(COMPOSE) logs -f

lint:
	cd core && cargo fmt --check && cargo clippy --all-targets -- -D warnings
	cd server && ruff check . && ruff format --check .
	cd client && ruff check . && ruff format --check .
	cd studio && npm run typecheck
	cd site && npm run typecheck

test: test-core test-server test-client test-studio test-site test-firmware

test-core:
	cd core && cargo test

# needs the wasm32 target, wasm-bindgen-cli and Node, so it is not part of `make test`: see core/wasm/README.md
test-core-wasm:
	cd core && sh wasm/build.sh && cd wasm/package && npm run typecheck && npm test

# needs maturin and pytest in a virtual environment at core/python/.venv, see core/README.md
test-core-python:
	cd core/python && .venv/bin/maturin develop --release --locked && .venv/bin/pytest -q

test-server:
	cd server && pytest -q

test-client:
	cd client && pytest -q

test-studio: test-core-wasm
	cd studio && npm test && npm run build

# the site's unit tests, then a build that checks links, alt text, headers and the writing rules.
# the browser checks (make check-site) need Chromium: run npx playwright install chromium once in site/
test-site:
	cd site && npm test && npm run build

check-site:
	cd site && npm run check

test-firmware:
	cd firmware && pio test -e native

sim:
	melophos-sim --profile profiles/piano-88.json --server http://localhost:8000
