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
    sample: bool = False  # always false: an empty database gives just the `me` node


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


# ---------- REST: relationships (backend/relationships) ----------
# friend/partner/family: personal ties. boss: they manage ME; report: ME manages them;
# coworker: same team or company, no clear lead. client: ME serves them (customer, patient, client);
# service: they serve ME (shop staff, waiter, driver, help desk). teacher: they teach ME;
# student: ME teaches them. acquaintance: some shared history, not close. stranger: no shared
# history (asking directions, small talk with someone new). unknown: not enough speech or mixed signals.
RelationshipKind = Literal[
    "friend", "partner", "family", "boss", "report", "coworker", "client", "teacher", "student",
    "service", "acquaintance", "stranger", "unknown",
]
RelationshipFormality = Literal["casual", "neutral", "formal"]
RelationshipPower = Literal["they_lead", "peer", "i_lead", "unknown"]
RelationshipSource = Literal["decisions", "rules", "user"]


class Relationship(Model):
    person_id: str
    kind: RelationshipKind
    confidence: float = Field(ge=0, le=1)
    formality: RelationshipFormality = "neutral"
    power: RelationshipPower = "unknown"
    warmth: float = Field(default=0.5, ge=0, le=1)
    evidence: list[str] = Field(default_factory=list, max_length=3)  # short, never quotes speech
    source: RelationshipSource
    based_on_sessions: int = 0
    updated_at: float | None = None  # unix seconds; None = not analysed yet


class PersonRelationship(Model):
    person_id: str
    name: str
    sessions: int  # kept conversations with this person
    relationship: Relationship


class RelationshipUpdate(Model):
    kind: RelationshipKind


class CommitmentUpdate(Model):
    """POST /graph/commitment/{id} body: false = done, true = reopened."""

    open: bool


CommitmentClosedBy = Literal["manual", "auto"]


class CommitmentStatus(Model):
    id: str  # "commitment:<bookmark_id>"
    bookmark_id: int
    open: bool
    closed_by: CommitmentClosedBy | None = None
    closed_at: float | None = None  # unix seconds
    closed_session_id: str | None = None  # the later conversation that closed it (auto only)
    evidence: str | None = None  # the wearer's words that closed it (auto only)


# ---------- REST: reports (backend/reports) ----------
ReportMeasure = Literal["conversations", "minutes_spoken", "talk_ratio", "wpm", "fillers_per_min",
                        "interruptions", "questions", "habit_per_conversation"]
ReportDirection = Literal["up", "down", "same", "insufficient_data"]
ReportHighlightKind = Literal["improved", "slipped", "person", "habit", "promises", "topic", "insufficient_data"]


class ReportWindow(Model):
    days: int
    start: float  # unix seconds; the window is [start, end]
    end: float
    previous_start: float  # the previous equal window is [previous_start, start)


class ReportDelta(Model):
    metric: ReportMeasure
    current: float | None = None  # null = no data in this window
    previous: float | None = None
    change: float | None = None  # current - previous; null when the sample is too small
    direction: ReportDirection = "insufficient_data"
    better: bool | None = None  # null when the measure has no better direction or data is insufficient
    sample: int = 0  # conversations behind `current`
    previous_sample: int = 0


class ReportDayPoint(Model):
    day: str  # YYYY-MM-DD, UTC
    conversations: int = 0
    minutes_spoken: float = 0.0
    talk_ratio: float | None = None
    wpm: float | None = None
    fillers_per_min: float | None = None
    interruptions: int = 0
    questions: int = 0
    nudges: int = 0
    quiet_marks: int = 0


class ReportBucket(Model):
    start: str  # YYYY-MM-DD, UTC; first day of the bucket
    days: int
    count: int


class ReportRank(Model):
    node_id: str
    label: str
    conversations: int
    minutes: float  # conversation minutes (both speakers)


class ReportCount(Model):
    node_id: str
    label: str
    count: int


class ReportComparison(Model):
    metric: ReportMeasure
    value: float | None = None  # the wearer in these conversations
    usual: float | None = None  # the wearer in all their other conversations in the window
    ratio: float | None = None  # value / usual; null unless both samples are big enough
    sample: int = 0
    usual_sample: int = 0
    meaningful: bool = False  # big enough samples and a clear difference


class ReportHighlight(Model):
    kind: ReportHighlightKind
    text: str
    node_ids: list[str] = Field(default_factory=list)


class GraphFocusEdge(Model):
    source: str
    target: str


class GraphFocus(Model):
    node_ids: list[str] = Field(default_factory=list)
    edges: list[GraphFocusEdge] = Field(default_factory=list)


class ReportTotals(Model):
    conversations: int = 0
    minutes_spoken: float = 0.0  # the wearer's own speaking minutes
    minutes_together: float = 0.0  # conversation length
    interruptions: int = 0
    questions: int = 0
    nudges: int = 0  # buzzed
    quiet_marks: int = 0


