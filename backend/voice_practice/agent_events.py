"""Voice agent server events -> the timeline and the browser's practice.* messages.

Event names and payloads per developers.deepgram.com (voice-agent-outputs and its pages):
ConversationText {role, content}, UserStartedSpeaking, AgentThinking, AgentStartedSpeaking,
AgentAudioDone,
Error {description, code}, Warning {description, code}.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from backend.voice_practice.prompt import CLOSING_RE as _CLOSING

if TYPE_CHECKING:
    from backend.voice_practice.relay import PracticeSession

log = logging.getLogger("undertone.voice_practice")



class AgentEvents:
    def __init__(self, session: "PracticeSession") -> None:
        self.s = session
        self.closing = False
        self.closing_since: float | None = None

    def _close_soon(self) -> None:
        if not self.closing:
            self.closing = True
            self.closing_since = self.s.deps.clock()

    async def handle(self, data: dict[str, Any]) -> None:
        kind = data.get("type")
        at = self.s.stream_s()
        tl = self.s.timeline
        if kind == "ConversationText":
            await self._text(at, str(data.get("role", "")), str(data.get("content", "")),
                             str(data.get("conversational_behavior") or "default"))
        elif kind == "UserStartedSpeaking":
            tl.user_started(at)
            await self.s.send({"type": "practice.state", "state": "you"})
        elif kind == "AgentThinking":
            await self.s.send({"type": "practice.state", "state": "thinking"})
        elif kind == "AgentStartedSpeaking":
            tl.coach_started(at)
            await self.s.send({"type": "practice.state", "state": "coach"})
        elif kind == "Error":
            log.warning("voice agent error: %s", data.get("code") or "error")
            await self.s.error("agent_lost", "The coach's voice service hit a problem. Scoring the answers so far.")
            self.s.live.agent_lost = True
            self.s.live.done.set()
        elif kind == "Warning":
            log.info("voice agent warning: %s", data.get("code") or "warning")

    async def _text(self, at: float, role: str, content: str, behavior: str) -> None:
        if not content.strip() or behavior != "default":
            return  # backchannels and fillers are scaffolding, not questions or answers
        tl = self.s.timeline
        if role == "assistant":
            tl.coach_text(at, content)
            if _CLOSING.search(content):
                self._close_soon()
            await self.s.send({"type": "practice.caption", "role": "coach", "text": content,
                               "question": tl.questions or None})
        elif role == "user":
            tl.user_text(at, content)
            await self.s.send({"type": "practice.caption", "role": "you", "text": content,
                               "question": tl.questions or None})
