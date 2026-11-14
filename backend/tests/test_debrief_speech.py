"""Tests for backend.debrief.speech: number wording, the spoken recap, and Deepgram TTS (no network)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx
import pytest

from backend import config
from backend.contracts import Debrief, DebriefNumbers
from backend.debrief import speech
from backend.debrief.speech import say_numbers, speak, spoken_text

FIXTURE = config.FIXTURES_DIR / "debrief_example.json"


def _fixture_debrief() -> Debrief:
    return Debrief.model_validate(json.loads(FIXTURE.read_text()))


def _short_debrief() -> Debrief:
    return Debrief(
        headline_fact="You talked 68% of the time and asked 1 question in 4 minutes.",
        strength="Your opening was clear and you named the goal in the first sentence.",
        one_fix="You spoke at 171 words a minute when you explained pricing, so the key point got lost.",
        if_then="When you hit 30 seconds, end with a question and wait.",
        numbers=DebriefNumbers(talk_ratio=0.68, interruptions=0, questions=1, fillers_per_min=2.0, wpm=171),
        best_moment_quote="What matters most to you here?",
    )


def _words(text: str) -> int:
    return len(text.split())


# ---------- say_numbers ----------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("68%", "sixty-eight percent"),
        ("7.5", "seven point five"),
        ("49", "forty-nine"),
        ("2,000", "two thousand"),
        ("0", "zero"),
        ("100", "one hundred"),
        ("9999", "nine thousand nine hundred ninety-nine"),
        ("12.05", "twelve point zero five"),
        ("15 %", "fifteen percent"),
    ],
)
def test_say_numbers_basic(raw: str, expected: str) -> None:
    assert say_numbers(raw) == expected


def test_say_numbers_mixed_sentence() -> None:
    out = say_numbers("You spoke 171 words a minute, 7.5 fillers per minute, and talked 68% of the time.")
    assert out == (
        "You spoke one hundred seventy-one words a minute, seven point five fillers per minute, "
        "and talked sixty-eight percent of the time."
    )


def test_say_numbers_sentence_end_decimal_and_hyphen() -> None:
    assert say_numbers("Fillers fell to 7.5.") == "Fillers fell to seven point five."
    assert say_numbers("an 18-month goal") == "an eighteen-month goal"


def test_say_numbers_leaves_words_alone() -> None:
    text = "You asked one question, then paused. Good!"
    assert say_numbers(text) == text
    assert say_numbers("") == ""


# ---------- spoken_text ----------
def _assert_clean(text: str) -> None:
    assert not re.search(r"\d", text), text
    assert '"' not in text and "“" not in text and "”" not in text
    assert len(text) < 2000
    assert "  " not in text and text == text.strip()


def test_spoken_text_fixture_length_and_order() -> None:
    d = _fixture_debrief()
    text = spoken_text(d)
    _assert_clean(text)
    assert 45 <= _words(text) <= 75, (_words(text), text)
    headline = text.find("forty-nine seconds")
    strength = text.find("Pick one branch")
    fix = text.find("In the framework answer")
    nxt = text.find("Next time")
    assert -1 not in (headline, strength, fix, nxt), text
    assert headline < strength < fix < nxt
    assert "pick one and give one reason" in text


def test_spoken_text_short_debrief_keeps_everything() -> None:
    text = spoken_text(_short_debrief())
    _assert_clean(text)
    assert 45 <= _words(text) <= 75, (_words(text), text)
    assert text.startswith("You talked sixty-eight percent of the time")
    assert text.index("opening was clear") < text.index("pricing") < text.index("Next time")
    assert text.endswith("end with a question and wait.")


def test_spoken_text_very_long_parts_still_capped() -> None:
    long = " ".join(["This part goes on, and on, and on without stopping"] * 20) + "."
    d = _short_debrief().model_copy(update={"headline_fact": long, "strength": long, "one_fix": long})
    text = spoken_text(d)
    _assert_clean(text)
    assert _words(text) <= 75
    assert text.endswith("end with a question and wait.")


def test_spoken_text_never_cuts_inside_a_quote() -> None:
    tail = " and then kept going with more and more words about the same branch" * 2
    d = _fixture_debrief().model_copy(update={
        "headline_fact": 'Your 49-second answer used "I think maybe" 3 times and "I\'m not totally sure" 2 times.',
        "strength": 'You answered "Revenue first, then how the client defines success"' + tail + ".",
        "one_fix": 'You ended on "basically both" instead of picking one branch' + tail + ".",
        "if_then": 'When you hear yourself say "I think maybe", stop and state your branch.',
    })
    text = spoken_text(d)
    assert _words(text) <= 75, text
    assert "I'm not totally sure two times" in text
    assert "Revenue first, then how the client defines success" in text
    assert text.endswith("stop and state your branch.")


def test_spoken_text_does_not_split_inside_quotes() -> None:
    d = _short_debrief().model_copy(
        update={
            "headline_fact": 'You said "Stop. Listen." to open, and the room went quiet for a moment. ' * 3,
        }
    )
    text = spoken_text(d)
    assert "Stop. Listen. to open" in text


# ---------- speak ----------
def _settings_with_key(key: str | None) -> config.Settings:
    base = config.load_settings()
    return config.Settings(
        gemini_api_key=None, deepgram_api_key=key, public_backend_url=base.public_backend_url,
        use_rule_judge_only=True, demo_policy=False, dev=False, db_path=base.db_path,
    )


@pytest.fixture
def media(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    out = tmp_path / "media"
    monkeypatch.setattr(config, "MEDIA_DIR", out)
    monkeypatch.setattr(speech, "load_settings", lambda: _settings_with_key("test-key"))
    return out


def _use_transport(monkeypatch: pytest.MonkeyPatch, handler: httpx.MockTransport) -> None:
    monkeypatch.setattr(speech, "_client", lambda: httpx.AsyncClient(transport=handler, timeout=15))


async def test_speak_no_key_returns_none(media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(speech, "load_settings", lambda: _settings_with_key(None))
    assert await speak("hello there", "s1") is None
    assert not media.exists()


async def test_speak_success_writes_file(media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["auth"] = req.headers.get("authorization")
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, content=b"ID3fake-mp3", headers={"content-type": "audio/mpeg"})

    _use_transport(monkeypatch, httpx.MockTransport(handler))
    url = await speak("You asked one question.", "sess_01-a")
    assert url == "/media/sess_01-a.mp3"
    assert (media / "sess_01-a.mp3").read_bytes() == b"ID3fake-mp3"
    assert seen["url"] == "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en"
    assert seen["auth"] == "Token test-key"
    assert seen["body"] == {"text": "You asked one question."}
    assert list(media.iterdir()) == [media / "sess_01-a.mp3"]  # no temp files left


async def test_speak_truncates_to_2000_chars(media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(json.loads(req.content)["text"])
        return httpx.Response(200, content=b"mp3")

    _use_transport(monkeypatch, httpx.MockTransport(handler))
    assert await speak("word " * 1000, "long") == "/media/long.mp3"
    assert len(sent[0]) <= 2000 and sent[0].endswith("word")


async def test_speak_401_returns_none(media: Path, monkeypatch: pytest.MonkeyPatch,
                                      caplog: pytest.LogCaptureFixture) -> None:
    _use_transport(monkeypatch, httpx.MockTransport(lambda req: httpx.Response(401, text="bad auth")))
    assert await speak("hello", "s401") is None
    assert not (media / "s401.mp3").exists()
    assert "test-key" not in caplog.text


async def test_speak_empty_body_returns_none(media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_transport(monkeypatch, httpx.MockTransport(lambda req: httpx.Response(200, content=b"")))
    assert await speak("hello", "empty") is None
    assert not (media / "empty.mp3").exists()


async def test_speak_timeout_returns_none(media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=req)

    _use_transport(monkeypatch, httpx.MockTransport(handler))
    assert await speak("hello", "slow") is None
    assert not (media / "slow.mp3").exists()


@pytest.mark.parametrize("bad", ["", "../etc", "a/b", "x" * 81, "has space", "dot.mp3"])
async def test_speak_bad_session_id(bad: str, media: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, content=b"mp3")

    _use_transport(monkeypatch, httpx.MockTransport(handler))
    assert await speak("hello", bad) is None
    assert calls == []


async def test_speak_write_error_returns_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("not a dir")
    monkeypatch.setattr(config, "MEDIA_DIR", blocker / "media")
    monkeypatch.setattr(speech, "load_settings", lambda: _settings_with_key("test-key"))
    _use_transport(monkeypatch, httpx.MockTransport(lambda req: httpx.Response(200, content=b"mp3")))
    assert await speak("hello", "werr") is None
