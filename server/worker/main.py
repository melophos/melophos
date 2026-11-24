"""Worker entry point: `python -m worker.main`.

Webhook delivery, song import, session scoring and the tidy-up each run in a loop of their own, so a slow receiver
or a long import can never delay the others and a loop that raises is logged and carries on.
"""

import logging
import os
import signal
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from types import FrameType

from app.accounts import AccountStore
from app.broker import DynsecBroker, reconcile
from app.config import check_secrets, get_settings
from app.db import Pool, check_least_privilege, make_pool
from app.scoring import ScoreRunner, choose_scorer
from app.security import RateLimiter
from app.webhooks import Dispatcher, SecretBox

from .jobs import fail_stuck, process_next

log = logging.getLogger("melophos.worker")

HEARTBEAT_LOOPS = ("webhooks", "imports", "scoring")
IDLE_SECONDS = 2.0
TIDY_EVERY = 3600.0


def heartbeat(name: str, directory: Path | None = None) -> None:
    """Touch a file for this loop, so the container's health check can see that every loop is still going round."""
    base = directory or Path(os.getenv("WORKER_HEARTBEAT_DIR", "/tmp"))
    with suppress(OSError):
        (base / f"melophos-worker-{name}").touch()


def worker_is_alive(directory: Path | None = None, max_age: float = 60.0) -> bool:
    """True when each of the three loops has gone round within `max_age` seconds. The tidy-up runs hourly and is
    not part of this."""
    base = directory or Path(os.getenv("WORKER_HEARTBEAT_DIR", "/tmp"))
    now = time.time()
    for name in HEARTBEAT_LOOPS:
        try:
            if now - (base / f"melophos-worker-{name}").stat().st_mtime > max_age:
                return False
        except OSError:
            return False
    return True


def loop(
    name: str, work: Callable[[], bool], stop: threading.Event, once: bool, idle: float = IDLE_SECONDS
) -> None:
    """Run `work` until stopped. It returns True when it found something, so the loop goes straight on."""
    while not stop.is_set():
        if name in HEARTBEAT_LOOPS:
            heartbeat(name)
        try:
            busy = work()
        except Exception:
            log.exception("%s loop failed, carrying on", name)
            busy = False
        if once:
            return
        if not busy:
            stop.wait(idle)


def build_loops(pool: Pool, once: bool = False) -> list[tuple[str, Callable[[], bool], float]]:
    settings = get_settings()
    dispatcher = Dispatcher(
        pool, SecretBox(settings.secret_key), allow_private=settings.webhook_allow_private
    )
    scores = ScoreRunner(pool, choose_scorer(settings.allow_stand_in_scorer))
    accounts = AccountStore(pool, settings.secret_key)
    limiter = RateLimiter(pool)
    broker = (
        DynsecBroker(
            settings.mqtt_host, settings.mqtt_port, settings.mqtt_admin_username, settings.mqtt_admin_password
        )
        if settings.mqtt_host and settings.mqtt_admin_username
        else None
    )

    def webhooks() -> bool:
        report = dispatcher.run_once()
        return bool(report.delivered + report.retrying + report.failed)

    def imports() -> bool:
        return process_next(pool)

    def scoring() -> bool:
        report = scores.run_once()
        return bool(report.scored + report.retrying + report.failed)

    def tidy() -> bool:
        accounts.purge_unclaimed()
        limiter.purge()
        accounts.purge_expired()
        fail_stuck(pool)
        if broker is not None:
            reconcile(broker, accounts.broker_logins_due())
        return False

    return [
        ("webhooks", webhooks, IDLE_SECONDS),
        ("imports", imports, IDLE_SECONDS),
        ("scoring", scoring, IDLE_SECONDS),
        ("tidy", tidy, TIDY_EVERY),
    ]


def run(once: bool = False) -> None:
    settings = get_settings()
    check_secrets(settings)
    if not settings.allow_privileged_database:
        check_least_privilege(settings.database_url)
    pool = make_pool(settings.database_url, max_size=8)
    pool.open(wait=True, timeout=10)
    stop = threading.Event()

    def on_signal(_signum: int, _frame: FrameType | None) -> None:
        stop.set()

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, on_signal)
        signal.signal(signal.SIGINT, on_signal)
    threads = [
        threading.Thread(target=loop, args=(name, work, stop, once, idle), name=f"worker-{name}")
        for name, work, idle in build_loops(pool, once)
    ]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        stop.set()
        pool.close()


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    print("melophos worker ready")
    run()


if __name__ == "__main__":
    main()