class ReportPromiseCounts(Model):
    made: int = 0
    open: int = 0
    done: int = 0
    overdue: int = 0


class ReportHabitCount(Model):
    rule_id: str
    node_id: str
    label: str
    total: int
    buzzed: int
    quiet: int
    conversations: int  # conversations it showed up in
    per_conversation: float | None = None  # across all conversations in the window
    trend: ReportDelta


class ReportConversation(Model):
    session_id: str
    node_id: str
    started_at: float  # unix seconds
    minutes: float
    minutes_spoken: float
    talk_ratio: float
    wpm: float
    fillers_per_min: float
    interruptions: int
    questions: int
    headline: str
    person_node_id: str | None = None
    topic_ids: list[str] = Field(default_factory=list)  # topic node ids


class ReportPromise(Model):
    id: str  # commitment node id
    bookmark_id: int
    text: str
    quote: str | None = None
    person_id: str | None = None
    person_name: str | None = None
    person_node_id: str | None = None
    session_id: str
    conversation_node_id: str
    made_at: float  # unix seconds
    age_days: int
    open: bool
    closed_by: CommitmentClosedBy | None = None
    closed_at: float | None = None
    closed_session_id: str | None = None
    evidence: str | None = None
    due_day: str | None = None  # YYYY-MM-DD, only when the promise names a clear day
    overdue: bool = False


class ReportQuote(Model):
    session_id: str
    ts: float  # unix seconds
    text: str


class ReportRelationshipGroup(Model):
    kind: RelationshipKind  # people never analysed are grouped under "unknown"
    people: int
    conversations: int
    minutes: float
    node_ids: list[str] = Field(default_factory=list)  # person node ids


class OverviewReport(Model):
    window: ReportWindow
    totals: ReportTotals
    measures: list[ReportDelta] = Field(default_factory=list)
    habits: list[ReportHabitCount] = Field(default_factory=list)
    best_habit: ReportHabitCount | None = None
    weakest_habit: ReportHabitCount | None = None
    promises: ReportPromiseCounts
    top_people: list[ReportRank] = Field(default_factory=list)
    top_topics: list[ReportRank] = Field(default_factory=list)
    by_relationship: list[ReportRelationshipGroup] = Field(default_factory=list)
    series: list[ReportDayPoint] = Field(default_factory=list)
    highlights: list[ReportHighlight] = Field(default_factory=list)
    insufficient_data: bool = True  # too few conversations to compare with the previous window
    graph_focus: GraphFocus


class PersonReportSummary(Model):
    person_id: str
    node_id: str
    name: str
    conversations: int
    minutes_together: float
    minutes_spoken: float
    last_talked: float | None = None  # unix seconds
    relationship: RelationshipKind | None = None  # null = never analysed (backend/relationships)
    relationship_confidence: float | None = None
    relationship_source: RelationshipSource | None = None
    comparisons: list[ReportComparison] = Field(default_factory=list)
    sentence: str | None = None  # the clearest meaningful comparison, ready to show
    open_promises: int = 0
    top_topics: list[ReportRank] = Field(default_factory=list)


class ByPersonReport(Model):
    window: ReportWindow
    people: list[PersonReportSummary] = Field(default_factory=list)
    untagged_conversations: int = 0
    graph_focus: GraphFocus


class PersonReport(Model):
    window: ReportWindow
    person: PersonReportSummary
    topics: list[ReportRank] = Field(default_factory=list)
    promises: list[ReportPromise] = Field(default_factory=list)
    habits: list[ReportCount] = Field(default_factory=list)
    timeline: list[ReportConversation] = Field(default_factory=list)
    graph_focus: GraphFocus


class TopicReportSummary(Model):
    topic_id: str  # slug
    node_id: str
    label: str
    conversations: int
    minutes_together: float
    last_discussed: float | None = None
    trend: ReportDelta  # conversations on the topic, this window vs the previous one
    people: list[ReportRank] = Field(default_factory=list)
    comparisons: list[ReportComparison] = Field(default_factory=list)
    sentence: str | None = None
    promises: int = 0


class ByTopicReport(Model):
    window: ReportWindow
    topics: list[TopicReportSummary] = Field(default_factory=list)
    graph_focus: GraphFocus


class TopicReport(Model):
    window: ReportWindow
    topic: TopicReportSummary
    series: list[ReportBucket] = Field(default_factory=list)
    promises: list[ReportPromise] = Field(default_factory=list)
    quotes: list[ReportQuote] = Field(default_factory=list)
    habits: list[ReportCount] = Field(default_factory=list)
    timeline: list[ReportConversation] = Field(default_factory=list)
    graph_focus: GraphFocus


class HabitReport(Model):
    habit: ReportHabitCount
    series: list[ReportBucket] = Field(default_factory=list)
    by_person: list[ReportCount] = Field(default_factory=list)
    by_topic: list[ReportCount] = Field(default_factory=list)
    if_then: list[str] = Field(default_factory=list)


class HabitsReport(Model):
    window: ReportWindow
    habits: list[HabitReport] = Field(default_factory=list)
    graph_focus: GraphFocus


