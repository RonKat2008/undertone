"""Deepgram through Pipecat (plan.md 3.2). One worker per session.

    hearing = Hearing(pcm_q, mapper, on_event, keyterms=[...], filler_words=[...], use_flux=False)
    await hearing.start()      # session start (after BandSource.reset_clock and mic on)
    ...
    await hearing.stop()       # session end: flushes the last turn

on_event gets `turn.final` and `transcript.partial` dicts exactly as in contracts/events.ts.
`hearing.words_for_me` (RollingPace) and the `on_words` hook give everyone else the final
words: the motion fusion uses them for pace, B's metrics can use them too.

Pipecat is imported lazily so the rest of the backend runs without it.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import re
from typing import Callable, Iterable, List, Optional

from .fillers import DEFAULT_FILLERS
from .turns import (FluxTurnAssembler, NovaTurnAssembler, RollingPace, SpeakerMapper, Word, WordDeduper,
                    partial_event, words_from_result)

log = logging.getLogger("undertone.stt")
SAMPLE_RATE = 16000
OPENING_HOLD_S = 10.0  # longest an opening turn waits for the loudness speaker check


# ---------- health (backend/listening.py reads these; no secrets: error *classes* only) ----------

def stt_error_class(text: str) -> str:
    """A short, secret-free name for a speech-to-text error message."""
    t = (text or "").lower()
    m = re.search(r"status (\d{3})", t) or re.search(r"\b(401|403|429)\b", t)
    if "rejected" in t or (m and m.group(1).startswith("4")):
        return "connection rejected" + (" (HTTP %s)" % m.group(1) if m else "")
    if "failed to stay up" in t:
        return "connection keeps dropping"
    if "timed out" in t or "timeout" in t:
        return "timeout"
    if "connection" in t or "websocket" in t:
        return "connection lost"
    if "api_key" in t or "api key" in t:
        return "no API key"
    return "error"


def _build_processors(pcm_q: asyncio.Queue, on_nova, on_interim, on_flux_end):
    """The three small Pipecat processors. Defined inside a function so that importing this
    module never needs Pipecat."""
    from pipecat.frames.frames import (CancelFrame, EndFrame, InputAudioRawFrame, InterimTranscriptionFrame,
                                       StartFrame, TranscriptionFrame)
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

    class QueueAudioSource(FrameProcessor):
        """Pushes 80 ms PCM chunks from the band queue into the pipeline."""

        def __init__(self) -> None:
            super().__init__()
            self._task = None

        async def process_frame(self, frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if isinstance(frame, StartFrame):
                await self.push_frame(frame, direction)
                maker = getattr(self, "create_task", None)
                self._task = maker(self._pump()) if maker else asyncio.create_task(self._pump())
                return
            if isinstance(frame, (EndFrame, CancelFrame)) and self._task is not None:
                canceller = getattr(self, "cancel_task", None)
                if canceller:
                    await canceller(self._task)
                else:
                    self._task.cancel()
                self._task = None
            await self.push_frame(frame, direction)

        async def _pump(self):
            while True:
                chunk = await pcm_q.get()
                if chunk is None:
                    return
                await self.push_frame(InputAudioRawFrame(audio=chunk, sample_rate=SAMPLE_RATE, num_channels=1))

    class NovaSink(FrameProcessor):
        async def process_frame(self, frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if isinstance(frame, TranscriptionFrame):
                on_nova(getattr(frame, "result", None), getattr(frame, "text", ""))
            elif isinstance(frame, InterimTranscriptionFrame):
                on_interim(getattr(frame, "result", None), getattr(frame, "text", ""))
            await self.push_frame(frame, direction)

    class FluxSink(FrameProcessor):
        """Flux pushes one TranscriptionFrame per EndOfTurn with result = the raw TurnInfo dict,
        which carries audio_window_start / audio_window_end (pipecat flux/stt_base.py)."""

        async def process_frame(self, frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if isinstance(frame, TranscriptionFrame):
                on_flux_end(getattr(frame, "result", None))
            await self.push_frame(frame, direction)

    return QueueAudioSource(), NovaSink(), FluxSink()


def split_connect_kwargs(kwargs: dict, accepted: Iterable[str]) -> dict:
    """Deepgram's SDK `listen.v1.connect()` takes only the parameters it declares and raises
    TypeError on any other (Pipecat spreads `Settings.extra` straight into it). Move the
    undeclared ones, e.g. filler_words, into request_options.additional_query_parameters,
    where the SDK puts them on the WebSocket URL unchanged."""
    accepted = set(accepted)
    out = {k: v for k, v in kwargs.items() if k in accepted}
    extra = {k: v for k, v in kwargs.items() if k not in accepted}
    if extra:
        ro = dict(out.get("request_options") or {})
        ro["additional_query_parameters"] = {**(ro.get("additional_query_parameters") or {}), **extra}
        out["request_options"] = ro
    return out


DEFAULT_STT_MODEL = "nova-2"


def stt_model() -> str:
    """The word-stream model: STT_MODEL, else NOVA_MODEL, else nova-2.

    nova-2 is the default because it keeps "um"/"uh": on the two-voice audio fixture Nova-3
    dropped all 6 scripted "um"s even with filler_words=true, Nova-2 found 5 (and its WER was
    lower, 1.8 % vs 4-5 %). Nova-3 has keyterm prompting; Nova-2 gets the coach's terms as
    keywords instead (vocabulary_settings)."""
    for name in ("STT_MODEL", "NOVA_MODEL"):
        v = (os.environ.get(name) or "").strip()
        if v:
            return v
    return DEFAULT_STT_MODEL


def diarize_extra() -> dict:
    """Extra Deepgram query params: filler words always; DIARIZE_MODEL (streaming accepts
    "v1" or "latest", SDK 7.19) picks the diarization model when set."""
    extra = {"filler_words": True}
    dm = (os.environ.get("DIARIZE_MODEL") or "").strip()
    if dm:
        extra["diarize_model"] = dm
    return extra


def vocabulary_settings(model: str, keyterms: List[str]) -> dict:
    """Coach vocabulary for the word stream: `keyterm` prompting exists only on Nova-3;
    older Nova models take `keywords` (single words)."""
    if not keyterms:
        return {}
    if model.startswith("nova-3"):
        return {"keyterm": list(keyterms)}
    words = []
    for k in keyterms:
        for w in k.split():
            if w and w not in words:
                words.append(w)
    return {"keywords": words[:100]}


def _nova_service_class():
    """DeepgramSTTService whose connect kwargs survive the SDK's strict signature."""
    import inspect

    from deepgram.listen.v1.client import AsyncV1Client
    from pipecat.services.deepgram.stt import DeepgramSTTService

    accepted = [n for n in inspect.signature(AsyncV1Client.connect).parameters if n != "self"]

    class NovaSTTService(DeepgramSTTService):
        def _build_connect_kwargs(self) -> dict:
            kw = super()._build_connect_kwargs()
            if kw.get("diarize_model"):
                # Deepgram refuses diarize (true or false) next to diarize_model (probed
                # 14 Nov); diarize_model alone turns diarization on
                kw = {k: v for k, v in kw.items() if k != "diarize"}
            return split_connect_kwargs(kw, accepted)

    return NovaSTTService


