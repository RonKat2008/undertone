"""Person A's runtime: band -> hearing -> motion, plus tap controls (plan.md 4.1).

B's main.py uses it like this:

    from backend.session import SessionController, build_router

    ctl = SessionController(emit=bus.publish,                 # sync or async, gets contract dicts
                            coach_provider=lambda: (coach_dict, mode),   # active CoachSpec + 'regular'|'practice'
                            status_provider=None,             # optional: B answers "How am I doing?"
                            baseline_provider=lambda: profile_baseline_wpm)
    app.include_router(build_router(ctl))
    @app.on_event("startup")
    async def _(): await ctl.start()

Events emitted (all from contracts/events.ts): band.status, session.started, session.ended,
transcript.partial, turn.final, motion, signal, status.reply, bookmark (source "phone"),
calibration. B's nudge engine can read `ctl.fusion.fidget_listening_s` for the
"fidget while they talk > 8 s" motion rule, `ctl.pace_wpm()` for live pace, and
`ctl.band.loudness.mean_db(start, end)` for the wearer's volume over a turn.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import TYPE_CHECKING, Awaitable, Callable, Optional, Tuple, Union

from .band.source import BandSource
from .config import _flag
from .listening import AudioWatchdog, TransitionLog, expected_listening, listening_report, silent_for
from .motion.classifier import MotionClassifier, Thresholds, calibrate, features
from .motion.fusion import Fusion
from .stt.fillers import DEFAULT_FILLERS
from .stt.turns import BaselinePace, SpeakerMapper

if TYPE_CHECKING:
    from .always_on import AlwaysOn
    from .capture.recorder import Recorder

log = logging.getLogger("undertone.session")

Emit = Callable[[dict], Union[None, Awaitable[None]]]

DEFAULT_POLICY = {"focus_rule_id": "monologue", "budget_per_session": 5, "min_gap_s": 60,
                  "tolerance": 0.3, "silent": False}


def status_verdict(talk_ratio: float, talk_target: float, since_question_s: Optional[float]) -> Tuple[str, str]:
    """(verdict, haptic) for a single tap: plan.md 4.1."""
    if talk_ratio > talk_target:
        return "talking_too_much", "status_talking"
    if since_question_s is None or since_question_s > 120:
        return "ask_question", "status_ask"
    return "good", "status_good"


class SessionController:
    def __init__(self, emit: Emit, coach_provider: Optional[Callable[[], Tuple[dict, str]]] = None,
                 status_provider: Optional[Callable[[], Optional[dict]]] = None,
                 baseline_provider: Optional[Callable[[], Optional[float]]] = None,
                 band: Optional[BandSource] = None, use_pipecat: Optional[bool] = None,
                 on_double_tap: Optional[Callable[[], Awaitable[None]]] = None,
                 on_single_tap: Optional[Callable[[], Awaitable[None]]] = None,
                 on_wearer_volume: Optional[Callable[[float, float], None]] = None) -> None:
        self._emit_fn = emit
        self.coach_provider = coach_provider or (lambda: ({"id": "default", "keyterms": [],
                                                           "filler_words": DEFAULT_FILLERS,
                                                           "nudge_policy": DEFAULT_POLICY}, "regular"))
        self.status_provider = status_provider
        self.on_double_tap = on_double_tap
        self.on_single_tap = on_single_tap
        self.on_wearer_volume = on_wearer_volume
        self.baseline_provider = baseline_provider or (lambda: None)
        self.band = band or BandSource.from_env(emit=self._emit)
        self.band.emit = self._emit
        self.use_pipecat = _flag("USE_PIPECAT", True) if use_pipecat is None else use_pipecat
        # STT: deepgram (real, via Pipecat) | fake (scripted speech, no network) | off
        stt = (os.getenv("STT") or "").strip().lower()
        self.stt = stt if stt in ("deepgram", "fake", "off") else ("deepgram" if self.use_pipecat else "off")
        if self.stt != "deepgram":
            log.warning("speech-to-text is %s (STT=%r, USE_PIPECAT=%r): nothing real will be transcribed",
                        self.stt.upper(), os.getenv("STT"), os.getenv("USE_PIPECAT"))
        self.single_speaker = _flag("SINGLE_SPEAKER")
        self.thresholds = Thresholds.load(self.band.number)
        self.classifier = MotionClassifier(self.thresholds)
        self.fusion = Fusion(self._emit_sync)
        self.mapper = SpeakerMapper(self.single_speaker)
        self.hearing = None
        self.session_id: Optional[str] = None
        self.started_wall: Optional[float] = None
        self._baseline = BaselinePace()
        self._talk = {"me": 0.0, "other": 0.0}
        self._last_question_ts: Optional[float] = None
        self._last_speaker: Optional[str] = None
        self._tasks: list = []
        self._calibrating: Optional[dict] = None
        self._lock = asyncio.Lock()
        self.always_on: Optional["AlwaysOn"] = None  # set by attach_band when ALWAYS_ON=1
        self._audio_offset = 0.0  # always-on: stream audio time that is this session's t=0
        self.recorder: Optional["Recorder"] = None  # set by attach_recorder (attach_band does it)
        # always-on boundaries + health (backend/always_on.py, backend/listening.py)
        self._pending_emits: set = set()
        self._hearing_gen = 0          # events from an older Hearing (a restarted one) are ignored
        self._parked: dict = {}        # session_id -> audio offset: closed but resumable (rejoin)
        self.stt_error: Optional[str] = None      # why the last Deepgram start failed (class only)
        self.stt_started_at: Optional[float] = None
        self.last_heard_at: Optional[float] = None
        self._stt_failures = 0
        self.audio_watchdog = AudioWatchdog()
        self._health_log = TransitionLog()
        self.health_extra: Callable[[], dict] = lambda: {}

    # ---------- emit ----------

    async def _emit(self, ev: dict) -> None:
        r = self._emit_fn(ev)
        if asyncio.iscoroutine(r):
            await r

    def _emit_sync(self, ev: dict) -> None:
        r = self._emit_fn(ev)
        if asyncio.iscoroutine(r):
            fut = asyncio.ensure_future(r)
            self._pending_emits.add(fut)
            fut.add_done_callback(self._pending_emits.discard)

    # ---------- lifecycle ----------

    async def start(self) -> None:
        await self.band.start()
        self._tasks += [asyncio.create_task(self._tap_loop()), asyncio.create_task(self._motion_loop()),
                        asyncio.create_task(self._health_loop())]
        if self.always_on is not None:
            await self.always_on.start()

    async def shutdown(self) -> None:
        if self.always_on is not None:
            await self.always_on.stop()
        if self.session_id:
            # attached to the Brain: the Brain announces session.ended itself
            await self.stop_session(announce=self.on_double_tap is None)
        if self.always_on is not None:
            await self._stop_listening()
        for t in self._tasks:
            t.cancel()
        await self.band.stop()

    @property
    def running(self) -> bool:
        return self.session_id is not None

    async def start_session(self, session_id: Optional[str] = None, coach: Optional[dict] = None,
                            announce: bool = True) -> str:
        """Mic on + Deepgram worker. announce=False when the Brain already published
        session.started (the attach_band() setup); then session_id and coach come from it."""
        async with self._lock:
            if self.session_id:
                return self.session_id
            if session_id is not None and session_id in self._parked:
                return self._resume(session_id)
            if coach is None:
                coach, mode = self.coach_provider()
            else:
                mode = "regular"
            self.session_id = session_id or ("s_" + uuid.uuid4().hex[:10])
            self.started_wall = time.time()
            self.fusion = Fusion(self._emit_sync)
            self._baseline = BaselinePace()
            self._talk = {"me": 0.0, "other": 0.0}
            self._last_question_ts = None
            try:
                if self.always_on is not None:
                    self._join_stream()  # mic and Deepgram are already running
                else:
                    self.mapper = SpeakerMapper(self.single_speaker)
                    await self._start_listening(coach)
            except BaseException:
                self.session_id = None  # never leave a phantom session behind
                raise
            self._begin_recording(self.session_id)
            if announce:
                await self._emit({"type": "session.started", "session_id": self.session_id,
                                  "coach_id": coach.get("id", "default"), "mode": mode,
                                  "policy": coach.get("nudge_policy") or DEFAULT_POLICY, "ts": 0})
            log.info("session %s started", self.session_id)
            return self.session_id

    async def stop_session(self, announce: bool = True, park: bool = False) -> Optional[str]:
        """park=True (always-on, closed on silence): keep the recording and t=0 so the session
        can be resumed; release_parked() ends it for good."""
        async with self._lock:
            if not self.session_id:
                return None
            sid = self.session_id
            try:
                if self.always_on is None:
                    await self._stop_listening()
            finally:
                self.session_id = None
                offset, self._audio_offset = self._audio_offset, 0.0
            if self.always_on is not None:
                self.always_on.ended(sid)
            if park and self.always_on is not None:
                self._parked[sid] = offset
            else:
                await self._end_recording(sid)
            if announce:
                await self._emit({"type": "session.ended", "session_id": sid})
            log.info("session %s ended%s", sid, " (resumable)" if park else "")
            return sid

    def _resume(self, sid: str) -> str:
        """Back into a parked session: same t=0, the recording never stopped. Lock held."""
        self.session_id, self._audio_offset = sid, self._parked.pop(sid)
        self.band.reset_wall_clock(max(0.0, self.band.audio_seconds - self._audio_offset))
        log.info("session %s resumed", sid)
        return sid

    async def release_parked(self, sid: str) -> None:
        """A parked session will not resume: finish its recording."""
        if self._parked.pop(sid, None) is not None:
            await self._end_recording(sid)

    # ---------- recording (backend/capture) ----------

    def attach_recorder(self, recorder: Optional["Recorder"]) -> None:
        """Tap every 80 ms chunk into the recorder (None detaches)."""
        self.recorder = recorder
        self.band.chunk_tap = recorder.feed if recorder is not None else None

    def _begin_recording(self, session_id: str) -> None:
        """Session t=0 is stream time _audio_offset (always-on) or 0 (after a clock reset)."""
        if self.recorder is None:
            return
        if self.band.chunk_tap is None:  # detached after an error: try again for this session
            self.band.chunk_tap = self.recorder.feed
        try:
            self.recorder.begin(session_id, self._audio_offset)
        except Exception:  # noqa: BLE001 - no recording, but the session runs
            log.exception("could not start recording %s", session_id)

    async def _end_recording(self, session_id: str) -> None:
        if self.recorder is None:
            return
        try:
            await asyncio.to_thread(self.recorder.end, session_id)
        except Exception:  # noqa: BLE001 - session end must go on
            log.exception("could not finish recording %s", session_id)

    # ---------- listening: mic + Deepgram ----------

    async def _start_listening(self, coach: dict, end_on_failure: bool = True) -> None:
        """end_on_failure: a Deepgram that gives up ends the worker, so `running` tells the truth."""
        self.band.reset_clock()
        if self.recorder is not None:
            self.recorder.clear()  # buffered audio is on the old clock
        if self.always_on is not None:
            self.always_on.clock_reset()  # stream times from before mean nothing now
        await self.band.mic(True)
        if self.stt == "off":
            return
        self._hearing_gen += 1
        self.hearing = self._new_hearing(coach, end_on_failure)
        self.stt_started_at = time.monotonic()
        try:
            await self.hearing.start()
            self.stt_error = None
        except Exception as e:  # noqa: BLE001
            from .stt.pipeline import stt_error_class
            self.stt_error = stt_error_class(str(e))
            self._stt_failures += 1
            (log.error if self._stt_failures in (1, 10) else log.debug)(
                "speech-to-text failed to start (%s, attempt %d); running without speech",
                self.stt_error, self._stt_failures)
            self.hearing = None

    def _new_hearing(self, coach: dict, end_on_failure: bool = False):  # -> Hearing
        if self.stt == "fake":
            from .stt.fake import FakeHearing as Hearing
        else:
            from .stt.pipeline import Hearing
        gen = self._hearing_gen
        return Hearing(self.band.pcm_q, self.mapper, lambda ev: self._on_hearing_event(ev, gen),
                       keyterms=coach.get("keyterms", []),
                       filler_words=coach.get("filler_words") or DEFAULT_FILLERS,
                       audio_clock=lambda: self.band.audio_seconds,
                       loudness=self.band.loudness, on_words=self._on_words,
                       end_on_failure=end_on_failure, on_live_words=self._on_live_words)

    async def _stop_listening(self) -> None:
        await self.band.mic(False)
        await self._stop_hearing()

    async def _stop_hearing(self) -> None:
        if self.hearing is not None:
            try:
                await self.hearing.stop()
            except Exception as e:  # noqa: BLE001
                log.warning("stopping Deepgram: %s", e)
            self.hearing = None

    def pipeline_ok(self) -> bool:
        """Mic on and, with Pipecat, a live Deepgram worker (what a restart can fix)."""
        if not self.band.mic_on:
            return False
        return self.stt == "off" or (self.hearing is not None and self.hearing.running)

    def listening_ok(self) -> bool:
        """Band connected and the speech pipeline alive. The full picture: health()."""
        return bool(self.band.status_event().get("connected")) and self.pipeline_ok()

    async def ensure_listening(self) -> None:
        """Always-on: mic on and one Deepgram worker for the whole stream; a dead one is
        replaced (its stream clock restarts at 0, so the band clock restarts with it)."""
        if self.pipeline_ok():
            return
        await self.stop_dead_hearing()
        coach, _ = self.coach_provider()
        await self._start_listening(coach, end_on_failure=True)
        up = self.hearing is not None or self.stt == "off"
        (log.info if up else log.debug)("always-on: mic %s, speech pipeline %s",
                                        "on" if self.band.mic_on else "off", "up" if up else "DOWN")

    async def stop_dead_hearing(self) -> None:
        """Stop a Deepgram worker that died; its last turn is flushed to whoever listens now."""
        if self.hearing is not None and not self.hearing.running:
            log.warning("Deepgram worker stopped (%s); restarting it",
                        getattr(self.hearing, "last_error", None) or "no error reported")
            await self._stop_hearing()
            await self.flush_hearing()

    def stream_seconds(self) -> float:
        return float(self.band.audio_seconds)

    async def flush_hearing(self, turns: bool = False) -> None:
        """Let every event already heard reach the bus handlers (the Brain) before going on.
        turns=True also closes the turn being assembled right now."""
        if turns and self.hearing is not None and self.hearing.running:
            flush = getattr(self.hearing, "flush_turns", None)
            if flush is not None:
                try:
                    flush()
                except Exception:  # noqa: BLE001
                    log.exception("flushing the open turn failed")
        for _ in range(10):
            pending = [f for f in self._pending_emits if not f.done()]
            if not pending:
                break
            await asyncio.gather(*pending, return_exceptions=True)
        for _ in range(3):  # bus handlers run their first (synchronous) step
            await asyncio.sleep(0)

    async def drain_for_end(self) -> None:
        """Brain.before_end: hand over the last words before the session closes."""
        if self.always_on is None and self.hearing is not None:
            await self._stop_hearing()  # flushes the last turn while the session is still open
        await self.flush_hearing(turns=self.always_on is not None)

    # ---------- health ----------

    def health(self) -> dict:
        return listening_report(self, self.health_extra())

    async def _health_loop(self, every_s: float = 1.0) -> None:
        while True:
            await asyncio.sleep(every_s)
            try:
                await self._health_tick()
            except Exception:  # noqa: BLE001
                log.exception("health check failed")

    async def _health_tick(self) -> None:
        now = time.monotonic()
        expected = expected_listening(self)
        self._health_log.update(self.health(), expected, now)
        connected = bool(self.band.status_event().get("connected"))
        quiet = silent_for(self.band, now)
        if expected and self.audio_watchdog.due(connected, bool(self.band.mic_on), quiet, now):
            log.warning("audio watchdog: no audio from the band for %.0f s with the mic on; re-arming "
                        "the mic (attempt %d of %d)", quiet or 0, self.audio_watchdog.retries,
                        self.audio_watchdog.max_retries)
            try:
                await self.band.mic(False)
                await self.band.mic(True)
            except Exception as e:  # noqa: BLE001
                log.warning("audio watchdog: re-arming the mic failed (%s)", type(e).__name__)

    def _join_stream(self) -> None:
        """Always-on session start: the running stream's current position becomes t=0."""
        audio_now = self.band.audio_seconds
        self._audio_offset = self.always_on.begin(audio_now)
        self.band.reset_wall_clock(max(0.0, audio_now - self._audio_offset))

    async def toggle(self) -> None:
        if self.running:
            await self.stop_session()
        else:
            await self.start_session()

    # ---------- taps ----------

    async def _tap_loop(self) -> None:
        while True:
            kind = await self.band.tap_q.get()
            try:
                if kind == "double":
                    await (self.on_double_tap() if self.on_double_tap else self.toggle())
                elif kind == "single":
                    if self.on_single_tap:
                        await self.on_single_tap()
                    elif self.running:
                        await self.status_reply()
            except Exception:  # noqa: BLE001
                log.exception("tap handling failed")

    def now(self) -> float:
        return self.band.now() if self.running else 0.0

    async def status_reply(self) -> dict:
        """Single tap: "How am I doing?". B can answer from its metrics via status_provider."""
        ev = self.status_provider() if self.status_provider else None
        if ev is None:
            total = self._talk["me"] + self._talk["other"]
            ratio = self._talk["me"] / total if total else 0.0
            coach, _ = self.coach_provider()
            target = float(coach.get("talk_target", 0.6))
            since_q = None if self._last_question_ts is None else self.now() - self._last_question_ts
            if self._last_question_ts is None and self.now() < 120:
                since_q = self.now()  # early in the session: not "no question for 2 min" yet
            verdict, haptic = status_verdict(ratio, target, since_q)
            ev = {"type": "status.reply", "verdict": verdict, "haptic": haptic, "ts": round(self.now(), 2)}
        await self._emit(ev)
        return ev

    async def bookmark(self, text: Optional[str] = None) -> dict:
        ev = {"type": "bookmark", "source": "phone", "text": text, "ts": round(self.now(), 2)}
        await self._emit(ev)
        return ev

    # ---------- hearing ----------

    def _on_hearing_event(self, ev: dict, gen: Optional[int] = None) -> None:
        if gen is not None and gen != self._hearing_gen:
            log.debug("ignoring %s from a replaced Deepgram worker", ev.get("type"))
            return
        if ev.get("type") in ("turn.final", "transcript.partial"):
            self.last_heard_at = time.monotonic()
        if self.always_on is not None and self.always_on.intercept(ev):
            return  # it opens a conversation and is replayed into it
        self.deliver(ev)

    def _rebase(self, ev: dict) -> dict:
        """Always-on: stream time -> session time on turn.final (a new dict)."""
        if ev["type"] != "turn.final" or not self._audio_offset:
            return ev
        off = self._audio_offset
        return {**ev, "start": round(max(0.0, ev["start"] - off), 3), "end": round(max(0.0, ev["end"] - off), 3)}

    def deliver(self, ev: dict) -> None:
        if self.always_on is not None and self.running:
            ev = self._rebase(ev)
            self.always_on.note(ev)
        if ev["type"] == "turn.final":
            self._talk[ev["speaker"]] += max(0.0, ev["end"] - ev["start"])
            if ev["speaker"] == "me" and "?" in ev["text"]:
                self._last_question_ts = ev["end"]
            if ev["speaker"] == "me" and self.on_wearer_volume:
                off = self._audio_offset  # the loudness timeline runs on stream time
                db = self.band.loudness.mean_db(ev["start"] + off, ev["end"] + off)
                if db is not None:
                    self.on_wearer_volume(db, ev["end"])
            self._last_speaker = ev["speaker"]
            self.fusion.on_turn(ev)
        elif ev["type"] == "transcript.partial" and ev.get("speaker"):
            self._last_speaker = ev["speaker"]
        self._emit_sync(ev)

    def _on_live_words(self, speaker: str, words) -> None:
        """Interim + final words, rebased to session time, for practice mode (backend/practice.py)."""
        hook = getattr(self, "on_live_words", None)
        if hook is None or not self.running:
            return
        off = self._audio_offset
        if off:
            from .stt.turns import Word
            words = [Word(w.text, w.start - off, w.end - off, w.label) for w in words]
        hook(speaker, words, self.hearing.audio_clock() - off if self.hearing else None)

    def _on_words(self, speaker: str, words) -> None:
        self.last_heard_at = time.monotonic()
        self._last_speaker = speaker
        if speaker == "me":
            self._baseline.add(words)

    def pace_wpm(self) -> Optional[float]:
        return self.hearing.pace.wpm(self.hearing.audio_clock()) if self.hearing else None

    def baseline_wpm(self) -> Optional[float]:
        return self.baseline_provider() or self._baseline.value

    def swap_speakers(self) -> None:
        self.mapper.swap()

    # ---------- motion ----------

    async def _motion_loop(self) -> None:
        while True:
            s = await self.band.motion_q.get()
            if self._calibrating is not None:
                self._calibrating["samples"].append(s)
            out = self.classifier.add(s)
            if out is None or not self.running:
                continue
            ev = {"type": "motion", "state": out["state"], "hand_energy": out["hand_energy"],
                  "speaker_context": self._last_speaker, "confidence": out["confidence"], "ts": out["ts"]}
            self.fusion.on_motion(ev, self.pace_wpm(), self.baseline_wpm())
            await self._emit(ev)

    async def calibrate_motion(self, seconds_each: float = 5.0) -> dict:
        """15 s calibration: still, gesture, fidget. The dashboard shows each step's prompt."""
        steps = {}
        for step in ("still", "gesture", "fidget"):
            await self._emit({"type": "calibration", "kind": "motion", "step": step, "done": False})
            self._calibrating = {"samples": []}
            await asyncio.sleep(seconds_each)
            samples = self._calibrating["samples"]
            self._calibrating = None
            feats = []
            for i in range(0, max(0, len(samples) - 50), 50):  # 1 s windows, 50% overlap at ~100 Hz
                f = features(samples[i:i + 100])
                if f is not None:
                    feats.append(f)
            steps[step] = feats
        self.thresholds = calibrate(steps["still"], steps["gesture"], steps["fidget"])
        self.thresholds.save(self.band.number)
        self.classifier.th = self.thresholds
        await self._emit({"type": "calibration", "kind": "motion", "step": "saved", "done": True})
        return self.thresholds.__dict__


