# Common tasks across every component. Run `make help` for the list.

COMPOSE = docker compose --env-file server/deploy/.env -f server/deploy/docker-compose.yml

.PHONY: help up down logs lint test test-core test-server test-client test-studio test-firmware sim

help:
	@echo "up             start the server stack (db, redis, mqtt, minio, server, worker)"
	@echo "down           stop the stack, keeping data volumes"
	@echo "logs           follow the stack logs"
	@echo "lint           lint every component"
	@echo "test           test every component"
	@echo "sim            run the hub simulator against a local server"

up:
	$(COMPOSE) up --build -d

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

test: test-core test-server test-client test-studio test-firmware

test-core:
	cd core && cargo test

test-server:
	cd server && pytest -q

test-client:
	cd client && pytest -q

test-studio:
	cd studio && npm run build

test-firmware:
	cd firmware && pio test -e native

sim:
	melophos-sim --profile profiles/piano-88.json --server http://localhost:8000
