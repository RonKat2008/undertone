"""Pydantic v2 mirror of contracts/events.ts. Field names match exactly.

contracts/events.ts is the source of truth. Do not add shapes here that are not there,
except internal (non-wire) types clearly marked INTERNAL at the bottom of this file.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import (
    BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, TypeAdapter, model_serializer,
)

# ---------- literals ----------
Speaker = Literal["me", "other"]
MotionState = Literal["still", "gesture", "fidget"]
JudgeSource = Literal["decisions", "rules"]
BandTransport = Literal["ble", "serial", "sim", "laptop-mic"]
SessionMode = Literal["regular", "practice"]
VolumeState = Literal["quiet", "ok", "loud"]
HapticPattern = Literal[
    "tap", "interrupt", "filler", "wrap_up", "slow_down", "still", "success", "approve",
    "status_good", "status_talking", "status_ask",
]
HAPTIC_PATTERNS: frozenset[str] = frozenset(HapticPattern.__args__)  # type: ignore[attr-defined]
BookmarkSource = Literal["phone", "promise"]
StatusVerdict = Literal["good", "talking_too_much", "ask_question"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- judge answers ----------
class NoulAnswer(Model):
    kind: Literal["noul"] = "noul"
    p: float
    confidence: float


class ChoiceAnswer(Model):
    kind: Literal["choice"] = "choice"
    choice: str
    probabilities: dict[str, float]
    confidence: float


class ScoreAnswer(Model):
    kind: Literal["score"] = "score"
    score: float
    max: float
    confidence: float


JudgeAnswer = Annotated[Union[NoulAnswer, ChoiceAnswer, ScoreAnswer], Field(discriminator="kind")]


# ---------- metrics / debrief ----------
class Metrics(Model):
    talk_ratio: float = 0.0
    interruptions: int = 0
    questions: int = 0
    fillers_per_min: float = 0.0
    wpm: float = 0.0
    baseline_wpm: float | None = None
    monologue_s: float = 0.0
    volume_db: float = 0.0
    volume_state: VolumeState = "ok"
    hand_energy: float = 0.0


class BookmarkReview(Model):
    ts: float
    source: BookmarkSource
    snippet: str
    what_happened: str
    follow_up: str | None = None


class TimelinePoint(Model):
    t: float
    wpm: float
    volume_db: float
    hand_energy: float


class DebriefNumbers(Model):
    talk_ratio: float
    interruptions: int
    questions: int
    fillers_per_min: float
    wpm: float


class BetterVersion(Model):
    original: str
    rewritten: str
    audio_url: str | None = None


class Debrief(Model):
    headline_fact: str
    strength: str
    one_fix: str
    if_then: str
    numbers: DebriefNumbers
    best_moment_quote: str
    vs_last_time: str | None = None
    notes: list[str] = Field(default_factory=list)
    bookmarks: list[BookmarkReview] = Field(default_factory=list)
    timeline: list[TimelinePoint] = Field(default_factory=list)
    better_version: BetterVersion | None = None


# ---------- coach ----------
class NoulQuestion(Model):
    type: Literal["noul"] = "noul"
    instructions: str


class ChoiceQuestion(Model):
    type: Literal["choice"] = "choice"
    instructions: str
    criteria: dict[str, str]


class ScoreQuestion(Model):
    type: Literal["score"] = "score"
    instructions: str
    criteria: list[str]


CoachQuestion = Annotated[Union[NoulQuestion, ChoiceQuestion, ScoreQuestion], Field(discriminator="type")]


class NudgeRule(Model):
    id: str
    when: str
    haptic: HapticPattern
    message: str
    cooldown_s: float | None = None
    enabled: bool | None = None


class NudgePolicy(Model):
    focus_rule_id: str
    budget_per_session: int = 5
    min_gap_s: float = 60
    tolerance: float = 0.3
    silent: bool = False


class Drill(Model):
    partner_persona: str
    prompts: list[str] = Field(default_factory=list)


class CoachSpec(Model):
    id: str
    name: str
    goal: str
    kind: Literal["prebuilt", "custom", "personal"]
    confidence_threshold: float
    keyterms: list[str] = Field(default_factory=list)
    filler_words: list[str] = Field(default_factory=list)
    questions: dict[str, CoachQuestion] = Field(default_factory=dict)
    nudge_rules: list[NudgeRule] = Field(default_factory=list)
    motion_rules: list[NudgeRule] = Field(default_factory=list)
    nudge_policy: NudgePolicy
    debrief_rubric: str = ""
    drill: Drill


# ---------- bus events ----------
class BandStatusEvent(Model):
    type: Literal["band.status"] = "band.status"
    connected: bool
    transport: BandTransport
    battery_pct: float | None = None
    mic_on: bool


class DeviceStatusEvent(Model):
    type: Literal["device.status"] = "device.status"
    device_id: str
    name: str
    connected: bool


class SessionStartedEvent(Model):
    type: Literal["session.started"] = "session.started"
    session_id: str
    coach_id: str
    mode: SessionMode
    policy: NudgePolicy
    ts: Literal[0] = 0


class CalibrationEvent(Model):
    type: Literal["calibration"] = "calibration"
    kind: Literal["speaker", "motion", "baseline"]
    step: str
    done: bool


class TranscriptPartialEvent(Model):
    type: Literal["transcript.partial"] = "transcript.partial"
    speaker: Speaker | None = None
    text: str


class TurnFinalEvent(Model):
    type: Literal["turn.final"] = "turn.final"
    turn_id: str
    speaker: Speaker
    text: str
    start: float
    end: float
    wpm: float
    fillers: list[str] = Field(default_factory=list)


class MotionEvent(Model):
    type: Literal["motion"] = "motion"
    state: MotionState
    hand_energy: float
    speaker_context: Speaker | None = None
    confidence: float
    ts: float


class JudgeEvent(Model):
    type: Literal["judge"] = "judge"
    turn_id: str
    results: dict[str, JudgeAnswer]
    latency_ms: float
    source: JudgeSource


class MetricsEvent(Metrics):
    type: Literal["metrics"] = "metrics"


class SignalEvent(Model):
    type: Literal["signal"] = "signal"
    kind: Literal["nerves", "checked_out"]
    detail: str
    ts: float


class NudgeEvent(Model):
    type: Literal["nudge"] = "nudge"
    rule_id: str
    haptic: HapticPattern
    message: str
    reason: str
    confidence: float | None = None
    latency_ms: float
    budget_left: int
    ts: float


class NudgeQuietEvent(Model):
    """A rule fired but did not buzz (not the focus habit, or the budget is spent)."""

    type: Literal["nudge.quiet"] = "nudge.quiet"
    rule_id: str
    haptic: HapticPattern
    message: str
    reason: str
    ts: float


class NudgeSnoozedEvent(Model):
    type: Literal["nudge.snoozed"] = "nudge.snoozed"
    rule_id: str
    ts: float


class StatusReplyEvent(Model):
    type: Literal["status.reply"] = "status.reply"
    verdict: StatusVerdict
    haptic: HapticPattern
    ts: float


class BookmarkEvent(Model):
    type: Literal["bookmark"] = "bookmark"
    source: BookmarkSource
    text: str | None = None
    ts: float


class SessionEndedEvent(Model):
    type: Literal["session.ended"] = "session.ended"
    session_id: str


class DebriefEvent(Model):
    type: Literal["debrief"] = "debrief"
    session_id: str
    data: Debrief
    audio_url: str | None = None


class CoachActivatedEvent(Model):
    type: Literal["coach.activated"] = "coach.activated"
    coach: CoachSpec


class AppRequestEvent(Model):
    type: Literal["app.request"] = "app.request"
    app_id: str
    name: str


BusEvent = Annotated[
    Union[
        BandStatusEvent, DeviceStatusEvent, SessionStartedEvent, CalibrationEvent,
        TranscriptPartialEvent, TurnFinalEvent, MotionEvent, JudgeEvent, MetricsEvent,
        SignalEvent, NudgeEvent, NudgeQuietEvent, NudgeSnoozedEvent, StatusReplyEvent, BookmarkEvent,
        SessionEndedEvent, DebriefEvent, CoachActivatedEvent, AppRequestEvent,
    ],
    Field(discriminator="type"),
]
_BUS_ADAPTER: TypeAdapter[Any] = TypeAdapter(BusEvent)
EVENT_TYPES: frozenset[str] = frozenset(
    m.model_fields["type"].default for m in BusEvent.__origin__.__args__  # type: ignore[attr-defined]
)


def parse_event(data: dict[str, Any]) -> BaseModel:
    """Validate a dict into the matching BusEvent model. Raises pydantic.ValidationError."""
    return _BUS_ADAPTER.validate_python(data)


# ---------- haptics / REST ----------
class HapticCommand(Model):
    type: Literal["haptic"] = "haptic"
    pattern: HapticPattern
    intensity: float = 1.0
    label: str
    source_app: str = "undertone"


class CrutchWord(Model):
    word: str
    per_min: float


class RecurringIssue(Model):
    rule_id: str
    label: str
    rate: float
    trend: Literal["better", "same", "worse"]


class HabitProfile(Model):
    sessions: int = 0
    baseline_wpm: float | None = None
    baseline_volume_db: float | None = None
    crutch_words: list[CrutchWord] = Field(default_factory=list)
    recurring_issues: list[RecurringIssue] = Field(default_factory=list)


class SessionSummary(Model):
    session_id: str
    started_at: str
    duration_s: float
    coach_name: str
    mode: SessionMode
    person_id: str | None = None
    headline_fact: str
    numbers: DebriefNumbers
    # optional on the wire (`kept?`, `kept_reason?`, `audio_url?`): left out when None
    kept: bool | None = None
    kept_reason: str | None = None
    audio_url: str | None = None

    @model_serializer(mode="wrap")
    def _omit_absent_optionals(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        return {k: v for k, v in data.items() if not (k in SUMMARY_OPTIONAL_KEYS and v is None)}


SUMMARY_OPTIONAL_KEYS: frozenset[str] = frozenset({"kept", "kept_reason", "audio_url"})


class TranscriptTurn(Model):
    turn_id: str
    speaker: Speaker
    text: str
    start: float  # seconds from the start of the conversation
    end: float
    wpm: float
    fillers: list[str] = Field(default_factory=list)


class SessionTranscript(Model):
    session_id: str
    started_at: str
    duration_s: float | None = None
    audio_url: str | None = None
    audio_offset_s: float = 0.0  # add to a turn's start to get its position in the audio file
    turns: list[TranscriptTurn] = Field(default_factory=list)


class MissionSuggestion(Model):
    focus_rule_id: str
    text: str


class DailyMission(Model):
    date: str
    focus_rule_id: str
    text: str
    if_then: str
    target: float
    progress: float = 0
    done: bool = False
    suggestions: list[MissionSuggestion] = Field(default_factory=list)


class Streak(Model):
    days: int = 0
    freeze_available: bool = True
    week: list[bool] = Field(default_factory=lambda: [False] * 7)


class Person(Model):
    person_id: str
    name: str
    sessions: int = 0
    pattern: str = ""
    brief: str = ""


DebriefMetric = Literal["talk_ratio", "interruptions", "questions", "fillers_per_min", "wpm"]


class TrendPoint(Model):
    metric: DebriefMetric
    to_: float = Field(alias="to")
    from_: float = Field(alias="from")

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


class WeeklyReport(Model):
    week_of: str
    trend: list[TrendPoint] = Field(default_factory=list)
    best_session_id: str | None = None
    biggest_improvement: str


# ---------- REST: knowledge graph (backend/graph) ----------
GraphNodeKind = Literal["me", "person", "topic", "commitment", "habit", "conversation"]
GraphEdgeKind = Literal["talked_with", "about", "promised", "showed", "part_of"]
GraphMetaValue = Union[str, int, float, bool, None]


class GraphNode(Model):
    id: str  # kind-prefixed: "me", "person:<id>", "topic:<slug>", "commitment:<id>", ...
    kind: GraphNodeKind
    label: str
    weight: float
    last_seen: float | None = None  # unix seconds
    meta: dict[str, GraphMetaValue] = Field(default_factory=dict)


class GraphEdge(Model):
    source: str
    target: str
    kind: GraphEdgeKind
    weight: float


class GraphStats(Model):
    conversations: int = 0
    people: int = 0
    topics: int = 0
    minutes_spoken: float = 0.0
    open_commitments: int = 0


class KnowledgeGraph(Model):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    stats: GraphStats = Field(default_factory=GraphStats)
    generated_at: float  # unix seconds
    sample: bool = False


class GraphQuote(Model):
    session_id: str
    ts: float  # unix seconds
    speaker: Speaker
    text: str


class GraphNodeDetail(Model):
    node: GraphNode
    neighbours: list[GraphNode] = Field(default_factory=list)
    conversations: list[SessionSummary] = Field(default_factory=list)
    quotes: list[GraphQuote] = Field(default_factory=list)


# ---------- REST: voice memory (backend/voices) ----------
WearerState = Literal["none", "provisional", "confirmed", "enrolled"]
VoiceDecision = Literal["wearer", "matched", "new", "weak", "manual"]
VoiceRunStatus = Literal["pending", "done", "skipped", "failed", "off"]
NameOutcome = Literal["named", "confirmed", "conflict", "ignored"]


class VoiceConflict(Model):
    session_id: str
    voice_name: str | None = None  # what the voice was called when the other name was heard
    heard_name: str
    created_at: str  # ISO


class VoiceSummary(Model):
    voice_id: str
    person_id: str | None = None  # the people-store person ('voice-<n>' while unnamed)
    name: str  # the person's name, or 'Unknown voice <n>'
    named: bool
    has_voiceprint: bool
    samples: int = 0  # conversations (and enrolment clips) that fed the voiceprint
    seconds: float = 0.0  # speech held in its exemplars
    last_heard: str | None = None  # ISO
    sessions: list[str] = Field(default_factory=list)  # newest first
    conflicts: list[VoiceConflict] = Field(default_factory=list)


class WearerVoice(Model):
    state: WearerState
    has_voiceprint: bool
    samples: int = 0
    seconds: float = 0.0
    last_heard: str | None = None


class VoiceList(Model):
    enabled: bool
    model: str | None = None
    wearer: WearerVoice
    voices: list[VoiceSummary] = Field(default_factory=list)


class SessionSpeaker(Model):
    voice_id: str | None = None  # 'wearer' for the wearer
    person_id: str | None = None
    name: str | None = None
    role: Speaker
    decision: VoiceDecision
    similarity: float | None = None  # cosine to the matched voiceprint
    margin: float | None = None  # over the second-best voiceprint
    seconds: float


class SessionNameGuess(Model):
    name: str
    source: str  # 'llm' | 'rules'
    evidence: str
    confidence: float
    outcome: NameOutcome


class SessionVoices(Model):
    session_id: str
    status: VoiceRunStatus
    reason: str | None = None
    processed_at: str | None = None  # ISO
    model: str | None = None
    wearer_source: str | None = None  # enrolled | confirmed | provisional | bootstrap | none
    wearer_similarity: float | None = None
    labels_corrected: bool = False
    turns_relabelled: int = 0
    turns_split: int = 0
    words_used: bool = False  # word timings were available (else whole-turn windows)
    speakers: list[SessionSpeaker] = Field(default_factory=list)
    name_guess: SessionNameGuess | None = None
    conflicts: list[VoiceConflict] = Field(default_factory=list)
    recomputed: list[str] = Field(default_factory=list)
    not_recomputed: list[str] = Field(default_factory=list)


class ReprocessResult(Model):
    queued: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


# ---------- INTERNAL (not on the wire) ----------
class MotionSnapshot(Model):
    """Current body state, built by brain.py from motion events, for the nudge engine.

    fidget_while_other_s: how long the wearer has been fidgeting continuously while the other
    person speaks (0 if not). Motion rules read it as `motion.fidget_while_other_s`.
    """

    state: MotionState = "still"
    hand_energy: float = 0.0
    speaker_context: Speaker | None = None
    confidence: float = 0.0
    fidget_while_other_s: float = 0.0
    ts: float = 0.0

class TurnContext(Model):
    """What the judge sees for one wearer turn. Built by brain.py.

    turn: the wearer's turn.final being judged.
    prev_other_turn: the other person's most recent turn before it, if any.
    motion_summary: one line, e.g. "hands: fidget 40% while other spoke; gesture while speaking".
    recent_turns: the last few turns (both speakers, oldest first), excluding `turn`.
    """

    turn: TurnFinalEvent
    prev_other_turn: TurnFinalEvent | None = None
    motion_summary: str = ""
    recent_turns: list[TurnFinalEvent] = Field(default_factory=list)
