"""Safe automatic fixes for a model-built CoachSpec. Immutable: always returns new objects."""

from __future__ import annotations

import re
from typing import Any

from backend.contracts import CoachSpec
from backend.studio.condition_check import (
    LEGACY_MOTION_ALIASES,
    check_condition,
    parse_strict,
)
from backend.studio.fallback import cap_name, clean_goal, coach_id, mentioned_fillers, merge_words, name_from_goal
from backend.studio.validate import (
    BUDGET_RANGE,
    CONFIDENCE_RANGE,
    MAX_MESSAGE_CHARS,
    MIN_GAP_RANGE,
    NUDGE_HAPTICS,
    TOLERANCE_RANGE,
    all_questions,
)

# A key must be usable both as a dict key (KEY_RE) and as a path segment in a `when`.
_PATH_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")
_UNIT_FIELDS = {"p", "confidence"}
_UNIT_METRICS = {"talk_ratio", "hand_energy"}
MIN_NOUL_THRESHOLD = 0.8
UNIT_STEP = 0.05  # how far a 0-1 threshold moves off a bound that can never/always hold
POLICY = {"budget_per_session": 5, "min_gap_s": 60.0, "tolerance": 0.3, "silent": False}
DEFAULT_PERSONA = "A friendly colleague who asks follow-up questions."
DROPPED = "dropped"  # notes starting with this mean content was lost

Data = dict[str, Any]


def _key_slug(key: str, taken: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9_]+", "_", key.strip().lower()).strip("_")[:60] or "q"
    if not slug[0].isalpha():
        slug = f"q_{slug}"[:60]
    candidate, n = slug, 2
    while candidate in taken:
        candidate, n = f"{slug}_{n}", n + 1
    return candidate


def _rewrite_when(rules: list[Data], pattern: str, repl: str) -> None:
    for rule in rules:
        rule["when"] = re.sub(pattern, repl, rule.get("when", ""))


def _fix_question_keys(d: Data, notes: list[str]) -> None:
    rules = d["nudge_rules"] + d["motion_rules"]
    fixed: Data = {}
    for qid, q in d["questions"].items():
        new_id = qid if _PATH_KEY_RE.match(qid) else _key_slug(qid, set(fixed) | set(d["questions"]))
        if new_id != qid:
            notes.append(f"renamed question key {qid!r} to {new_id!r}")
            _rewrite_when(rules, rf"(judge\.){re.escape(qid)}(\.)", rf"\g<1>{new_id}\g<2>")
        if q.get("type") == "choice":
            q["criteria"] = _fix_option_keys(new_id, q.get("criteria", {}), rules, notes)
        fixed[new_id] = q
    d["questions"] = fixed


def _fix_option_keys(qid: str, criteria: Data, rules: list[Data], notes: list[str]) -> Data:
    out: Data = {}
    for key, desc in criteria.items():
        new_key = key if _PATH_KEY_RE.match(key) else _key_slug(key, set(out) | set(criteria))
        if new_key != key:
            notes.append(f"renamed option {key!r} of {qid} to {new_key!r}")
            pattern = rf"(judge\.{re.escape(qid)}\.probabilities\.){re.escape(key)}(?=\s*[<>=!])"
            _rewrite_when(rules, pattern, rf"\g<1>{new_key}")
        text = str(desc or "").strip()
        out[new_key] = text or new_key.replace("_", " ")
    return out


def _fix_questions(d: Data, notes: list[str]) -> None:
    kept: Data = {}
    for qid, q in d["questions"].items():
        if not str(q.get("instructions", "")).strip():
            notes.append(f"{DROPPED} question {qid}: empty instructions")
            continue
        if q.get("type") == "score":
            levels = [lvl for lvl in q.get("criteria", []) if str(lvl).strip()]
            if len(levels) < 2:
                notes.append(f"{DROPPED} score question {qid}: fewer than 2 levels")
                continue
            q["criteria"] = levels
        if q.get("type") == "choice" and len(q.get("criteria", {})) < 2:
            notes.append(f"{DROPPED} choice question {qid}: fewer than 2 options")
            continue
        kept[qid] = q
    d["questions"] = kept


def _clamp(value: float, lo: float, hi: float) -> float:
    return min(max(value, lo), hi)


