"""Smoke test: structured JSON from Gemini 3.8 Flash (coach builder + debrief).

Usage (independent of the project env):
  uv run --no-project --with "google-genai>=3.2.0" --with python-dotenv --with pydantic \
      python scripts/smoke_flash.py [--runs 2] [--thinking low] [--variant list|direct] [--only coach|debrief]

--variant direct (default) requests the contract shape as-is: a tagged union inside a
                 free-form map, sent via response_json_schema after gemini_json_schema().
--variant list   fallback: CoachSpec.questions as a list of
                 {id, type, instructions, criteria_keys, criteria_values, levels},
                 converted to the contract's Record<string, CoachQuestion> in code.
--sdk-schema     pass the pydantic class via response_schema (fails for maps on the
                 Developer API: the SDK rejects additionalProperties client-side).

Prints latency, token usage and the parsed result. Never prints the API key.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Annotated, Literal, Optional, Union

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field, ValidationError

MODEL = "gemini-3.8-flash"
ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------- contract models

HapticPattern = Literal[
    "tap", "interrupt", "filler", "wrap_up", "slow_down", "still", "success", "approve",
    "status_good", "status_talking", "status_ask",
]


class NoulQuestion(BaseModel):
    type: Literal["noul"]
    instructions: str


class ChoiceQuestion(BaseModel):
    type: Literal["choice"]
    instructions: str
    criteria: dict[str, str]


class ScoreQuestion(BaseModel):
    type: Literal["score"]
    instructions: str
    criteria: list[str]


CoachQuestion = Annotated[Union[NoulQuestion, ChoiceQuestion, ScoreQuestion], Field(discriminator="type")]


class NudgeRule(BaseModel):
    id: str
    when: str = Field(description='Expression, e.g. "judge.interrupted.p >= 0.8" or "metrics.monologue_s > 45"')
    haptic: HapticPattern
    message: str = Field(description='An action ("Let them finish"), never a judgement')
    cooldown_s: Optional[float] = None
    enabled: Optional[bool] = None


class NudgePolicy(BaseModel):
    focus_rule_id: str
    budget_per_session: int
    min_gap_s: float
    tolerance: float
    silent: bool


class Drill(BaseModel):
    partner_persona: str
    prompts: list[str]


class _CoachBase(BaseModel):
    id: str
    name: str
    goal: str
    kind: Literal["prebuilt", "custom", "personal"]
    confidence_threshold: float = Field(ge=0, le=1)
    keyterms: list[str]
    filler_words: list[str]
    nudge_rules: list[NudgeRule]
    motion_rules: list[NudgeRule]
    nudge_policy: NudgePolicy
    debrief_rubric: str
    drill: Drill


class CoachSpec(_CoachBase):
    """Exact contract shape (contracts/events.ts)."""

    questions: dict[str, CoachQuestion]


class FlatQuestion(BaseModel):
    """Wire-friendly question: no union, no free-form map."""

    id: str = Field(description="snake_case key, [A-Za-z0-9_-]{1,64}")
    type: Literal["noul", "choice", "score"]
    instructions: str
    criteria_keys: list[str] = Field(description="choice only: option names; empty otherwise")
    criteria_values: list[str] = Field(description="choice only: what each option means, same order; empty otherwise")
    levels: list[str] = Field(description="score only: rubric levels from lowest to highest; empty otherwise")


class CoachSpecWire(_CoachBase):
    questions: list[FlatQuestion]

    def to_contract(self) -> CoachSpec:
        qs: dict[str, dict] = {}
        for q in self.questions:
            if q.type == "noul":
                qs[q.id] = {"type": "noul", "instructions": q.instructions}
            elif q.type == "choice":
                if len(q.criteria_keys) != len(q.criteria_values):
                    raise ValueError(f"question {q.id}: criteria_keys/values length mismatch")
                qs[q.id] = {"type": "choice", "instructions": q.instructions,
                            "criteria": dict(zip(q.criteria_keys, q.criteria_values))}
            else:
                qs[q.id] = {"type": "score", "instructions": q.instructions, "criteria": q.levels}
        data = self.model_dump(exclude={"questions"}) | {"questions": qs}
        return CoachSpec.model_validate(data)


class DebriefNumbers(BaseModel):
    talk_ratio: float = Field(ge=0, le=1)
    interruptions: int
    questions: int
    fillers_per_min: float
    wpm: float


class BookmarkReview(BaseModel):
    ts: float
    source: Literal["phone", "promise"]
    snippet: str
    what_happened: str
    follow_up: Optional[str]


class BetterVersion(BaseModel):
    original: str
    rewritten: str
    audio_url: Optional[str]


class DebriefWire(BaseModel):
    """Contract Debrief minus `timeline` (computed locally). Field order = read-aloud order."""

    headline_fact: str
    strength: str
    one_fix: str
    if_then: str
    numbers: DebriefNumbers
    best_moment_quote: str
    vs_last_time: Optional[str]
    notes: list[str]
    bookmarks: list[BookmarkReview]
    better_version: Optional[BetterVersion]


# ---------------------------------------------------------------- prompts

GOAL = "Stop saying 'like' and sound confident in consulting case interviews"

COACH_PROMPT = f"""You design a coach for Undertone, a wearable speech coach that buzzes the wearer's wrist.
Goal from the wearer: "{GOAL}"

