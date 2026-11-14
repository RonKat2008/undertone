"""Realistic past sessions for the demo (History, People, Today). Used by scripts/seed_sample.py.

The sessions table has no sample flag, so every seeded session id starts with SAMPLE_PREFIX.
Person ids stay clean slugs so tagging from the phone matches by name. Deterministic: the same
`today` always gives the same specs. This module never prints.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from backend.contracts import DebriefNumbers, Person
from backend.db import DB
from backend.growth._writer import SessionSpec, write_session

log = logging.getLogger(__name__)

SAMPLE_PREFIX = "sample_"
SAMPLE_PEOPLE: tuple[Person, ...] = (
    Person(person_id="alex", name="Alex"),    # manager, weekly 1:1s
    Person(person_id="priya", name="Priya"),  # friend, coffee
    Person(person_id="sam", name="Sam"),      # teammate who runs mock interviews
)
SEEDED_TABLES = ("sessions", "turns", "nudges", "debriefs", "judge_results", "bookmarks")
FILLER_WORDS = ("um", "uh", "like", "you know", "kind of", "sort of", "basically", "actually",
                "literally", "I mean", "anyway", "so yeah")
NUDGE_BUDGET = 5
# Weighted crutch words: "like" dominates, as it does for most speakers.
_FILLERS = ("like", "like", "like", "um", "um", "you know", "basically", "I mean", "uh")
_COACHES = {"listener": "Listener", "interview": "Interview"}


@dataclass(frozen=True)
class _Plan:
    days_ago: int
    start: time
    person: str
    coach: str
    minutes: float
    fillers_per_min: float
    interruptions: int
    talk_ratio: float
    questions: int
    wpm: float
    volume_db: float
    headline: str
    one_fix: str
    if_then: str
    follow_up: str


# Oldest first. Improving overall, with noise; interrupts Alex ~2.3x more; talks most with Sam.
_PLANS: tuple[_Plan, ...] = (
    _Plan(9, time(9, 30), "alex", "listener", 18, 8.6, 5, 0.70, 1, 176, -18.5,
          "You cut in 5 times while Alex was mid-sentence.", "Your turns started before Alex finished.",
          "When Alex pauses, count one breath before you answer.",
          "Follow up: ask Alex how the Lisbon trip planning is going."),
    _Plan(8, time(12, 15), "priya", "listener", 12, 8.0, 2, 0.64, 1, 172, -19.5,
          "You spoke for 64% of the coffee and asked 1 question.", "You answered without asking back.",
          "If Priya finishes a story, ask one question about it before sharing yours.",
          "Follow up: ask Priya whether the landlord fixed the heating."),
    _Plan(7, time(16, 0), "sam", "interview", 22, 7.6, 2, 0.74, 1, 174, -18.0,
          "Your answer about the migration ran 3 minutes before the result.",
          "The result came at the end of your answers.",
          "When Sam asks a question, say the result in your first sentence.",
          "Follow up: send Sam the latency numbers from the migration."),
    _Plan(5, time(10, 0), "alex", "listener", 15, 7.1, 4, 0.66, 2, 168, -19.0,
          "You interrupted 4 times, down from 5 last 1:1.", "You jumped in when Alex slowed down.",
          "When you feel the urge to jump in, nod and wait for Alex's full stop.",
          "Follow up: ask Alex what the promotion panel needs from you."),
    _Plan(4, time(13, 30), "priya", "listener", 9, 6.4, 1, 0.58, 3, 164, -20.5,
          "You asked 3 questions about the climbing trip.", "Two stories turned back to you.",
          "If Priya mentions a plan, ask how she feels about it.",
          "Follow up: ask Priya how the bouldering competition went."),
    _Plan(3, time(17, 15), "sam", "interview", 20, 5.6, 2, 0.66, 2, 162, -20.0,
          "You opened 3 of 5 answers with the result.", "You hedged with 'I think maybe' on numbers.",
          "When you give a number, say it once with no 'maybe' in front.",
          "Follow up: ask Sam for one more mock on system design next week."),
    _Plan(2, time(9, 45), "alex", "listener", 14, 5.2, 2, 0.55, 3, 158, -21.0,
          "You let Alex finish 9 of 11 turns before replying.", "Two replies still started early.",
          "When Alex pauses, count one breath before you answer.",
          "Follow up: ask Alex how the Lisbon trip went."),
    _Plan(1, time(11, 30), "priya", "listener", 11, 4.4, 1, 0.50, 4, 154, -21.5,
          "You said 'like' about 4 times a minute, half of 9 days ago.",
          "One long story about work took over the middle.",
          "If a story of yours passes a minute, end it with a question.",
          "Follow up: ask Priya how her sister's wedding planning is going."),
)

_WEARER_LINES: dict[str, tuple[str, ...]] = {
    "alex": (
        "the roadmap slipped because the vendor API changed again.",
        "I like the idea of splitting the launch into two phases.",
        "we were waiting on design for most of last week.",
        "the onboarding numbers look like they are finally moving.",
        "I wanted to talk about the promotion timeline.",
        "the team is stretched with the on-call rotation.",
        "I could take the analytics migration if that helps.",
        "it looks like we need one more engineer for Q1.",
    ),
    "priya": (
        "work has been a lot this month with the launch.",
        "I like that new place on Valencia, the coffee is great.",
        "my brother finally moved to Seattle.",
        "I tried climbing once and my arms were gone for days.",
        "it looks like rain all weekend again.",
        "I have been trying to read before bed instead of scrolling.",
        "the apartment hunt was exhausting last year.",
        "I am thinking about taking a week off in December.",
    ),
    "sam": (
        "in my last role I led the payments migration.",
        "we cut checkout latency from 900 to 300 milliseconds.",
        "the hard part was keeping the old system alive during the cutover.",
        "I like to start with the data model when I design a system.",
        "I would shard by customer id to keep writes local.",
        "the team was four engineers and one designer.",
        "it looks like a cache problem first, then a queue problem.",
        "I pushed for feature flags so we could roll back fast.",
    ),
}
_WEARER_QUESTIONS: dict[str, tuple[str, ...]] = {
    "alex": ("What would make Q1 a win for you?", "How is the Lisbon trip planning going?",
             "What should I stop doing?", "Is there anything blocking you that I can take?"),
    "priya": ("How did the bouldering competition go?", "Did the landlord fix the heating?",
              "How is your sister doing with the wedding?", "What are you reading right now?"),
    "sam": ("Was that the level of detail you wanted?", "Should I go deeper on the sharding?",
            "What would a strong answer have included?", "Can we do one on behavioural questions?"),
}
_OTHER_LINES: dict[str, tuple[str, ...]] = {
    "alex": ("Let's start with the roadmap.", "I hear you on the vendor issue.",
             "I'm planning Lisbon for March, still sorting flights.", "What do you need from me this week?",
             "The panel wants to see you lead a cross-team project.", "Good, let's keep that.",
             "I like the two-phase plan.", "Let's pick this up next week."),
    "priya": ("Okay, tell me everything.", "The bouldering comp was terrifying but fun.",
              "The heating is still broken, honestly.", "My sister picked a venue finally.",
              "That sounds like a lot.", "I'm reading a book about octopuses.",
              "We should go to that place again.", "I have to run in five minutes."),
    "sam": ("Tell me about a project you're proud of.", "What was the result?",
            "How would you design a URL shortener?", "What would you shard on?",
            "Walk me through a time you disagreed with your manager.", "Good, that was clear.",
            "Try that answer again, result first.", "Last one: why this company?"),
}


def _with_fillers(line: str, fillers: list[str]) -> str:
    """First filler opens the line, the rest sit at evenly spaced gaps: 'Um, we were, like, ...'."""
    if not fillers:
        return line[0].upper() + line[1:]
    words = line.split(" ")
    inline = fillers[1:]
    gaps = {round((i + 1) * len(words) / (len(inline) + 1)): f for i, f in enumerate(inline)}
    out: list[str] = []
    for i, word in enumerate(words):
        filler = gaps.get(i)
        out = [*out[:-1], f"{out[-1].rstrip(',')},", f"{filler},", word] if filler and out else [*out, word]
    head = fillers[0]
    return f"{head[0].upper()}{head[1:]}, " + " ".join(out)


def _spread(total: int, parts: int) -> list[int]:
    base, extra = divmod(total, parts)
    return [base + (1 if i < extra else 0) for i in range(parts)]


def _wearer_texts(plan: _Plan, rng: random.Random) -> tuple[str, ...]:
    n_turns = rng.randint(8, 10)
    wearer_minutes = plan.minutes * 0.5 * 0.95  # alternating turns, each 95% of its slot
    quota = round(plan.fillers_per_min * wearer_minutes)
    lines = _WEARER_LINES[plan.person]
    questions = list(_WEARER_QUESTIONS[plan.person][: plan.questions])
    q_turns = set(rng.sample(range(n_turns), k=len(questions)))
    out: list[str] = []
    for i, count in enumerate(_spread(quota, n_turns)):
        per_line = _spread(count, 3)
        body = [_with_fillers(lines[(i * 3 + j + plan.days_ago) % len(lines)],
                              [rng.choice(_FILLERS) for _ in range(k)]) for j, k in enumerate(per_line)]
        if i in q_turns:
            body.append(questions.pop())
        out.append(" ".join(body))
    return tuple(out)


def _nudges(plan: _Plan) -> tuple[tuple[str, bool], ...]:
    if plan.coach == "interview":
        loud = [("hedging", True)] * min(3, NUDGE_BUDGET)
        quiet = [("long_answer", False)] * (2 if plan.talk_ratio > 0.7 else 1)
        if plan.wpm > 165:
            quiet.append(("pace", False))
        quiet += [("interrupt", False)] * plan.interruptions  # tracked, not the focus habit here
    else:
        loud = [("interrupt", True)] * min(plan.interruptions, NUDGE_BUDGET)
        quiet = [("talk_share", False)] if plan.talk_ratio > 0.6 else []
        quiet += [("interrupt", False)] * max(0, plan.interruptions - NUDGE_BUDGET)
    quiet += [("fillers", False)] * max(1, round(plan.fillers_per_min / 2))
    return tuple(loud + quiet)


def _spec(plan: _Plan, today: date) -> SessionSpec:
    day = today - timedelta(days=plan.days_ago)
    started = datetime.combine(day, plan.start, tzinfo=timezone.utc)
    rng = random.Random(f"{day.isoformat()}-{plan.person}")
    others = _OTHER_LINES[plan.person]
    wearer = _wearer_texts(plan, rng)
    numbers = DebriefNumbers(talk_ratio=plan.talk_ratio, interruptions=plan.interruptions,
                             questions=plan.questions, fillers_per_min=plan.fillers_per_min, wpm=plan.wpm)
    return SessionSpec(
        session_id=f"{SAMPLE_PREFIX}{day.strftime('%Y%m%d')}_{plan.person}",
        started_at=started, numbers=numbers, wearer_texts=wearer,
        other_texts=tuple(others[: len(wearer)]), nudges=_nudges(plan), person_id=plan.person,
        duration_s=plan.minutes * 60, coach_id=plan.coach, coach_name=_COACHES[plan.coach],
        headline=plan.headline, one_fix=plan.one_fix, if_then=plan.if_then,
        notes=(plan.follow_up, f"Focus habit: {'hedging' if plan.coach == 'interview' else 'interrupting'}."),
        volume_db=plan.volume_db)


def sample_specs(today: date) -> list[SessionSpec]:
    """About 8 finished sessions over the 10 days before `today` (UTC), none on `today` itself."""
    return [_spec(plan, today) for plan in _PLANS]


def _delete_sample_rows(db: DB) -> None:
    pattern = SAMPLE_PREFIX.replace("_", "\\_") + "%"
    for table in SEEDED_TABLES:  # fixed table names, never user input
        db.execute(f"DELETE FROM {table} WHERE session_id LIKE ? ESCAPE '\\'", (pattern,))


def _rebuild_profile(db: DB) -> None:
    """Refresh the habit profile if the profile module exists yet (built by another agent)."""
    try:
        from backend.growth._profile import rebuild_profile
    except ImportError:
        log.info("growth._profile not available; profile will build after the first live session")
        return
    try:
        rebuild_profile(db, list(FILLER_WORDS))
    except Exception:  # the seed itself succeeded; a profile failure must not undo it
        log.exception("profile rebuild after seeding failed")


def seed(db: DB, today: date, force: bool = False) -> int:
    """Write the sample sessions. Refuses a DB with any session unless `force`; with `force`
    only earlier sample rows (ids starting with SAMPLE_PREFIX) are replaced. Returns sessions written.
    Today's mission is not created here; it is generated on first request."""
    existing = db.query("SELECT COUNT(*) AS n FROM sessions")[0]["n"]
    if existing and not force:
        raise RuntimeError(f"database already has {existing} session(s); pass force=True "
                           f"to replace only the '{SAMPLE_PREFIX}' sample sessions")
    if force:
        _delete_sample_rows(db)
    for person in SAMPLE_PEOPLE:
        db.save_person(person)
    specs = sample_specs(today)
    for spec in specs:
        write_session(db, spec)
    _rebuild_profile(db)
    return len(specs)
