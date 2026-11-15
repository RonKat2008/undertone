"""Voice memory end to end on synthetic audio with a deterministic fake embedder (no model, no network).

Each "voice" is a harmonic tone; the fake embedder is a coarse magnitude spectrum, so the same
voice embeds alike across conversations and two voices embed far apart.
"""

from __future__ import annotations

import wave
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.capture.media import recordings_dir
from backend.contracts import Metrics, SessionVoices, TurnFinalEvent, VoiceList
from backend.db import DB
from backend.growth import router as growth_router
from backend.state import AppState
from backend.studio.default import default_coach
from backend.voices import routes as voice_routes
from backend.voices import store
from backend.voices.names import NameGuess
from backend.voices.service import VoiceMemory
from backend.voices.types import SAMPLE_RATE, TimedWord

PRE_ROLL = 0.5
TONES = {"me": 180.0, "dylan": 520.0, "sam": 330.0}


class FakeEmbedder:
    name = "fake-spectrum"

    def embed(self, samples: np.ndarray) -> np.ndarray:
        spec = np.abs(np.fft.rfft(samples, n=8192))[:1024]
        return np.add.reduceat(spec, np.arange(0, 1024, 16)).astype(np.float32)


def tone(freq: float, seconds: float, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    x = sum(np.sin(2 * np.pi * freq * k * t) / k for k in (1, 2, 3))
    return (0.2 * x * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t)) + 0.002 * rng.standard_normal(len(t))).astype(np.float32)


def conversation(plan: list[tuple[str, float, float]], seed: int = 0) -> tuple[np.ndarray, list[TimedWord]]:
    """plan: (voice, start, duration) on the conversation clock. One Deepgram label for all (the failure)."""
    rng = np.random.default_rng(seed)
    total = max(s + d for _, s, d in plan) + 1.0
    audio = 0.001 * rng.standard_normal(int((total + PRE_ROLL) * SAMPLE_RATE)).astype(np.float32)
    words: list[TimedWord] = []
    for voice, start, dur in plan:
        i = int((start + PRE_ROLL) * SAMPLE_RATE)
        seg = tone(TONES[voice], dur, rng)
        audio[i:i + len(seg)] = seg
        n = max(1, int(dur / 0.4))
        for k in range(n):
            text = f"{voice}{k}" + ("." if k == n - 1 else "")
            words.append(TimedWord(text, round(start + k * dur / n, 3), round(start + (k + 0.8) * dur / n, 3), 0))
    return audio, words


