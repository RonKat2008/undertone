"""One spoken practice: browser <-> backend <-> Deepgram Voice Agent, then the result.

    session = PracticeSession(browser, deps)
    await session.run()      # returns when the browser socket is done with

Message shapes: contracts/events.ts, "spoken practice with the coach". Audio is relayed as is
(16 kHz linear16 up, 24 kHz linear16 down); each mic chunk also feeds the word stream.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

import numpy as np

from backend.contracts import CoachSpec, HabitProfile, PracticeGoal, PracticeResult
from backend.voice_practice import gate
from backend.voice_practice.agent import AgentRefused, open_agent
from backend.voice_practice.agent_events import AgentEvents
from backend.voice_practice.prompt import INPUT_RATE, PLANNED_QUESTIONS, build_settings
from backend.voice_practice.result import SessionFacts, build_result
from backend.voice_practice.timeline import Timeline
from backend.voice_practice.words import Connect, Socket, WordStream, ws_connect

log = logging.getLogger("undertone.voice_practice")

MIC_SILENT_S = 8.0  # no microphone audio at all for this long after ready: stop
MIC_QUIET_AFTER_S = 20.0  # this much audio, all near silent: warn once
MIC_QUIET_PEAK = 300  # of 32767
KEEPALIVE_S = 8.0  # docs: one KeepAlive every 8 s while no audio is sent
MAX_SESSION_S = 12 * 60.0
CLOSING_GRACE_S = 12.0  # after the closing line, wait this long at most for its playback
TICK_S = 0.5


class Browser(Protocol):
    async def receive(self) -> dict[str, Any]: ...
    async def send_text(self, data: str) -> None: ...
    async def send_bytes(self, data: bytes) -> None: ...
    async def close(self, code: int = 1000) -> None: ...


@dataclass(frozen=True)
class PracticeDeps:
    key: str | None
    coach: CoachSpec
    profile: HabitProfile | None
    previous_goals: tuple[PracticeGoal, ...]
    save: Callable[[PracticeResult], None]
    connect: Connect = ws_connect
    clock: Callable[[], float] = time.monotonic


@dataclass
class _Live:
    bytes_in: int = 0
    peak: int = 0
    last_audio_at: float | None = None
    last_agent_send_at: float = 0.0
    quiet_warned: bool = False
    browser_gone: bool = False
    ended_by_user: bool = False
    agent_lost: bool = False
    done: asyncio.Event = field(default_factory=asyncio.Event)


class PracticeSession:
    def __init__(self, browser: Browser, deps: PracticeDeps) -> None:
        self.browser, self.deps = browser, deps
        self.timeline = Timeline()
        self.live = _Live()
        self.agent: Socket | None = None
        self.words: WordStream | None = None
        self.events: AgentEvents | None = None
        self.started_wall = datetime.now(timezone.utc)
        self.started_at = deps.clock()
        self.ready_at: float | None = None

    # ---------- clock + output ----------

    def stream_s(self) -> float:
        return self.live.bytes_in / 2 / INPUT_RATE

    async def send(self, message: dict[str, Any]) -> None:
        if self.live.browser_gone:
            return
        try:
            await self.browser.send_text(json.dumps(message))
        except Exception:  # noqa: BLE001 - the tab went away; scoring still runs
            self.live.browser_gone = True

    async def send_audio(self, chunk: bytes) -> None:
        if not self.live.browser_gone:
            try:
                await self.browser.send_bytes(chunk)
            except Exception:  # noqa: BLE001
                self.live.browser_gone = True

    async def error(self, code: str, message: str) -> None:
        await self.send({"type": "practice.error", "code": code, "message": message})

    # ---------- lifecycle ----------

    async def run(self) -> None:
        if not self.deps.key:
            await self.error("no_key", "Practice needs a Deepgram key on the laptop (DEEPGRAM_API_KEY).")
            return await self._close_browser()
        if not gate.try_enter():
            await self.error("busy", "A practice is already running in another tab.")
            return await self._close_browser()
        try:
            if await self._open():
                await self._converse()
                await self._finish()
        finally:
            await self._teardown()
            gate.leave()
            await self._close_browser()

    async def _open(self) -> bool:
        settings = build_settings(self.deps.coach, self.deps.profile, self.deps.previous_goals)
        try:
            self.agent = await open_agent(self.deps.key or "", settings, self.deps.connect)
        except AgentRefused as exc:
            await self.error("agent_refused", str(exc))
            return False
        self.words = WordStream(self.deps.key or "", self.timeline.add_words, list(self.deps.coach.keyterms),
                                INPUT_RATE, self.deps.connect)
        await self.words.start()
        self.events = AgentEvents(self)
        self.ready_at = self.deps.clock()
        self.live.last_agent_send_at = self.ready_at
        await self.send({"type": "practice.ready", "coach_name": self.deps.coach.name,
                         "planned_questions": PLANNED_QUESTIONS,
                         "previous_goals": [g.model_dump(mode="json") for g in self.deps.previous_goals]})
        return True

    async def _converse(self) -> None:
        tasks = [asyncio.create_task(c) for c in (self._from_browser(), self._from_agent(), self._watch())]
        await self.live.done.wait()
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _finish(self) -> None:
        await self.send({"type": "practice.scoring"})
        if self.agent is not None:
            await _quiet_close(self.agent)
            self.agent = None
        if self.words is not None:
            await self.words.finish()
        facts = SessionFacts(coach=self.deps.coach, started_at=self.started_wall.isoformat(),
                             duration_s=self.deps.clock() - self.started_at, ended_early=self._ended_early(),
                             previous_goals=self.deps.previous_goals)
        result = await build_result(facts, self.timeline.records())
        if result is None:
            await self.send({"type": "practice.no_result",
                             "message": "No answers were heard, so there is nothing to score yet."})
            return
        try:
            self.deps.save(result)
        except Exception:  # noqa: BLE001 - still show it
            log.exception("practice result could not be saved")
        log.info("practice result: %d answers, overall %d (%s)", len(result.answers), result.overall,
                 result.judged_by)
        await self.send({"type": "practice.result", "result": result.model_dump(mode="json")})

    def _ended_early(self) -> bool:
        closing = self.events is not None and self.events.closing
        return not closing and (self.live.ended_by_user or self.live.agent_lost or self.live.browser_gone)

    async def _teardown(self) -> None:
        if self.agent is not None:
            await _quiet_close(self.agent)
        if self.words is not None:
            await self.words.close()

    async def _close_browser(self) -> None:
        if not self.live.browser_gone:
            try:
                await self.browser.close()
            except Exception:  # noqa: BLE001
                pass

    # ---------- loops ----------

    async def _from_browser(self) -> None:
        try:
            while True:
                msg = await self.browser.receive()
                if msg.get("type") == "websocket.disconnect":
                    self.live.browser_gone = True
                    break
                if msg.get("bytes"):
                    await self._mic(msg["bytes"])
                elif msg.get("text"):
                    await self._client_message(msg["text"])
        except Exception:  # noqa: BLE001 - a dropped tab: score what exists
            self.live.browser_gone = True
        self.live.done.set()

    async def _mic(self, chunk: bytes) -> None:
        usable = chunk[: len(chunk) - len(chunk) % 2]
        if not usable:
            return
        self.live.bytes_in += len(usable)
        self.live.last_audio_at = self.deps.clock()
        self.live.peak = max(self.live.peak, int(np.abs(np.frombuffer(usable, dtype="<i2")).max(initial=0)))
        if self.agent is not None:
            try:
                await self.agent.send(usable)
                self.live.last_agent_send_at = self.live.last_audio_at
            except Exception:  # noqa: BLE001
                self.live.agent_lost = True
                self.live.done.set()
        if self.words is not None:
            await self.words.send_audio(usable)

    async def _client_message(self, text: str) -> None:
        try:
            kind = json.loads(text).get("type")
        except (ValueError, AttributeError):
            kind = None
        if kind == "end":
            self.live.ended_by_user = True
            self.live.done.set()
        elif kind == "playback_done":
            self.timeline.playback_done(self.stream_s())
            await self.send({"type": "practice.state", "state": "waiting"})
            if self.events is not None and self.events.closing:
                self.live.done.set()
        else:
            await self.error("bad_message", "The page sent a message the coach did not understand.")

    async def _from_agent(self) -> None:
        assert self.agent is not None and self.events is not None
        try:
            while True:
                msg = await self.agent.recv()
                if isinstance(msg, bytes):
                    await self.send_audio(msg)
                else:
                    await self.events.handle(json.loads(msg))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the agent closed or sent junk
            log.info("voice agent stream ended: %s", type(exc).__name__)
            if not (self.events.closing or self.live.done.is_set()):
                self.live.agent_lost = True
                await self.error("agent_lost", "The coach's voice dropped. Scoring the answers so far.")
        self.live.done.set()

    async def _watch(self) -> None:
        while not self.live.done.is_set():
            await asyncio.sleep(TICK_S)
            await self._tick(self.deps.clock())

    async def _tick(self, now: float) -> None:
        live, ready = self.live, self.ready_at or now
        if live.last_audio_at is None and now - ready > MIC_SILENT_S:
            await self.error("mic_silent", "No sound is reaching the coach from your microphone.")
            live.done.set()
        elif not live.quiet_warned and self.stream_s() > MIC_QUIET_AFTER_S and live.peak < MIC_QUIET_PEAK:
            live.quiet_warned = True
            await self.send({"type": "practice.warning", "code": "mic_quiet",
                             "message": "Your microphone sounds very quiet. Check it is not muted."})
        if self.agent is not None and now - live.last_agent_send_at > KEEPALIVE_S:
            live.last_agent_send_at = now
            await _quiet_send(self.agent, json.dumps({"type": "KeepAlive"}))
        if now - self.started_at > MAX_SESSION_S:
            live.done.set()
        if self.events is not None and self.events.closing_since is not None \
                and now - self.events.closing_since > CLOSING_GRACE_S:
            live.done.set()


async def _quiet_send(ws: Socket, data: str) -> None:
    try:
        await ws.send(data)
    except Exception:  # noqa: BLE001
        pass


async def _quiet_close(ws: Socket) -> None:
    try:
        await ws.close()
    except Exception:  # noqa: BLE001
        pass
