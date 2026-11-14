"""Isolated test environment, set once before any test module imports `backend.config`.

`backend.config.settings` is read at import time, so this runs at conftest load (before
collection): a temporary SQLite db, no real keys (empty key vars and a missing env file, so the
repo `.env` cannot fill them in), dev on, demo policy and the rule judge forced on.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="undertone-tests-"))

os.environ.update({
    "DEV": "1",
    "DEMO_POLICY": "1",
    "USE_RULE_JUDGE_ONLY": "1",
    "UNDERTONE_DB": str(_TMP / "tests.db"),
    "UNDERTONE_ENV_FILE": str(_TMP / "does-not-exist.env"),
    # Empty values win over the repo .env (load_dotenv never overrides) and read as "missing".
    "GEMINI_API_KEY": "",
    "DEEPGRAM_API_KEY": "",
})