def _bounds(path: tuple[str, ...], questions: dict[str, Any]) -> tuple[float, float, float] | None:
    """(lo, hi, step) for bounded paths; step is how far to move off a bound. None if unbounded."""
    root = path[0]
    if root == "judge" and len(path) >= 3:
        field = path[2]
        if field in _UNIT_FIELDS or field == "probabilities":
            return 0.0, 1.0, UNIT_STEP
        q = questions.get(path[1])
        if field == "score" and q is not None and getattr(q, "type", "") == "score":
            return 1.0, float(max(len(q.criteria), 2)), 1.0
    if root == "metrics" and len(path) == 2 and path[1] in _UNIT_METRICS:
        return 0.0, 1.0, UNIT_STEP
    return None


def _clamped(path: tuple[str, ...], op: str, value: float,
             questions: dict[str, Any]) -> tuple[str, float]:
    """Clamp into range, then move off a bound that would make the rule never or always true."""
    bounds = _bounds(path, questions)
    if bounds is None:
        never_negative = (path[0] == "metrics" and path[-1] != "volume_db") or path[0] == "motion"
        return op, (max(value, 0.0) if never_negative else value)
    lo, hi, step = bounds
    v = _clamp(value, lo, hi)
    if op == ">" and v >= hi:
        return (">=", hi) if step == 1.0 else (">=", hi - step)
    if op == "<" and v <= lo:
        return ("<=", lo) if step == 1.0 else ("<=", lo + step)
    if op == ">=" and v <= lo:
        return ">=", lo + step
    if op == "<=" and v >= hi:
        return "<=", hi - step
    return op, v


def _fix_when(rule: Data, questions: dict[str, Any], notes: list[str]) -> None:
    rid = rule.get("id", "?")
    try:
        cond = parse_strict(rule.get("when", ""))
    except ValueError:
        return
    path = cond.path
    if path[0] == "motion" and len(path) == 2 and path[1] in LEGACY_MOTION_ALIASES:
        path = ("motion", LEGACY_MOTION_ALIASES[path[1]])
        notes.append(f"rule {rid}: motion.{cond.path[1]} rewritten to motion.{path[1]}")
    op, value = _clamped(path, cond.op, cond.value, questions)
    if (op, value) != (cond.op, cond.value):
        notes.append(f"rule {rid}: '{cond.op} {cond.value:g}' adjusted to '{op} {value:g}'")
    is_noul_p = path[0] == "judge" and len(path) == 3 and path[2] == "p"
    if is_noul_p and op in (">=", ">") and value < MIN_NOUL_THRESHOLD:
        notes.append(f"rule {rid}: yes/no threshold {value:g} raised to {MIN_NOUL_THRESHOLD:g}")
        value = MIN_NOUL_THRESHOLD
    rule["when"] = f"{'.'.join(path)} {op} {round(value, 4):g}"


def _short_message(message: str) -> str:
    text = re.sub(r"\s+", " ", message or "").strip().rstrip(".!")
    if len(text) <= MAX_MESSAGE_CHARS:
        return text
    head = re.split(r"[.;:!?,(—-]", text, maxsplit=1)[0].strip()
    if 0 < len(head) <= MAX_MESSAGE_CHARS:
        return head
    return text[:MAX_MESSAGE_CHARS].rsplit(" ", 1)[0].rstrip(" ,.;:-") or text[:MAX_MESSAGE_CHARS]


def _fix_rules(d: Data, notes: list[str]) -> None:
    questions = all_questions(CoachSpec.model_validate({**d, "nudge_rules": [], "motion_rules": []}))
    taken: set[str] = set()
    for kind in ("nudge_rules", "motion_rules"):
        kept: list[Data] = []
        for rule in d[kind]:
            rid = str(rule.get("id", ""))
            if not _PATH_KEY_RE.match(rid) or rid in taken:
                new_id = _key_slug(rid or "rule", taken)
                notes.append(f"rule id {rid!r} changed to {new_id!r}")
                if d["nudge_policy"].get("focus_rule_id") == rid and rid not in taken:
                    d["nudge_policy"]["focus_rule_id"] = new_id
                rule["id"] = rid = new_id
            if rule.get("haptic") not in NUDGE_HAPTICS:
                notes.append(f"rule {rid}: haptic {rule.get('haptic')!r} mapped to 'tap'")
                rule["haptic"] = "tap"
            _fix_when(rule, questions, notes)
            problem = check_condition(rule["when"], questions)
            if problem:
                notes.append(f"{DROPPED} rule {rid}: {problem}")
                continue
            message = _short_message(str(rule.get("message", "")))
            if not message:
                notes.append(f"{DROPPED} rule {rid}: empty message")
                continue
            if message != rule.get("message"):
                notes.append(f"rule {rid}: message shortened to {message!r}")
                rule["message"] = message
            cooldown = rule.get("cooldown_s")
            if cooldown is not None and cooldown < 0:
                rule["cooldown_s"] = 0.0
                notes.append(f"rule {rid}: negative cooldown set to 0")
            taken.add(rid)
            kept.append(rule)
        d[kind] = kept


