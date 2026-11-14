"""Always-on capture (ALWAYS_ON=1): the band listens all the time, conversations open and close
by themselves.

- At band connect the mic goes on and one Deepgram worker runs for as long as the server does.
  (After a Bluetooth auto-reconnect BandSource._apply_settings re-sends audio=mic_on, so the
  mic comes back on with the band.) A worker that dies is restarted on the next tick.
- The first turn.final while no conversation is open opens one (Brain.start_session). That
  turn and anything heard while the session is being set up are held back and replayed into
  it, so nothing is lost.
- After `silence_s` with no turn.final and no transcript.partial the conversation is closed
  through Brain.end_session, the same path as a manual end. With fewer than `min_turns`
  final turns it is closed quietly: transcript kept, no debrief, no spoken audio.

The silence clock is injectable, so tests drive it without sleeping:

    ao = AlwaysOn(host, open_conversation, close_conversation, AlwaysOnConfig(), clock=fake)
    ...
    await ao.tick()      # what the 1 Hz watcher runs
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, List, Optional, Protocol

log = logging.getLogger("undertone.always_on")

Clock = Callable[[], float]
TICK_S = 1.0
RESTART_BACKOFF_S = 10.0  # a Deepgram worker that will not start is retried this often


@dataclass(frozen=True)
class AlwaysOnConfig:
    silence_s: float = 60.0
    min_turns: int = 4


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
    """What AlwaysOn needs from the SessionController."""

    @property
    def running(self) -> bool: ...

    def listening_ok(self) -> bool: ...

    async def ensure_listening(self) -> None: ...

    def deliver(self, ev: dict) -> None: ...


class AlwaysOn:
    def __init__(self, host: Host, open_conversation: Callable[[], Awaitable[None]],
                 close_conversation: Callable[[bool], Awaitable[None]],
                 config: AlwaysOnConfig = AlwaysOnConfig(), clock: Clock = time.monotonic) -> None:
        self.host = host
        self.config = config
        self.timer = SilenceTimer(config.silence_s, clock)
        self.turns = 0
        self._clock = clock
        self._open_fn = open_conversation
        self._close_fn = close_conversation
        self._pending: Optional[List[dict]] = None  # held back while a conversation opens
        self._next_offset: Optional[float] = None
        self._next_restart = 0.0
        self._tasks: List[asyncio.Task] = []

    # ---------- lifecycle ----------

    async def start(self) -> None:
        """Band connected: mic on, Deepgram up, watcher running."""
        await self._keep_listening()
        self._tasks.append(asyncio.create_task(self._watch()))
        log.info("always-on: listening (close after %.0f s of silence, debrief from %d turns)",
                 self.config.silence_s, self.config.min_turns)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        self._tasks = []

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
            except Exception:  # noqa: BLE001
                log.exception("always-on tick failed")

    async def tick(self) -> None:
        if self.host.running and self.timer.expired():
            await self.close(reason="%.0f s of silence" % self.timer.idle_s())
        if not self.host.listening_ok():
            await self._recover_listening()

    # ---------- hearing events (called by the controller, synchronously) ----------

    def intercept(self, ev: dict) -> bool:
        """True when `ev` is held back until the conversation it opens is ready."""
        if self._pending is not None:
            self._pending.append(ev)
            return True
        if self.host.running or ev.get("type") != "turn.final":
            return False
        self._pending = [ev]
        self._next_offset = float(ev["start"])
        self._tasks = [t for t in self._tasks if not t.done()] + [asyncio.ensure_future(self._open())]
        return True

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
        return offset

    # ---------- open / close ----------

    async def _open(self) -> None:
        try:
            await self._open_fn()
        except Exception:  # noqa: BLE001
            log.exception("always-on: could not open a conversation")
        held, self._pending = self._pending or [], None
        if not self.host.running:
            self._next_offset = None
            log.warning("always-on: dropped %d held-back events (no conversation)", len(held))
            return
        log.info("always-on: conversation opened on first turn (%d events replayed)", len(held))
        for ev in held:
            self.host.deliver(ev)

    async def close(self, reason: str = "double-tap") -> None:
        """End the open conversation. Quiet (no debrief) below min_turns, unless forced by a
        tap, which always gets the normal debrief. A second close of the same conversation is
        harmless: Brain.end_session returns None once the session is gone."""
        if not self.host.running:
            return
        quiet = reason != "double-tap" and self.turns < self.config.min_turns
        log.info("always-on: closing conversation after %s (%d turns, %s)", reason, self.turns,
                 "quiet: no debrief" if quiet else "debrief")
        await self._close_fn(quiet)

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
        self._next_restart = now + RESTART_BACKOFF_S
        if self.host.running:
            # a new Deepgram stream restarts its clock at 0: end this conversation cleanly first
            await self.close(reason="speech pipeline restart")
        log.warning("always-on: speech pipeline is down; restarting it")
        await self._keep_listening()
