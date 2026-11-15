"""Voice memory: name extraction, the word log, the embedder loader's graceful failure, the
SessionController words hook, and contract parity with contracts/events.ts."""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend import contracts as c
from backend.contracts import TurnFinalEvent
from backend.voices import embedder as emb_mod
from backend.voices.names import NameAnswer, other_name, rule_name
from backend.voices.words import WordLog

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"


def turn(speaker: str, text: str, i: int = 0) -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=f"t{i}", speaker=speaker, text=text, start=float(i), end=i + 0.9, wpm=120)


# ---------- names ----------
@pytest.mark.parametrize(("lines", "expected"), [
    ([("me", "Hello, Dylan. How was the trip?")], "Dylan"),
    ([("other", "Hi, I'm Priya, I run the data team.")], "Priya"),
    ([("me", "That makes sense, thanks, Marco.")], "Marco"),
    ([("me", "Hello, how are you?"), ("other", "Good, thanks.")], None),
    ([("other", "I'm tired today."), ("me", "Same here.")], None),
    ([("other", "Thanks, Alex."), ("me", "Thanks, Alex.")], None),  # Alex is what OTHER calls ME
    ([("me", "Hi, Dylan."), ("me", "Thanks, Sam.")], None),  # two different names: no guess
    ([("me", "Did Sarah send the deck?")], None),  # a person talked about, not addressed
    ([("me", "Priya, have you got a minute?")], "Priya"),  # leading vocative
    ([("me", "Lisbon, Porto, then Madrid.")], None),  # a list of places is not a vocative
])
def test_rule_name(lines: list[tuple[str, str]], expected: str | None) -> None:
    got = rule_name([turn(s, t, i) for i, (s, t) in enumerate(lines)])
    assert (got.name if got else None) == expected


async def test_llm_name_used_when_confident() -> None:
    async def gen(prompt, schema, timeout_s):  # type: ignore[no-untyped-def]
        assert "OTHER" in prompt
        return NameAnswer(other_name="Dylan", evidence="ME: so, Dylan", source="addressed_by_me", confidence=0.95)

    got = await other_name([turn("me", "So, Dylan, what now?")], generate=gen)
    assert got is not None and got.name == "Dylan" and got.source == "llm"


async def test_llm_name_rejected_when_not_in_transcript_or_unsure() -> None:
    async def invented(prompt, schema, timeout_s):  # type: ignore[no-untyped-def]
        return NameAnswer(other_name="Zed", evidence="", source="self_introduction", confidence=0.99)

    async def unsure(prompt, schema, timeout_s):  # type: ignore[no-untyped-def]
        return NameAnswer(other_name="Dylan", evidence="", source="addressed_by_me", confidence=0.5)

    turns = [turn("me", "Hey, Dylan, how are you doing?")]
    assert await other_name(turns, generate=invented) is None
    assert await other_name(turns, generate=unsure) is None


async def test_llm_failure_falls_back_to_rules() -> None:
    async def broken(prompt, schema, timeout_s):  # type: ignore[no-untyped-def]
        raise RuntimeError("no key")

    got = await other_name([turn("me", "Thanks, Priya.")], generate=broken)
    assert got is not None and got.name == "Priya" and got.source == "rules"


async def test_never_the_wearers_own_name() -> None:
    async def gen(prompt, schema, timeout_s):  # type: ignore[no-untyped-def]
        return NameAnswer(other_name="Alex", evidence="", source="addressed_by_me", confidence=0.95)

    turns = [turn("other", "Good to see you, Alex.", 0), turn("me", "Alex here, hi.", 1)]
    assert await other_name(turns, generate=gen) is None


# ---------- word log ----------
def w(text: str, start: float, label: int = 0) -> SimpleNamespace:
    return SimpleNamespace(text=text, start=start, end=start + 0.3, label=label)


def test_word_log_carries_the_opening_turn_and_rebases() -> None:
    log = WordLog()
    log.add(None, 0.0, [w("noise", 1.0), w("Hello", 10.0), w("there.", 10.4)])  # before the conversation opens
    log.add("s1", 10.0, [w("Hi!", 11.0, 1), w("Hello", 10.0)])  # the duplicate is dropped
    words = log.take("s1")
    assert [(x.text, x.start, x.label) for x in words] == [("Hello", 0.0, 0), ("there.", 0.4, 0), ("Hi!", 1.0, 1)]
    assert log.take("s1") == []


def test_word_log_ignores_garbage() -> None:
    log = WordLog()
    log.add("s1", 0.0, [object()])
    assert log.take("s1") == []


# ---------- embedder loading degrades ----------
def test_missing_model_without_download_returns_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(emb_mod, "_cache", {})
    monkeypatch.setattr(emb_mod, "_failed_at", {})
    assert emb_mod.load_embedder(download=False) is None
    assert emb_mod.load_embedder(download=False) is None  # backed off, no second attempt


def test_bad_download_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_download(spec, dest):  # type: ignore[no-untyped-def]
        raise ValueError("checksum mismatch")

    monkeypatch.setattr(emb_mod, "_download", fake_download)
    assert emb_mod.ensure_model(emb_mod.model_spec(), tmp_path) is None


def test_unknown_model_name_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_MODEL", "nope")
    assert emb_mod.model_spec().key == emb_mod.DEFAULT_MODEL


# ---------- the controller hook ----------
def test_controller_forwards_final_words(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.session import SessionController

    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    ctl = SessionController(emit=lambda ev: None, use_pipecat=False)
    got: list[tuple] = []
    ctl.on_final_words = lambda sid, off, words: got.append((sid, off, len(words)))
    ctl._on_words("me", [w("hi", 1.0)])
    ctl.session_id, ctl._audio_offset = "s1", 5.0
    ctl._on_words("other", [w("yo", 6.0)])
    ctl.on_final_words = lambda *a: (_ for _ in ()).throw(RuntimeError("boom"))
    ctl._on_words("me", [w("ok", 7.0)])  # a broken hook never breaks the live path
    assert got == [(None, 0.0, 1), ("s1", 5.0, 1)]


# ---------- contract parity ----------
VOICE_MODELS = ("VoiceConflict", "VoiceSummary", "WearerVoice", "VoiceList", "SessionSpeaker", "SessionNameGuess",
                "SessionVoices", "ReprocessResult")


def _ts_fields(name: str) -> set[str]:
    m = re.search(rf"export interface {name} \{{(.*?)\n\}}", EVENTS_TS.read_text(), re.S)
    assert m, name
    return set(re.findall(r"^\s+(\w+)\??:", m.group(1), re.M))


@pytest.mark.parametrize("name", VOICE_MODELS)
def test_voice_payloads_match_events_ts(name: str) -> None:
    assert set(getattr(c, name).model_fields) == _ts_fields(name)


def test_voice_literals_match_events_ts() -> None:
    src = EVENTS_TS.read_text()
    for ts_name, lit in (("WearerState", c.WearerState), ("VoiceDecision", c.VoiceDecision),
                         ("VoiceRunStatus", c.VoiceRunStatus), ("NameOutcome", c.NameOutcome)):
        body = re.search(rf"export type {ts_name} = (.*?);", src)
        assert body and set(re.findall(r"'([^']+)'", body.group(1))) == set(lit.__args__)  # type: ignore[attr-defined]
