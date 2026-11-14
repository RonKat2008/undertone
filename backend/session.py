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
from typing import Awaitable, Callable, Optional, Tuple, Union

from .band.source import BandSource
from .motion.classifier import MotionClassifier, Thresholds, calibrate, features
from .motion.fusion import Fusion
from .stt.fillers import DEFAULT_FILLERS
from .stt.turns import BaselinePace, SpeakerMapper

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
        self.use_pipecat = (os.getenv("USE_PIPECAT", "true").lower() == "true") if use_pipecat is None else use_pipecat
        self.single_speaker = os.getenv("SINGLE_SPEAKER", "false").lower() == "true"
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

    # ---------- emit ----------

    async def _emit(self, ev: dict) -> None:
        r = self._emit_fn(ev)
        if asyncio.iscoroutine(r):
            await r

    def _emit_sync(self, ev: dict) -> None:
        r = self._emit_fn(ev)
        if asyncio.iscoroutine(r):
            asyncio.ensure_future(r)

    # ---------- lifecycle ----------

    async def start(self) -> None:
        await self.band.start()
        self._tasks += [asyncio.create_task(self._tap_loop()), asyncio.create_task(self._motion_loop())]

    async def shutdown(self) -> None:
        if self.session_id:
            await self.stop_session()
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
            if coach is None:
                coach, mode = self.coach_provider()
            else:
                mode = "regular"
            self.session_id = session_id or ("s_" + uuid.uuid4().hex[:10])
            self.started_wall = time.time()
            self.mapper = SpeakerMapper(self.single_speaker)
            self.fusion = Fusion(self._emit_sync)
            self._baseline = BaselinePace()
            self._talk = {"me": 0.0, "other": 0.0}
            self._last_question_ts = None
            self.band.reset_clock()
            await self.band.mic(True)
            if self.use_pipecat:
                from .stt.pipeline import Hearing
                self.hearing = Hearing(self.band.pcm_q, self.mapper, self._on_hearing_event,
                                       keyterms=coach.get("keyterms", []),
                                       filler_words=coach.get("filler_words") or DEFAULT_FILLERS,
                                       audio_clock=lambda: self.band.audio_seconds,
                                       loudness=self.band.loudness, on_words=self._on_words)
                try:
                    await self.hearing.start()
                except Exception as e:  # noqa: BLE001
                    log.error("Deepgram/Pipecat failed to start: %s. Session runs without speech.", e)
                    self.hearing = None
            if announce:
                await self._emit({"type": "session.started", "session_id": self.session_id,
                                  "coach_id": coach.get("id", "default"), "mode": mode,
                                  "policy": coach.get("nudge_policy") or DEFAULT_POLICY, "ts": 0})
            log.info("session %s started", self.session_id)
            return self.session_id

    async def stop_session(self, announce: bool = True) -> Optional[str]:
        async with self._lock:
            if not self.session_id:
                return None
            sid = self.session_id
            await self.band.mic(False)
            if self.hearing is not None:
                try:
                    await self.hearing.stop()
                except Exception as e:  # noqa: BLE001
                    log.warning("stopping Deepgram: %s", e)
                self.hearing = None
            self.session_id = None
            if announce:
                await self._emit({"type": "session.ended", "session_id": sid})
            log.info("session %s ended", sid)
            return sid

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

    def _on_hearing_event(self, ev: dict) -> None:
        if ev["type"] == "turn.final":
            self._talk[ev["speaker"]] += max(0.0, ev["end"] - ev["start"])
            if ev["speaker"] == "me" and "?" in ev["text"]:
                self._last_question_ts = ev["end"]
            if ev["speaker"] == "me" and self.on_wearer_volume:
                db = self.band.loudness.mean_db(ev["start"], ev["end"])
                if db is not None:
                    self.on_wearer_volume(db, ev["end"])
            self._last_speaker = ev["speaker"]
            self.fusion.on_turn(ev)
        elif ev["type"] == "transcript.partial" and ev.get("speaker"):
            self._last_speaker = ev["speaker"]
        self._emit_sync(ev)

    def _on_words(self, speaker: str, words) -> None:
        self._last_speaker = speaker
        if speaker == "me":
            self._baseline.add(words)

    def pace_wpm(self) -> Optional[float]:
        return self.hearing.pace.wpm(self.band.audio_seconds) if self.hearing else None

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


def build_router(ctl: SessionController):
    """FastAPI router for B to include in main.py."""
    from fastapi import APIRouter
    from pydantic import BaseModel

    r = APIRouter()

    class BookmarkIn(BaseModel):
        text: Optional[str] = None

    class TapIn(BaseModel):
        kind: str  # "double" | "single"

    @r.post("/session/start")
    async def session_start():
        return {"session_id": await ctl.start_session()}

    @r.post("/session/stop")
    async def session_stop():
        return {"session_id": await ctl.stop_session()}

    @r.post("/session/bookmark")
    async def session_bookmark(body: BookmarkIn = BookmarkIn()):
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
        return ctl.band.status_event()

    return r


# ---------- wiring into the Brain (backend/brain.py) ----------

def _coach_dict(coach) -> dict:
    if coach is None:
        return {"id": "default", "keyterms": [], "filler_words": DEFAULT_FILLERS}
    if hasattr(coach, "model_dump"):
        return coach.model_dump(mode="json")
    return dict(coach)


async def attach_band(app_state, brain) -> SessionController:
    """Connect the band (BAND_TRANSPORT) to the Brain. Two lines in main.py's lifespan:

        from backend.session import attach_band
        band = await attach_band(state, app.state.brain)      # after Brain(...)
        ...                                                    # and in `finally`:
        await band.shutdown()

    Then: double-tap starts/ends a Brain session, single tap is brain.single_tap(), the mic
    and Deepgram follow session.started / session.ended on the bus (so /session/start from
    the dashboard works too), and turn.final, transcript.partial, motion, signal, band.status
    and calibration go onto the bus. The wearer's loudness per turn goes to brain.on_volume.
    """
    bus = app_state.bus

    async def double_tap():
        if app_state.session is not None:
            await brain.end_session()
        else:
            await brain.start_session()

    async def single_tap():
        await brain.single_tap()

    ctl = SessionController(emit=bus.publish, on_double_tap=double_tap, on_single_tap=single_tap,
                            on_wearer_volume=brain.on_volume,
                            baseline_provider=lambda: getattr(getattr(brain, "metrics", None), "baseline_wpm", None))

    async def on_started(ev):
        coach = getattr(getattr(app_state, "session", None), "coach", None) or getattr(app_state, "active_coach", None)
        await ctl.start_session(session_id=ev.session_id, coach=_coach_dict(coach), announce=False)

    async def on_ended(ev):
        await ctl.stop_session(announce=False)

    bus.on("session.started", on_started)
    bus.on("session.ended", on_ended)
    await ctl.start()
    return ctl


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
        return ctl.band.status_event()

    @r.post("/calibration/motion")
    async def calibration_motion():
        return await ctl.calibrate_motion()

    @r.post("/calibration/swap-speakers")
    async def calibration_swap():
        ctl.swap_speakers()
        await ctl._emit({"type": "calibration", "kind": "speaker", "step": "swapped", "done": True})
        return {"ok": True}

    return r