from pydantic import BaseModel  # noqa: E402  (module level, so FastAPI can resolve the annotations)


class BookmarkIn(BaseModel):
    text: Optional[str] = None


class TapIn(BaseModel):
    kind: str  # "double" | "single"


def build_router(ctl: SessionController):
    """Standalone router (only when main.py does NOT own /session/*). With the Brain, use
    attach_band() + build_band_router() instead."""
    from fastapi import APIRouter

    r = APIRouter()

    @r.post("/session/start")
    async def session_start():
        return {"session_id": await ctl.start_session()}

    @r.post("/session/stop")
    async def session_stop():
        return {"session_id": await ctl.stop_session()}

    @r.post("/session/bookmark")
    async def session_bookmark(body: Optional[BookmarkIn] = None):
        body = body or BookmarkIn()
        return await ctl.bookmark(body.text)

    @r.post("/session/tap")  # dev helper: pretend tap when the band is not at hand
    async def session_tap(body: TapIn):
        ctl.band.tap(body.kind)
        return {"ok": True}

    @r.post("/calibration/motion")
    async def calibration_motion():
        return await ctl.calibrate_motion()

    @r.post("/calibration/swap-speakers")
    async def calibration_swap():
        ctl.swap_speakers()
        await ctl._emit({"type": "calibration", "kind": "speaker", "step": "swapped", "done": True})
        return {"ok": True}

    @r.get("/band/status")
    async def band_status():
        return band_status_body(ctl)

    @r.get("/band/diag")
    async def band_diag():
        return band_diag_body(ctl)

    return r


