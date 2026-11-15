"""Pure voice-memory core: segments, clustering, voiceprints, turn correction, audio helpers."""

from __future__ import annotations

import numpy as np
import pytest

from backend.contracts import TurnFinalEvent
from backend.stt.fillers import DEFAULT_FILLERS
from backend.voices.audio import level_db, pcm16_to_float, slice_seconds, voiced
from backend.voices.cluster import (
    bootstrap_wearer,
    build_clusters,
    cluster_spans,
    pick_wearer,
)
from backend.voices.correct import correct_turns
from backend.voices.prints import (
    add_exemplar,
    cosine,
    match_voice,
    merge_prints,
    new_voiceprint,
    normalize,
    remove_session,
    robust_centroid,
)
from backend.voices.segments import (
    embeddable,
    pool_short,
    spans_from_turns,
    spans_from_words,
)
from backend.voices.types import (
    Exemplar,
    Span,
    SpeakerCluster,
    TimedWord,
    TurnSpan,
    VoiceConfig,
    Voiceprint,
)

CFG = VoiceConfig()
DIM = 192


def _dirs(k: int, seed: int = 0) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [normalize(rng.normal(size=DIM)) for _ in range(k)]


def _noisy(base: np.ndarray, n: int, seed: int, sigma: float = 0.03) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [normalize(base + rng.normal(scale=sigma, size=DIM)) for _ in range(n)]


def _w(text: str, start: float, end: float, label: int = 0) -> TimedWord:
    return TimedWord(text=text, start=start, end=end, label=label)


def _turn(tid: str, speaker: str, start: float, end: float, text: str = "x") -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=tid, speaker=speaker, text=text, start=start, end=end,
                          wpm=100.0, fillers=["um"])


# ---------------------------------------------------------------- audio


def test_pcm16_to_float_scales_and_ignores_odd_byte() -> None:
    data = np.array([0, 16384, -32768, 32767], dtype="<i2").tobytes() + b"\x01"
    out = pcm16_to_float(data)
    assert out.dtype == np.float32
    assert out.tolist() == pytest.approx([0.0, 0.5, -1.0, 32767 / 32768])


def test_slice_seconds_clamps() -> None:
    x = np.arange(16000, dtype=np.float32)
    assert len(slice_seconds(x, 0.5, 0.75)) == 4000
    assert len(slice_seconds(x, -1.0, 0.1)) == 1600
    assert len(slice_seconds(x, 0.9, 5.0)) == 1600
    assert slice_seconds(x, 2.0, 3.0).size == 0
    assert slice_seconds(x, 0.5, 0.2).size == 0


def test_level_db() -> None:
    assert level_db(np.zeros(0)) is None
    assert level_db(np.zeros(100)) is None
    assert level_db(np.ones(100) * 0.1) == pytest.approx(-20.0)


def test_voiced_drops_silence() -> None:
    sr = 16000
    t = np.arange(sr) / sr
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    quiet = np.full(sr, 1e-4, dtype=np.float32)
    x = np.concatenate([quiet, tone, quiet, tone[:1000]])
    out = voiced(x)
    assert abs(len(out) - (sr + 1000)) <= 2 * 480
    assert level_db(out) > -15.0
    assert voiced(np.zeros(sr, dtype=np.float32)).size == 0
    assert voiced(np.zeros(0, dtype=np.float32)).size == 0


# ---------------------------------------------------------------- segments


def test_spans_split_on_label_change_and_gap() -> None:
    words = [_w("a", 0.0, 0.4, 0), _w("b", 0.5, 0.9, 0), _w("c", 1.0, 1.4, 1),
             _w("d", 2.5, 2.9, 1)]
    spans = spans_from_words(words, CFG)
    assert [s.words for s in spans] == [(0, 1), (2,), (3,)]
    assert spans[0].start == 0.0 and spans[0].end == 0.9 and spans[1].label == 1


