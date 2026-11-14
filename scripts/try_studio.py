"""Build coaches from goals for real (Gemini) and print a readable summary.

Usage:
  UNDERTONE_ENV_FILE=/path/to/.env uv run python scripts/try_studio.py "<goal>" ["<goal>" ...] [--json]

backend.config loads UNDERTONE_ENV_FILE (then the repo .env). Never prints any key.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.config import load_settings  # noqa: E402
from backend.contracts import ChoiceQuestion, CoachSpec, ScoreQuestion  # noqa: E402
from backend.studio.builder import BuildResult, build_coach_with_meta  # noqa: E402
from backend.studio.validate import validate_coach  # noqa: E402


def _summary(spec: CoachSpec) -> str:
    lines = [f"  id: {spec.id}", f"  name: {spec.name}", f"  goal: {spec.goal}"]
    lines.append("  questions:")
    for qid, q in spec.questions.items():
        extra = ""
        if isinstance(q, ChoiceQuestion):
            extra = f" options={list(q.criteria)}"
        elif isinstance(q, ScoreQuestion):
            extra = f" levels={len(q.criteria)}"
        lines.append(f"    - {qid} [{q.type}]{extra}: {q.instructions}")
    for label, rules in (("nudge_rules", spec.nudge_rules), ("motion_rules", spec.motion_rules)):
        lines.append(f"  {label}:")
        for r in rules:
            lines.append(f"    - {r.id}: when {r.when!r} -> {r.haptic} {r.message!r} (cooldown {r.cooldown_s})")
    p = spec.nudge_policy
    lines.append(f"  focus: {p.focus_rule_id} (budget {p.budget_per_session}, gap {p.min_gap_s:g}s, "
                 f"tolerance {p.tolerance:g}, silent {p.silent})")
    lines.append(f"  keyterms: {spec.keyterms}")
    lines.append(f"  filler_words: {spec.filler_words}")
    lines.append(f"  debrief_rubric: {spec.debrief_rubric}")
    lines.append(f"  drill persona: {spec.drill.partner_persona}")
    lines.extend(f"    prompt: {pr}" for pr in spec.drill.prompts)
    return "\n".join(lines)


def _report(goal: str, result: BuildResult, as_json: bool) -> None:
    errors = validate_coach(result.spec)
    print("=" * 80)
    print(f"GOAL: {goal!r}")
    print(f"source={result.source} elapsed_ms={result.elapsed_ms:.0f} "
          f"valid={'yes' if not errors else 'NO: ' + '; '.join(errors)}")
    for note in result.notes:
        print(f"  note: {note}")
    print(result.spec.model_dump_json(indent=2) if as_json else _summary(result.spec))


async def _main(goals: list[str], as_json: bool) -> int:
    settings = load_settings()
    print(f"settings: {settings}")  # Settings.__repr__ never shows key values
    failures = 0
    for goal in goals:
        result = await build_coach_with_meta(goal)
        failures += bool(validate_coach(result.spec))
        _report(goal, result, as_json)
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("goals", nargs="+")
    parser.add_argument("--json", action="store_true", help="print the full spec JSON")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    raise SystemExit(asyncio.run(_main(args.goals, args.json)))


if __name__ == "__main__":
    main()
