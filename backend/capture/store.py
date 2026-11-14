"""Glue between recordings on disk, verdicts and the sessions table.

The recorder (finishing in a worker thread) and the classifier (a task after session end) can
finish in either order, so both check the stored state: whichever comes second deletes the
audio of a 'noise' or 'sensitive' capture.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from backend.capture.media import audio_url, delete_recording, recording_path
from backend.capture.recorder import RecordingInfo
from backend.capture.verdict import Decide, Verdict, classify, make_verdict
from backend.db import DB

log = logging.getLogger("undertone.capture")

DISCARD_AUDIO: frozenset[str] = frozenset({"noise", "sensitive"})


def audio_discarded(row: Mapping[str, Any] | None) -> bool:
    return bool(row) and row.get("kept_reason") in DISCARD_AUDIO  # type: ignore[union-attr]


def store_recording(db: DB, directory: Path, info: RecordingInfo) -> None:
    """Recorder finished: keep the metadata, unless the capture was already judged noise/sensitive."""
    if audio_discarded(db.get_session(info.session_id)):
        delete_recording(directory, info.session_id)
        return
    db.set_recording(info.session_id, info.offset_s, info.duration_s)


def apply_verdict(db: DB, directory: Path, session_id: str, verdict: Verdict) -> None:
    db.set_verdict(session_id, verdict.kept, verdict.reason, verdict.source)
    if verdict.reason in DISCARD_AUDIO:
        delete_recording(directory, session_id)
        db.set_recording(session_id, None, None)
    log.info("session %s: %s (%s%s)", session_id, verdict.reason, verdict.source,
             f", {verdict.latency_ms:.0f} ms" if verdict.latency_ms is not None else "")


async def classify_session(db: DB, directory: Path, session_id: str, quiet: bool,
                           decide: Decide | None = None) -> Verdict | None:
    """Classify a closed session once and store the verdict. Never raises."""
    try:
        if quiet:  # below ALWAYS_ON_MIN_TURNS: the cheap first gate, no API call
            verdict = make_verdict("trivial", "rules")
        else:
            verdict = await classify(db.load_turns(session_id), decide=decide)
        apply_verdict(db, directory, session_id, verdict)
        return verdict
    except Exception:  # noqa: BLE001 - a failed classification must never break session end
        log.exception("classifying session %s failed", session_id)
        return None


def session_audio_url(row: Mapping[str, Any], directory: Path) -> str | None:
    """The audio URL for a session row, or None when there is no finished recording on disk."""
    if row.get("audio_s") is None or audio_discarded(row):
        return None
    path = recording_path(directory, str(row.get("session_id", "")))
    return audio_url(str(row["session_id"])) if path is not None and path.is_file() else None


def session_audio_path(row: Mapping[str, Any], directory: Path) -> Path | None:
    if session_audio_url(row, directory) is None:
        return None
    return recording_path(directory, str(row["session_id"]))