Produce a CoachSpec:
- id: short kebab-case slug. kind: "custom". confidence_threshold around 0.7.
- keyterms: domain words the speech recogniser should know (e.g. case-interview vocabulary).
- filler_words: filler and hedge words to count.
- questions: 3-6 questions a judge answers about each wearer turn. type "noul" = yes/no probability,
  "choice" = pick one option (fill criteria_keys and criteria_values, same length),
  "score" = rate on levels (fill levels lowest to highest). Leave unused arrays empty.
- nudge_rules / motion_rules: `when` is an expression over judge.<question_id>.p, judge.<question_id>.choice,
  judge.<question_id>.score or metrics.<talk_ratio|interruptions|questions|fillers_per_min|wpm|monologue_s|volume_db|hand_energy>.
  `message` is an action, never a judgement. Every rule id unique.
- nudge_policy: focus_rule_id must be one of the nudge_rules ids; budget_per_session 5; min_gap_s 60; tolerance 0.3; silent false.
- debrief_rubric: how to judge the session. drill: a practice-partner persona and 3 prompts.
"""

TRANSCRIPT = """\
[0.0-7.1] OTHER: Our client is a regional coffee chain. Profits fell 20% over two years. How would you approach it?
[7.4-24.0] ME: Um, so, like, I'd basically start with, like, revenue versus costs? I'm not totally sure but it could be costs.
[24.5-31.0] OTHER: Okay. Revenue has been flat. What next?
[31.2-52.8] ME: Then costs are the driver. I'd split them into cost of goods, labour and rent, and check which grew faster than inflation. Which store formats does the client run?
[53.0-60.0] OTHER: Mostly high-street stores, some kiosks. I'll send you the store-level data.
[60.2-70.4] ME: Great, like, I'll look at that and send you a short summary by Friday.
"""

METRICS = {"talk_ratio": 0.68, "interruptions": 0, "questions": 1, "fillers_per_min": 7.9, "wpm": 162,
           "baseline_wpm": 150, "focus_habit": "filler 'like'", "last_session": {"fillers_per_min": 9.4, "wpm": 170}}

DEBRIEF_PROMPT = f"""You write the post-conversation debrief for Undertone, a wearable speech coach.
Wearer's goal: "{GOAL}". Use only facts in the data. Compare only with the wearer's own past.
one_fix describes a behaviour, never a trait. if_then is "When <cue>, <action>".
bookmarks: include any promise the wearer made (source "promise") with a follow_up. audio_url fields are null.
better_version: rewrite the wearer's weakest answer.