def band_diag_body(ctl: SessionController) -> dict:
    """GET /band/diag: the full listening picture (backend/listening.py), plus the keys this
    route always had (connected, stt as a string, stt_running, session_id, always_on bool)."""
    report = ctl.health()
    hearing = ctl.hearing
    return {**report,
            "connected": report["band_connected"],
            "stt": ctl.stt, "stt_detail": report["stt"],
            "stt_running": bool(hearing is not None and getattr(hearing, "running", True)),
            "session_id": ctl.session_id,
            "always_on": ctl.always_on is not None, "always_on_detail": report["always_on"]}


def band_status_body(ctl: SessionController) -> dict:
    """GET /band/status: the band.status event plus `always_on`, `listening_ok` and
    `listening_reason`. Only this HTTP reply has the extra keys; the band.status bus event keeps
    its contract shape."""
    report = ctl.health()
    return {**ctl.band.status_event(), "always_on": ctl.always_on is not None,
            "listening_ok": report["listening_ok"], "listening_reason": report["listening_reason"]}


# ---------- wiring into the Brain (backend/brain.py) ----------

def _coach_dict(coach) -> dict:
    if coach is None:
        return {"id": "default", "keyterms": [], "filler_words": DEFAULT_FILLERS}
    if hasattr(coach, "model_dump"):
        return coach.model_dump(mode="json")
    return dict(coach)