def _fix_policy(d: Data, notes: list[str]) -> None:
    policy = d["nudge_policy"]
    rules = [*d["nudge_rules"], *d["motion_rules"]]
    focus = next((r for r in rules if r["id"] == policy.get("focus_rule_id")), None)
    if focus is None or focus.get("enabled") is False:
        enabled = [r for r in d["nudge_rules"] if r.get("enabled") is not False]
        if not enabled and d["nudge_rules"]:
            d["nudge_rules"][0]["enabled"] = True
            enabled = [d["nudge_rules"][0]]
            notes.append(f"enabled rule {enabled[0]['id']} so it can be the focus")
        if enabled:
            notes.append(f"focus_rule_id {policy.get('focus_rule_id')!r} changed to {enabled[0]['id']!r}")
            policy["focus_rule_id"] = enabled[0]["id"]
    ranges = {"budget_per_session": BUDGET_RANGE, "min_gap_s": MIN_GAP_RANGE, "tolerance": TOLERANCE_RANGE}
    for name, (lo, hi) in ranges.items():
        value = policy.get(name, POLICY[name])
        clamped = type(POLICY[name])(_clamp(value, lo, hi))
        if clamped != value:
            notes.append(f"nudge_policy.{name} {value:g} clamped to {clamped:g}")
            policy[name] = clamped


def _fix_top_level(d: Data, notes: list[str]) -> None:
    lo, hi = CONFIDENCE_RANGE
    value = float(d.get("confidence_threshold", 0.8))
    clamped = _clamp(value, lo, hi)
    if clamped != value:
        notes.append(f"confidence_threshold {value:g} clamped to {clamped:g}")
        d["confidence_threshold"] = clamped
    if not str(d["drill"].get("partner_persona", "")).strip():
        d["drill"]["partner_persona"] = DEFAULT_PERSONA
        notes.append("drill.partner_persona was empty; set a default")


def apply_safe_fixes(spec: CoachSpec) -> tuple[CoachSpec, list[str]]:
    """Fix what can be fixed mechanically. Notes starting with 'dropped' mean content was lost."""
    notes: list[str] = []
    d: Data = spec.model_dump()  # a deep copy; `spec` is never touched
    _fix_question_keys(d, notes)
    _fix_questions(d, notes)
    _fix_rules(d, notes)
    _fix_policy(d, notes)
    _fix_top_level(d, notes)
    return CoachSpec.model_validate(d), notes


def enforce_overrides(spec: CoachSpec, goal: str) -> CoachSpec:
    """Fields the model never controls: kind, id shape, name cap, goal, policy numbers, fillers."""
    clean = clean_goal(goal)
    lo, hi = CONFIDENCE_RANGE
    fillers = mentioned_fillers(clean)
    name = cap_name(spec.name) or name_from_goal(clean)
    return spec.model_copy(update={
        "kind": "custom",
        "id": coach_id(spec.id if spec.id.strip() else clean),
        "name": name,
        "goal": clean,
        "confidence_threshold": _clamp(spec.confidence_threshold, lo, hi),
        "filler_words": merge_words(fillers, spec.filler_words),
        "keyterms": merge_words(fillers, spec.keyterms),
        "nudge_policy": spec.nudge_policy.model_copy(update=POLICY),
    })


def lost_content(notes: list[str]) -> bool:
    return any(n.startswith(DROPPED) for n in notes)


__all__ = ["apply_safe_fixes", "enforce_overrides", "lost_content"]
