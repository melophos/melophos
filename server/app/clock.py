"""The server's clock and whether it can be believed.

The server decides which session dates are accepted and hubs take their time from it (`server_time`), so two things
matter. The clock must not be plainly wrong: the server refuses to start before the time its software was built. And
the clock must be known to be right. A Raspberry Pi has no battery clock: after a power cut its system restores the
last shutdown time, so the clock starts at once but is behind by the length of the cut until the network has set it.
The kernel knows whether its clock has been synchronised and the server asks it (adjtimex, through ctypes: no extra
package). A server whose clock is not synchronised still runs. It tells hubs the time is not yet trusted and marks
the sessions it receives meanwhile.

CLOCK_SYNC decides what is reported: auto asks the kernel, true always reports synchronised and false never does."""

import ctypes
import logging
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger("melophos.clock")

# the build time is set when the image is built (--build-arg BUILD_EPOCH, the time of the commit). A run from source
# uses the newest file of the app folder, which is when this code was last written
BUILD_EPOCH_ENV = "MELOPHOS_BUILD_EPOCH"
MODES = ("auto", "true", "false")


def build_time() -> float:
    raw = os.getenv(BUILD_EPOCH_ENV, "").strip()
    if raw.isdigit() and int(raw) > 1_000_000_000:
        return float(raw)
    newest = max((p.stat().st_mtime for p in Path(__file__).parent.rglob("*.py")), default=0.0)
    return newest


def server_time() -> int:
    """Whole seconds since the Unix epoch in UTC."""
    return int(time.time())


def check_clock(now: float | None = None, floor: float | None = None) -> None:
    moment = time.time() if now is None else now
    built = build_time() if floor is None else floor
    if moment < built:
        shown = datetime.fromtimestamp(moment, UTC).strftime("%Y-%m-%d %H:%M UTC")
        made = datetime.fromtimestamp(built, UTC).strftime("%Y-%m-%d")
        raise RuntimeError(
            f"the server's clock says {shown}, which is before this version was built ({made}). "
            "Set the system time (enable network time) and start the server again. It refuses to run on a clock "
            "this wrong, because session dates and the time hubs are told depend on it"
        )


class _Timex(ctypes.Structure):
    """struct timex of 64-bit Linux, 208 bytes."""

    _fields_ = [
        ("modes", ctypes.c_uint), ("offset", ctypes.c_long), ("freq", ctypes.c_long), ("maxerror", ctypes.c_long),
        ("esterror", ctypes.c_long), ("status", ctypes.c_int), ("constant", ctypes.c_long), ("precision", ctypes.c_long),
        ("tolerance", ctypes.c_long), ("time_sec", ctypes.c_long), ("time_usec", ctypes.c_long), ("tick", ctypes.c_long),
        ("ppsfreq", ctypes.c_long), ("jitter", ctypes.c_long), ("shift", ctypes.c_int), ("stabil", ctypes.c_long),
        ("jitcnt", ctypes.c_long), ("calcnt", ctypes.c_long), ("errcnt", ctypes.c_long), ("stbcnt", ctypes.c_long),
        ("tai", ctypes.c_int), ("padding", ctypes.c_int * 11),
    ]  # fmt: skip


STA_UNSYNC = 0x0040
TIME_ERROR = 5  # what adjtimex returns while the clock is not synchronised


def kernel_synchronised() -> bool | None:
    """True or False as the kernel says or None when this platform cannot say (not 64-bit Linux or the call is
    refused, for example by a container's security profile)."""
    if not sys.platform.startswith("linux") or ctypes.sizeof(ctypes.c_long) != 8:
        return None
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        timex = _Timex()  # modes 0: only read, nothing is set
        state = libc.adjtimex(ctypes.byref(timex))
    except (OSError, AttributeError):
        return None
    if state < 0:
        return None
    return not (state == TIME_ERROR or timex.status & STA_UNSYNC)


_last: list[bool | None | str] = ["unset"]


def sync_status(mode: str) -> bool | None:
    """What the server tells hubs: True (the clock is the authority), False (hold, do not take this time yet) or
    None (cannot be read: a hub treats it as True)."""
    state: bool | None = {"true": True, "false": False}.get(mode)
    if mode == "auto":
        state = kernel_synchronised()
    if state != _last[0]:
        if _last[0] != "unset":
            log.warning("the server's clock status changed to %s", _describe(state))
        _last[0] = state
    return state


def _describe(state: bool | None) -> str:
    return {True: "synchronised", False: "NOT synchronised", None: "unknown"}[state]


def announce_clock(mode: str) -> None:
    """One plain line at start about the state of the clock."""
    if mode not in MODES:
        raise RuntimeError(f"CLOCK_SYNC must be one of {', '.join(MODES)}, not {mode!r}")
    state = sync_status(mode)
    if state is False:
        log.warning(
            "the server's clock is NOT synchronised (after a power cut a Raspberry Pi starts with the time it was "
            "switched off at). The server runs, hubs are told the time is not yet trusted and the sessions it "
            "receives meanwhile are marked. Check with: timedatectl show -p NTPSynchronized"
        )
    elif state is None:
        log.warning(
            "the server could not read whether its clock is synchronised on this platform, so it treats the clock as "
            "trusted. Set CLOCK_SYNC=false to hold hubs back or CLOCK_SYNC=true to silence this"
        )
    else:
        log.info("the server's clock is synchronised")