async def attach_band(app_state, brain, band: Optional[BandSource] = None,
                      clock: Optional[Callable[[], float]] = None) -> SessionController:
    """Connect the band (BAND_TRANSPORT) to the Brain. Two lines in main.py's lifespan:

        from backend.session import attach_band
        band = await attach_band(state, app.state.brain)      # after Brain(...)
        ...                                                    # and in `finally`:
        await band.shutdown()

    Then: double-tap starts/ends a Brain session, single tap is brain.single_tap(), the mic
    and Deepgram follow session.started / session.ended on the bus (so /session/start from
    the dashboard works too), and turn.final, transcript.partial, motion, signal, band.status
    and calibration go onto the bus. The wearer's loudness per turn goes to brain.on_volume.

    With brain.settings.always_on (ALWAYS_ON=1) the mic and Deepgram run from connect and
    conversations open/close themselves (backend/always_on.py); double-tap only closes one.
    `band` and `clock` are for tests.
    """
    bus = app_state.bus

    async def double_tap():
        if ctl.always_on is not None:
            if not ctl.running:
                log.info("double-tap: no conversation open (always-on); nothing to close")
            await ctl.always_on.close(reason="double-tap")
        elif app_state.session is not None:
            await brain.end_session()
        else:
            await brain.start_session()

    async def single_tap():
        await brain.single_tap()

    ctl = SessionController(emit=bus.publish, on_double_tap=double_tap, on_single_tap=single_tap,
                            on_wearer_volume=brain.on_volume, band=band,
                            baseline_provider=lambda: getattr(getattr(brain, "metrics", None), "baseline_wpm", None))

    async def join(session_id: str) -> None:
        live = getattr(app_state, "session", None)
        if getattr(live, "session_id", None) != session_id:
            return  # a stale session.started: that session is already gone
        if ctl.session_id not in (None, session_id):
            log.warning("controller still on %s while the Brain runs %s; switching", ctl.session_id, session_id)
            await ctl.stop_session(announce=False)
        coach = getattr(live, "coach", None) or getattr(app_state, "active_coach", None)
        await ctl.start_session(session_id=session_id, coach=_coach_dict(coach), announce=False)

    async def on_started(ev):
        await join(ev.session_id)

    async def on_ended(ev):
        if ctl.session_id == ev.session_id:  # never stop a newer session on a late event
            await ctl.stop_session(announce=False)

    bus.on("session.started", on_started)
    bus.on("session.ended", on_ended)
    brain.before_end = ctl.drain_for_end  # the last words reach the Brain before it closes
    ctl.health_extra = lambda: _health_extra(app_state, brain)
    from .practice import attach_practice
    ctl.practice = attach_practice(ctl, app_state)  # practice mode: buzz on every crutch word
    ctl._tasks.append(asyncio.ensure_future(_feed_live_pace(ctl, app_state, brain)))
    if getattr(getattr(brain, "settings", None), "always_on", False):
        _attach_always_on(ctl, app_state, brain, join, clock)
    _attach_recorder(ctl, app_state.db)
    await ctl.start()
    return ctl