class PromisesReport(Model):
    window: ReportWindow
    counts: ReportPromiseCounts
    open: list[ReportPromise] = Field(default_factory=list)
    done: list[ReportPromise] = Field(default_factory=list)
    graph_focus: GraphFocus


REPORT_TYPES: tuple[str, ...] = (
    "ReportWindow", "ReportDelta", "ReportDayPoint", "ReportBucket", "ReportRank", "ReportCount",
    "ReportComparison", "ReportHighlight", "GraphFocusEdge", "GraphFocus", "ReportTotals",
    "ReportPromiseCounts", "ReportHabitCount", "ReportConversation", "ReportPromise", "ReportQuote",
    "ReportRelationshipGroup",
    "OverviewReport", "PersonReportSummary", "ByPersonReport", "PersonReport", "TopicReportSummary",
    "ByTopicReport", "TopicReport", "HabitReport", "HabitsReport", "PromisesReport",
)


# ---------- REST + WebSocket payloads: spoken practice with the coach (/ws/practice, /practice/*) ----------
# The wearer answers the active coach's spoken questions (Deepgram Voice Agent, relayed by the backend).
# A measure that could not be taken is null or left out, never zero. Mirrored in contracts/events.ts.
PracticeMeasure = Literal["pace", "fillers", "conciseness", "structure", "confidence", "responsiveness"]
PracticeScoreSource = Literal["measured", "judged", "rules"]
PracticeJudge = Literal["gemini", "rules"]
PracticeSpeaker = Literal["coach", "you", "thinking", "waiting"]
PracticeErrorCode = Literal["no_key", "agent_refused", "agent_lost", "mic_silent", "busy", "bad_message"]


class PracticeAnswer(Model):
    index: int  # 1-based, in the order the questions were asked
    question: str
    text: str
    words: int
    speaking_s: float | None = None  # first word to last word, from word timings
    wpm: float | None = None
    fillers: list[str] = Field(default_factory=list)  # each filler as heard, in order
    fillers_per_min: float | None = None
    hedges: list[str] = Field(default_factory=list)
    long_pauses: int | None = None  # gaps of 2 s or more between words
    time_to_start_s: float | None = None  # coach audio finished (in the browser) -> first word


class PracticeTotals(Model):
    answers: int
    words: int
    speaking_s: float | None = None
    wpm: float | None = None
    filler_count: int
    fillers_per_min: float | None = None
    top_fillers: list[str] = Field(default_factory=list)
    hedges: int
    long_pauses: int | None = None
    mean_answer_s: float | None = None
    mean_time_to_start_s: float | None = None


class PracticeSubScore(Model):
    measure: PracticeMeasure
    label: str
    score: int  # 0-100
    source: PracticeScoreSource  # measured from numbers, judged by Gemini, or a rule-based estimate
    detail: str  # plain words, e.g. "148 words a minute"


class PracticeStrength(Model):
    title: str
    detail: str
    from_answer: int | None = None


class PracticeGoal(Model):
    measure: PracticeMeasure
    title: str  # e.g. "Fewer filler words"
    target: str  # e.g. "Under 3 filler words a minute; you had 7"
    target_min: float | None = None  # numeric target, when the measure is a number
    target_max: float | None = None
    unit: str | None = None  # e.g. "filler words a minute"
    actual: float | None = None  # this session's value of the measure
    from_answer: int | None = None
    evidence: str | None = None  # a short quote or number from that answer


class PracticeGoalCheck(Model):
    goal: PracticeGoal  # the goal as set last time
    now: float | None = None  # this session's value of the same measure
    met: bool | None = None  # null: could not be measured this time
    detail: str


class PracticeResult(Model):
    id: str
    coach_id: str
    coach_name: str
    started_at: str  # ISO 8601
    duration_s: float
    overall: int  # 0-100
    summary: str
    sub_scores: list[PracticeSubScore]
    strengths: list[PracticeStrength]
    goals: list[PracticeGoal]
    previous_goals: list[PracticeGoalCheck] = Field(default_factory=list)
    answers: list[PracticeAnswer]
    totals: PracticeTotals
    judged_by: PracticeJudge
    ended_early: bool = False


class PracticeResultSummary(Model):
    id: str
    coach_name: str
    started_at: str
    duration_s: float
    overall: int
    answers: int
    goals_met: int | None = None  # earlier goals met this time; null when there were none
    goals_checked: int = 0


class PracticeGoals(Model):
    result_id: str | None = None
    started_at: str | None = None
    coach_name: str | None = None
    overall: int | None = None
    goals: list[PracticeGoal] = Field(default_factory=list)


PRACTICE_TYPES: tuple[str, ...] = (
    "PracticeAnswer", "PracticeTotals", "PracticeSubScore", "PracticeStrength", "PracticeGoal",
    "PracticeGoalCheck", "PracticeResult", "PracticeResultSummary", "PracticeGoals",
)


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

