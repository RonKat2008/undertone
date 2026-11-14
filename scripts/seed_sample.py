"""Fill a database with realistic past sessions for the demo (History, People, Today screens).

Usage: uv run python scripts/seed_sample.py [db_path] [--force] [--today YYYY-MM-DD]
Seeded session ids start with 'sample_'; --force replaces only those and keeps real sessions.
Needs no .env and no API keys.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.db import DB  # noqa: E402
from backend.growth._sample import SAMPLE_PREFIX, seed  # noqa: E402


def default_db_path() -> Path:
    """Same resolution as backend.config.load_settings, minus reading .env (which holds keys)."""
    return Path(os.environ.get("UNDERTONE_DB") or REPO_ROOT / "undertone.db")


def parse_day(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {raw!r}") from exc


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("db_path", nargs="?", type=Path, default=None,
                   help="SQLite file (default: $UNDERTONE_DB, else undertone.db at the repo root)")
    p.add_argument("--force", action="store_true",
                   help=f"replace earlier '{SAMPLE_PREFIX}' sessions; real sessions are kept")
    p.add_argument("--today", type=parse_day, default=None, help="UTC day to seed back from (testing)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    path: Path = args.db_path or default_db_path()
    today: date = args.today or datetime.now(timezone.utc).date()
    try:
        db = DB(path)
    except Exception as exc:  # sqlite3.Error, OSError: bad path or unreadable file
        print(f"cannot open database {path}: {exc}", file=sys.stderr)
        return 1
    try:
        n = seed(db, today, force=args.force)
    except RuntimeError as exc:
        print(f"refusing to seed {path}: {exc}. Re-run with --force.", file=sys.stderr)
        return 2
    finally:
        db.close()
    print(f"Seeded {n} sample sessions into {path} (session ids start with '{SAMPLE_PREFIX}').")
    return 0


if __name__ == "__main__":
    sys.exit(main())
