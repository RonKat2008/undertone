from backend.stt.fillers import find_fillers
from backend.stt.turns import (BaselinePace, FluxTurnAssembler, NovaTurnAssembler, RollingPace, SpeakerMapper, Word,
                               WordDeduper, partial_event, words_from_result)


def W(text, s, e, lab):
    return Word(text, s, e, lab)


def test_fillers_multiword_first():
    assert find_fillers("um so you know I mean it's basically fine".split()) == ["um", "you know", "i mean", "basically"]
    assert find_fillers(["Um,", "uh."]) == ["um", "uh"]
    assert find_fillers("I like pizza".split()) == []


def test_words_from_result_dict_and_dedupe():
    res = {"start": 2.0, "channel": {"alternatives": [{"words": [
        {"word": "hi", "punctuated_word": "Hi,", "start": 2.0, "end": 2.2, "speaker": 0},
        {"word": "there", "start": 2.3, "end": 2.6, "speaker": 0}]}]}}
    rs, ws = words_from_result(res)
    assert rs == 2.0 and [w.text for w in ws] == ["Hi,", "there"]
    d = WordDeduper()
    assert len(d.new(rs, ws)) == 2
    assert d.new(rs, ws) == []  # second frame of the same result


def test_first_speaker_is_me_and_swap():
    m = SpeakerMapper()
    assert m.speaker(1) == "me" and m.speaker(0) == "other"
    m.swap()
    assert m.speaker(0) == "me" and m.speaker(1) == "other"


def test_loudness_swap():
    m = SpeakerMapper()
    m.speaker(0); m.speaker(1)
    for _ in range(12):
        m.note_loudness(0, -40)
        m.note_loudness(1, -25)
    assert m.maybe_swap_by_loudness() is True
    assert m.speaker(1) == "me"
    assert m.maybe_swap_by_loudness() is False  # only once


def test_nova_turns_by_speaker_gap_and_flush():
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append)
    a.add([W("So", 0.0, 0.2, 0), W("um", 0.3, 0.5, 0), W("hello", 0.6, 1.0, 0),
           W("Hey", 1.2, 1.4, 1), W("there?", 1.5, 1.9, 1)])
    assert len(out) == 1 and out[0]["speaker"] == "me" and out[0]["fillers"] == ["um"]
    a.add([W("Long", 5.0, 5.3, 1)])  # same label but 3 s gap -> new turn
    assert len(out) == 2 and out[1]["speaker"] == "other" and out[1]["text"] == "Hey there?"
    a.tick(5.4)
    assert len(out) == 2
    a.tick(7.0)
    assert len(out) == 2  # 1.7 s of quiet: within flush_s (3.0 s)
    a.tick(8.5)
    assert len(out) == 3 and out[2]["text"] == "Long"
    ev = out[0]
    assert set(ev) == {"type", "turn_id", "speaker", "text", "start", "end", "wpm", "fillers"}
    assert ev["type"] == "turn.final" and ev["turn_id"] == "t1"


def test_flux_windows_majority_and_alignment():
    out = []
    f = FluxTurnAssembler(SpeakerMapper(), out.append)
    f.add([W("a", 0.0, 0.4, 0), W("b", 0.5, 0.9, 0), W("c", 0.95, 1.1, 1)])
    f.end_of_turn(0.0, 1.0)  # c ends at 1.1 inside slack, label 0 dominates
    assert out == []         # not settled yet: Nova's last finals may still be on the way
    f.tick(3.6)              # settle_s after the window
    assert len(out) == 1 and out[0]["speaker"] == "me" and out[0]["text"] == "a b c"
    for i in range(5):
        f.add([W("x", 10 + 2 * i, 10.2 + 2 * i, 1)])
        f.end_of_turn(10 + 2 * i, 10.6 + 2 * i)  # real Flux: the window ends in the silence after
    f.tick(30)
    assert len(out) == 6 and not f.misaligned
    g = FluxTurnAssembler(SpeakerMapper(), lambda e: None)
    for i in range(5):
        g.add([W("x", 10 + 2 * i, 10.9 + 2 * i, 0)])
        g.end_of_turn(10 + 2 * i, 10.4 + 2 * i)  # Nova's word runs 0.5 s past Flux's end
    g.tick(30)
    assert g.misaligned


def test_flux_leftovers():
    out = []
    f = FluxTurnAssembler(SpeakerMapper(), out.append)
    f.add([W("lost", 0.0, 0.5, 0), W("words", 0.6, 1.0, 0)])
    f.tick(6.0)
    assert out == []  # Flux may still close a long turn: no early expiry
    f.tick(21.5)      # orphan_s without any window
    assert len(out) == 1 and out[0]["text"] == "lost words"


def test_pace_and_baseline():
    p = RollingPace()
    ws = [W("w", i * 0.4, i * 0.4 + 0.3, 0) for i in range(30)]  # 30 words in 12 s ~ 150 wpm
    p.add(ws)
    v = p.wpm(12.0)
    assert 140 < v < 160
    assert p.wpm(40.0) is None  # nothing in the window
    b = BaselinePace(seconds=10)
    assert b.add(ws) is not None


def test_partial_speaker():
    m = SpeakerMapper()
    assert partial_event(m, [W("hi", 0, 0.2, 0)], "hi")["speaker"] is None  # nobody mapped yet
    m.speaker(0)
    assert partial_event(m, [W("hi", 0, 0.2, 0)], "hi") == {"type": "transcript.partial", "speaker": "me", "text": "hi"}


def test_overlap_gives_two_turns_not_fragments():
    """The other person is still talking when the wearer cuts in: two overlapping turns."""
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append)
    a.add([W("So", 0.0, 0.3, 0), W("what", 0.4, 0.7, 0), W("is", 0.8, 1.0, 0), W("it", 1.1, 1.3, 0)])
    ws = []
    for i in range(6):  # interleaved for 1.5 s
        ws.append(W("me%d" % i, 1.2 + i * 0.25, 1.3 + i * 0.25, 1))
        if i < 4:
            ws.append(W("them%d" % i, 1.3 + i * 0.25, 1.45 + i * 0.25, 0))
    ws += [W("and", 3.0, 3.2, 1), W("so", 3.3, 3.5, 1), W("on", 3.6, 3.9, 1)]
    a.add(ws)
    a.flush()
    assert len(out) == 2, [(t["speaker"], t["text"]) for t in out]
    first, second = sorted(out, key=lambda t: t["start"])
    assert second["start"] < first["end"]  # overlap = an interruption downstream


def test_backchannel_does_not_end_turn():
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append)
    a.add([W("I", 0.0, 0.2, 0), W("think", 0.3, 0.6, 0), W("yeah", 0.65, 0.85, 1),
           W("we", 0.9, 1.1, 0), W("should", 1.2, 1.5, 0)])
    a.flush()
    me = [t for t in out if t["speaker"] == "me"]
    assert len(me) == 1 and me[0]["text"] == "I think we should"