async def _feed_live_pace(ctl: SessionController, app_state, brain, every_s: float = 1.0) -> None:
    """Once a second, the wearer's live pace (final Deepgram words, last 15 s) into the
    Brain's metrics, so the pace nudge can fire mid-answer instead of when the answer ends."""
    while True:
        await asyncio.sleep(every_s)
        try:
            session, metrics = getattr(app_state, "session", None), getattr(brain, "metrics", None)
            if session is None or metrics is None or not ctl.running or not hasattr(metrics, "add_live_pace"):
                continue
            wpm = ctl.pace_wpm()
            if wpm:
                metrics.add_live_pace(wpm, session.now_s())
        except Exception:  # noqa: BLE001
            log.exception("live pace feed failed")


def _attach_recorder(ctl: SessionController, db) -> None:
    """RECORD_AUDIO (default on): each conversation's audio goes to <db dir>/media/recordings."""
    from pathlib import Path

    from .capture.media import capture_settings
    from .capture.recorder import Recorder
    from .capture.store import store_recording

    settings = capture_settings(Path(db.path))
    if not settings.enabled:
        log.info("recording: off (RECORD_AUDIO=0)")
        return
    ctl.attach_recorder(Recorder(settings, on_finished=lambda info: store_recording(db, settings.directory, info)))
    log.info("recording: on (%s, cap %.0f MB)", settings.directory, settings.max_total_bytes / 2 ** 20)


