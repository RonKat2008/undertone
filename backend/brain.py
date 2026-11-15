"""The orchestrator. Wires bus events through judge -> metrics -> nudge -> haptics, and runs
session start / end (debrief, growth).

Inputs (Person A, or scripts/replay.py via POST /dev/publish) are just bus events:
    turn.final, transcript.partial, motion, signal, bookmark, band.status
plus direct calls: start_session, end_session, single_tap, bookmark, on_volume.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from backend import debrief as debrief_pkg
from backend.capture import store as capture_store
from backend.capture.media import recordings_dir
from backend import growth, haptics_port, judge, studio
from backend.config import Settings
from backend.contracts import (
    BookmarkEvent, BookmarkSource, CoachActivatedEvent, CoachSpec, Debrief, DebriefEvent,
    HapticCommand, JudgeEvent, Metrics, MetricsEvent, MotionEvent, MotionSnapshot, NudgeEvent, NudgePolicy,
    NudgeSnoozedEvent, SessionEndedEvent, SessionMode, SessionStartedEvent, SessionSummary,
    SignalEvent, StatusReplyEvent, TranscriptPartialEvent, TurnContext, TurnFinalEvent,
)
from backend.metrics import MetricsEngine
from backend.nudge import NudgeEngine, next_policy
from backend.state import AppState, SessionState

log = logging.getLogger("undertone.brain")

TICK_S = 1.0
PROMISE_P = 0.8
SNOOZE_WINDOW_S = 3.0
RECENT_TURNS = 6
DEMO_MIN_GAP_S = 10
DEMO_BUDGET = 8


@dataclass
class _Closed:
    """A session that has ended (session.ended out, row closed) whose debrief has not run yet:
    always-on finishes it after its rejoin window, or resumes it if speech comes back."""
    session: SessionState
    metrics: MetricsEngine
    nudge: NudgeEngine | None
    quiet: bool


class Brain:
    def __init__(self, app: AppState, settings: Settings) -> None:
        self.app = app
        self.settings = settings
        self.metrics: MetricsEngine | None = None
        self.nudge: NudgeEngine | None = None
        self.motion = MotionSnapshot()
        self._fidget_since: float | None = None
        self._ticker: asyncio.Task[None] | None = None
        self._last_nudge: NudgeEvent | None = None
        # session lifecycle (always-on, backend/session.py): one start at a time; sessions closed
        # with defer=True wait here for finish_session / resume_session; before_end lets the band
        # hand over the last words before a session closes; judge health for /health
        self._lifecycle = asyncio.Lock()
        self._closed: dict[str, _Closed] = {}
        self.before_end: Callable[[], Awaitable[None]] | None = None
        self.judge_fail_streak = 0
        self._rel_tasks: set[asyncio.Task[object]] = set()  # relationship refreshes in flight
        bus = app.bus
        bus.on("turn.final", self._on_turn)
        bus.on("transcript.partial", self._on_partial)
        bus.on("motion", self._on_motion)
        bus.on("bookmark", self._on_bookmark)
        bus.on("signal", self._on_signal)

    # ---------- coaches ----------
    def find_coach(self, coach_id: str | None) -> CoachSpec | None:
        if coach_id is None:
            return self.app.active_coach
        found = self.app.db.load_coach(coach_id)
        if found is not None:
            return found
        for c in [studio.default_coach(), *studio.load_prebuilt()]:
            if c.id == coach_id:
                return c
        return None

    async def activate_coach(self, coach: CoachSpec) -> None:
        self.app.active_coach = coach
        self.app.db.kv_set("active_coach_id", coach.id)
        await self.app.bus.publish(CoachActivatedEvent(coach=coach))

    # ---------- session control ----------
    async def start_session(self, coach_id: str | None = None, mode: SessionMode = "regular",
                            started_at: float | None = None) -> str:
        """`started_at` (wall clock) backdates t=0, e.g. to when the first turn began."""
        async with self._lifecycle:
            return await self._start_session(coach_id, mode, started_at)

    async def ensure_session(self, started_at: float | None = None) -> str:
        """The open session, or a new regular one (always-on: never ends a session)."""
        async with self._lifecycle:
            if self.app.session is not None:
                return self.app.session.session_id
            return await self._start_session(None, "regular", started_at)

    async def _start_session(self, coach_id: str | None, mode: SessionMode, started_at: float | None) -> str:
        if self.app.session is not None:
            await self.end_session()
        profile = growth.current_profile(self.app.db)
        if mode == "practice" and coach_id is None:
            coach = studio.build_personal_coach(profile)
        else:
            coach = self.find_coach(coach_id)
            if coach is None:
                raise ValueError(f"unknown coach {coach_id}")
        policy = self._policy_for(coach, mode)
        sid = f"s-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
        session = SessionState(session_id=sid, coach=coach, mode=mode, policy=policy,
                               **({"started_at": started_at} if started_at is not None else {}))
        self.metrics = MetricsEngine(profile.baseline_wpm, profile.baseline_volume_db, coach.filler_words)
        self.nudge = NudgeEngine(coach, policy)
        self.motion, self._fidget_since, self._last_nudge = MotionSnapshot(), None, None
        self.app.session = session
        self.app.db.create_session(sid, coach.id, coach.name, mode, session.started_at_iso)
        await self.app.bus.publish(SessionStartedEvent(session_id=sid, coach_id=coach.id, mode=mode, policy=policy))
        # First Decisions call is slow (cold connection); warm it without delaying the session.
        self._warm_task = asyncio.create_task(judge.warm_up())
        self._ticker = asyncio.create_task(self._tick_loop(session))
        log.info("session %s started (coach=%s mode=%s)", sid, coach.id, mode)
        return sid

    def _policy_for(self, coach: CoachSpec, mode: SessionMode) -> NudgePolicy:
        """Demo override wins; otherwise regular sessions fade the budget as the focus habit
        improves and every fifth session is silent (nudge.next_policy). Never raises."""
        policy = coach.nudge_policy
        if self.settings.demo_policy:
            return policy.model_copy(update={"min_gap_s": DEMO_MIN_GAP_S, "budget_per_session": DEMO_BUDGET})
        if mode != "regular":
            return policy
        try:
            rates = growth.focus_rates(self.app.db, coach.id, policy.focus_rule_id)
            return next_policy(policy, rates, growth.next_session_index(self.app.db))
        except Exception:
            log.exception("fading policy failed for coach %s; using the coach's policy", coach.id)
            return policy

    async def end_session(self, quiet: bool = False, defer: bool = False) -> DebriefEvent | None:
        """quiet=True (always-on, a too-short capture): session.ended is published and the
        session row is closed with its metrics; turns are already saved. No debrief, no audio,
        no profile/mission update. Returns None.
        defer=True: close now (session.ended, row ended) and keep the session for
        finish_session (debrief, keep verdict) or resume_session. Returns None."""
        if self.app.session is not None and self.before_end is not None:
            try:
                await self.before_end()  # the band hands over turns still in flight
            except Exception:
                log.exception("before_end hook failed")
        session = self.app.session
        if session is None or self.metrics is None:
            return None
        engine = self.metrics
        self.app.session = None
        session.ended_at = time.time()
        if self._ticker is not None:
            self._ticker.cancel()
        await self.app.bus.publish(SessionEndedEvent(session_id=session.session_id))
        # the row is ended first: a slow or failing debrief can never leave it open
        self.app.db.end_session(session.session_id, _iso(session.ended_at), session.duration_s,
                                engine.snapshot(session.now_s()), None)
        if defer:
            self._closed[session.session_id] = _Closed(session, engine, self.nudge, quiet)
            log.info("session %s closed (%d turns); debrief deferred", session.session_id, len(session.turns))
            return None
        return await self._finish(session, engine, quiet)

    async def finish_session(self, session_id: str) -> DebriefEvent | None:
        """Debrief (or quiet verdict) for a session closed with defer=True. Once only."""
        closed = self._closed.pop(session_id, None)
        if closed is None:
            return None
        return await self._finish(closed.session, closed.metrics, closed.quiet)

    async def resume_session(self, session_id: str) -> bool:
        """Reopen a deferred session (same id, same t=0) when speech comes back in time."""
        async with self._lifecycle:
            closed = self._closed.get(session_id)
            if closed is None or self.app.session is not None:
                return False
            del self._closed[session_id]
            session = closed.session
            session.ended_at = None
            self.app.session, self.metrics, self.nudge = session, closed.metrics, closed.nudge
            self.app.db.execute("UPDATE sessions SET ended_at = NULL WHERE session_id = ?", (session_id,))
            await self.app.bus.publish(SessionStartedEvent(session_id=session_id, coach_id=session.coach.id,
                                                           mode=session.mode, policy=session.policy))
            self._ticker = asyncio.create_task(self._tick_loop(session))
            log.info("session %s resumed", session_id)
            return True

    def add_late_turn(self, session_id: str, turn: TurnFinalEvent) -> None:
        """A turn spoken before `session_id` closed that Deepgram finished after: stored with
        that session (and in its debrief, if that has not run yet). No judge, no nudge."""
        closed = self._closed.get(session_id)
        live = self.app.session if self.app.session is not None and self.app.session.session_id == session_id else None
        if closed is not None:
            closed.session.turns.append(turn)
            closed.metrics.add_turn(turn)
        elif live is not None and self.metrics is not None:  # still closing
            live.turns.append(turn)
            self.metrics.add_turn(turn)
        self.app.db.save_turn(session_id, turn)

    async def _finish(self, session: SessionState, engine: MetricsEngine, quiet: bool) -> DebriefEvent | None:
        metrics = engine.snapshot(session.now_s())
        if quiet:
            log.info("session %s ended quietly (%d turns, no debrief)", session.session_id, len(session.turns))
            await self._classify(session, quiet=True)  # rules only: no API call, nothing to wait for
            return None
        # one Decisions call, alongside the debrief (it does not delay it)
        self._keep_task = asyncio.create_task(self._classify(session, quiet=False))
        timeline = engine.timeline()
        last = self._last_summary()
        try:
            data = await debrief_pkg.generate_debrief(session, metrics, timeline, last)
        except Exception:
            log.exception("debrief failed for %s", session.session_id)
            return None
        # Text first: the voice takes several more seconds and follows as a second debrief event.
        audio_url = None
        event = DebriefEvent(session_id=session.session_id, data=data, audio_url=audio_url)
        await self.app.bus.publish(event)
        self._audio_task = asyncio.create_task(self._debrief_audio(session.session_id, data))
        summary = SessionSummary(
            session_id=session.session_id, started_at=session.started_at_iso, duration_s=session.duration_s,
            coach_name=session.coach.name, mode=session.mode, person_id=None,
            headline_fact=data.headline_fact, numbers=data.numbers)
        db = self.app.db
        db.save_debrief(session.session_id, data, audio_url)
        db.end_session(session.session_id, _iso(session.ended_at), session.duration_s, metrics, summary)
        self._safe(lambda: growth.update_profile(db, session, metrics), "update_profile")
        self._safe(lambda: growth.mission_for_today(db), "mission_for_today")
        return event

    async def _classify(self, session: SessionState, quiet: bool) -> None:
        """Is this capture worth keeping? Stored on the session; a session that is not kept
        leaves the habit profile, so it is rebuilt. Never raises."""
        db = self.app.db
        try:
            verdict = await capture_store.classify_session(db, recordings_dir(Path(db.path)),
                                                           session.session_id, quiet)
        except Exception:
            log.exception("keep classification failed for %s", session.session_id)
            return
        if verdict is not None and not verdict.kept and not quiet:
            self._safe(lambda: growth.update_profile(db, session, Metrics()), "update_profile")
        self._refresh_relationship(session.session_id)

    def _refresh_relationship(self, session_id: str) -> None:
        """A new keep verdict can change who someone is to the wearer: re-infer the tagged
        person in the background (refresh_person never raises)."""
        try:
            row = self.app.db.get_session(session_id) or {}
            pid = row.get("person_id")
            if not pid:
                return
            from backend import relationships

            task = asyncio.create_task(relationships.refresh_person(self.app.db, str(pid)))
            self._rel_tasks.add(task)
            task.add_done_callback(self._rel_tasks.discard)
        except Exception:
            log.exception("could not schedule the relationship refresh for %s", session_id)

    async def _debrief_audio(self, session_id: str, data: Debrief) -> None:
        """Speak the recap, then re-publish the debrief with its audio. Never raises."""
        try:
            url = await debrief_pkg.speak(debrief_pkg.spoken_text(data), session_id)
            if url is None:
                return
            self.app.db.save_debrief(session_id, data, url)
            await self.app.bus.publish(DebriefEvent(session_id=session_id, data=data, audio_url=url))
        except Exception:
            log.exception("debrief audio failed for %s", session_id)

    async def single_tap(self) -> StatusReplyEvent | None:
        session = self.app.session
        if session is None or self.nudge is None or self.metrics is None:
            return None
        now = session.now_s()
        last = self._last_nudge
        if last is not None and now - last.ts <= SNOOZE_WINDOW_S:
            self.nudge.snooze(last.rule_id, now)
            await self.app.bus.publish(NudgeSnoozedEvent(rule_id=last.rule_id, ts=now))
        reply = self.nudge.status_reply(self.metrics.snapshot(now), now)
        await self.app.bus.publish(reply)
        await haptics_port.send(HapticCommand(pattern=reply.haptic, label=reply.verdict))
        return reply

    async def bookmark(self, source: BookmarkSource, text: str | None = None) -> BookmarkEvent | None:
        session = self.app.session
        if session is None:
            return None
        event = BookmarkEvent(source=source, text=text, ts=session.now_s())
        await self.app.bus.publish(event)  # persisted by _on_bookmark
        return event

    def on_volume(self, db: float, ts: float) -> None:
        if self.metrics is not None:
            self.metrics.add_volume(db, ts)

    # ---------- bus handlers ----------
    async def _on_turn(self, turn: TurnFinalEvent) -> None:
        session = self.app.session
        if session is None or self.metrics is None:
            return
        arrived = time.time()
        recent = session.turns[-RECENT_TURNS:]
        session.turns.append(turn)
        self.metrics.add_turn(turn)
        self.app.db.save_turn(session.session_id, turn)
        if turn.speaker != "me":
            return
        prev_other = next((t for t in reversed(recent) if t.speaker == "other"), None)
        ctx = TurnContext(turn=turn, prev_other_turn=prev_other,
                          motion_summary=self._motion_summary(session, turn, prev_other), recent_turns=recent)
        try:
            verdict = await judge.judge_turn(ctx, session.coach)
        except Exception:
            log.exception("judge_turn raised on %s; using rule judge", turn.turn_id)
            verdict = JudgeEvent(turn_id=turn.turn_id, results=judge.rule_judge(ctx, session.coach),
                                 latency_ms=round((time.time() - arrived) * 1000, 1), source="rules")
        if not (self.settings.use_rule_judge_only or not self.settings.has_gemini):
            self.judge_fail_streak = 0 if verdict.source == "decisions" else self.judge_fail_streak + 1
        if self.app.session is not session:
            return
        await self._handle_judge(session, verdict, turn, arrived)

    async def _handle_judge(self, session: SessionState, verdict: JudgeEvent, turn: TurnFinalEvent,
                            arrived: float) -> None:
        assert self.metrics is not None and self.nudge is not None
        session.judge_results[verdict.turn_id] = verdict
        await self.app.bus.publish(verdict)
        self.app.db.save_judge(session.session_id, verdict)
        self.metrics.note_judge(verdict)
        now = session.now_s()
        nudge = self.nudge.evaluate(verdict, self.metrics.snapshot(now), self.motion, now, arrived)
        if nudge is not None:
            await self._emit_nudge(session, nudge, arrived)
        await self._publish_quiet_marks()
        promise = verdict.results.get("commitment_made")
        if promise is not None and getattr(promise, "p", 0.0) >= PROMISE_P:
            await self.bookmark("promise", turn.text)

    async def _emit_nudge(self, session: SessionState, nudge: NudgeEvent, slip_ts: float) -> None:
        stamped = nudge.model_copy(update={"latency_ms": round((time.time() - slip_ts) * 1000, 1)})
        self._last_nudge = stamped
        session.nudges.append(stamped)
        await asyncio.gather(
            self.app.bus.publish(stamped),
            haptics_port.send(HapticCommand(pattern=stamped.haptic, label=stamped.message)),
        )
        self.app.db.save_nudge(session.session_id, stamped)

    async def _on_partial(self, partial: TranscriptPartialEvent) -> None:
        session = self.app.session
        if session is not None and self.metrics is not None:
            self.metrics.add_partial(partial, session.now_s())

    async def _on_motion(self, m: MotionEvent) -> None:
        session = self.app.session
        if session is None or self.metrics is None:
            return
        session.motion.append(m)
        self.metrics.add_motion(m)
        fidget_other = m.state == "fidget" and m.speaker_context == "other"
        self._fidget_since = (self._fidget_since if self._fidget_since is not None else m.ts) if fidget_other else None
        self.motion = MotionSnapshot(
            state=m.state, hand_energy=m.hand_energy, speaker_context=m.speaker_context,
            confidence=m.confidence, ts=m.ts,
            fidget_while_other_s=round(m.ts - self._fidget_since, 2) if self._fidget_since is not None else 0.0)

    async def _on_bookmark(self, bm: BookmarkEvent) -> None:
        session = self.app.session
        if session is not None:
            session.bookmarks.append(bm)
            self.app.db.save_bookmark(session.session_id, bm)

    async def _on_signal(self, sig: SignalEvent) -> None:
        if self.app.session is not None:
            self.app.session.signals.append(sig)

    # ---------- 1 Hz loop ----------
    async def _tick_loop(self, session: SessionState) -> None:
        while self.app.session is session:
            try:
                await self._tick(session)
            except Exception:
                log.exception("tick failed (session %s)", session.session_id)
            await asyncio.sleep(TICK_S)

    async def _tick(self, session: SessionState) -> None:
        assert self.metrics is not None and self.nudge is not None
        now = session.now_s()
        snap = self.metrics.snapshot(now)
        await self.app.bus.publish(MetricsEvent(**snap.model_dump()))
        slip = time.time()
        nudge = self.nudge.evaluate(None, snap, self.motion, now, slip)
        if nudge is not None:
            await self._emit_nudge(session, nudge, slip)
        await self._publish_quiet_marks()
        for signal in self.metrics.detect_signals(now):
            session.signals.append(signal)
            await self.app.bus.publish(signal)

    async def _publish_quiet_marks(self) -> None:
        """Rules that fired without buzzing reach the laptop as quiet marks."""
        assert self.nudge is not None
        session = self.app.session
        for mark in self.nudge.drain_quiet_marks():
            await self.app.bus.publish(mark)
            if session is not None:  # stored so the habit profile counts silent slips too
                self.app.db.save_nudge(session.session_id, mark)

    # ---------- helpers ----------
    def _motion_summary(self, session: SessionState, turn: TurnFinalEvent,
                        prev_other: TurnFinalEvent | None) -> str:
        def share(lo: float, hi: float) -> str:
            ms = [m for m in session.motion if lo <= m.ts <= hi]
            if not ms:
                return "no data"
            counts = {s: sum(1 for m in ms if m.state == s) for s in ("still", "gesture", "fidget")}
            return ", ".join(f"{s} {c / len(ms):.0%}" for s, c in counts.items() if c)

        parts = [f"while speaking: {share(turn.start, turn.end)}"]
        if prev_other is not None:
            parts.insert(0, f"while the other person spoke: {share(prev_other.start, prev_other.end)}")
        return "wearer's hands " + "; ".join(parts)

    def _last_summary(self) -> SessionSummary | None:
        for row in self.app.db.list_sessions(limit=20):
            if row.get("summary_json"):
                return SessionSummary.model_validate_json(row["summary_json"])
        return None

    async def wait_background(self, timeout: float = 30.0) -> None:
        """Shutdown: let debriefs in progress (text, keep verdict, voice) land in the DB."""
        tasks = [t for t in (getattr(self, n, None) for n in ("_keep_task", "_audio_task")) if t is not None]
        pending = [t for t in tasks if not t.done()]
        if pending:
            await asyncio.wait(pending, timeout=timeout)
        if self._rel_tasks:  # scheduled by the keep verdicts just awaited
            await asyncio.wait(list(self._rel_tasks), timeout=timeout)
        for t in list(self._rel_tasks):  # a refresh still running after the timeout: stop it
            t.cancel()

    @staticmethod
    def _safe(fn, what: str) -> None:  # type: ignore[no-untyped-def]
        try:
            fn()
        except Exception:
            log.exception("%s failed", what)


def _iso(ts: float | None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time(), tz=timezone.utc).isoformat()
