import asyncio
import math
import struct

from backend.band.audio import CHUNK_BYTES, Chunker, LoudnessTimeline, rms_db
from backend.session import status_verdict


def test_chunker_80ms():
    c = Chunker()
    out = []
    for _ in range(9):
        out += c.feed(b"\x00" * 640)  # nine 20 ms packets
    assert len(out) == 2 and all(len(x) == CHUNK_BYTES for x in out)
    assert abs(c.seconds - 0.16) < 1e-9


def test_rms_db():
    assert rms_db(b"\x00" * 100) == -96.0
    tone = b"".join(struct.pack("<h", int(16384 * math.sin(i / 5))) for i in range(1280))
    assert -12 < rms_db(tone) < -6


def test_loudness_timeline():
    lt = LoudnessTimeline()
    for i in range(1, 26):
        lt.add(i * 0.08, -20.0 if i <= 12 else -40.0)
    assert abs(lt.mean_db(0, 0.9) - -20) < 0.01
    assert lt.mean_db(5, 6) is None


def test_status_verdict():
    assert status_verdict(0.8, 0.6, 10) == ("talking_too_much", "status_talking")
    assert status_verdict(0.4, 0.6, 200) == ("ask_question", "status_ask")
    assert status_verdict(0.4, 0.6, 30) == ("good", "status_good")


def test_sim_session_end_to_end(tmp_path, monkeypatch):
    """Kit sim band: connect, double-tap starts, single tap answers, double-tap stops."""
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)
    from backend.band.source import BandSource
    from backend.session import SessionController

    async def run():
        events = []
        band = BandSource("sim", 13, keyboard=False)
        ctl = SessionController(events.append, band=band, use_pipecat=False)
        await ctl.start()
        band.tap("double")
        await asyncio.sleep(2.0)
        band.tap("single")
        await asyncio.sleep(0.3)
        band.tap("double")
        await asyncio.sleep(0.5)
        await ctl.shutdown()
        return events, band

    events, band = asyncio.run(run())
    types = [e["type"] for e in events]
    assert "session.started" in types and "session.ended" in types and "status.reply" in types
    assert any(e["type"] == "motion" for e in events)
    st = [e for e in events if e["type"] == "band.status"]
    assert any(e["mic_on"] for e in st) and st[-1]["connected"] is False
    started = next(e for e in events if e["type"] == "session.started")
    assert set(started) == {"type", "session_id", "coach_id", "mode", "policy", "ts"}
