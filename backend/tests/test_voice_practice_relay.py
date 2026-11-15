"""The practice relay against a fake Deepgram (agent + word stream) and a fake browser."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from backend.contracts import PracticeResult
from backend.studio import load_prebuilt
from backend.voice_practice import gate
from backend.voice_practice.relay import PracticeDeps, PracticeSession

SECOND = b"\x10\x00" * 16000  # 1 s of quiet-but-present 16 kHz audio


class FakeSocket:
    def __init__(self, url: str) -> None:
        self.url = url
        self.inbox: asyncio.Queue[Any] = asyncio.Queue()
        self.sent: list[Any] = []
        self.closed = False

    async def send(self, message: str | bytes) -> None:
        if self.closed:
            raise ConnectionError("closed")
        self.sent.append(message)
        if isinstance(message, str):
            kind = json.loads(message).get("type")
            if kind == "Settings":
                self.push({"type": "SettingsApplied"})
            if kind == "CloseStream":
                self.inbox.put_nowait(ConnectionError("closed"))

    async def recv(self) -> str | bytes:
        item = await self.inbox.get()
        if isinstance(item, Exception):
            raise item
        return item

    async def close(self) -> None:
        self.closed = True
        self.inbox.put_nowait(ConnectionError("closed"))

    def push(self, item: Any) -> None:
        self.inbox.put_nowait(json.dumps(item) if isinstance(item, dict) else item)

    def json_sent(self) -> list[dict[str, Any]]:
        return [json.loads(m) for m in self.sent if isinstance(m, str)]


class FakeDeepgram:
    def __init__(self, refuse: bool = False) -> None:
        self.refuse = refuse
        self.agent: FakeSocket | None = None
        self.words: FakeSocket | None = None

    async def connect(self, url: str, headers: dict[str, str]) -> FakeSocket:
        assert headers["Authorization"].startswith("Token ")
        sock = FakeSocket(url)
        if "agent.deepgram.com" in url:
            if self.refuse:
                raise ConnectionRefusedError("no")
            sock.push({"type": "Welcome", "request_id": "r1"})
            self.agent = sock
        else:
            assert "filler_words=true" in url
            self.words = sock
        return sock


class FakeBrowser:
    def __init__(self) -> None:
        self.inbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.text: list[dict[str, Any]] = []
        self.audio: list[bytes] = []
        self.closed = False

    async def receive(self) -> dict[str, Any]:
        return await self.inbox.get()

    async def send_text(self, data: str) -> None:
        self.text.append(json.loads(data))

    async def send_bytes(self, data: bytes) -> None:
        self.audio.append(data)

    async def close(self, code: int = 1000) -> None:
        self.closed = True

    def mic(self, chunk: bytes) -> None:
        self.inbox.put_nowait({"type": "websocket.receive", "bytes": chunk})

    def say(self, message: dict[str, Any]) -> None:
        self.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps(message)})

    def kinds(self) -> list[str]:
        return [m["type"] for m in self.text]


def deps(dg: FakeDeepgram, saved: list[PracticeResult], key: str | None = "k") -> PracticeDeps:
    coach = next(c for c in load_prebuilt() if c.id == "interview")
    return PracticeDeps(key=key, coach=coach, profile=None, previous_goals=(), save=saved.append, connect=dg.connect)


def words_msg(text: str, start: float, step: float = 0.35) -> dict[str, Any]:
    ws = [{"word": w.strip(".,").lower(), "punctuated_word": w, "start": start + i * step,
           "end": start + i * step + 0.3} for i, w in enumerate(text.split())]
    return {"type": "Results", "is_final": True, "channel": {"alternatives": [{"transcript": text, "words": ws}]}}


async def settle() -> None:
    await asyncio.sleep(0.05)


async def run_conversation(browser: FakeBrowser, dg: FakeDeepgram) -> None:
    await settle()
    assert dg.agent is not None and dg.words is not None and gate.practice_active()
    agent = dg.agent
    agent.push({"type": "AgentStartedSpeaking", "total_latency": "0.1", "tts_latency": "0.05", "ttt_latency": "0.05"})
    agent.push({"type": "ConversationText", "role": "assistant", "content": "First question. Tell me about a project?"})
    agent.push(b"\x00\x01" * 2400)
    await settle()
    browser.mic(SECOND)
    await settle()
    browser.say({"type": "playback_done"})
    await settle()
    agent.push({"type": "UserStartedSpeaking"})
    browser.mic(SECOND * 8)
    dg.words.push(words_msg("Um, I led the um launch and we grew revenue by twelve percent in a quarter.", 1.8))
    await settle()
    agent.push({"type": "ConversationText", "role": "user", "content": "I led the launch and we grew revenue."})
    agent.push({"type": "AgentStartedSpeaking", "total_latency": "0.1", "tts_latency": "0.05", "ttt_latency": "0.05"})
    agent.push({"type": "ConversationText", "role": "assistant",
                "content": "Thanks, that was great. That's our practice for today."})
    await settle()
    browser.say({"type": "playback_done"})


async def test_full_session_relays_scores_and_stores() -> None:
    dg, browser, saved = FakeDeepgram(), FakeBrowser(), []
    session = PracticeSession(browser, deps(dg, saved))
    await asyncio.wait_for(asyncio.gather(session.run(), run_conversation(browser, dg)), 10)
    kinds = browser.kinds()
    assert kinds[0] == "practice.ready" and "practice.scoring" in kinds and kinds[-1] == "practice.result"
    assert {"type": "practice.state", "state": "you"} in browser.text  # barge-in signal
    captions = [m for m in browser.text if m["type"] == "practice.caption"]
    assert captions[0] == {"type": "practice.caption", "role": "coach",
                           "text": "First question. Tell me about a project?", "question": 1}
    assert browser.audio and len(saved) == 1 and browser.closed
    result = saved[0]
    assert len(result.answers) == 1 and result.ended_early is False
    answer = result.answers[0]
    assert answer.fillers.count("um") == 2 and answer.time_to_start_s == pytest.approx(0.8, abs=0.01)
    assert answer.question == "Tell me about a project?"  # greeting opener trimmed
    assert dg.agent is not None
    sent = dg.agent.json_sent()
    assert sent[0]["type"] == "Settings" and "Tell me about a time" in sent[0]["agent"]["greeting"]
    assert sum(len(m) for m in dg.agent.sent if isinstance(m, bytes)) == len(SECOND) * 9  # mic relayed
    assert not gate.practice_active()


async def test_no_key_says_so_and_closes() -> None:
    browser = FakeBrowser()
    await PracticeSession(browser, deps(FakeDeepgram(), [], key=None)).run()
    assert browser.text == [{"type": "practice.error", "code": "no_key",
                             "message": "Practice needs a Deepgram key on the laptop (DEEPGRAM_API_KEY)."}]
    assert browser.closed and not gate.practice_active()


async def test_refused_agent_is_reported_plainly() -> None:
    browser = FakeBrowser()
    await asyncio.wait_for(PracticeSession(browser, deps(FakeDeepgram(refuse=True), [])).run(), 5)
    assert browser.text[0]["code"] == "agent_refused" and "reach" in browser.text[0]["message"]
    assert not gate.practice_active()


async def test_second_practice_is_busy() -> None:
    assert gate.try_enter()
    try:
        browser = FakeBrowser()
        await PracticeSession(browser, deps(FakeDeepgram(), [])).run()
        assert browser.text[0]["code"] == "busy"
    finally:
        gate.leave()


async def test_leaving_before_any_answer_stores_nothing() -> None:
    dg, browser, saved = FakeDeepgram(), FakeBrowser(), []

    async def leave() -> None:
        await settle()
        browser.mic(SECOND)
        browser.inbox.put_nowait({"type": "websocket.disconnect"})

    await asyncio.wait_for(asyncio.gather(PracticeSession(browser, deps(dg, saved)).run(), leave()), 5)
    assert saved == [] and not gate.practice_active()


async def test_end_early_scores_what_exists() -> None:
    dg, browser, saved = FakeDeepgram(), FakeBrowser(), []

    async def script() -> None:
        await settle()
        assert dg.agent is not None and dg.words is not None
        dg.agent.push({"type": "ConversationText", "role": "assistant", "content": "Tell me about a project?"})
        await settle()
        browser.mic(SECOND * 6)
        dg.words.push(words_msg("I shipped the app in three weeks with two people.", 0.5))
        await settle()
        dg.agent.push({"type": "ConversationText", "role": "user", "content": "I shipped the app."})
        await settle()
        browser.say({"type": "end"})

    await asyncio.wait_for(asyncio.gather(PracticeSession(browser, deps(dg, saved)).run(), script()), 10)
    assert len(saved) == 1 and saved[0].ended_early is True
    assert browser.text[-1]["type"] == "practice.result"


async def test_silent_mic_stops_with_a_plain_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.voice_practice import relay

    monkeypatch.setattr(relay, "MIC_SILENT_S", 0.2)
    monkeypatch.setattr(relay, "TICK_S", 0.05)
    browser, saved = FakeBrowser(), []
    await asyncio.wait_for(PracticeSession(browser, deps(FakeDeepgram(), saved)).run(), 5)
    assert any(m.get("code") == "mic_silent" for m in browser.text)
    assert browser.text[-1]["type"] == "practice.no_result" and saved == []


async def test_agent_error_scores_answers_so_far() -> None:
    dg, browser, saved = FakeDeepgram(), FakeBrowser(), []

    async def script() -> None:
        await settle()
        assert dg.agent is not None and dg.words is not None
        dg.agent.push({"type": "ConversationText", "role": "assistant", "content": "Why this job?"})
        browser.mic(SECOND * 5)
        dg.words.push(words_msg("Because I like hard problems and good teams.", 0.4))
        await settle()
        dg.agent.push({"type": "ConversationText", "role": "user", "content": "Because I like hard problems."})
        dg.agent.push({"type": "Error", "description": "boom", "code": "INTERNAL"})

    await asyncio.wait_for(asyncio.gather(PracticeSession(browser, deps(dg, saved)).run(), script()), 10)
    assert any(m.get("code") == "agent_lost" for m in browser.text)
    assert len(saved) == 1 and saved[0].ended_early is True
