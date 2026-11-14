from backend.motion.classifier import MotionClassifier, Thresholds, calibrate, features, synth_samples
from backend.motion.fusion import Fusion


def _states(kind, th=None):
    c = MotionClassifier(th)
    out = [c.add(s) for s in synth_samples(kind, 6)]
    return [o for o in out if o], c


def test_classifier_defaults():
    for kind in ("still", "gesture", "fidget"):
        outs, _ = _states(kind)
        states = [o["state"] for o in outs[2:]]
        assert states.count(kind) / len(states) >= 0.8, (kind, states)


def test_hand_energy_ordering():
    e = {}
    for kind in ("still", "fidget", "gesture"):
        outs, c = _states(kind)
        e[kind] = outs[-1]["hand_energy"]
    assert e["still"] < 0.1 < e["fidget"] < e["gesture"]


def test_calibration_roundtrip(tmp_path, monkeypatch):
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    def feats(kind):
        s = synth_samples(kind, 5, seed=3)
        return [features(s[i:i + 100]) for i in range(0, len(s) - 100, 50)]

    th = calibrate(feats("still"), feats("gesture"), feats("fidget"))
    assert th.still_a < th.gesture_a
    th.save(13)
    assert Thresholds.load(13) == th
    for kind in ("still", "gesture", "fidget"):
        outs, _ = _states(kind, th)
        states = [o["state"] for o in outs[2:]]
        assert states.count(kind) / len(states) >= 0.8, (kind, states)


def test_fidget_listening_and_checked_out():
    sig = []
    f = Fusion(sig.append)
    f.on_turn({"speaker": "other", "start": 0, "end": 50, "text": "long story"})
    for i in range(20):
        f.on_motion({"ts": i * 0.5, "state": "fidget", "speaker_context": "other"})
    assert f.fidget_listening_s >= 9
    for i in range(20, 40):
        f.on_motion({"ts": i * 0.5, "state": "still", "speaker_context": "other"})
    assert f.fidget_listening_s == 0
    assert [s["kind"] for s in sig] == ["checked_out"]


def test_nerves():
    sig = []
    f = Fusion(sig.append)
    f.on_motion({"ts": 0, "state": "gesture", "speaker_context": "me"})
    for i in range(1, 15):
        f.on_motion({"ts": i * 0.5, "state": "still", "speaker_context": "me"}, pace_wpm=200, baseline_wpm=140)
    assert [s["kind"] for s in sig] == ["nerves"]  # cooldown: only once
    assert set(sig[0]) == {"type", "kind", "detail", "ts"}
