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
        self.use_pipecat = (os.getenv("USE_PIPECAT", "true").lower() == "true") if use_pipecat is None else use_pipecat
        # STT: deepgram (real, via Pipecat) | fake (scripted speech, no network) | off
        stt = (os.getenv("STT") or "").strip().lower()
        self.stt = stt if stt in ("deepgram", "fake", "off") else ("deepgram" if self.use_pipecat else "off")
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
        self.always_on: Optional["AlwaysOn"] = None  # set by attach_band when ALWAYS_ON=1
        self._audio_offset = 0.0  # always-on: stream audio time that is this session's t=0
        self.recorder: Optional["Recorder"] = None  # set by attach_recorder (attach_band does it)

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
            if self.always_on is not None:
                self._join_stream()  # mic and Deepgram are already running
            else:
                self.mapper = SpeakerMapper(self.single_speaker)
                await self._start_listening(coach)
            self._begin_recording(self.session_id)
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
            if self.always_on is None:
                await self._stop_listening()
            self.session_id = None
            self._audio_offset = 0.0
            await self._end_recording(sid)
            if announce:
                await self._emit({"type": "session.ended", "session_id": sid})
            log.info("session %s ended", sid)
            return sid

    # ---------- recording (backend/capture) ----------

    def attach_recorder(self, recorder: Optional["Recorder"]) -> None:
        """Tap every 80 ms chunk into the recorder (None detaches)."""
        self.recorder = recorder
        self.band.chunk_tap = recorder.feed if recorder is not None else None

    def _begin_recording(self, session_id: str) -> None:
        """Session t=0 is stream time _audio_offset (always-on) or 0 (after a clock reset)."""
        if self.recorder is None:
            return
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

    async def _start_listening(self, coach: dict, end_on_failure: bool = False) -> None:
        self.band.reset_clock()
        if self.recorder is not None:
            self.recorder.clear()  # buffered audio is on the old clock
        await self.band.mic(True)
        if self.stt == "off":
            return
        self.hearing = self._new_hearing(coach, end_on_failure)
        try:
            await self.hearing.start()
        except Exception as e:  # noqa: BLE001
            log.error("Deepgram/Pipecat failed to start: %s. Session runs without speech.", e)
            self.hearing = None

    def _new_hearing(self, coach: dict, end_on_failure: bool = False):  # -> Hearing
        if self.stt == "fake":
            from .stt.fake import FakeHearing as Hearing
        else:
            from .stt.pipeline import Hearing
        return Hearing(self.band.pcm_q, self.mapper, self._on_hearing_event,
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

    def listening_ok(self) -> bool:
        """Always-on: mic on and, with Pipecat, a live Deepgram worker."""
        if not self.band.mic_on:
            return False
        return self.stt == "off" or (self.hearing is not None and self.hearing.running)

    async def ensure_listening(self) -> None:
        """Always-on: mic on and one Deepgram worker for the whole stream; a dead one is
        replaced (its stream clock restarts at 0, so the band clock restarts with it)."""
        if self.listening_ok():
            return
        if self.hearing is not None:
            log.warning("Deepgram worker stopped; restarting it")
            await self._stop_hearing()
        coach, _ = self.coach_provider()
        await self._start_listening(coach, end_on_failure=True)
        log.info("always-on: mic %s, speech pipeline %s", "on" if self.band.mic_on else "off",
                 "up" if self.hearing is not None else ("off" if self.stt == "off" else "DOWN"))

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

    def _on_hearing_event(self, ev: dict) -> None:
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
    """GET /band/diag: is sound arriving and is speech-to-text alive? For checking by hand."""
    band = ctl.band
    secs = float(band.audio_seconds)
    recent = band.loudness.mean_db(max(0.0, secs - 5.0), secs) if secs > 0 else None
    hearing = ctl.hearing
    return {
        "connected": bool(band.status_event().get("connected")),
        "mic_on": bool(band.mic_on),
        "audio_seconds": round(secs, 1),
        "recent_level_db": None if recent is None else round(recent, 1),
        "queued_chunks": band.pcm_q.qsize(),
        "dropped_chunks": band.dropped_chunks,
        "stt": ctl.stt,
        "stt_running": bool(hearing is not None and getattr(hearing, "running", True)),
        "session_id": ctl.session_id,
        "always_on": ctl.always_on is not None,
    }


def band_status_body(ctl: SessionController) -> dict:
    """GET /band/status: the band.status event plus `always_on`. Only this HTTP reply has the
    extra key; the band.status bus event keeps its contract shape."""
    return {**ctl.band.status_event(), "always_on": ctl.always_on is not None}


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
        coach = getattr(getattr(app_state, "session", None), "coach", None) or getattr(app_state, "active_coach", None)
        await ctl.start_session(session_id=session_id, coach=_coach_dict(coach), announce=False)

    async def on_started(ev):
        await join(ev.session_id)

    async def on_ended(ev):
        await ctl.stop_session(announce=False)

    bus.on("session.started", on_started)
    bus.on("session.ended", on_ended)
    from .practice import attach_practice
    ctl.practice = attach_practice(ctl, app_state)  # practice mode: buzz on every crutch word
    if getattr(getattr(brain, "settings", None), "always_on", False):
        _attach_always_on(ctl, app_state, brain, join, clock)
    _attach_recorder(ctl, app_state.db)
    await ctl.start()
    return ctl


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
        await join(await brain.start_session())  # join now: the bus handler may run later

    async def close_conversation(quiet: bool) -> None:
        await brain.end_session(quiet=quiet)

    st = brain.settings
    cfg = AlwaysOnConfig(silence_s=float(st.always_on_silence_s), min_turns=int(st.always_on_min_turns))
    ctl.coach_provider = lambda: (_coach_dict(getattr(app_state, "active_coach", None)), "regular")
    ctl.always_on = AlwaysOn(ctl, open_conversation, close_conversation, cfg,
                             **({"clock": clock} if clock is not None else {}))


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
