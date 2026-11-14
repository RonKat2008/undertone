"""Scoring for scripts/eval_audio.py and the file band transport. No network."""
import asyncio
import wave

import numpy as np
import pytest

from backend.stt.audio_eval import edit_ops, norm_words, score, wer
from backend.stt.turns import Word


def test_norm_words_numbers_and_punctuation():
    assert norm_words("Profits fell 20% over 2 years.") == "profits fell twenty percent over two years".split()
    assert norm_words("about 80 stores, I'd want—") == "about eighty stores i'd want".split()
    assert norm_words("within 18 months") == ["within", "eighteen", "months"]


def test_wer_counts():
    assert edit_ops("a b c d".split(), "a x c".split()) == (1, 1, 0)
    assert wer("a b".split(), "a b".split()) == 0.0
    assert wer("a b".split(), "a b c d".split()) == 1.0


def _truth():
    return [
        {"turn": 1, "speaker": "other", "text": "hello there friend", "start": 0.0, "end": 2.0, "words": 3,
         "wpm": 90.0, "fillers": []},
        {"turn": 2, "speaker": "me", "text": "um hi how are you", "start": 2.5, "end": 4.5, "words": 5,
         "wpm": 150.0, "fillers": ["um"]},
    ]


def _ev(tid, spk, text, s, e, at, fillers=()):
    return {"type": "turn.final", "turn_id": tid, "speaker": spk, "text": text, "start": s, "end": e,
            "wpm": round(len(text.split()) / max(e - s, 0.5) * 60, 1), "fillers": list(fillers), "emitted_at": at}


def test_score_perfect_run():
    turns = [_ev("t1", "other", "Hello there, friend.", 0.1, 1.9, 2.4),
             _ev("t2", "me", "Um, hi. How are you?", 2.6, 4.4, 5.0, ["um"])]
    words = [("other", Word("Hello", 0.1, 0.5, 1)), ("me", Word("hi", 3.0, 3.2, 0))]
    c = score(_truth(), turns, words)
    assert c["turns_detected"] == 2 and not c["merged"] and not c["split"] and not c["missed"]
    assert c["speaker_turn_acc"] == 1.0 and c["speaker_word_acc"] == 1.0
    assert c["wer"] == 0.0
    assert c["fillers_matched"] == 1
    assert c["latency_median"] == pytest.approx(0.45)


def test_score_merged_and_wrong_speaker():
    turns = [_ev("t1", "other", "hello there friend um hi how are you", 0.1, 4.4, 6.0, ["um"])]
    c = score(_truth(), turns)
    assert c["merged"] and c["merged"][0]["truth_turns"] == [1, 2]
    assert c["missed"] == [1]          # the merged turn counts for the truth turn it overlaps most
    assert c["wrong_speaker"] == [2]


def test_score_split():
    turns = [_ev("t1", "other", "hello there", 0.1, 1.0, 1.5), _ev("t2", "other", "friend", 1.5, 1.9, 2.5),
             _ev("t3", "me", "um hi how are you", 2.6, 4.4, 5.0, ["um"])]
    c = score(_truth(), turns)
    assert c["split"] == [{"turn": 1, "into": ["t1", "t2"]}]
    assert c["per_turn"][0]["latency"] == pytest.approx(0.5)


def _write_wav(path, seconds, amp=0.3):
    t = np.arange(int(16000 * seconds)) / 16000
    x = (amp * np.sin(2 * np.pi * 220 * t) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(x.tobytes())


def test_wav_frames_are_band_packets(tmp_path):
    from backend.band.file_audio import FRAME_BYTES, wav_frames
    p = tmp_path / "a.wav"
    _write_wav(p, 0.05)  # 2.5 frames
    frames = list(wav_frames(str(p)))
    assert FRAME_BYTES == 640 and len(frames) == 3 and all(len(f) == 640 for f in frames)


def test_file_transport_needs_a_file():
    from backend.band.source import BandSource
    with pytest.raises(ValueError):
        BandSource("file", 0, keyboard=False)


def test_file_transport_plays_in_real_time(tmp_path):
    """The file goes through _push_pcm (80 ms chunks + loudness) in real time, then silence."""
    from backend.band.source import BandSource
    p = tmp_path / "a.wav"
    _write_wav(p, 0.4)

    async def run():
        band = BandSource("file", 0, keyboard=False, audio_file=str(p))
        await band.start()
        band.reset_clock()
        t0 = asyncio.get_running_loop().time()
        await band.mic(True)
        await asyncio.wait_for(band.file_done.wait(), 3)
        took = asyncio.get_running_loop().time() - t0
        await asyncio.sleep(0.2)
        await band.stop()
        return band, took

    band, took = asyncio.run(run())
    assert 0.3 < took < 1.0
    assert band.audio_seconds >= 0.48  # 0.4 s of file + silence after it
    assert band.loudness.mean_db(0.0, 0.35) > -20
    assert band.loudness.mean_db(0.45, 0.6) == -96.0