def test_spans_split_at_sentence_end_only_when_long_enough() -> None:
    words = [_w("hi.", 0.0, 0.3), _w("so", 0.4, 0.8), _w("this", 0.9, 1.2),
             _w("works.", 1.3, 1.6), _w("next", 1.7, 2.0)]
    spans = spans_from_words(words, CFG)
    assert [s.words for s in spans] == [(0, 1, 2, 3), (4,)]


def test_spans_split_at_max_length() -> None:
    words = [_w(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(20)]
    spans = spans_from_words(words, CFG)
    assert all(s.duration <= CFG.max_span_s for s in spans)
    assert sum(len(s.words) for s in spans) == 20 and len(spans) == 2
    assert spans_from_words([], CFG) == []


def test_pool_short_merges_neighbours() -> None:
    spans = [Span(0.0, 0.5, 0, (0,)), Span(0.8, 1.2, 0, (1,)), Span(1.5, 4.0, 1, (2,)),
             Span(10.0, 10.3, 1, (3,))]
    pooled = pool_short(spans, CFG)
    assert pooled[0] == Span(0.0, 1.2, 0, (0, 1))
    assert pooled[1].words == (2,)
    assert pooled[2] == spans[3]  # too far: left short
    assert embeddable(pooled, CFG) == [0, 1]


def test_pool_short_respects_max_and_turn() -> None:
    a = Span(0.0, 5.8, 0, (0,))
    b = Span(5.9, 6.3, 0, (1,))
    assert pool_short([a, b], CFG) == [a, b]
    t1 = Span(0.0, 0.5, None, (), "t1")
    t2 = Span(0.6, 2.0, None, (), "t2")
    assert pool_short([t1, t2], CFG) == [t1, t2]
    t3 = Span(0.6, 2.0, None, (), "t1")
    assert pool_short([t1, t3], CFG) == [Span(0.0, 2.0, None, (), "t1")]


def test_spans_from_turns_windows() -> None:
    turns = [TurnSpan("t1", 0.0, 7.5, "me"), TurnSpan("t2", 10.0, 16.5, "other"),
             TurnSpan("t3", 20.0, 20.4, "me")]
    spans = spans_from_turns(turns, CFG)
    t1 = [(s.start, s.end) for s in spans if s.turn_id == "t1"]
    t2 = [(s.start, s.end) for s in spans if s.turn_id == "t2"]
    assert t1 == [(0.0, 3.0), (3.0, 6.0), (6.0, 7.5)]
    assert t2 == [(10.0, 13.0), (13.0, 16.5)]  # 0.5 s tail merged
    assert [s for s in spans if s.turn_id == "t3"] == [Span(20.0, 20.4, None, (), "t3")]
    assert all(s.label is None for s in spans)


# ---------------------------------------------------------------- clustering


def test_cluster_separates_two_voices_under_one_label() -> None:
    a, b = _dirs(2, seed=1)
    embs = np.stack(_noisy(a, 6, 2) + _noisy(b, 4, 3))
    seconds = [2.0] * 6 + [2.0] * 4
    assign = cluster_spans(embs, seconds, [0] * 10, CFG)
    assert assign == [0] * 6 + [1] * 4
    clusters = build_clusters(assign, embs, seconds, [0] * 10, [-20.0] * 6 + [-30.0] * 4)
    assert [c.seconds for c in clusters] == [12.0, 8.0]
    assert clusters[0].labels == {0: 12.0} and clusters[1].level_db == -30.0
    assert cosine(clusters[0].centroid, a) > 0.95


def test_cluster_absorbs_tiny_cluster() -> None:
    a, b = _dirs(2, seed=4)
    embs = np.stack(_noisy(a, 4, 5) + _noisy(b, 1, 6))
    assign = cluster_spans(embs, [2.0] * 4 + [1.0], [0, 0, 0, 0, 1], CFG)
    assert assign == [0] * 5


def test_cluster_single_speaker_and_edge_sizes() -> None:
    (a,) = _dirs(1, seed=7)
    embs = np.stack(_noisy(a, 5, 8))
    assert cluster_spans(embs, [1.5] * 5, [0, 1, 0, 1, None], CFG) == [0] * 5
    assert cluster_spans(np.zeros((0, DIM)), [], [], CFG) == []
    assert cluster_spans(embs[:1], [1.0], [None], CFG) == [0]
    assert build_clusters([], embs, [], [], []) == []


def test_cluster_label_bonus_tips_borderline_merge() -> None:
    cfg = VoiceConfig(cluster_sim=0.5, label_bonus=0.1, min_cluster_s=0.0)
    a, b = _dirs(2, seed=9)
    b = normalize(b - float(np.dot(a, b)) * a)  # orthogonal to a
    x = normalize(a + 0.9 * b)
    y = normalize(a - 0.35 * b)  # cosine(x, y) ~ 0.48
    sim = cosine(x, y)
    assert 0.4 < sim < 0.5
    assert cluster_spans(np.stack([x, y]), [2.0, 2.0], [0, 0], cfg) == [0, 0]
    assert sorted(cluster_spans(np.stack([x, y]), [2.0, 2.0], [0, 1], cfg)) == [0, 1]


def _cluster(index: int, centroid: np.ndarray, seconds: float, level: float | None) -> SpeakerCluster:
    return SpeakerCluster(index=index, members=(index,), centroid=centroid, seconds=seconds,
                          level_db=level)


def test_pick_wearer() -> None:
    a, b = _dirs(2, seed=10)
    clusters = [_cluster(0, a, 5.0, -20.0), _cluster(1, b, 5.0, -30.0)]
    idx, sim = pick_wearer(clusters, _noisy(b, 1, 11)[0], 0.5)
    assert idx == 1 and sim > 0.9
    idx, sim = pick_wearer(clusters, _dirs(1, seed=12)[0], 0.5)
    assert idx is None and sim < 0.5
    assert pick_wearer(clusters, None, 0.5) == (None, -1.0)
    assert pick_wearer([], a, 0.5) == (None, -1.0)


def test_bootstrap_wearer() -> None:
    a, b, c = _dirs(3, seed=13)
    assert bootstrap_wearer([_cluster(0, a, 5.0, -30.0), _cluster(1, b, 5.0, -20.0)]) == 1
    assert bootstrap_wearer([_cluster(0, a, 5.0, -21.0), _cluster(1, b, 5.0, -20.0)]) is None
    assert bootstrap_wearer([_cluster(0, a, 1.0, -10.0), _cluster(1, b, 5.0, -20.0)]) is None
    assert bootstrap_wearer([_cluster(0, a, 3.0, -25.0), _cluster(1, c, 9.0, None)]) == 0
    assert bootstrap_wearer([_cluster(0, a, 3.0, None)]) is None
    assert bootstrap_wearer([]) is None


# ---------------------------------------------------------------- voiceprints


def test_normalize_and_cosine() -> None:
    z = normalize(np.zeros(4))
    assert z.dtype == np.float32 and not z.any()
    assert np.linalg.norm(normalize(np.array([3.0, 4.0]))) == pytest.approx(1.0)
    assert cosine(np.array([1.0, 0.0]), np.array([2.0, 0.0])) == pytest.approx(1.0)


def test_robust_centroid_drops_outlier() -> None:
    a, b = _dirs(2, seed=14)
    members = _noisy(a, 4, 15) + [b]
    cen = robust_centroid(members, None, 0.3)
    inliers = normalize(np.mean(members[:4], axis=0))
    assert cosine(cen, inliers) == pytest.approx(1.0, abs=1e-5)
    assert cosine(cen, b) < 0.1
    two = robust_centroid([a, b], [3.0, 1.0], 0.3)  # < 3 members: no outlier removal
    assert cosine(two, b) > 0.2
    with pytest.raises(ValueError):
        robust_centroid([], None, 0.3)


def test_match_voice_threshold_and_margin() -> None:
    a, b, c = _dirs(3, seed=16)
    prints = [Voiceprint("A", a), Voiceprint("B", b)]
    q = _noisy(a, 1, 17)[0]
    m = match_voice(q, prints, 0.5, 0.08)
    assert m.voice_id == "A" and m.best_id == "A" and m.margin > 0.5
    assert match_voice(c, prints, 0.5, 0.08).voice_id is None
    close = [Voiceprint("A", a), Voiceprint("A2", _noisy(a, 1, 18, sigma=0.01)[0])]
    m2 = match_voice(q, close, 0.5, 0.08)
    assert m2.voice_id is None and m2.best_id in {"A", "A2"} and m2.similarity > 0.9
    single = match_voice(q, prints, 0.5, 0.08, exclude=frozenset({"B"}))
    assert single.voice_id == "A" and single.margin == 1.0
    assert match_voice(q, [], 0.5, 0.08) == match_voice(q, prints, 0.5, 0.08,
                                                       exclude=frozenset({"A", "B"}))
    assert match_voice(q, [], 0.5, 0.08).similarity == -1.0


def _ex(session: str, v: np.ndarray, seconds: float = 2.0) -> Exemplar:
    return Exemplar(session_id=session, embedding=v, seconds=seconds)


def test_add_exemplar_rejects_outlier_and_respects_cap() -> None:
    a, b = _dirs(2, seed=19)
    cfg = VoiceConfig(exemplar_cap=3)
    vs = _noisy(a, 5, 20)
    vp = new_voiceprint("A", _ex("s0", vs[0]))
    assert vp.samples == 1 and len(vp.exemplars) == 1
    vp, ok = add_exemplar(vp, _ex("s1", vs[1]), cfg)
    assert ok
    rejected, ok = add_exemplar(vp, _ex("s9", b), cfg)
    assert not ok and rejected is vp
    for i in range(2, 5):
        vp, ok = add_exemplar(vp, _ex(f"s{i}", vs[i]), cfg)
        assert ok
    assert len(vp.exemplars) == 3 and vp.samples == 5
    assert [e.session_id for e in vp.exemplars] == ["s2", "s3", "s4"]
    assert cosine(vp.centroid, a) > 0.95


def test_remove_session_is_idempotent() -> None:
    (a,) = _dirs(1, seed=21)
    vs = _noisy(a, 4, 22, sigma=0.05)
    vp = new_voiceprint("A", _ex("s0", vs[0]))
    for i in (1, 2):
        vp, _ = add_exemplar(vp, _ex(f"s{i}", vs[i]), CFG)
    before = vp
    after, ok = add_exemplar(before, _ex("s3", vs[3]), CFG)
    assert ok
    back = remove_session(after, "s3", CFG)
    assert back is not None
    np.testing.assert_allclose(back.centroid, before.centroid, atol=1e-5)
    assert back.samples == before.samples
    assert remove_session(back, "nope", CFG) is back
    solo = new_voiceprint("B", _ex("x", a))
    assert remove_session(solo, "x", CFG) is None


def test_merge_prints() -> None:
    a, b = _dirs(2, seed=23)
    va, vb = _noisy(a, 2, 24), _noisy(a, 2, 25)
    p1 = new_voiceprint("A", _ex("s1", va[0]))
    p1, _ = add_exemplar(p1, _ex("s2", va[1]), CFG)
    p2 = new_voiceprint("B", _ex("s3", vb[0]))
    p2, _ = add_exemplar(p2, _ex("s4", vb[1]), CFG)
    merged = merge_prints(p1, p2, VoiceConfig(exemplar_cap=3))
    assert merged.voice_id == "A" and merged.samples == 4
    assert [e.session_id for e in merged.exemplars] == ["s2", "s3", "s4"]
    assert cosine(merged.centroid, a) > 0.95
    empty = merge_prints(Voiceprint("E", b, (), 2), Voiceprint("F", b, (), 3), CFG)
    assert empty.samples == 5


# ---------------------------------------------------------------- correction


def test_correct_relabels_whole_turn_keeping_fields() -> None:
    turns = [_turn("t1", "me", 0.0, 2.0, "hello there friend")]
    words = [_w("hello", 0.0, 0.5), _w("there", 0.6, 1.0), _w("friend", 1.1, 2.0)]
    res = correct_turns(turns, words, ["other", None, "other"], {}, DEFAULT_FILLERS)
    assert (res.relabelled, res.split, res.unchanged) == (1, 0, 0)
    (t,) = res.turns
    assert t.speaker == "other" and t.turn_id == "t1" and t.wpm == 100.0
    assert t.text == "hello there friend" and t.fillers == ["um"]
    assert turns[0].speaker == "me"  # input untouched


def test_correct_splits_turn_with_two_voices() -> None:
    turns = [_turn("t1", "me", 0.0, 6.0)]
    words = [_w("um", 0.0, 0.5), _w("I", 0.6, 1.0), _w("think", 1.1, 1.5),
             _w("yes", 3.0, 3.5), _w("you", 3.6, 4.0), _w("know", 4.1, 4.5)]
    roles = [None, "me", "me", "other", None, "other"]
    res = correct_turns(turns, words, roles, {}, DEFAULT_FILLERS)
    assert (res.relabelled, res.split, res.unchanged) == (0, 1, 0)
    first, second = res.turns
    assert (first.turn_id, first.speaker, first.text) == ("t1.1", "me", "um I think")
    assert (first.start, first.end) == (0.0, 1.5)
    assert first.wpm == round(3 / (1.5 / 60), 1) and first.fillers == ["um"]
    assert (second.turn_id, second.speaker, second.text) == ("t1.2", "other", "yes you know")
    assert second.fillers == ["you know"]


def test_correct_merges_flicker_run() -> None:
    turns = [_turn("t1", "me", 0.0, 4.0)]
    words = [_w("a", 0.0, 0.5), _w("b", 0.6, 1.0), _w("c", 1.1, 1.3), _w("d", 1.4, 2.0),
             _w("e", 2.1, 2.5)]
    res = correct_turns(turns, words, ["me", "me", "other", "me", "me"], {}, DEFAULT_FILLERS)
    assert (res.relabelled, res.split, res.unchanged) == (0, 0, 1)
    assert res.turns[0].turn_id == "t1"
    lead = correct_turns(turns, words, ["other", "me", "me", "me", "me"], {}, DEFAULT_FILLERS)
    assert lead.unchanged == 1 and lead.turns[0].speaker == "me"


def test_correct_no_words_uses_turn_roles_and_sorts() -> None:
    turns = [_turn("t2", "me", 5.0, 6.0), _turn("t1", "me", 0.0, 1.0),
             _turn("t3", "other", 8.0, 9.0)]
    words = [_w("late", 8.2, 8.5)]
    res = correct_turns(turns, words, [None], {"t2": "other", "t1": "me"}, DEFAULT_FILLERS)
    assert [t.turn_id for t in res.turns] == ["t1", "t2", "t3"]
    assert [t.speaker for t in res.turns] == ["me", "other", "other"]
    assert (res.relabelled, res.split, res.unchanged) == (1, 0, 2)


def test_correct_word_goes_to_first_turn_only_and_zero_duration_piece() -> None:
    turns = [_turn("t1", "me", 0.0, 1.0), _turn("t2", "me", 1.0, 3.0)]
    words = [_w("x", 0.98, 1.0), _w("p", 1.2, 1.2), _w("q", 1.3, 1.3),
             _w("r", 2.0, 2.0), _w("s", 2.1, 2.1)]
    roles = ["other", "me", "me", "other", "other"]
    res = correct_turns(turns, words, roles, {}, [])
    assert res.turns[0].turn_id == "t1" and res.turns[0].speaker == "other"
    pieces = [t for t in res.turns if t.turn_id.startswith("t2.")]
    assert [p.text for p in pieces] == ["p q", "r s"]
    assert res.split == 1 and res.relabelled == 1
    with pytest.raises(ValueError):
        correct_turns(turns, words, [None], {}, [])


def test_correct_zero_duration_wpm() -> None:
    turns = [_turn("t1", "me", 0.0, 3.0)]
    words = [_w("a", 0.0, 0.0), _w("b", 0.0, 0.0), _w("c", 2.0, 2.0), _w("d", 2.0, 2.0)]
    res = correct_turns(turns, words, ["me", "me", "other", "other"], {}, [])
    assert [t.wpm for t in res.turns] == [0.0, 0.0]