def _flux_window(*args, **kwargs):
    """Find audio_window_start/end in the TurnInfo dict Flux attaches to its TranscriptionFrame."""
    for obj in list(args) + list(kwargs.values()):
        for cand in (obj, getattr(obj, "result", None), obj.get("result") if isinstance(obj, dict) else None):
            if cand is None:
                continue
            g = (lambda k: cand.get(k)) if isinstance(cand, dict) else (lambda k: getattr(cand, k, None))
            s, e = g("audio_window_start"), g("audio_window_end")
            if s is not None and e is not None:
                return float(s), float(e)
    return None


class Hearing:
    def __init__(self, pcm_q: asyncio.Queue, mapper: SpeakerMapper, on_event: Callable[[dict], None],
                 keyterms: Iterable[str] = (), filler_words: Iterable[str] = DEFAULT_FILLERS,
                 use_flux: Optional[bool] = None, audio_clock: Optional[Callable[[], float]] = None,
                 loudness=None, on_words: Optional[Callable[[str, List[Word]], None]] = None,
                 end_on_failure: bool = False,
                 on_live_words: Optional[Callable[[str, List[Word]], None]] = None) -> None:
        self.pcm_q = pcm_q
        self.mapper = mapper
        self.on_event = on_event
        self.keyterms = [k for k in keyterms if k][:100]
        self.filler_words = list(filler_words)
        self.use_flux = _env_flag("USE_FLUX") if use_flux is None else use_flux
        self.audio_clock = audio_clock or (lambda: 0.0)
        self.loudness = loudness  # LoudnessTimeline, for the speaker cross-check
        self.on_words = on_words
        self.pace = RollingPace()
        self._dedupe = WordDeduper()
        # With loudness to settle who the wearer is, the opening turns wait (up to 10 s) for
        # that check: the person who speaks first is often not the wearer.
        self.nova_turns = NovaTurnAssembler(mapper, self._emit, self.filler_words,
                                            hold_s=OPENING_HOLD_S if loudness is not None else 0.0)
        self.flux_turns = FluxTurnAssembler(mapper, self._emit, self.filler_words)
        self._flux_given_up = False
        self._runner = None
        self._ticker = None
        self._run_task: Optional[asyncio.Task] = None
        # always-on: if Deepgram gives up reconnecting, end the worker (so `running` turns False
        # and the owner restarts it) instead of Pipecat's default of running on without STT
        self.end_on_failure = end_on_failure
        # interim AND final words, by speaker, as soon as Deepgram has them (practice mode's
        # crutch-word buzz needs ~1 s, a turn.final can be 20 s away). Interims get revised:
        # the consumer dedupes by word and time.
        self.on_live_words = on_live_words
        # health: last pipeline error (class only), when, and the last transcript from Deepgram
        self.last_error: Optional[str] = None
        self.last_error_at: Optional[float] = None  # time.monotonic()
        self.last_transcript_at: Optional[float] = None  # time.monotonic()
        self._stt_service = None

    @property
    def running(self) -> bool:
        return self._run_task is not None and not self._run_task.done()

    @property
    def connected(self) -> bool:
        """Deepgram's websocket is open right now (no service object: same as running)."""
        if self._stt_service is None:
            return self.running
        return self.running and getattr(self._stt_service, "_connection", None) is not None

    def flush_turns(self) -> None:
        """Close the turn being assembled now (always-on: its conversation is closing)."""
        if self._flux_on():
            self.flux_turns.flush()
        self.nova_turns.flush()

    def _note_error(self, text: str) -> None:
        self.last_error, self.last_error_at = stt_error_class(text), time.monotonic()
        log.error("speech-to-text error: %s", self.last_error)

    # ---------- Deepgram callbacks ----------

    def _emit(self, ev: dict) -> None:
        self.on_event(ev)

    def _on_nova(self, result, text: str) -> None:
        rs, words = words_from_result(result)
        self.last_transcript_at = time.monotonic()
        new = self._dedupe.new(rs, words)
        if not new:
            return
        if self.loudness is not None:
            for w in new:
                self.mapper.note_loudness(w.label, self.loudness.mean_db(w.start, w.end))
            if self.mapper.maybe_swap_by_loudness():
                log.info("speaker labels swapped by loudness check")
                self.on_event({"type": "calibration", "kind": "speaker", "step": "auto-swapped by loudness",
                               "done": True})
        if self._flux_on():
            self.flux_turns.add(new)
            self._flux_on()  # adding can settle a window and show the clocks disagree
        else:
            self.nova_turns.add(new)
        by_speaker: dict = {}
        for w in new:
            by_speaker.setdefault(self.mapper.speaker(w.label), []).append(w)
        mine = by_speaker.get("me", [])
        if mine:
            self.pace.add(mine)
        if self.on_words:
            for spk, ws in by_speaker.items():
                self.on_words(spk, ws)
        self._live(new)

    def _live(self, words: List[Word]) -> None:
        if not self.on_live_words or not words:
            return
        if self.mapper.me_label is None and not self.mapper.single_speaker:
            return  # nobody mapped yet: do not guess who the wearer is from an interim
        by: dict = {}
        for w in words:
            by.setdefault(self.mapper.speaker(w.label), []).append(w)
        for spk, ws in by.items():
            try:
                self.on_live_words(spk, ws)
            except Exception:  # noqa: BLE001
                log.exception("on_live_words failed")

    def _on_interim(self, result, text: str) -> None:
        _, words = words_from_result(result)
        if text or words:
            self.last_transcript_at = time.monotonic()
        if words:
            self.nova_turns.heard(max(w.end for w in words))
        self._live(words)
        if text or words:
            self.on_event(partial_event(self.mapper, words, text or " ".join(w.text for w in words)))

    def _on_flux_end(self, *args, **kwargs) -> None:
        win = _flux_window(*args, **kwargs)
        if win is None:
            return
        self.flux_turns.end_of_turn(*win)
        self._flux_on()

    def _flux_on(self) -> bool:
        """Flux turns in use. The first time the clocks are found to disagree, the words Flux
        still holds go to the Nova assembler, which carries on the turn numbering."""
        if not self.use_flux or self._flux_given_up:
            return False
        if not self.flux_turns.misaligned:
            return True
        log.warning("Flux and Nova clocks disagree by >300 ms: staying Nova-only for turns")
        self._flux_given_up = True
        self.nova_turns.continue_after(self.flux_turns._n)
        self.nova_turns.add(self.flux_turns.hand_over())
        return False

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            try:
                now = self.audio_clock()
                if self._flux_on():
                    self.flux_turns.tick(now)
                else:
                    self.nova_turns.tick(now)
            except Exception:  # noqa: BLE001 - one bad tick must not stop turn assembly
                log.exception("turn assembly tick failed")

    # ---------- lifecycle ----------

    async def start(self) -> None:
        from pipecat.pipeline.parallel_pipeline import ParallelPipeline
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.worker import PipelineParams, PipelineWorker
        from pipecat.services.deepgram.stt import DeepgramSTTService
        from pipecat.workers.runner import WorkerRunner

        NovaSTTService = _nova_service_class()

        key = os.environ.get("DEEPGRAM_API_KEY")
        if not key:
            raise RuntimeError("DEEPGRAM_API_KEY is not set in .env")
        # A new stream numbers speakers from 0 again: in always-on the mapper outlives a
        # restarted worker, and the old labels would now point at whoever speaks first.
        self.mapper.new_stream()
        src, nova_sink, flux_sink = _build_processors(self.pcm_q, self._on_nova, self._on_interim, self._on_flux_end)
        # mip_opt_out: Deepgram keeps no audio for training (the kit's rule, docs/deepgram.md)
        model = stt_model()
        nova = NovaSTTService(api_key=key, sample_rate=SAMPLE_RATE, mip_opt_out=True, settings=DeepgramSTTService.Settings(
            model=model, diarize=True, interim_results=True, smart_format=True,
            **vocabulary_settings(model, self.keyterms), extra=diarize_extra()))
        if self.use_flux:
            from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
            flux = DeepgramFluxSTTService(api_key=key, sample_rate=SAMPLE_RATE, mip_opt_out=True,
                                          settings=DeepgramFluxSTTService.Settings(
                                              model="flux-general-en", keyterm=self.keyterms))

            pipeline = Pipeline([src, ParallelPipeline([flux, flux_sink], [nova, nova_sink])])
        else:
            pipeline = Pipeline([src, nova, nova_sink])  # Phase 1: Nova-only
        extra = {}
        if self.end_on_failure:
            from pipecat.pipeline.worker import ProcessorUnusablePolicy
            extra["processor_unusable_policy"] = ProcessorUnusablePolicy.CANCEL
        worker = PipelineWorker(pipeline, params=PipelineParams(audio_in_sample_rate=SAMPLE_RATE),
                                idle_timeout_secs=None, enable_rtvi=False,  # default 300 s idle would kill it
                                **extra)
        self._stt_service = nova

        @worker.event_handler("on_pipeline_error")
        async def _on_pipeline_error(_worker, frame) -> None:  # health: keep the error class
            self._note_error(str(getattr(frame, "error", frame)))

        self._runner = WorkerRunner(handle_sigint=False)  # FastAPI owns signals
        await self._runner.add_workers(worker)
        self._run_task = asyncio.create_task(self._runner.run())
        self._ticker = asyncio.create_task(self._tick())
        log.info("Deepgram worker connecting (flux=%s, keyterms=%d)", self.use_flux, len(self.keyterms))

    async def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()
        # let the last finals arrive before closing
        await asyncio.sleep(1.0)
        try:
            self._close_runner_queue()
            await self._stop_runner()
        finally:
            if self._flux_on():
                self.flux_turns.flush()
            self.nova_turns.flush()

    def _close_runner_queue(self) -> None:
        try:
            self.pcm_q.put_nowait(None)
        except asyncio.QueueFull:  # full queue: make room for the end marker
            self.pcm_q.get_nowait()
            self.pcm_q.put_nowait(None)

    async def _stop_runner(self) -> None:
        if self._runner is not None:
            for name in ("cancel", "stop", "stop_when_done"):
                fn = getattr(self._runner, name, None)
                if fn:
                    try:
                        r = fn()
                        if asyncio.iscoroutine(r):
                            await asyncio.wait_for(r, timeout=3)
                    except Exception as e:  # noqa: BLE001
                        log.debug("runner.%s: %s", name, e)
                    break


def _env_flag(name: str) -> bool:
    return (os.getenv(name) or "").strip().split("#")[0].strip().lower() in {"1", "true", "yes", "on"}
