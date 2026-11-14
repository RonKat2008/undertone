"""Reports: pure functions over hand-built conversations with known answers."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

import pytest

from backend.contracts import DebriefNumbers, SessionSummary
from backend.graph._rows import CommitmentState, Conversation, GraphInput, HabitHit, Line, Promise
from backend.reports._habits import habits_report
from backend.reports._input import split
from backend.reports._measures import MIN_COMPARE, comparison, measure, window_delta
from backend.reports._overview import overview_report
from backend.reports._people import by_person_report, person_report
from backend.reports._promises import promises_report
from backend.reports._sentences import habit_sentence
from backend.reports._topics import by_topic_report, topic_report

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc).timestamp()  # a Saturday
DAYS = 7
PEOPLE = (("alex", "Alex Kim"), ("priya", "Priya"), ("sam", "Sam"))


def _ts(day: int) -> float:
    return datetime(2026, 11, day, 10, 0, tzinfo=timezone.utc).timestamp()


def conv(sid: str, day: int, person: str | None, *, inter: int = 2, questions: int = 2, talk: float = 0.6,
         wpm: float = 150, fillers: float = 2.0, topics: tuple[str, ...] = (), habits: tuple[HabitHit, ...] = (),
         promises: tuple[Promise, ...] = (), me: str = "Fine.", if_then: str = "") -> Conversation:
    numbers = DebriefNumbers(talk_ratio=talk, interruptions=inter, questions=questions, fillers_per_min=fillers,
                             wpm=wpm)
    started = _ts(day)
    summary = SessionSummary(session_id=sid, started_at=datetime.fromtimestamp(started, tz=timezone.utc).isoformat(),
                             duration_s=600, coach_name="Listener", mode="regular", person_id=person,
                             headline_fact=f"headline {sid}", numbers=numbers)
    lines = (Line("other", "Tell me.", 0, 60), Line("me", me, 60, 360))  # 5 minutes spoken
    return Conversation(session_id=sid, started_ts=started, duration_s=600, coach_id="listener", person_id=person,
                        talk_ratio=talk, wpm=wpm, headline=f"headline {sid}", topics=topics, habits=habits,
                        promises=promises, lines=lines, summary=summary, if_then=if_then)


LOUD = HabitHit("interrupt", True, 30.0)
QUIET_FILLER = HabitHit("fillers", False, 40.0)
DECK = Promise(bookmark_id=1, ts=60.0, text="I'll send you the deck by Friday.", follow_up="Send Sam the deck")
DOC = Promise(bookmark_id=2, ts=60.0, text="I'll share the roadmap doc tomorrow.", follow_up="")
FLIGHTS = Promise(bookmark_id=3, ts=60.0, text="I'll book the Lisbon flights.", follow_up="")
CURRENT = (
    conv("c1", 14, "sam", inter=4, fillers=4, topics=("roadmap",), habits=(LOUD, LOUD, LOUD, QUIET_FILLER),
         promises=(DECK,), if_then="When Sam pauses, count one breath."),
    conv("c2", 13, "sam", inter=4, fillers=4, topics=("roadmap",), habits=(LOUD, LOUD, LOUD),
         if_then="When Sam pauses, count one breath."),
    conv("c3", 12, "sam", inter=4, habits=(LOUD, LOUD, LOUD), if_then="Wait for the full stop."),
    conv("c4", 11, "alex", fillers=4, topics=("roadmap",), promises=(DOC,),
         me="The roadmap slipped again. The vendor changed the API and we lost a week."),
    conv("c5", 10, "alex", fillers=4, topics=("roadmap",), promises=(FLIGHTS,)),
    conv("c6", 9, "alex", topics=("lisbon trip",), me="The lisbon trip is in March."),
    conv("c7", 8, None),
    conv("c8", 9, "priya"),
)
PREVIOUS = tuple(conv(f"p{d}", d, "alex", inter=6, habits=(LOUD,) * 5) for d in (2, 3, 4))
OLD = (replace(conv("old", 1, "alex"), started_ts=_ts(1) - 2 * 86_400),)  # 30 Oct: in no window
STATES = (CommitmentState(bookmark_id=3, open=False, closed_by="manual", closed_at=_ts(12), manual=True),)


def _inp(current: tuple[Conversation, ...] = CURRENT, previous: tuple[Conversation, ...] = PREVIOUS):
    convs = tuple(sorted((*current, *previous, *OLD), key=lambda c: -c.started_ts))
    return split(GraphInput(conversations=convs, people=PEOPLE, has_any_session=True, commitments=STATES), DAYS, NOW)


def test_split_uses_whole_utc_days() -> None:
    inp = _inp()
    assert inp.start == datetime(2026, 11, 8, tzinfo=timezone.utc).timestamp()
    assert inp.previous_start == datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp()
    assert {c.session_id for c in inp.current} == {f"c{i}" for i in range(1, 9)}
    assert {c.session_id for c in inp.previous} == {"p2", "p3", "p4"}


def test_measures_weighting() -> None:
    a, b = conv("a", 10, None, talk=0.8), conv("b", 10, None, talk=0.4)
    assert measure([a, b], "talk_ratio") == 0.6 and measure([], "talk_ratio") is None
    assert measure([], "conversations") == 0 and measure([a, b], "minutes_spoken") == 10.0


def test_window_comparison_and_minimum_sample() -> None:
    inp = _inp()
    d = window_delta("interruptions", inp.current, inp.previous)
    assert (d.current, d.previous, d.change, d.direction, d.better) == (2.75, 6.0, -3.25, "down", True)
    assert (d.sample, d.previous_sample) == (8, 3)
    same = window_delta("talk_ratio", inp.current, inp.previous)
    assert same.direction == "same" and same.better is None and same.change == 0
    small = window_delta("interruptions", inp.current, inp.previous[: MIN_COMPARE - 1])
    assert small.direction == "insufficient_data" and small.change is None and small.better is None
    assert small.current == 2.75 and small.previous == 6.0  # the facts stay, the verdict goes
    count = window_delta("conversations", inp.current, inp.previous[:1])
    assert count.direction == "up" and count.better is None  # counts have no better direction
    none_before = window_delta("conversations", inp.current, ())
    assert none_before.direction == "insufficient_data" and none_before.previous == 0


def test_overview_known_answers() -> None:
    r = overview_report(_inp())
    assert r.totals.conversations == 8 and r.totals.minutes_spoken == 40.0 and r.totals.minutes_together == 80.0
    assert r.totals.interruptions == 22 and r.totals.nudges == 9 and r.totals.quiet_marks == 1
    by = {m.metric: m for m in r.measures}
    assert by["questions"].direction == "same" and by["wpm"].better is None
    assert by["conversations"].current == 8 and by["conversations"].previous == 3
    assert r.insufficient_data is False
    habits = {h.rule_id: h for h in r.habits}
    assert habits["interrupt"].total == 9 and habits["interrupt"].buzzed == 9 and habits["interrupt"].conversations == 3
    assert habits["interrupt"].per_conversation == 1.12 and habits["interrupt"].trend.previous == 5.0
    assert r.best_habit is not None and r.best_habit.rule_id == "interrupt"
    assert r.weakest_habit is not None and r.weakest_habit.rule_id == "fillers"
    assert r.promises.model_dump() == {"made": 3, "open": 2, "done": 1, "overdue": 1}
    assert [p.node_id for p in r.top_people] == ["person:alex", "person:sam", "person:priya"]
    assert r.top_people[0].label == "Alex Kim" and r.top_people[0].minutes == 30.0
    assert [t.node_id for t in r.top_topics] == ["topic:roadmap", "topic:lisbon-trip"]
    assert [p.day for p in r.series] == [f"2026-11-{d:02d}" for d in range(8, 15)]
    assert r.series[1].conversations == 2 and r.series[0].talk_ratio == 0.6
    texts = [h.text for h in r.highlights]
    assert [h.kind for h in r.highlights] == ["improved", "person", "slipped"]
    assert texts[0] == "You interrupted 2.8 times a conversation, down from 6 in the 7 days before."
    assert texts[1] == "You interrupt Sam twice as often as in your other conversations (4 against 2 a conversation)."
    assert texts[2] == "You used 3 filler words a minute, up from 2 in the 7 days before."
    focus = set(r.graph_focus.node_ids)
    assert {"me", "person:sam", "topic:roadmap", "habit:interrupt", "commitment:1", "commitment:2"} <= focus
    assert "commitment:3" not in focus  # done promises are not highlighted on the overview map
    assert all(e.source in focus and e.target in focus for e in r.graph_focus.edges)


def test_overview_with_too_little_history_says_so() -> None:
    r = overview_report(_inp(previous=()))
    assert r.insufficient_data is True
    assert r.highlights[0].kind == "insufficient_data"
    assert r.highlights[0].text == (
        "8 conversations in the last 7 days and 0 in the 7 before: too few to compare with your past yet.")
    assert all(m.direction == "insufficient_data" for m in r.measures)
    assert r.best_habit is None and all(h.kind != "improved" for h in r.highlights)


def test_empty_overview() -> None:
    r = overview_report(_inp(current=(), previous=()))
    assert r.totals.conversations == 0 and r.habits == [] and r.top_people == []
    assert len(r.series) == DAYS and all(p.talk_ratio is None and p.conversations == 0 for p in r.series)
    assert {m.metric: m.current for m in r.measures}["talk_ratio"] is None
    assert [h.kind for h in r.highlights] == ["insufficient_data"]
    assert r.graph_focus.node_ids == ["me"] and r.weakest_habit is None


def test_by_person_and_minimum_sample_rule() -> None:
    r = by_person_report(_inp())
    assert [p.person_id for p in r.people] == ["sam", "alex", "priya"]  # tie: most recent first
    assert r.untagged_conversations == 1
    people = {p.person_id: p for p in r.people}
    sam = people["sam"]
    inter = next(c for c in sam.comparisons if c.metric == "interruptions")
    assert (inter.value, inter.usual, inter.ratio, inter.sample, inter.usual_sample, inter.meaningful) == (
        4.0, 2.0, 2.0, 3, 5, True)
    assert sam.sentence == (
        "You interrupt Sam twice as often as in your other conversations (4 against 2 a conversation).")
    assert people["alex"].sentence == "You interrupt Alex less than elsewhere (2 against 3.2 a conversation)."
    priya = people["priya"]  # one conversation: facts, but no ratio and no sentence
    assert priya.conversations == 1 and priya.sentence is None
    assert all(c.ratio is None and not c.meaningful for c in priya.comparisons)
    assert next(c.value for c in priya.comparisons if c.metric == "interruptions") == 2.0
    talk = next(c for c in sam.comparisons if c.metric == "talk_ratio")
    assert talk.ratio == 1.0 and talk.meaningful is False
    assert set(r.graph_focus.node_ids) == {"me", "person:alex", "person:sam", "person:priya"}


def test_person_detail() -> None:
    r = person_report(_inp(), "alex")
    assert r.person.name == "Alex Kim" and r.person.conversations == 3 and r.person.minutes_together == 30.0
    assert r.person.last_talked == _ts(11) and r.person.open_promises == 1
    assert [t.node_id for t in r.topics] == ["topic:roadmap", "topic:lisbon-trip"]
    assert [p.bookmark_id for p in r.promises] == [3, 2]  # oldest first
    assert [t.session_id for t in r.timeline] == ["c4", "c5", "c6"]
    assert r.timeline[0].topic_ids == ["topic:roadmap"] and r.timeline[0].person_node_id == "person:alex"
    edges = {(e.source, e.target) for e in r.graph_focus.edges}
    assert ("me", "person:alex") in edges and ("conversation:c4", "person:alex") in edges
    assert ("conversation:c4", "topic:roadmap") in edges and ("commitment:2", "person:alex") in edges
    assert "person:sam" not in r.graph_focus.node_ids


def test_person_with_no_conversations_in_window() -> None:
    r = person_report(_inp(), "nobody-yet")
    assert r.person.conversations == 0 and r.person.last_talked is None and r.timeline == []
    assert all(c.value is None for c in r.person.comparisons) and r.person.sentence is None


def test_by_topic_and_topic_detail() -> None:
    r = by_topic_report(_inp())
    assert [t.topic_id for t in r.topics] == ["roadmap", "lisbon-trip"]
    roadmap = r.topics[0]
    assert roadmap.conversations == 4 and roadmap.promises == 1
    assert [p.node_id for p in roadmap.people] == ["person:alex", "person:sam"]
    fillers = next(c for c in roadmap.comparisons if c.metric == "fillers_per_min")
    assert (fillers.value, fillers.usual, fillers.meaningful) == (4.0, 2.0, True)
    assert roadmap.sentence == "On roadmap you use more filler words: 4 a minute against 2 elsewhere."
    assert roadmap.trend.current == 4 and roadmap.trend.previous == 0 and roadmap.trend.direction == "up"
    single = r.topics[1]
    assert single.conversations == 1 and single.sentence is None
    assert all(c.ratio is None for c in single.comparisons)
    detail = topic_report(_inp(), "roadmap", "roadmap")
    assert [q.text for q in detail.quotes] == ["The roadmap slipped again."]
    assert detail.quotes[0].session_id == "c4"
    assert [p.bookmark_id for p in detail.promises] == [2] and detail.promises[0].overdue is True
    assert [(b.start, b.days, b.count) for b in detail.series] == [("2026-11-08", 7, 4)]
    assert {h.node_id: h.count for h in detail.habits} == {"habit:interrupt": 6, "habit:fillers": 1}
    edges = {(e.source, e.target) for e in detail.graph_focus.edges}
    assert ("me", "topic:roadmap") in edges and ("conversation:c1", "topic:roadmap") in edges
    assert ("conversation:c4", "commitment:2") in edges


def test_habits_report() -> None:
    r = habits_report(_inp())
    assert [h.habit.rule_id for h in r.habits] == ["interrupt", "fillers"]
    inter = r.habits[0]
    assert inter.by_person[0].node_id == "person:sam" and inter.by_person[0].count == 9
    assert {t.node_id: t.count for t in inter.by_topic} == {"topic:roadmap": 6}
    assert inter.if_then == ["When Sam pauses, count one breath.", "Wait for the full stop."]
    assert [b.count for b in inter.series] == [9]
    assert inter.habit.trend.direction == "down" and inter.habit.trend.better is True
    assert habit_sentence(inter.habit, DAYS) == (
        "Interrupting showed up 1.1 times a conversation, down from 5 in the 7 days before.")
    fillers = r.habits[1].habit
    assert fillers.quiet == 1 and fillers.buzzed == 0
    assert fillers.trend.direction == "insufficient_data"  # one hit in both windows: below MIN_HABIT_HITS
    assert set(r.graph_focus.node_ids) == {"me", "habit:interrupt", "habit:fillers"}


def test_promises_report() -> None:
    r = promises_report(_inp())
    assert r.counts.model_dump() == {"made": 3, "open": 2, "done": 1, "overdue": 1}
    assert [p.bookmark_id for p in r.open] == [2, 1]
    doc, deck = r.open
    assert doc.due_day == "2026-11-12" and doc.overdue is True and doc.age_days == 3
    assert deck.due_day == "2026-11-20" and deck.overdue is False and deck.text == "Send Sam the deck"
    assert deck.person_name == "Sam" and deck.quote == "I'll send you the deck by Friday."
    assert deck.conversation_node_id == "conversation:c1" and deck.age_days == 0
    done = r.done[0]
    assert done.bookmark_id == 3 and done.closed_by == "manual" and done.due_day is None
    edges = {(e.source, e.target) for e in r.graph_focus.edges}
    assert ("commitment:1", "person:sam") in edges and ("conversation:c5", "commitment:3") in edges


@pytest.mark.parametrize("metric", ["interruptions", "questions"])
def test_tiny_differences_are_not_meaningful(metric: str) -> None:
    group = [conv(f"g{i}", 10, "x", **{"inter" if metric == "interruptions" else "questions": 0}) for i in range(3)]
    rest = [conv(f"r{i}", 10, None, **{"inter" if metric == "interruptions" else "questions": 0}) for i in range(2)]
    rest.append(conv("r9", 10, None, **{"inter" if metric == "interruptions" else "questions": 1}))
    c = comparison(metric, group, rest)  # 0 against 0.33: ratio 0, but the gap is under 0.5
    assert c.ratio == 0 and c.meaningful is False


def test_relationships_on_person_rows_and_overview_groups() -> None:
    from backend.contracts import Relationship

    rels = (("alex", Relationship(person_id="alex", kind="boss", confidence=0.834, source="decisions")),
            ("sam", Relationship(person_id="sam", kind="coworker", confidence=1.0, source="user")))
    convs = tuple(sorted((*CURRENT, *PREVIOUS), key=lambda c: -c.started_ts))
    inp = split(GraphInput(conversations=convs, people=PEOPLE, has_any_session=True, commitments=STATES,
                           relationships=rels), DAYS, NOW)
    people = {p.person_id: p for p in by_person_report(inp).people}
    assert (people["alex"].relationship, people["alex"].relationship_confidence,
            people["alex"].relationship_source) == ("boss", 0.83, "decisions")
    assert people["sam"].relationship == "coworker" and people["sam"].relationship_source == "user"
    assert people["priya"].relationship is None and people["priya"].relationship_confidence is None
    groups = [(g.kind, g.people, g.conversations, g.node_ids) for g in overview_report(inp).by_relationship]
    assert groups == [("boss", 1, 3, ["person:alex"]), ("coworker", 1, 3, ["person:sam"]),
                      ("unknown", 1, 1, ["person:priya"])]


def test_habit_sentence_when_the_habit_stopped() -> None:
    from backend.contracts import ReportDelta, ReportHabitCount

    trend = ReportDelta(metric="habit_per_conversation", current=0.0, previous=0.75, change=-0.75, direction="down",
                        better=True, sample=4, previous_sample=4)
    habit = ReportHabitCount(rule_id="talk_share", node_id="habit:talk_share", label="Talking most of the time",
                             total=0, buzzed=0, quiet=0, conversations=0, per_conversation=0.0, trend=trend)
    assert habit_sentence(habit, 5) == (
        "Talking most of the time did not show up, down from 0.8 times a conversation in the 5 days before.")
