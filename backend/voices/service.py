"""VoiceMemory: runs when a conversation closes, never on the live audio path.

    vm = voice_memory(app_state)                 # one per app (created on first use)
    ctl.on_final_words = vm.words.add            # backend/session.py, live words with timings
    vm.schedule(session_id, filler_words)        # Brain, once the keep verdict is stored

One conversation at a time (an asyncio lock); model inference and DB work run in a worker
thread (asyncio.to_thread), so the event loop is never blocked. Every failure is logged and
recorded as the run's status; nothing here raises into session end, the debrief or the verdict.

Env: VOICE_MEMORY (default on; 0 turns the feature off entirely), VOICE_MODEL, VOICE_MODEL_DIR,
VOICE_MODEL_DOWNLOAD (default on), VOICE_THREADS.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

from backend.capture.media import recordings_dir
from backend.capture.store import DISCARD_AUDIO, session_audio_path
from backend.db import DB
from backend.stt.fillers import DEFAULT_FILLERS
from backend.voices import memory, naming, people, store
from backend.voices.correct import correct_turns
from backend.voices.embedder import Embedder, load_embedder
from backend.voices.enrol import enrol_wearer
from backend.voices.names import NameGuess, other_name
from backend.voices.process import analyse, read_wav, span_roles, turn_roles, word_roles
from backend.voices.recompute import NOT_RECOMPUTED, rebuild_derived, recompute_session
from backend.voices.types import VoiceConfig
from backend.voices.words import WordLog

log = logging.getLogger("undertone.voices")

RECORDING_WAIT_S = 30.0
SUMMARY_WAIT_S = 120.0  # the debrief (and the summary row it writes) can take a while
POLL_S = 0.5


def enabled_from_env() -> bool:
    return (os.environ.get("VOICE_MEMORY", "1").strip().lower() not in ("0", "false", "no", "off"))


def _download_allowed() -> bool:
    return os.environ.get("VOICE_MODEL_DOWNLOAD", "1").strip().lower() not in ("0", "false", "no", "off")


class VoiceMemory:
    def __init__(self, db: DB, cfg: VoiceConfig | None = None, enabled: bool | None = None,
                 embedder_factory: Callable[[], Embedder | None] | None = None,
                 namer: Callable[..., Any] = other_name,
                 filler_words: Callable[[], Sequence[str]] = lambda: ()) -> None:
        self.db = db
        self._fillers = filler_words  # the active coach's, for reprocessing and the backfill
        self.cfg = cfg or VoiceConfig()
        self.enabled = enabled_from_env() if enabled is None else enabled
        self.words = WordLog()
        self.recorder: Any = None  # backend.capture.recorder.Recorder, for live enrolment
        self._factory = embedder_factory or (lambda: load_embedder(download=_download_allowed()))
        self._namer = namer
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[Any]] = set()
        self.model: str | None = None
        if self.enabled:
            store.ensure_tables(db)

    # ---------- entry points ----------
    def schedule(self, session_id: str, filler_words: Sequence[str] = (), await_summary: bool = False) -> None:
        """A conversation closed and its verdict is stored. Never raises.

        await_summary: the Brain is still writing the debrief, whose end_session() stores the live
        metrics and summary; wait for it, or the recomputed numbers would be overwritten."""
        if not self.enabled:
            self.words.take(session_id)
            return
        try:
            words = self.words.take(session_id)
            row = self.db.get_session(session_id)
            if words and not (row and row.get("kept_reason") in DISCARD_AUDIO):  # sensitive / noise: dropped
                store.save_words(self.db, session_id, words)
            self._spawn(self.process(session_id, filler_words, await_summary=await_summary))
        except Exception:  # noqa: BLE001
            log.exception("voice memory: could not schedule %s", session_id)

    def _spawn(self, coro: Any) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def drain(self) -> None:
        """Wait for scheduled work (tests, shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def process(self, session_id: str, filler_words: Sequence[str] = (),
                      wait_s: float = RECORDING_WAIT_S, await_summary: bool = False) -> dict[str, Any] | None:
        """Run voice memory over one closed conversation. Returns the report. Never raises."""
        if not self.enabled:
            return None
        try:
            path = await self._wait_until_ready(session_id, wait_s, await_summary)
            async with self._lock:
                report, target = await asyncio.to_thread(self._run_blocking, session_id, path, list(filler_words))
                if report.get("status") == "done":
                    # profile and people cards are rebuilt here on the event loop, like the Brain's writes
                    report["recomputed"] = report.get("recomputed", []) + rebuild_derived(self.db, filler_words)
                    report = await self._names(session_id, report, target)
            if report.get("wearer_confirmed_now"):
                redo = await asyncio.to_thread(self._uncorrected, session_id)
                self._spawn(self._process_all(redo))
            return report
        except Exception as exc:  # noqa: BLE001 - voice memory must never break anything else
            log.exception("voice memory failed for %s", session_id)
            self._safe_save(session_id, "failed", {"reason": type(exc).__name__})
            return None

    async def _wait_until_ready(self, session_id: str, wait_s: float, await_summary: bool) -> Path | None:
        """The recording's path once it is stored (and the summary, when asked), or at the deadline."""
        deadline = time.monotonic() + (max(wait_s, SUMMARY_WAIT_S) if await_summary else wait_s)
        while True:
            row = self.db.get_session(session_id)
            if row is None or (row.get("kept_reason") in DISCARD_AUDIO):
                return None
            path = session_audio_path(row, recordings_dir(Path(self.db.path)))
            ready = path is not None and (not await_summary or row.get("summary_json") is not None)
            if ready or time.monotonic() >= deadline:
                return path
            await asyncio.sleep(POLL_S)

    # ---------- the blocking part (worker thread) ----------
    def _embedder(self) -> Embedder | None:
        emb = self._factory()
        self.model = emb.name if emb is not None else self.model
        return emb

    def _run_blocking(self, session_id: str, path: Path | None,
                      filler_words: list[str]) -> tuple[dict[str, Any], str | None]:
        row = self.db.get_session(session_id)
        skip = _skip_reason(row, path)
        if skip is not None:
            return self._safe_save(session_id, "skipped", {"reason": skip}), None
        embedder = self._embedder()
        if embedder is None:
            return self._safe_save(session_id, "skipped", {"reason": "model unavailable"}), None
        t0 = time.perf_counter()
        report, target = self._analyse_and_remember(session_id, path, row, filler_words, embedder)  # type: ignore[arg-type]
        report["elapsed_s"] = round(time.perf_counter() - t0, 2)
        report["status"] = "done"
        log.info("voice memory: %s done in %.1f s (%d speakers, %d relabelled, %d split)", session_id,
                 report["elapsed_s"], len(report["speakers"]), report["turns_relabelled"], report["turns_split"])
        store.save_run(self.db, session_id, "done", embedder.name, report)
        return report, target

    def _analyse_and_remember(self, session_id: str, path: Path, row: dict[str, Any], filler_words: list[str],
                              embedder: Embedder) -> tuple[dict[str, Any], str | None]:
        db, cfg = self.db, self.cfg
        original = store.original_turns(db, session_id)
        rerun = original is not None
        turns = original if rerun else db.load_turns(session_id)
        words = store.load_words(db, session_id)
        # analyse first: if it fails, the previous run's results are still intact
        a = analyse(read_wav(path), float(row.get("audio_offset_s") or 0.0), turns, words, embedder, cfg)
        if rerun:
            memory.undo_session(db, session_id, cfg)
        else:
            store.save_run(db, session_id, "pending", embedder.name, {}, original_turns=turns)
        heard = str(row.get("started_at") or store.now_iso())
        wearer_row = store.wearer(db)
        wearer_row = wearer_row if wearer_row is not None and wearer_row.model == embedder.name else None
        wd = memory.decide_wearer(a.clusters, wearer_row, cfg)
        voices = [v.voiceprint for v in store.list_voices(db) if v.model == embedder.name]
        confirmed = memory.remember_wearer(db, session_id, a.clusters, wd, embedder.name, cfg, heard)
        decisions = memory.remember_others(db, session_id, a.clusters,
                                           memory.match_others(a.clusters, wd, voices, cfg), embedder.name, cfg, heard)
        report = _base_report(a, wd, decisions)
        report.update(self._correct(session_id, turns, a, wd, decisions, filler_words, rerun))
        _save_sightings(db, session_id, a, decisions, heard)
        target = _main_other(decisions)
        self._tag(session_id, target, cfg)
        if confirmed:
            log.info("voice memory: the wearer's voice is now confirmed; earlier conversations will be redone")
            report["wearer_confirmed_now"] = True
        return report, target

    def _correct(self, session_id: str, turns: list[Any], a: Any, wd: memory.WearerDecision,
                 decisions: list[memory.ClusterDecision], filler_words: list[str], rerun: bool) -> dict[str, Any]:
        if not wd.trusted:
            done: list[str] = []
            if rerun:  # an earlier correction is undone: the original turns and their numbers come back
                store.replace_turns(self.db, session_id, turns)
                done = recompute_session(self.db, session_id, turns, filler_words)
            return {"labels_corrected": False, "turns_relabelled": 0, "turns_split": 0, "recomputed": done,
                    "not_recomputed": list(NOT_RECOMPUTED) if done else []}
        roles = span_roles(a, {d.cluster: d.role for d in decisions})
        fix = correct_turns(turns, a.words, word_roles(a, roles), turn_roles(a, roles), filler_words)
        store.replace_turns(self.db, session_id, fix.turns)
        done = recompute_session(self.db, session_id, fix.turns, filler_words)
        return {"labels_corrected": True, "turns_relabelled": fix.relabelled, "turns_split": fix.split,
                "recomputed": done, "not_recomputed": list(NOT_RECOMPUTED)}

    def _tag(self, session_id: str, voice_id: str | None, cfg: VoiceConfig) -> None:
        manual = people.manual_sessions(self.db)
        if session_id in manual:
            naming.on_manual_tag(self.db, session_id, manual[session_id], cfg)
            return
        row = store.get_voice(self.db, voice_id) if voice_id else None
        if row is not None:
            people.tag_by_voice(self.db, session_id, row.person_id)

    async def _names(self, session_id: str, report: dict[str, Any], target: str | None) -> dict[str, Any]:
        """Name the main other voice from the transcript. A failure here leaves the run 'done'."""
        if target is None:
            return report
        try:
            turns = await asyncio.to_thread(self.db.load_turns, session_id)
            guess: NameGuess | None = await self._namer(turns, None)
            outcome = await asyncio.to_thread(naming.apply_heard_name, self.db, session_id, target, guess)
            if guess is not None:
                report = {**report, "name_guess": {**asdict(guess), "outcome": outcome}}
                await asyncio.to_thread(store.save_run, self.db, session_id, "done", self.model, report)
                if outcome == "named":
                    rebuild_derived(self.db, ())
        except Exception:  # noqa: BLE001
            log.exception("voice memory: name extraction failed for %s", session_id)
        return report

    # ---------- user actions (routes), serialised with processing ----------
    async def run_locked(self, fn: Callable[..., Any], *args: Any) -> Any:
        """A blocking mutation (rename, merge, forget, clear) under the same lock as processing."""
        async with self._lock:
            return await asyncio.to_thread(fn, *args)

    async def manual_tag(self, session_id: str, person_id: str) -> None:
        """POST /sessions/{id}/person: attach the conversation's voice to that person. Never raises.
        The caller has already stored the tag and recorded it as manual."""
        if not self.enabled:
            return
        try:
            async with self._lock:
                await asyncio.to_thread(naming.on_manual_tag, self.db, session_id, person_id, self.cfg)
                self.db.set_session_person(session_id, person_id)  # the manual tag always wins
        except Exception:  # noqa: BLE001 - the tag itself is already stored
            log.exception("voice memory: manual tag of %s not applied to voices", session_id)

    def _safe_save(self, session_id: str, status: str, report: dict[str, Any]) -> dict[str, Any]:
        try:
            store.save_run(self.db, session_id, status, self.model, {**report, "status": status})
        except Exception:  # noqa: BLE001
            log.exception("voice memory: could not record the run for %s", session_id)
        return {**report, "status": status}

    # ---------- reprocess / enrolment ----------
    async def reprocess(self, session_ids: Sequence[str] | None = None) -> tuple[list[str], list[str]]:
        """Queue conversations with recordings (all of them when none given), oldest first."""
        eligible = await asyncio.to_thread(store.sessions_with_recordings, self.db) if self.enabled else []
        wanted = eligible if not session_ids else [s for s in eligible if s in set(session_ids)]
        skipped = [s for s in (session_ids or []) if s not in wanted]
        if wanted:
            self._spawn(self._process_all(wanted))
        return wanted, skipped

    def _uncorrected(self, exclude: str) -> list[str]:
        """Conversations processed before the wearer's voice was trusted."""
        out = []
        for sid in store.sessions_with_recordings(self.db):
            run = store.get_run(self.db, sid)
            if sid != exclude and run is not None and run["status"] == "done" \
                    and not run["report"].get("labels_corrected"):
                out.append(sid)
        return out

    async def _process_all(self, session_ids: Sequence[str]) -> None:
        for sid in session_ids:
            await self.process(sid, self._current_fillers(), wait_s=0.0)

    def _current_fillers(self) -> list[str]:
        try:
            return list(self._fillers())
        except Exception:  # noqa: BLE001
            log.exception("voice memory: could not read the coach's filler words")
            return []

    async def enrol(self, samples: np.ndarray) -> None:
        """Replace the wearer voiceprint with one built from the wearer speaking alone."""
        async with self._lock:
            embedder = await asyncio.to_thread(self._embedder)
            if embedder is None:
                raise RuntimeError("voice model unavailable")
            await asyncio.to_thread(enrol_wearer, self.db, samples, embedder, self.cfg)


def _skip_reason(row: dict[str, Any] | None, path: Path | None) -> str | None:
    if row is None:
        return "unknown session"
    if row.get("kept_reason") in DISCARD_AUDIO:
        return f"verdict {row.get('kept_reason')}: not used"
    if path is None:
        return "no recording"
    return None


def _base_report(a: Any, wd: memory.WearerDecision, decisions: list[memory.ClusterDecision]) -> dict[str, Any]:
    return {"wearer_source": wd.source, "wearer_similarity": wd.similarity, "words_used": a.from_words,
            "spans": len(a.spans), "embedded": len(a.embedded),
            "speakers": [{"voice_id": d.voice_id, "role": d.role, "decision": d.decision,
                          "similarity": d.similarity, "margin": d.margin, "seconds": round(d.seconds, 1)}
                         for d in decisions]}


def _save_sightings(db: DB, session_id: str, a: Any, decisions: list[memory.ClusterDecision], heard: str) -> None:
    by_index = {c.index: c for c in a.clusters}
    rows = [store.Sighting(session_id, d.voice_id, d.role, d.similarity, d.margin, d.decision, d.seconds,
                           by_index[d.cluster].centroid, heard)
            for d in decisions if d.voice_id is not None]
    store.save_sightings(db, session_id, rows)


def _main_other(decisions: list[memory.ClusterDecision]) -> str | None:
    others = [d for d in decisions if d.role == "other" and d.voice_id is not None]
    return max(others, key=lambda d: d.seconds).voice_id if others else None


def _coach_fillers(app_state: Any) -> list[str]:
    """The active coach's filler words, else the live path's defaults."""
    coach = getattr(app_state, "active_coach", None)
    words = list(getattr(coach, "filler_words", None) or [])
    if words:
        return words
    return list(DEFAULT_FILLERS)


def voice_memory(app_state: Any) -> VoiceMemory:
    """The app's VoiceMemory, created on first use and kept on the AppState."""
    vm = getattr(app_state, "voices", None)
    if vm is None:
        vm = VoiceMemory(app_state.db, filler_words=lambda: _coach_fillers(app_state))
        app_state.voices = vm
    return vm
