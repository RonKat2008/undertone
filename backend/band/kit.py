"""Import the Vexo Open kit from ./vexo-open-kit (git-ignored clone in the repo root)."""
import sys
from pathlib import Path

KIT_DIR = Path(__file__).resolve().parents[2] / "vexo-open-kit" / "python"


def load_kit():
    """Return (Band, PcmDecoder or None). PcmDecoder is None when the `av` package is missing."""
    if not KIT_DIR.exists():
        raise RuntimeError(
            "Vexo kit not found at %s. In the repo root run:\n"
            "  git clone --depth 1 https://github.com/VexoAI-Org/vexo-open-kit" % KIT_DIR)
    if str(KIT_DIR) not in sys.path:
        sys.path.insert(0, str(KIT_DIR))
    from vexo_open import Band  # noqa: E402
    try:
        import av  # noqa: F401
        from vexo_open.audio import PcmDecoder
    except ImportError:
        PcmDecoder = None
    return Band, PcmDecoder