def write_session(db: DB, sid: str, audio: np.ndarray, turns: list[TurnFinalEvent]) -> None:
    db.create_session(sid, "default", "Default", "regular", f"2026-11-14T10:{len(sid):02d}:00+00:00")
    for t in turns:
        db.save_turn(sid, t)
    db.end_session(sid, "2026-11-14T11:00:00+00:00", len(audio) / SAMPLE_RATE, Metrics(talk_ratio=0.95), None)
    directory = recordings_dir(Path(db.path))
    directory.mkdir(parents=True, exist_ok=True)
    with wave.open(str(directory / f"{sid}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    db.set_recording(sid, PRE_ROLL, len(audio) / SAMPLE_RATE)
    db.set_verdict(sid, True, "keep", "rules")


def stored_turns(words: list[TimedWord], gap: float = 1.0) -> list[TurnFinalEvent]:
    """What live assembly stores with one label: everything 'me', split only on long gaps."""
    groups: list[list[TimedWord]] = []
    for w in words:
        if groups and w.start - groups[-1][-1].end <= gap:
            groups[-1].append(w)
        else:
            groups.append([w])
    return [TurnFinalEvent(turn_id=f"t{i + 1}", speaker="me", text=" ".join(x.text for x in g),
                           start=g[0].start, end=g[-1].end, wpm=120.0) for i, g in enumerate(groups)]


PLAN_A = [("me", 0.0, 3.0), ("dylan", 3.3, 3.2), ("me", 6.8, 2.2), ("dylan", 9.3, 2.7), ("dylan", 14.0, 3.0)]
PLAN_B = [("dylan", 0.0, 3.5), ("me", 3.8, 3.0), ("dylan", 7.1, 3.0), ("me", 10.4, 2.5)]
PLAN_C = [("sam", 0.0, 3.5), ("me", 3.8, 3.0), ("sam", 7.1, 3.0)]


class Namer:
    def __init__(self) -> None:
        self.answers: dict[int, NameGuess | None] = {}
        self.calls = 0

    async def __call__(self, turns, wearer_name=None):  # type: ignore[no-untyped-def]
        self.calls += 1
        return self.answers.get(self.calls)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    d = DB(tmp_path / "voices.db")
    yield d
    d.close()


@pytest.fixture
def namer() -> Namer:
    return Namer()


@pytest.fixture
def vm(db: DB, namer: Namer) -> VoiceMemory:
    return VoiceMemory(db, enabled=True, embedder_factory=FakeEmbedder, namer=namer)


def add(db: DB, sid: str, plan: list[tuple[str, float, float]], seed: int = 0, with_words: bool = True) -> list[TimedWord]:
    audio, words = conversation(plan, seed)
    write_session(db, sid, audio, stored_turns(words))
    if with_words:
        store.ensure_tables(db)
        store.save_words(db, sid, words)
    return words


async def enrol(vm: VoiceMemory) -> None:
    await vm.enrol(tone(TONES["me"], 10.0, np.random.default_rng(9)))


def speakers(db: DB, sid: str) -> list[str]:
    return [t.speaker for t in db.load_turns(sid)]


async def test_enrolled_wearer_corrects_and_splits_turns(vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    report = await vm.process("s1", wait_s=0)
    assert report is not None and report["labels_corrected"]
    turns = db.load_turns("s1")
    assert [t.speaker for t in turns] == ["me", "other", "me", "other", "other"]
    assert all(t.text.startswith("me" if t.speaker == "me" else "dylan") for t in turns)
    assert report["turns_split"] == 1 and report["turns_relabelled"] == 1
    metrics = Metrics.model_validate_json(db.get_session("s1")["metrics_json"])  # type: ignore[index]
    assert 0.25 < metrics.talk_ratio < 0.5  # recomputed from the corrected turns (was 0.95)


async def test_second_conversation_links_the_same_voice(vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s2", PLAN_B, seed=1)
    await vm.process("s1", wait_s=0)
    await vm.process("s2", wait_s=0)
    voices = store.list_voices(db)
    assert len(voices) == 1
    p1, p2 = db.get_session("s1")["person_id"], db.get_session("s2")["person_id"]  # type: ignore[index]
    assert p1 == p2 == voices[0].person_id
    assert voices[0].samples == 2
    names = {p.person_id: p.name for p in db.list_people()}
    assert names[p1] == "Unknown voice 1"


async def test_a_different_person_gets_a_new_voice(vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s3", PLAN_C, seed=2)
    await vm.process("s1", wait_s=0)
    await vm.process("s3", wait_s=0)
    assert len(store.list_voices(db)) == 2
    assert db.get_session("s1")["person_id"] != db.get_session("s3")["person_id"]  # type: ignore[index]


async def test_heard_name_names_the_voice_then_conflicts(vm: VoiceMemory, db: DB, namer: Namer) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s2", PLAN_B, seed=1)
    namer.answers = {1: NameGuess("Dylan", "rules", "Hello, Dylan.", 0.85), 2: NameGuess("Sam", "llm", "x", 0.9)}
    await vm.process("s1", wait_s=0)
    assert db.get_session("s1")["person_id"] == "dylan"  # type: ignore[index]
    report = await vm.process("s2", wait_s=0)
    assert report["name_guess"]["outcome"] == "conflict"  # type: ignore[index]
    assert db.get_session("s2")["person_id"] == "dylan"  # type: ignore[index]  voice wins, name is recorded
    assert store.conflicts(db)[0]["heard_name"] == "Sam"


async def test_reprocess_is_idempotent(vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    await vm.process("s1", wait_s=0)
    first = [(t.turn_id, t.speaker) for t in db.load_turns("s1")]
    await vm.process("s1", wait_s=0)
    voices = store.list_voices(db)
    assert len(voices) == 1 and voices[0].samples == 1
    assert [(t.turn_id, t.speaker) for t in db.load_turns("s1")] == first


async def test_turn_windows_without_word_timings(vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    audio, words = conversation(PLAN_C, 3)
    turns = [TurnFinalEvent(turn_id="a", speaker="me", text="hi", start=0.0, end=3.5, wpm=100),
             TurnFinalEvent(turn_id="b", speaker="other", text="yo", start=3.8, end=6.8, wpm=100),
             TurnFinalEvent(turn_id="c", speaker="me", text="ok", start=7.1, end=10.1, wpm=100)]
    write_session(db, "s4", audio, turns)
    report = await vm.process("s4", wait_s=0)
    assert report is not None and not report["words_used"]
    assert speakers(db, "s4") == ["other", "me", "other"]


async def test_bootstrap_does_not_correct_until_confirmed(db: DB, namer: Namer) -> None:
    vm = VoiceMemory(db, enabled=True, embedder_factory=FakeEmbedder, namer=namer)
    audio, words = conversation(PLAN_B, 4)
    audio = audio.copy()
    # the wearer is louder (band on the wrist): boost the wearer's stretches
    for voice, start, dur in PLAN_B:
        if voice == "me":
            i = int((start + PRE_ROLL) * SAMPLE_RATE)
            audio[i:i + int(dur * SAMPLE_RATE)] *= 3.0
    write_session(db, "s5", audio, stored_turns(words))
    store.save_words(db, "s5", words)
    report = await vm.process("s5", wait_s=0)
    assert report is not None and report["wearer_source"] == "bootstrap" and not report["labels_corrected"]
    assert store.wearer(db) is not None and store.wearer(db).wearer_state == "provisional"  # type: ignore[union-attr]


async def test_waits_for_the_debrief_summary_before_recomputing(vm: VoiceMemory, db: DB) -> None:
    import asyncio

    from backend.contracts import DebriefNumbers, SessionSummary

    await enrol(vm)
    add(db, "s1", PLAN_A)
    db.execute("UPDATE sessions SET summary_json = NULL WHERE session_id = 's1'")
    task = asyncio.ensure_future(vm.process("s1", wait_s=0, await_summary=True))
    await asyncio.sleep(0.3)
    assert not task.done()  # still waiting for the Brain's end_session
    numbers = DebriefNumbers(talk_ratio=0.95, interruptions=1, questions=2, fillers_per_min=0.0, wpm=120)
    summary = SessionSummary(session_id="s1", started_at="2026-11-14T10:00:00+00:00", duration_s=20.0,
                             coach_name="Default", mode="regular", headline_fact="x", numbers=numbers)
    db.end_session("s1", "2026-11-14T11:00:00+00:00", 20.0, Metrics(talk_ratio=0.95), summary)
    await task
    stored = SessionSummary.model_validate_json(db.get_session("s1")["summary_json"])  # type: ignore[index]
    assert stored.numbers.talk_ratio < 0.5 and stored.numbers.interruptions == 1


async def test_model_missing_keeps_old_behaviour(db: DB, namer: Namer) -> None:
    vm = VoiceMemory(db, enabled=True, embedder_factory=lambda: None, namer=namer)
    add(db, "s1", PLAN_A)
    before = speakers(db, "s1")
    report = await vm.process("s1", wait_s=0)
    assert report is not None and report["status"] == "skipped"
    assert speakers(db, "s1") == before


async def test_sensitive_conversation_is_not_used(vm: VoiceMemory, db: DB) -> None:
    add(db, "s1", PLAN_A)
    db.set_verdict("s1", False, "sensitive", "decisions")
    await vm.process("s1", wait_s=0)
    assert store.list_voices(db, include_wearer=True) == []


async def test_disabled_does_nothing(db: DB, namer: Namer) -> None:
    vm = VoiceMemory(db, enabled=False, embedder_factory=FakeEmbedder, namer=namer)
    add(db, "s1", PLAN_A)
    vm.schedule("s1")
    assert await vm.process("s1", wait_s=0) is None


async def test_embedder_crash_never_raises(db: DB, namer: Namer) -> None:
    class Broken:
        name = "broken"

        def embed(self, samples):  # type: ignore[no-untyped-def]
            raise RuntimeError("onnx exploded")

    vm = VoiceMemory(db, enabled=True, embedder_factory=Broken, namer=namer)
    add(db, "s1", PLAN_A)
    report = await vm.process("s1", wait_s=0)
    assert report is not None and not report["labels_corrected"]


# ---------- routes ----------
@pytest.fixture
def client(db: DB, vm: VoiceMemory) -> TestClient:
    app = FastAPI()
    app.include_router(growth_router)
    app.include_router(voice_routes.router)
    state = AppState(bus=Bus(), db=db, active_coach=default_coach())
    state.voices = vm  # type: ignore[attr-defined]
    app.state.app = state
    return TestClient(app)


async def test_routes_list_name_merge_forget(client: TestClient, vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s3", PLAN_C, seed=2)
    await vm.process("s1", wait_s=0)
    await vm.process("s3", wait_s=0)
    listing = VoiceList.model_validate(client.get("/voices").json())
    assert listing.enabled and listing.wearer.state == "enrolled" and len(listing.voices) == 2
    v1 = next(v for v in listing.voices if "s1" in v.sessions)
    named = client.post(f"/voices/{v1.voice_id}/name", json={"name": "Dylan"}).json()
    assert named["named"] and named["person_id"] == "dylan" and db.get_session("s1")["person_id"] == "dylan"  # type: ignore[index]
    view = SessionVoices.model_validate(client.get("/sessions/s1/voices").json())
    assert view.status == "done" and any(s.name == "Dylan" for s in view.speakers)
    other = next(v for v in listing.voices if v.voice_id != v1.voice_id)
    merged = client.post(f"/voices/{other.voice_id}/merge", json={"into": v1.voice_id}).json()
    assert set(merged["sessions"]) == {"s1", "s3"} and db.get_session("s3")["person_id"] == "dylan"  # type: ignore[index]
    assert client.delete(f"/voices/{v1.voice_id}").json() == {"forgotten": v1.voice_id}
    assert store.list_voices(db) == [] and client.get(f"/voices/{v1.voice_id}").status_code == 404


async def test_manual_tag_teaches_the_voice(client: TestClient, vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s2", PLAN_B, seed=1)
    await vm.process("s1", wait_s=0)
    assert client.post("/sessions/s1/person", json={"name": "Priya"}).status_code == 200
    assert store.list_voices(db)[0].person_id == "priya"
    await vm.process("s2", wait_s=0)
    assert db.get_session("s2")["person_id"] == "priya"  # type: ignore[index]


async def test_manual_tag_wins_over_voice(client: TestClient, vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s2", PLAN_B, seed=1)
    await vm.process("s1", wait_s=0)
    client.post(f"/voices/{store.list_voices(db)[0].voice_id}/name", json={"name": "Dylan"})
    await vm.process("s2", wait_s=0)
    client.post("/sessions/s2/person", json={"name": "Marco"})
    await vm.process("s2", wait_s=0)  # a rerun keeps the manual tag
    assert db.get_session("s2")["person_id"] == "marco"  # type: ignore[index]
    by_person = {v.person_id for v in store.list_voices(db)}
    assert {"dylan", "marco"} <= by_person


def test_enrol_wav_rejects_garbage(client: TestClient) -> None:
    assert client.post("/voices/wearer/enrol/wav", content=b"not a wav").status_code == 422


def test_reprocess_route(client: TestClient, db: DB) -> None:
    add(db, "s1", PLAN_A)
    body = client.post("/voices/reprocess", json={"session_ids": ["s1", "nope"]}).json()
    assert body == {"queued": ["s1"], "skipped": ["nope"]}
    assert client.post("/voices/reprocess", json={}).json()["queued"] == ["s1"]


# ---------- review fixes ----------
def test_existing_tags_are_recorded_as_manual_once(db: DB) -> None:
    from backend.voices import people

    add(db, "s1", PLAN_A, with_words=False)
    db.set_session_person("s1", "ana")  # tagged by hand before voice memory existed
    store.ensure_tables(db)
    add(db, "s2", PLAN_B, with_words=False)
    db.set_session_person("s2", "dylan")  # after: not a backfilled manual tag
    store.ensure_tables(db)
    assert people.manual_sessions(db) == {"s1": "ana"}


async def test_a_wearer_print_from_another_model_is_replaced(vm: VoiceMemory, db: DB, namer: Namer) -> None:
    class OtherModel(FakeEmbedder):
        name = "other-model"

    await enrol(vm)
    audio, words = conversation(PLAN_B, 4)
    audio = audio.copy()
    for voice, start, dur in PLAN_B:  # the wearer is louder, so bootstrapping has a pick
        if voice == "me":
            i = int((start + PRE_ROLL) * SAMPLE_RATE)
            audio[i:i + int(dur * SAMPLE_RATE)] *= 3.0
    write_session(db, "s1", audio, stored_turns(words))
    store.save_words(db, "s1", words)
    other = VoiceMemory(db, enabled=True, embedder_factory=OtherModel, namer=namer)
    await other.process("s1", wait_s=0)
    row = store.wearer(db)
    assert row is not None and row.model == "other-model" and row.wearer_state == "provisional"


async def test_reprocess_uses_the_coachs_filler_words(db: DB, namer: Namer, monkeypatch: pytest.MonkeyPatch) -> None:
    vm = VoiceMemory(db, enabled=True, embedder_factory=FakeEmbedder, namer=namer, filler_words=lambda: ["um"])
    seen: list[list[str]] = []

    async def spy(sid, filler_words=(), **kw):  # type: ignore[no-untyped-def]
        seen.append(list(filler_words))

    monkeypatch.setattr(vm, "process", spy)
    await vm._process_all(["s1"])
    assert seen == [["um"]]


async def test_manual_tag_joins_the_persons_existing_voice(client: TestClient, vm: VoiceMemory, db: DB) -> None:
    await enrol(vm)
    add(db, "s1", PLAN_A)
    add(db, "s3", PLAN_C, seed=2)
    await vm.process("s1", wait_s=0)
    client.post("/sessions/s1/person", json={"name": "Priya"})
    await vm.process("s3", wait_s=0)  # a new unknown voice
    assert len(store.list_voices(db)) == 2
    client.post("/sessions/s3/person", json={"name": "Priya"})
    voices = store.list_voices(db)
    assert len(voices) == 1 and voices[0].person_id == "priya"
    assert db.get_session("s3")["person_id"] == "priya"  # type: ignore[index]


async def test_manual_tag_is_kept_with_voice_memory_off(db: DB, namer: Namer) -> None:
    from backend.voices import people

    off = VoiceMemory(db, enabled=False, embedder_factory=FakeEmbedder, namer=namer)
    app = FastAPI()
    app.include_router(growth_router)
    state = AppState(bus=Bus(), db=db, active_coach=default_coach())
    state.voices = off  # type: ignore[attr-defined]
    app.state.app = state
    add(db, "s1", PLAN_A, with_words=False)
    assert TestClient(app).post("/sessions/s1/person", json={"name": "Ana"}).status_code == 200
    assert people.manual_sessions(db) == {"s1": "ana"}
