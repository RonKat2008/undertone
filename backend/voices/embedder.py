"""The speaker-embedding model, behind a tiny interface so tests use a deterministic fake.

    emb = load_embedder()            # SherpaEmbedder, or None (logged) when it cannot run
    v = emb.embed(samples)           # float32 16 kHz mono -> 1-D embedding (not normalised)

The model file is fetched on first use from a pinned URL, checked against a pinned sha256 and
kept in VOICE_MODEL_DIR (default <repo>/.undertone/models, git-ignored). Nothing here raises
on a missing package, a failed download or a bad checksum: load_embedder() returns None and
voice memory stays off for that attempt (the old behaviour).
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from backend.voices.types import SAMPLE_RATE

log = logging.getLogger("undertone.voices")

RELEASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
DOWNLOAD_TIMEOUT_S = 120.0
RETRY_AFTER_S = 600.0  # a failed load is retried at most this often
REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ModelSpec:
    key: str
    filename: str
    sha256: str
    size_bytes: int
    licence: str


MODELS: dict[str, ModelSpec] = {
    spec.key: spec for spec in (
        ModelSpec("wespeaker-resnet34-lm", "wespeaker_en_voxceleb_resnet34_LM.onnx",
                  "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012", 26_530_550,
                  "Apache-2.0 (WeSpeaker); trained on VoxCeleb (CC BY 4.0)"),
        ModelSpec("campplus-voxceleb", "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
                  "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b", 29_596_978,
                  "Apache-2.0 (3D-Speaker); trained on VoxCeleb (CC BY 4.0)"),
        ModelSpec("wespeaker-campplus-lm", "wespeaker_en_voxceleb_CAM++_LM.onnx",
                  "e197af7e9d473030cf486b3124149a19bf37014d0e4485e4c70c483b0ec10cb2", 29_292_687,
                  "Apache-2.0 (WeSpeaker); trained on VoxCeleb (CC BY 4.0)"),
        ModelSpec("titanet-small", "nemo_en_titanet_small.onnx",
                  "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e", 40_257_283,
                  "CC BY 4.0 (NVIDIA NeMo)"),
    )
}
DEFAULT_MODEL = "wespeaker-resnet34-lm"


class Embedder(Protocol):
    name: str

    def embed(self, samples: np.ndarray) -> np.ndarray: ...


def model_dir() -> Path:
    raw = (os.environ.get("VOICE_MODEL_DIR") or "").strip()
    return Path(raw) if raw else REPO_ROOT / ".undertone" / "models"


def model_spec() -> ModelSpec:
    key = (os.environ.get("VOICE_MODEL") or DEFAULT_MODEL).strip()
    if key not in MODELS:
        log.warning("VOICE_MODEL=%r is unknown; using %s", key, DEFAULT_MODEL)
        key = DEFAULT_MODEL
    return MODELS[key]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _download(spec: ModelSpec, dest: Path) -> None:
    import httpx

    tmp = dest.with_suffix(".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("voice memory: downloading %s (%.0f MB)", spec.filename, spec.size_bytes / 2 ** 20)
    with httpx.stream("GET", RELEASE_URL + spec.filename, follow_redirects=True,
                      timeout=DOWNLOAD_TIMEOUT_S) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in resp.iter_bytes(1 << 20):
                f.write(chunk)
    if sha256_of(tmp) != spec.sha256:
        tmp.unlink(missing_ok=True)
        raise ValueError(f"checksum mismatch for {spec.filename}")
    tmp.replace(dest)


def ensure_model(spec: ModelSpec, directory: Path | None = None, download: bool = True) -> Path | None:
    """The verified model file, fetching it when allowed. None (logged) on any failure."""
    dest = (directory or model_dir()) / spec.filename
    try:
        if dest.is_file() and dest.stat().st_size == spec.size_bytes:
            return dest
        if not download:
            log.warning("voice memory: model %s missing and download disabled", spec.filename)
            return None
        _download(spec, dest)
        return dest
    except Exception as exc:  # noqa: BLE001 - no model means the old behaviour, never a crash
        log.warning("voice memory: model %s unavailable (%s)", spec.filename, type(exc).__name__)
        return None


class SherpaEmbedder:
    """sherpa-onnx SpeakerEmbeddingExtractor (ONNX Runtime on CPU). Thread-safe via a lock."""

    def __init__(self, path: Path, name: str, num_threads: int = 2) -> None:
        import sherpa_onnx  # imported here so a missing package only disables voice memory

        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(path), num_threads=num_threads)
        if not config.validate():
            raise ValueError(f"invalid speaker model config for {path.name}")
        self._ex = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        self._lock = threading.Lock()
        self.name = name
        self.dim = int(self._ex.dim)

    def embed(self, samples: np.ndarray) -> np.ndarray:
        x = np.ascontiguousarray(samples, dtype=np.float32)
        with self._lock:
            stream = self._ex.create_stream()
            stream.accept_waveform(SAMPLE_RATE, x)
            stream.input_finished()
            return np.asarray(self._ex.compute(stream), dtype=np.float32)


_cache: dict[str, Embedder] = {}
_failed_at: dict[str, float] = {}
_cache_lock = threading.Lock()


def load_embedder(download: bool = True) -> Embedder | None:
    """The process-wide embedder (loaded once). Blocking: call from a worker thread."""
    spec = model_spec()
    with _cache_lock:
        if spec.key in _cache:
            return _cache[spec.key]
        if time.monotonic() - _failed_at.get(spec.key, -RETRY_AFTER_S) < RETRY_AFTER_S:
            return None
        path = ensure_model(spec, download=download)
        try:
            if path is None:
                raise FileNotFoundError(spec.filename)
            embedder = SherpaEmbedder(path, spec.key, num_threads=_threads())
        except Exception as exc:  # noqa: BLE001 - ImportError, ONNX errors: degrade, never crash
            log.warning("voice memory: embedding model not loaded (%s); voice memory is idle",
                        type(exc).__name__)
            _failed_at[spec.key] = time.monotonic()
            return None
        _cache[spec.key] = embedder
        log.info("voice memory: model %s loaded (dim %d)", spec.key, embedder.dim)
        return embedder


def _threads() -> int:
    try:
        return max(1, min(8, int(os.environ.get("VOICE_THREADS", "2"))))
    except ValueError:
        return 2
