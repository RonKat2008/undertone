"""Always-on capture (ALWAYS_ON=1): the band listens all the time, conversations open and close
by themselves.

- At band connect the mic goes on and one Deepgram worker runs for as long as the server does.
  (After a Bluetooth auto-reconnect BandSource._apply_settings re-sends audio=mic_on, so the
  mic comes back on with the band.) A worker that dies is restarted on the next tick, with a
  growing backoff and one warning per outage.
- One conversation at a time, in one of four phases:

      idle --first turn.final--> opening --session joined--> open --silence/tap/...--> closing --> idle

  Every hearing event passes through `intercept`. While a conversation is opening or closing,
  events are held back and replayed once that is done, so nothing heard is lost, and the next
  conversation only opens after the previous one has fully closed (session.ended out, Brain
  session cleared, row ended, controller stopped). The debrief then runs in the background.
- Which conversation a turn belongs to is decided by when it was SPOKEN, not when Deepgram
  finished it: a turn.final that started before the last close (its words were said in that
  conversation, the turn just completed late) is stored with that conversation and never opens
  a new one. A turn that started after the close opens the next conversation.
- After `silence_s` with no turn.final and no transcript.partial the conversation is closed.
  With fewer than `min_turns` final turns it is closed quietly: transcript kept, no debrief.
  A double-tap always gets its debrief.
- Rejoin: after a silence close the conversation is parked for `rejoin_s` seconds. Its debrief
  and keep-classification wait. Speech in that window resumes the same session (same id, same
  t=0, same recording); otherwise it is finished when the window ends, when a new conversation
  opens, on a double-tap, on a pipeline restart or at shutdown.
- Closes that are not ours (the phone's or dashboard's Start / Stop) are followed through
  `begin` and `ended`, which the controller calls on every session start and stop.

The clock is injectable, so tests drive it without sleeping:

    ao = AlwaysOn(host, open_conversation, close_conversation, AlwaysOnConfig(), clock=fake)
    ...
    await ao.tick()      # what the 1 Hz watcher runs
    await ao.settle()    # opens, resumes and debriefs in flight
"""
from __future__ import annotations

import asyncio
import logging
import time
import weakref
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional, Protocol

log = logging.getLogger("undertone.always_on")

Clock = Callable[[], float]
TICK_S = 1.0
RESTART_BACKOFF_S = 10.0      # first retry of a Deepgram worker that will not start ...
RESTART_BACKOFF_MAX_S = 60.0  # ... doubling up to this
STILL_DOWN_LOG_S = 300.0      # while it stays down, one reminder this often

IDLE, OPENING, OPEN, CLOSING = "idle", "opening", "open", "closing"
SILENCE, DOUBLE_TAP, MANUAL, SHUTDOWN, RESTART = (
    "silence", "double-tap", "manual", "shutdown", "pipeline restart")
FORCED = (DOUBLE_TAP,)  # closes that always get a debrief


@dataclass(frozen=True)
class AlwaysOnConfig:
    silence_s: float = 60.0
    min_turns: int = 4
    rejoin_s: float = 0.0


@dataclass(frozen=True)
class Parked:
    """A conversation closed on silence whose debrief waits for the rejoin window."""
    session_id: str
    until: float
    turns: int
    opened_at: float
    closed_at: float


@dataclass(frozen=True)
class LastClose:
    session_id: str
    audio_s: float  # stream time of the close: turns that started before it belong to it


class SilenceTimer:
    """Seconds since anyone last spoke."""

    def __init__(self, silence_s: float, clock: Clock = time.monotonic) -> None:
        self.silence_s = silence_s
        self._clock = clock
        self._last = clock()

    def touch(self) -> None:
        self._last = self._clock()

    def idle_s(self) -> float:
        return self._clock() - self._last

    def expired(self) -> bool:
        return self.idle_s() >= self.silence_s


class Host(Protocol):
    """What AlwaysOn needs from the SessionController (flush_hearing, stop_dead_hearing,
    stream_seconds and pipeline_ok are used when present)."""

    @property
    def running(self) -> bool: ...

    session_id: Optional[str]

    def listening_ok(self) -> bool: ...

    async def ensure_listening(self) -> None: ...

    def deliver(self, ev: dict) -> None: ...


OpenFn = Callable[[], Awaitable[None]]
CloseFn = Callable[..., Awaitable[None]]                  # (quiet, park)
ResumeFn = Callable[[str], Awaitable[bool]]               # session_id -> resumed?
FinishFn = Callable[[str, bool], Awaitable[None]]         # (session_id, wait for the debrief)
LateFn = Callable[[str, dict], None]                      # (session_id, raw turn.final)

