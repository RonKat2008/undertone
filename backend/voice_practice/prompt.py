"""The voice agent's persona and its Deepgram `Settings` message (Voice Agent API v1).

Settings shape checked against developers.deepgram.com on 14 Nov 2026 (configure-voice-agent,
voice-agent-settings, voice-agent-stt-models, voice-agent-llm-models, voice-agent-tts-models,
voice-agent-message-flow). The practice ends when the coach says CLOSING_LINE
(a function call was tried first: gpt-4o-mini read the call out loud). Models are overridable by env var, never keys.
"""

from __future__ import annotations

import os
import re
from typing import Any, Sequence

from backend.contracts import CoachSpec, HabitProfile, PracticeGoal

PLANNED_QUESTIONS = 5
CLOSING_LINE = "That's our practice for today."
FIRST_MARK = "First question."  # the greeting's opener ends here; the question follows
CLOSING_RE = re.compile(r"\b(?:that'?s|that’s|that is) our practice for today\b", re.I)  # finds CLOSING_LINE
INPUT_RATE, OUTPUT_RATE = 16000, 24000
PROMPT_LIMIT = 24000  # managed LLMs take 25 000 characters

DEFAULT_LISTEN_MODEL = "flux-general-en"  # Flux v2: turn-taking built for agents
DEFAULT_THINK_PROVIDER, DEFAULT_THINK_MODEL = "open_ai", "gpt-4o-mini"  # Deepgram-managed, Standard tier
DEFAULT_VOICE = "flux-kit-en"  # the agent's default Flux TTS voice
EOT_THRESHOLD = 0.8  # higher than the 0.7 default: a thinking pause mid-answer is not the end of it
EOT_TIMEOUT_MS = 6000


def _env(name: str, default: str) -> str:
    return (os.environ.get(name) or "").strip() or default


def _habits(profile: HabitProfile | None) -> str:
    if profile is None or profile.sessions == 0:
        return "No history yet."
    parts = []
    if profile.crutch_words:
        parts.append("crutch words: " + ", ".join(f"'{c.word}'" for c in profile.crutch_words[:3]))
    if profile.recurring_issues:
        parts.append("recurring habits: " + ", ".join(i.label for i in profile.recurring_issues[:3]))
    if profile.baseline_wpm:
        parts.append(f"usual pace about {profile.baseline_wpm:.0f} words a minute")
    return "; ".join(parts) or "No clear habits yet."


def _goals(previous: Sequence[PracticeGoal]) -> str:
    if not previous:
        return "None: this is the first practice."
    return " | ".join(f"{g.title}: {g.target}" for g in previous)


def _question_bank(coach: CoachSpec) -> str:
    prompts = [p for p in coach.drill.prompts if p.strip()]
    return "\n".join(f"- {p}" for p in prompts) or "- (none: write your own, on the coach goal)"


def build_prompt(coach: CoachSpec, profile: HabitProfile | None, previous: Sequence[PracticeGoal]) -> str:
    text = f"""You are {coach.drill.partner_persona or coach.name} running a short SPOKEN practice for the {coach.name} coach.
The person you are talking to wants to get better at this: {coach.goal}

How to run it:
- Your opening line (already spoken) asked the first question. Do not ask it again.
- Ask exactly one question at a time, then stop and listen. Never ask two questions in one turn.
- Ask about {PLANNED_QUESTIONS} main questions in total. Ask the coach's own questions below word for word, in this order (the first is already asked), and only then any of your own:
{_question_bank(coach)}
- Shape questions so they practise their known habits ({_habits(profile)}) and last time's goals ({_goals(previous)}). Never mention scores, numbers or goals out loud.
- After an answer, you may ask at most one short follow-up (one sentence), or acknowledge in a few words and move on.
- Keep every turn under 30 words. Never lecture, never give feedback or tips, never answer for them. This is practice, not a lesson.
- Speak plainly for the ear: no lists, no markdown, numbers in words.
- When you have heard about {PLANNED_QUESTIONS} answers, or they ask to stop, say one warm sentence that you are wrapping up, end with exactly "{CLOSING_LINE}" Say nothing after it.
"""
    return text[:PROMPT_LIMIT]


def greeting(coach: CoachSpec) -> str:
    """Spoken first. It carries the first question: the agent only speaks again after an answer."""
    opener = f"Hi, I'm your {coach.name} coach. I'll ask you a few questions; answer out loud, like it's real."
    first = next((p.strip() for p in coach.drill.prompts if p.strip()), None)
    if first is None:
        return f"{opener} To start, tell me what you'd like to get better at, and why."
    return f"{opener} {FIRST_MARK} {first}"


def build_settings(coach: CoachSpec, profile: HabitProfile | None, previous: Sequence[PracticeGoal]) -> dict[str, Any]:
    keyterms = [k for k in coach.keyterms if k.strip()][:20]
    listen: dict[str, Any] = {"type": "deepgram", "version": "v2", "model": _env("PRACTICE_LISTEN_MODEL",
                                                                                  DEFAULT_LISTEN_MODEL),
                              "eot_threshold": EOT_THRESHOLD, "eot_timeout_ms": EOT_TIMEOUT_MS}
    if keyterms:
        listen["keyterms"] = keyterms
    return {
        "type": "Settings",
        "tags": ["undertone", "practice"],
        "audio": {"input": {"encoding": "linear16", "sample_rate": INPUT_RATE},
                  "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"}},
        "agent": {
            "listen": {"provider": listen},
            "think": {"provider": {"type": _env("PRACTICE_THINK_PROVIDER", DEFAULT_THINK_PROVIDER),
                                   "model": _env("PRACTICE_THINK_MODEL", DEFAULT_THINK_MODEL)},
                      "prompt": build_prompt(coach, profile, previous)},
            "speak": {"provider": {"type": "deepgram", "version": "v2", "model": _env("PRACTICE_VOICE", DEFAULT_VOICE)}},
            "greeting": greeting(coach),
        },
    }
