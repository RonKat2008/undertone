"""Where conversation recordings live, how big the folder may grow, and the URL a client uses.

Recordings are `<db dir>/media/recordings/<session_id>.wav` (the debrief MP3s use `media/` too;
the folder is git-ignored). File names come only from session ids read back from the database
and are checked against SAFE_ID, so a request can never point outside the folder.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("undertone.capture")

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
DEFAULT_MEDIA_MAX_MB = 2000.0
DEFAULT_MAX_MINUTES = 30.0
BYTES_PER_MB = 1024 * 1024


@dataclass(frozen=True)
class CaptureSettings:
    enabled: bool
    directory: Path
    max_total_bytes: int
    max_file_s: float = DEFAULT_MAX_MINUTES * 60


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().split("#")[0].strip().lower() in {"1", "true", "yes", "on"}


def _env_mb(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").split("#")[0].strip()
    try:
        value = float(raw) if raw else default
    except ValueError:
        log.warning("%s is not a number; using %.0f", name, default)
        return default
    return value if value > 0 else default


def recordings_dir(db_path: Path) -> Path:
    return Path(db_path).resolve().parent / "media" / "recordings"


def capture_settings(db_path: Path) -> CaptureSettings:
    """RECORD_AUDIO (default on) and UNDERTONE_MEDIA_MAX_MB (default 2000)."""
    max_mb = _env_mb("UNDERTONE_MEDIA_MAX_MB", DEFAULT_MEDIA_MAX_MB)
    return CaptureSettings(enabled=_env_flag("RECORD_AUDIO", True), directory=recordings_dir(db_path),
                           max_total_bytes=int(max_mb * BYTES_PER_MB))


def recording_path(directory: Path, session_id: str) -> Path | None:
    """The file for a session id, or None for an id that is not a plain token."""
    if not SAFE_ID.match(session_id):
        return None
    return directory / f"{session_id}.wav"


def audio_url(session_id: str) -> str:
    return f"/sessions/{session_id}/audio"


def delete_recording(directory: Path, session_id: str) -> bool:
    path = recording_path(directory, session_id)
    if path is None:
        return False
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("could not delete recording %s: %s", path.name, type(exc).__name__)
        return False
    return True


def plan_prune(files: list[tuple[str, float, int]], max_total_bytes: int,
               keep: frozenset[str] = frozenset()) -> list[str]:
    """Pure: names to delete, oldest first, until the total fits. files = (name, mtime, size)."""
    total = sum(size for _, _, size in files)
    doomed: list[str] = []
    for name, _, size in sorted(files, key=lambda f: f[1]):
        if total <= max_total_bytes:
            break
        if name in keep:
            continue
        doomed.append(name)
        total -= size
    return doomed


def prune(directory: Path, max_total_bytes: int, keep: frozenset[str] = frozenset()) -> list[str]:
    """Delete the oldest recordings until the folder is under its cap. Never raises."""
    try:
        files = [(p.name, p.stat().st_mtime, p.stat().st_size) for p in directory.glob("*.wav")]
    except OSError as exc:
        log.warning("could not list recordings: %s", type(exc).__name__)
        return []
    doomed = plan_prune(files, max_total_bytes, keep)
    for name in doomed:
        try:
            (directory / name).unlink(missing_ok=True)
        except OSError as exc:
            log.warning("could not prune %s: %s", name, type(exc).__name__)
    if doomed:
        log.info("media cap: removed %d oldest recording(s)", len(doomed))
    return doomed