def _attach_always_on(ctl: SessionController, app_state, brain, join: Callable[[str], Awaitable[None]],
                      clock: Optional[Callable[[], float]]) -> None:
    from .always_on import AlwaysOn, AlwaysOnConfig

    async def open_conversation() -> None:
        # t=0 is the first turn's start, which was `lead` seconds of audio ago
        first = ctl.always_on.pending_offset
        lead = max(0.0, ctl.stream_seconds() - first) if first is not None else 0.0
        sid = await brain.ensure_session(started_at=time.time() - lead)  # adopts a phone Start
        await join(sid)  # join now: the bus handler may run later

    async def close_conversation(quiet: bool, park: bool = False) -> None:
        sid = ctl.session_id
        await brain.end_session(quiet=quiet, defer=True)
        if ctl.session_id == sid:
            await ctl.stop_session(announce=False, park=park)

    async def resume_conversation(session_id: str) -> bool:
        if not await brain.resume_session(session_id):
            return False
        await join(session_id)  # the parked controller session comes back (same t=0, same file)
        return ctl.session_id == session_id

    async def finish_conversation(session_id: str, wait: bool = True) -> None:
        await ctl.release_parked(session_id)  # the recording is complete before its verdict
        if wait:
            await brain.finish_session(session_id)
        else:
            ctl._tasks.append(asyncio.ensure_future(brain.finish_session(session_id)))

    def late_turn(session_id: str, ev: dict) -> None:
        offset = ctl.always_on.offset_of(session_id)
        rebased = {**ev, "start": round(max(0.0, ev["start"] - offset), 3),
                   "end": round(max(0.0, ev["end"] - offset), 3)}
        from .contracts import TurnFinalEvent
        try:
            brain.add_late_turn(session_id, TurnFinalEvent.model_validate(rebased))
        except Exception:  # noqa: BLE001
            log.exception("could not store a late turn for %s", session_id)

    st = brain.settings
    cfg = AlwaysOnConfig(silence_s=float(st.always_on_silence_s), min_turns=int(st.always_on_min_turns),
                         rejoin_s=float(getattr(st, "always_on_rejoin_s", 0.0)))
    ctl.coach_provider = lambda: (_coach_dict(getattr(app_state, "active_coach", None)), "regular")
    ctl.always_on = AlwaysOn(ctl, open_conversation, close_conversation, cfg,
                             resume_conversation=resume_conversation,
                             finish_conversation=finish_conversation, late_turn=late_turn,
                             **({"clock": clock} if clock is not None else {}))