_instances: "weakref.WeakSet[AlwaysOn]" = weakref.WeakSet()


async def settle_all() -> None:
    """Tests: wait until every AlwaysOn has nothing in flight."""
    for ao in list(_instances):
        await ao.settle()


class AlwaysOn:
    def __init__(self, host: Host, open_conversation: OpenFn, close_conversation: CloseFn,
                 config: AlwaysOnConfig = AlwaysOnConfig(), clock: Clock = time.monotonic,
                 resume_conversation: Optional[ResumeFn] = None,
                 finish_conversation: Optional[FinishFn] = None,
                 late_turn: Optional[LateFn] = None) -> None:
        self.host = host
        self.config = config
        self.timer = SilenceTimer(config.silence_s, clock)
        self.turns = 0
        self.phase = IDLE
        self._clock = clock
        self._open_fn = open_conversation
        self._close_fn = close_conversation
        self._resume_fn = resume_conversation
        self._finish_fn = finish_conversation
        self._late_fn = late_turn
        self._held: List[dict] = []        # events held back while opening / closing
        self._next_offset: Optional[float] = None
        self._offsets: Dict[str, float] = {}
        self._opened_at = clock()
        self._closing = False
        self._close_after_open: Optional[str] = None
        self._parked: Optional[Parked] = None
        self._last_close: Optional[LastClose] = None
        self._stopping = False
        self._next_restart = 0.0
        self._restart_wait = RESTART_BACKOFF_S
        self._down_since: Optional[float] = None
        self._down_attempts = 0
        self._last_down_log = 0.0
        self._watcher: Optional[asyncio.Task] = None
        self._tasks: List[asyncio.Future] = []
        _instances.add(self)

    @property
    def parked(self) -> Optional[str]:
        return self._parked.session_id if self._parked is not None else None

    @property
    def pending_offset(self) -> Optional[float]:
        """Stream time of the turn that is opening a conversation (its t=0), if any."""
        return self._next_offset

    def offset_of(self, session_id: str) -> float:
        return self._offsets.get(session_id, 0.0)

    def describe(self) -> dict:
        """For /health."""
        p = self._parked
        return {"state": self.phase, "turns": self.turns if self.phase == OPEN else 0,
                "idle_s": round(self.timer.idle_s(), 1) if self.phase == OPEN else None,
                "silence_s": self.config.silence_s, "rejoin_s": self.config.rejoin_s,
                "min_turns": self.config.min_turns,
                "parked": None if p is None else {
                    "session_id": p.session_id, "rejoin_left_s": round(max(0.0, p.until - self._clock()), 1)}}

    # ---------- lifecycle ----------

    async def start(self) -> None:
        """Band connected: mic on, Deepgram up, watcher running."""
        await self._keep_listening()
        self._watcher = asyncio.create_task(self._watch())
        log.info("always-on: listening (close after %.0f s of silence, rejoin within %.0f s, "
                 "debrief from %d turns)", self.config.silence_s, self.config.rejoin_s, self.config.min_turns)

    async def stop(self) -> None:
        """Shutdown: nothing new opens; close what is open, finish what is parked."""
        self._stopping = True
        if self._watcher is not None:
            self._watcher.cancel()
            self._watcher = None
        try:
            await asyncio.wait_for(self.settle(), timeout=30)
        except Exception:  # noqa: BLE001
            log.exception("always-on: pending work did not finish at shutdown")
        if self.phase == OPEN:
            await self.close(reason=SHUTDOWN)
        await self._finish_parked(wait=True)
        await self.settle()

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
            except Exception:  # noqa: BLE001
                log.exception("always-on tick failed")

    async def tick(self) -> None:
        if self.phase == OPEN and self.host.running and self.timer.expired():
            await self.close(reason=SILENCE)
        if self._parked is not None and self._clock() >= self._parked.until:
            await self._finish_parked(wait=False)
        ok = getattr(self.host, "pipeline_ok", self.host.listening_ok)
        if not ok():
            await self._recover_listening()
        elif self._down_since is not None:
            log.info("always-on: speech pipeline back up after %.0f s (%d restart attempts)",
                     self._clock() - self._down_since, self._down_attempts)
            self._down_since, self._down_attempts = None, 0
            self._restart_wait = RESTART_BACKOFF_S

    def clock_reset(self) -> None:
        """The band / Deepgram stream clock restarted at 0: old stream times mean nothing."""
        self._next_offset = None
        self._last_close = None
        self._offsets = {}
        if self._parked is not None:  # it cannot resume across a clock reset
            self._spawn(self._finish_parked(wait=False))

    # ---------- hearing events (called by the controller, synchronously) ----------

    def intercept(self, ev: dict) -> bool:
        """True when `ev` was taken care of here: held back (a conversation is opening or
        closing), or stored with the conversation it was spoken in."""
        if self._stopping:
            return False
        if self._is_late(ev):
            sid = self._last_close.session_id
            log.info("always-on: a turn spoken before %s closed arrived late; stored with it", sid)
            self._late_fn(sid, ev)
            return True
        if self.phase in (OPENING, CLOSING):
            self._held.append(ev)
            return True
        if self.phase == OPEN or ev.get("type") != "turn.final":
            return False
        if self.host.running:  # a session the controller joined without us: follow it
            self.phase = OPEN
            return False
        self.phase = OPENING
        self._held = [ev]
        p = self._parked
        if p is not None and self._clock() < p.until and self._resume_fn is not None:
            self._spawn(self._resume(p))
        else:
            self._next_offset = float(ev["start"])
            self._spawn(self._open())
        return True

    def _is_late(self, ev: dict) -> bool:
        lc = self._last_close
        return (lc is not None and self._late_fn is not None and ev.get("type") == "turn.final"
                and float(ev.get("start", 0.0)) < lc.audio_s)

    def note(self, ev: dict) -> None:
        """A hearing event inside an open conversation: speech resets the silence timer."""
        if ev.get("type") == "turn.final":
            self.turns += 1
            self.timer.touch()
        elif ev.get("type") == "transcript.partial":
            self.timer.touch()

    def begin(self, audio_now: float) -> float:
        """A conversation just opened (auto, tap or dashboard). Returns the audio time that
        becomes its t=0: the first turn's start when it opened on a turn, else now."""
        offset = self._next_offset if self._next_offset is not None else audio_now
        self._next_offset = None
        self.turns = 0
        self.timer.touch()
        self._opened_at = self._clock()
        sid = getattr(self.host, "session_id", None)
        if sid:
            self._offsets = {**{k: v for k, v in list(self._offsets.items())[-8:]}, sid: offset}
        if self.phase == IDLE:  # opened from outside (phone / dashboard Start)
            self.phase = OPEN
            log.info("always-on: conversation %s opened (manual start)", sid)
        return offset

    def ended(self, session_id: str) -> None:
        """The controller left `session_id`. Our own closes are logged by close(); anything
        else was the phone's or dashboard's Stop / Start."""
        if self._closing or self.phase != OPEN:
            return
        log.info("always-on: conversation %s closed (%s): %d turns, %.0f s", session_id, MANUAL,
                 self.turns, self._clock() - self._opened_at)
        self.phase = IDLE
        self._mark_close(session_id)

    def _mark_close(self, session_id: Optional[str]) -> None:
        audio = getattr(self.host, "stream_seconds", None)
        if session_id and audio is not None:
            self._last_close = LastClose(session_id, float(audio()))

    # ---------- open / resume / close ----------

    async def _open(self) -> None:
        await self._finish_parked(wait=False)  # fully closed already; its debrief runs alongside
        try:
            await self._open_fn()
        except Exception:  # noqa: BLE001
            log.exception("always-on: could not open a conversation")
        self._next_offset = None
        if not self.host.running:
            held, self._held, self.phase = self._held, [], IDLE
            log.warning("always-on: no conversation could be opened; dropped %d held-back events", len(held))
            return
        self.phase = OPEN
        log.info("always-on: conversation %s opened (%s, %d events replayed)", getattr(self.host, "session_id", None),
                 "first turn", len(self._held))
        await self._after_open()

    async def _resume(self, p: Parked) -> None:
        self._parked = None
        ok = False
        try:
            ok = await self._resume_fn(p.session_id)
        except Exception:  # noqa: BLE001
            log.exception("always-on: could not resume %s", p.session_id)
        if not ok or not self.host.running:
            log.info("always-on: %s could not be resumed; opening a new conversation", p.session_id)
            self._parked = p if p.session_id != getattr(self.host, "session_id", None) else None
            self._next_offset = float(self._held[0]["start"]) if self._held else None
            await self._open()
            return
        self.phase = OPEN
        self.turns = p.turns
        self.timer.touch()
        self._opened_at = p.opened_at
        if self._last_close is not None and self._last_close.session_id == p.session_id:
            self._last_close = None  # it goes on: nothing of it is "late" any more
        log.info("always-on: conversation %s resumed after a %.0f s pause (%d events replayed)",
                 p.session_id, self._clock() - p.closed_at, len(self._held))
        await self._after_open()

    async def _after_open(self) -> None:
        self._replay()
        if self._close_after_open is not None:
            reason, self._close_after_open = self._close_after_open, None
            await self.close(reason=reason)

    def _replay(self) -> None:
        held, self._held = self._held, []
        for ev in held:
            if not self.intercept(ev):
                self.host.deliver(ev)

    async def close(self, reason: str = DOUBLE_TAP) -> None:
        """End the open conversation. Quiet (no debrief) below min_turns, unless forced by a
        tap. Harmless when nothing is open; a tap then finishes a parked conversation now."""
        if self._closing:
            return
        if self.phase == OPENING:
            self._close_after_open = reason
            return
        if self.phase != OPEN or not self.host.running:
            if self.phase == OPEN:
                self.phase = IDLE
            if reason in (DOUBLE_TAP, RESTART, SHUTDOWN):
                await self._finish_parked(wait=reason == SHUTDOWN)
            return
        self._closing = True
        try:
            await self._close_open(reason)
        finally:
            self._closing = False
        self._replay()  # what was heard during the close opens (or resumes) the next one

    async def _close_open(self, reason: str) -> None:
        sid, idle = getattr(self.host, "session_id", None), self.timer.idle_s()
        flush = getattr(self.host, "flush_hearing", None)
        if flush is not None:
            await flush(turns=True)  # the turn being spoken right now ends in this conversation
        self.phase = CLOSING
        turns, duration = self.turns, self._clock() - self._opened_at
        self._mark_close(sid)
        quiet = reason not in FORCED and turns < self.config.min_turns
        park = (reason == SILENCE and self.config.rejoin_s > 0 and self._resume_fn is not None
                and self._finish_fn is not None)
        try:
            await self._close_fn(quiet, park)
        except Exception:  # noqa: BLE001
            log.exception("always-on: closing %s failed", sid)
        finally:
            self.phase = IDLE
        log.info("always-on: conversation %s closed (%s): %d turns, %.0f s, %s", sid,
                 "%s, %.0f s" % (reason, idle) if reason == SILENCE else reason, turns, duration,
                 "rejoin window %.0f s" % self.config.rejoin_s if park
                 else ("quiet: no debrief" if quiet else "debrief"))
        if park and sid:
            now = self._clock()
            self._parked = Parked(sid, now + self.config.rejoin_s, turns, self._opened_at, now)
        elif sid and self._finish_fn is not None:
            self._spawn(self._finish_fn(sid, True))  # debrief in the background

    async def _finish_parked(self, wait: bool) -> None:
        p, self._parked = self._parked, None
        if p is None or self._finish_fn is None:
            return
        log.info("always-on: conversation %s did not resume within %.0f s: finishing it",
                 p.session_id, self.config.rejoin_s)
        try:
            await self._finish_fn(p.session_id, wait)
        except Exception:  # noqa: BLE001
            log.exception("always-on: finishing %s failed", p.session_id)

    def _spawn(self, coro: Awaitable[None]) -> None:
        self._tasks = [t for t in self._tasks if not t.done()] + [asyncio.ensure_future(coro)]

    async def settle(self) -> None:
        """Wait for opens, resumes and debriefs in flight."""
        loop = asyncio.get_running_loop()
        while True:
            pending = [t for t in self._tasks if not t.done() and t.get_loop() is loop]
            if not pending:
                return
            await asyncio.gather(*pending, return_exceptions=True)

    # ---------- keeping Deepgram up ----------

    async def _keep_listening(self) -> None:
        try:
            await self.host.ensure_listening()
        except Exception:  # noqa: BLE001
            log.exception("always-on: could not start listening")

    async def _recover_listening(self) -> None:
        now = self._clock()
        if now < self._next_restart:
            return
        self._next_restart = now + self._restart_wait
        self._restart_wait = min(RESTART_BACKOFF_MAX_S, self._restart_wait * 2)
        # a new Deepgram stream restarts its clock at 0: nothing may straddle it
        stop_dead = getattr(self.host, "stop_dead_hearing", None)
        if stop_dead is not None:
            await stop_dead()  # its last words land in the conversation they were spoken in
        if self.phase == OPEN and self.host.running:
            await self.close(reason=RESTART)
        await self._finish_parked(wait=False)
        self._down_attempts += 1
        if self._down_since is None:
            self._down_since = self._last_down_log = now
            log.warning("always-on: speech pipeline is down; restarting it (retrying with backoff)")
        elif now - self._last_down_log >= STILL_DOWN_LOG_S:
            self._last_down_log = now
            log.warning("always-on: speech pipeline still down after %.0f s (%d attempts)",
                        now - self._down_since, self._down_attempts)
        else:
            log.debug("always-on: speech pipeline restart attempt %d", self._down_attempts)
        await self._keep_listening()
