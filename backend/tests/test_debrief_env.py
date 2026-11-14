"""Test environment for the debrief tests.

`backend.config.settings` is read once, at import time. The debrief test modules import
`backend.debrief` (and so `backend.config`) during collection, before `test_e2e.py` sets its
environment. This module sorts first among them and sets the same isolated environment that
`test_e2e.py` wants: no real keys (missing env file), dev + demo policy + rule judge, a temp db.

Proper fix (shared file, not owned by debrief): a `backend/tests/conftest.py` doing this once.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="undertone-debrief-"))
os.environ["DEV"] = "1"
os.environ["DEMO_POLICY"] = "1"
os.environ["USE_RULE_JUDGE_ONLY"] = "1"
os.environ["UNDERTONE_DB"] = str(_TMP / "debrief.db")
os.environ["UNDERTONE_ENV_FILE"] = str(_TMP / "does-not-exist.env")


def test_environment_is_isolated() -> None:
    assert os.environ["DEV"] == "1"
    assert not Path(os.environ["UNDERTONE_ENV_FILE"]).exists()