def _health_extra(app_state, brain) -> dict:
    """Judge mode and phones for the listening report (GET /health, /band/diag)."""
    st = getattr(brain, "settings", None)
    rules = st is None or st.use_rule_judge_only or not st.has_gemini
    phones = None
    hub = getattr(app_state, "haptics_hub", None)
    if hub is not None:
        try:
            phones = sum(1 for d in hub.list_devices() if d.get("connected"))
        except Exception:  # noqa: BLE001
            phones = None
    return {"judge": "rules" if rules else "decisions",
            "judge_fail_streak": getattr(brain, "judge_fail_streak", 0), "phones_connected": phones}


def build_band_router(ctl: SessionController):
    """Band-only routes that do not clash with main.py's /session/* routes."""
    from fastapi import APIRouter

    r = APIRouter()

    @r.post("/band/tap")  # pretend tap when the band is not at hand: {"kind": "double" | "single"}
    async def band_tap(body: TapIn):
        ctl.band.tap(body.kind)
        return {"ok": True}

    @r.get("/band/status")
    async def band_status():
        return band_status_body(ctl)

    @r.get("/band/diag")
    async def band_diag():
        return band_diag_body(ctl)

    @r.post("/calibration/motion")
    async def calibration_motion():
        return await ctl.calibrate_motion()

    @r.post("/calibration/swap-speakers")
    async def calibration_swap():
        ctl.swap_speakers()
        await ctl._emit({"type": "calibration", "kind": "speaker", "step": "swapped", "done": True})
        return {"ok": True}

    return r
