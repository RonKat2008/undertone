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
from typing import Callable, Iterable, List, Optional

from .fillers import DEFAULT_FILLERS
from .turns import (FluxTurnAssembler, NovaTurnAssembler, RollingPace, SpeakerMapper, Word, WordDeduper,
                    partial_event, words_from_result)

log = logging.getLogger("undertone.stt")
SAMPLE_RATE = 16000


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
        async def process_frame(self, frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)

    return QueueAudioSource(), NovaSink(), FluxSink()


def _flux_window(*args, **kwargs):
    """Find audio_window_start/end in whatever Flux's on_end_of_turn hands us."""
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
                 loudness=None, on_words: Optional[Callable[[str, List[Word]], None]] = None) -> None:
        self.pcm_q = pcm_q
        self.mapper = mapper
        self.on_event = on_event
        self.keyterms = [k for k in keyterms if k][:100]
        self.filler_words = list(filler_words)
        self.use_flux = (os.getenv("USE_FLUX", "false").lower() == "true") if use_flux is None else use_flux
        self.audio_clock = audio_clock or (lambda: 0.0)
        self.loudness = loudness  # LoudnessTimeline, for the speaker cross-check
        self.on_words = on_words
        self.pace = RollingPace()
        self._dedupe = WordDeduper()
        self.nova_turns = NovaTurnAssembler(mapper, self._emit, self.filler_words)
        self.flux_turns = FluxTurnAssembler(mapper, self._emit, self.filler_words)
        self._runner = None
        self._ticker = None

    # ---------- Deepgram callbacks ----------

    def _emit(self, ev: dict) -> None:
        self.on_event(ev)

    def _on_nova(self, result, text: str) -> None:
        rs, words = words_from_result(result)
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
        if self.use_flux and not self.flux_turns.misaligned:
            self.flux_turns.add(new)
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

    def _on_interim(self, result, text: str) -> None:
        _, words = words_from_result(result)
        if text or words:
            self.on_event(partial_event(self.mapper, words, text or " ".join(w.text for w in words)))

    def _on_flux_end(self, *args, **kwargs) -> None:
        win = _flux_window(*args, **kwargs)
        if win is None:
            return
        self.flux_turns.end_of_turn(*win)
        if self.flux_turns.misaligned:
            log.warning("Flux and Nova clocks disagree by >300 ms: staying Nova-only for turns")

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            now = self.audio_clock()
            if self.use_flux and not self.flux_turns.misaligned:
                self.flux_turns.tick(now)
            else:
                self.nova_turns.tick(now)

    # ---------- lifecycle ----------

    async def start(self) -> None:
        from pipecat.pipeline.parallel_pipeline import ParallelPipeline
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.worker import PipelineParams, PipelineWorker
        from pipecat.services.deepgram.stt import DeepgramSTTService
        from pipecat.workers.runner import WorkerRunner

        key = os.environ.get("DEEPGRAM_API_KEY")
        if not key:
            raise RuntimeError("DEEPGRAM_API_KEY is not set in .env")
        src, nova_sink, flux_sink = _build_processors(self.pcm_q, self._on_nova, self._on_interim, self._on_flux_end)
        nova = DeepgramSTTService(api_key=key, sample_rate=SAMPLE_RATE, settings=DeepgramSTTService.Settings(
            model="nova-3", diarize=True, interim_results=True, smart_format=True,
            keyterm=self.keyterms, extra={"filler_words": True}))
        if self.use_flux:
            from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
            flux = DeepgramFluxSTTService(api_key=key, sample_rate=SAMPLE_RATE,
                                          settings=DeepgramFluxSTTService.Settings(
                                              model="flux-general-en", keyterm=self.keyterms))

            @flux.event_handler("on_end_of_turn")
            async def _eot(*args, **kwargs):
                self._on_flux_end(*args, **kwargs)

            pipeline = Pipeline([src, ParallelPipeline([flux, flux_sink], [nova, nova_sink])])
        else:
            pipeline = Pipeline([src, nova, nova_sink])  # Phase 1: Nova-only
        worker = PipelineWorker(pipeline, params=PipelineParams(audio_in_sample_rate=SAMPLE_RATE),
                                idle_timeout_secs=None, enable_rtvi=False)  # default 300 s idle would kill it
        self._runner = WorkerRunner(handle_sigint=False)  # FastAPI owns signals
        await self._runner.add_workers(worker)
        self._run_task = asyncio.create_task(self._runner.run())
        self._ticker = asyncio.create_task(self._tick())
        log.info("Deepgram worker started (flux=%s, keyterms=%d)", self.use_flux, len(self.keyterms))

    async def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()
        # let the last finals arrive before closing
        await asyncio.sleep(1.0)
        self.pcm_q.put_nowait(None)
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
        if self.use_flux and not self.flux_turns.misaligned:
            self.flux_turns.tick(float("inf"))
        self.nova_turns.flush()