TRANSCRIPT (seconds since start):
{TRANSCRIPT}
METRICS: {json.dumps(METRICS)}
"""

# ---------------------------------------------------------------- calling


def make_client() -> genai.Client:
    load_dotenv(ROOT / ".env")
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY missing from .env")
    return genai.Client(api_key=key)


def gemini_json_schema(model: type[BaseModel]) -> dict:
    """Pydantic JSON Schema -> the subset Gemini enforces.

    Pydantic emits single-value Literals as `const` and tagged unions as `oneOf` + `discriminator`.
    `const` and `discriminator` are not in Gemini's supported keyword list and are silently ignored,
    so the union's `type` tag is unconstrained and the model can mix branches (measured: 3/3 invalid
    with a conflicting prompt). Rewriting const -> enum makes the branches enforce (3/3 valid).
    """

    def walk(node):
        if isinstance(node, dict):
            node = {k: walk(v) for k, v in node.items() if k != "discriminator"}
            if "const" in node:
                node["enum"] = [node.pop("const")]
            if "oneOf" in node:
                node["anyOf"] = node.pop("oneOf")
            return node
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(model.model_json_schema())


def call(client: genai.Client, prompt: str, schema: type[BaseModel], thinking: str, use_json_schema: bool):
    if use_json_schema:
        schema_kw = {"response_json_schema": gemini_json_schema(schema)}
    else:
        schema_kw = {"response_schema": schema}
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
        **schema_kw,
    )
    t0 = time.perf_counter()
    resp = client.models.generate_content(model=MODEL, contents=prompt, config=config)
    ms = (time.perf_counter() - t0) * 1000
    return resp, ms


def usage_str(resp) -> str:
    u = resp.usage_metadata
    if u is None:
        return "usage: none"
    return (f"usage: prompt={u.prompt_token_count} output={u.candidates_token_count} "
            f"thoughts={u.thoughts_token_count} total={u.total_token_count}")


def run_case(client, label, prompt, schema, thinking, runs, use_json_schema, post=None) -> bool:
    ok = True
    for i in range(runs):
        try:
            resp, ms = call(client, prompt, schema, thinking, use_json_schema)
        except errors.APIError as e:
            print(f"[{label}] run {i + 1}: API ERROR {e.code} {e.status}: {e.message}")
            return False
        except Exception as e:  # SDK-side schema conversion errors, etc.
            print(f"[{label}] run {i + 1}: CLIENT ERROR {type(e).__name__}: {e}")
            return False
        print(f"[{label}] run {i + 1}: {ms:.0f} ms  thinking={thinking}  {usage_str(resp)}")
        try:
            obj = resp.parsed if resp.parsed is not None else schema.model_validate_json(resp.text)
            if isinstance(obj, dict):
                obj = schema.model_validate(obj)
            final = post(obj) if post else obj
        except (ValidationError, ValueError) as e:
            ok = False
            print(f"[{label}] run {i + 1}: INVALID: {e}\nraw: {resp.text[:2000]}")
            continue
        if i == runs - 1:
            print(f"[{label}] parsed ({type(final).__name__}):")
            print(json.dumps(final.model_dump(), indent=2))
    return ok


def check_coach(spec: CoachSpec) -> CoachSpec:
    key_re = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
    bad = [k for k in spec.questions if not key_re.match(k)]
    if bad:
        raise ValueError(f"bad question keys: {bad}")
    rule_ids = {r.id for r in spec.nudge_rules}
    if spec.nudge_policy.focus_rule_id not in rule_ids:
        raise ValueError(f"focus_rule_id {spec.nudge_policy.focus_rule_id!r} not in nudge_rules")
    return spec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--thinking", default="low")
    ap.add_argument("--variant", choices=["list", "direct"], default="direct")
    ap.add_argument("--only", choices=["coach", "debrief"])
    ap.add_argument("--sdk-schema", action="store_true",
                    help="pass the pydantic class via response_schema instead of response_json_schema")
    args = ap.parse_args()
    client = make_client()
    use_js = not args.sdk_schema
    results = {}
    if args.only in (None, "coach"):
        if args.variant == "list":
            results["coach"] = run_case(client, "coach/list", COACH_PROMPT, CoachSpecWire, args.thinking,
                                        args.runs, use_js, post=lambda w: check_coach(w.to_contract()))
        else:
            direct_prompt = COACH_PROMPT.replace(
                "(fill criteria_keys and criteria_values, same length)", "(criteria maps option -> meaning)"
            ).replace("(fill levels lowest to highest). Leave unused arrays empty.", "(criteria = levels, lowest first).")
            direct_prompt += "\n`questions` is an object keyed by question id."
            results["coach"] = run_case(client, "coach/direct", direct_prompt, CoachSpec, args.thinking,
                                        args.runs, use_js, post=check_coach)
    if args.only in (None, "debrief"):
        results["debrief"] = run_case(client, "debrief", DEBRIEF_PROMPT, DebriefWire, args.thinking,
                                      args.runs, use_js)
    print("RESULT:", results)
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
