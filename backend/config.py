"""Settings loaded from the repo-root .env (or UNDERTONE_ENV_FILE).

Never print or log key values. Use `settings.has_gemini` style checks instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = REPO_ROOT / "media"
FIXTURES_DIR = REPO_ROOT / "fixtures"
PREBUILT_COACHES_DIR = Path(__file__).resolve().parent / "studio" / "prebuilt"


def _load_env() -> None:
    alt = os.environ.get("UNDERTONE_ENV_FILE")
    if alt and Path(alt).is_file():
        load_dotenv(alt, override=False)
    load_dotenv(REPO_ROOT / ".env", override=False)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().split("#")[0].strip().lower() in {"1", "true", "yes", "on"}


def _number(name: str, default: float, minimum: float) -> float:
    """A number from the env; unset, unreadable or below `minimum` gives `default`."""
    raw = _str(name)
    if raw is None:
        return default
    try:
        val = float(raw)
    except ValueError:
        return default
    return val if val >= minimum else default


def _str(name: str) -> str | None:
    raw = os.environ.get(name)
    if raw is None:
        return None
    val = raw.split(" #")[0].strip()
    return val or None


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    deepgram_api_key: str | None
    public_backend_url: str
    use_rule_judge_only: bool
    demo_policy: bool
    dev: bool
    db_path: Path
    # ALWAYS_ON=1: mic and Deepgram run from band connect; conversations open on the first
    # final turn and close after ALWAYS_ON_SILENCE_S of silence (backend/always_on.py).
    always_on: bool = False
    always_on_silence_s: float = 60.0
    always_on_min_turns: int = 4

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_deepgram(self) -> bool:
        return bool(self.deepgram_api_key)

    def __repr__(self) -> str:  # never leak keys
        return (
            f"Settings(gemini={'set' if self.has_gemini else 'missing'}, "
            f"deepgram={'set' if self.has_deepgram else 'missing'}, "
            f"rule_judge_only={self.use_rule_judge_only}, demo_policy={self.demo_policy}, "
            f"dev={self.dev}, db={self.db_path.name})"
        )

    __str__ = __repr__


def load_settings() -> Settings:
    _load_env()
    db = _str("UNDERTONE_DB") or str(REPO_ROOT / "undertone.db")
    return Settings(
        gemini_api_key=_str("GEMINI_API_KEY"),
        deepgram_api_key=_str("DEEPGRAM_API_KEY"),
        public_backend_url=_str("PUBLIC_BACKEND_URL") or "http://localhost:8000",
        use_rule_judge_only=_flag("USE_RULE_JUDGE_ONLY"),
        demo_policy=_flag("DEMO_POLICY"),
        dev=_flag("DEV"),
        db_path=Path(db),
        always_on=_flag("ALWAYS_ON"),
        always_on_silence_s=_number("ALWAYS_ON_SILENCE_S", 60.0, minimum=1.0),
        always_on_min_turns=int(_number("ALWAYS_ON_MIN_TURNS", 4, minimum=0)),
    )


settings = load_settings()
