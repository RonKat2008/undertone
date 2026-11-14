"""Save a recorded session's turns as a script for scripted speech (STT=fake).

    uv run python scripts/export_session.py                    # latest session in undertone.db
    uv run python scripts/export_session.py s-20261114-... --out fixtures/good_run.jsonl

Then replay it exactly, e.g. on stage if the venue Wi-Fi dies:
    $env:STT="fake"; $env:STT_FAKE_SCRIPT="fixtures/good_run.jsonl"; uv run uvicorn backend.main:app
"""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("session_id", nargs="?", default="latest")
    p.add_argument("--db", default=os.getenv("UNDERTONE_DB") or str(ROOT / "undertone.db"))
    p.add_argument("--out", default=None)
    a = p.parse_args()
    if not Path(a.db).exists():
        print("no database at %s" % a.db, file=sys.stderr)
        return 2
    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    sid = a.session_id
    if sid == "latest":
        row = con.execute("SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT 1").fetchone()
        if row is None:
            print("no sessions in %s" % a.db, file=sys.stderr)
            return 2
        sid = row["session_id"]
    rows = con.execute("SELECT data_json FROM turns WHERE session_id = ? ORDER BY start", (sid,)).fetchall()
    if not rows:
        print("session %s has no turns (was speech on?)" % sid, file=sys.stderr)
        return 2
    out = Path(a.out or ROOT / "fixtures" / ("%s.jsonl" % sid))
    out.parent.mkdir(exist_ok=True)
    lines = []
    for r in rows:
        ev = json.loads(r["data_json"])
        lines.append(json.dumps({"at": ev["end"], "event": ev}))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote %d turns from %s to %s" % (len(lines), sid, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
