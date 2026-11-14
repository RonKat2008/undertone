"""Regression tests for defects found by pushing real audio through the pipeline
(scripts/eval_audio.py). No network."""
import inspect

from backend.stt.pipeline import split_connect_kwargs


def test_undeclared_deepgram_params_go_to_the_url_not_connect():
    """filler_words in Settings.extra made the SDK's connect() raise TypeError on every
    attempt: Deepgram never connected and sessions ran with no speech at all."""
    kw = {"model": "nova-3", "diarize": "true", "filler_words": "true"}
    out = split_connect_kwargs(kw, ["model", "diarize", "request_options"])
    assert out["model"] == "nova-3" and out["diarize"] == "true" and "filler_words" not in out
    assert out["request_options"]["additional_query_parameters"] == {"filler_words": "true"}
    assert split_connect_kwargs({"model": "x"}, ["model"]) == {"model": "x"}


def test_real_service_connect_kwargs_fit_the_sdk():
    """The Nova service as Hearing builds it produces kwargs the installed SDK accepts,
    with filler_words and mip_opt_out still sent."""
    from deepgram.listen.v1.client import AsyncV1Client
    from pipecat.services.deepgram.stt import DeepgramSTTService

    from backend.stt.pipeline import _nova_service_class

    svc = _nova_service_class()(api_key="test", sample_rate=16000, mip_opt_out=True,
                                settings=DeepgramSTTService.Settings(model="nova-3", diarize=True,
                                                                     extra={"filler_words": True}))
    kw = svc._build_connect_kwargs()
    accepted = set(inspect.signature(AsyncV1Client.connect).parameters) - {"self"}
    assert set(kw) <= accepted
    assert kw["mip_opt_out"] == "true"
    assert kw["request_options"]["additional_query_parameters"]["filler_words"] == "true"


# ---------- turns stay whole while a final is still on its way ----------

from backend.stt.turns import NovaTurnAssembler, SpeakerMapper, Word  # noqa: E402


def W(t, s, e, label=0):
    return Word(t, s, e, label)


def test_turn_not_flushed_while_interim_words_are_pending():
    """Real Deepgram: the final for "Our client ..." arrived >1.5 s after "Here's the case."
    ended, so the flush closed the turn mid-speech: 9 scripted turns came out as 30."""
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append)
    a.add([W("Here's", 0.5, 0.8), W("the", 0.8, 0.9), W("case.", 0.9, 1.3)])
    a.heard(2.4)            # interim: "Our client is a" ... still talking
    a.tick(4.5)             # 3.2 s after the last final word, but a final is pending
    assert out == []
    a.add([W("Our", 1.7, 1.9), W("client", 1.9, 2.3), W("is", 2.3, 2.4), W("fine.", 2.4, 4.9)])
    a.tick(7.5)
    assert out == []
    a.tick(8.0)
    assert len(out) == 1 and out[0]["text"] == "Here's the case. Our client is fine."


def test_pending_final_that_never_comes_does_not_hold_the_turn_forever():
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append, pending_max_s=4.0)
    a.add([W("Hi.", 0.0, 0.4)])
    a.heard(1.0)            # interim words whose final never arrives
    a.tick(4.0)
    assert out == []
    a.tick(5.1)
    assert len(out) == 1


def test_label_change_still_closes_at_once():
    out = []
    a = NovaTurnAssembler(SpeakerMapper(), out.append)
    a.add([W("Hello", 0.0, 0.4, 0)])
    a.heard(3.0)
    a.add([W("Hey", 1.0, 1.3, 1)])
    assert len(out) == 1 and out[0]["text"] == "Hello"


# ---------- loudness check lands before the second speaker's first turn ----------

def test_loudness_swap_after_four_words_each():
    """With 10 words needed, the swap came at 27 s in a real run: the wearer's first
    turns were already out as "other"."""
    m = SpeakerMapper()
    m.speaker(0)
    m.speaker(1)
    for _ in range(4):
        m.note_loudness(0, -32)  # the person across the table, heard first
        m.note_loudness(1, -21)  # the wearer
    assert m.maybe_swap_by_loudness() is True
    assert m.speaker(1) == "me" and m.speaker(0) == "other"


def test_no_swap_verdict_waits_for_ten_words():
    m = SpeakerMapper()
    m.speaker(0)
    m.speaker(1)
    for _ in range(4):
        m.note_loudness(0, -25)
        m.note_loudness(1, -27)
    assert m.maybe_swap_by_loudness() is False and m.swapped_by_loudness is False  # still open
    for _ in range(8):
        m.note_loudness(0, -35)  # more evidence: label 0 is the quiet one after all
        m.note_loudness(1, -22)
    assert m.maybe_swap_by_loudness() is True
    m2 = SpeakerMapper()
    m2.speaker(0)
    m2.speaker(1)
    for _ in range(10):
        m2.note_loudness(0, -25)
        m2.note_loudness(1, -26)
    assert m2.maybe_swap_by_loudness() is False and m2.swapped_by_loudness is True  # settled


# ---------- the opening turn waits for the speaker check ----------

def _hearing_like(a, m, words):
    """What Hearing._on_nova does per final: loudness, maybe swap, then the assembler."""
    for w, db in words:
        m.note_loudness(w.label, db)
    m.maybe_swap_by_loudness()
    a.add([w for w, _ in words])
    for w, _ in words:
        m.speaker(w.label)


def test_opening_turn_by_the_other_person_goes_out_as_other():
    """The scripted interview opens with the interviewer. "First label heard = wearer" sent
    that turn out as "me" before the loudness check could correct it."""
    out = []
    m = SpeakerMapper()
    a = NovaTurnAssembler(m, out.append, hold_s=15.0)
    _hearing_like(a, m, [(W("Here's", 0.5, 0.8, 0), -31), (W("the", 0.8, 0.9, 0), -32),
                         (W("case.", 0.9, 1.3, 0), -30), (W("Okay?", 1.4, 1.8, 0), -31)])
    _hearing_like(a, m, [(W("Um,", 2.4, 2.6, 1), -20), (W("okay.", 2.7, 3.0, 1), -21),
                         (W("Is", 3.1, 3.2, 1), -20), (W("that", 3.2, 3.4, 1), -21)])
    assert out == []                       # held: the check needs the second label first
    _hearing_like(a, m, [(W("drop", 3.5, 3.8, 1), -20)])
    assert [e["speaker"] for e in out] == ["other"] and out[0]["text"] == "Here's the case. Okay?"
    a.flush()
    assert [e["speaker"] for e in out] == ["other", "me"] and [e["turn_id"] for e in out] == ["t1", "t2"]


def test_opening_hold_times_out_and_never_comes_back():
    out = []
    m = SpeakerMapper()
    a = NovaTurnAssembler(m, out.append, hold_s=15.0)
    a.add([W("Practising", 0.0, 1.0, 0)])
    a.tick(5.0)
    assert out == []
    a.tick(16.5)
    assert len(out) == 1 and out[0]["speaker"] == "me"
    a.add([W("again", 20.0, 20.5, 0)])
    a.tick(24.0)
    assert len(out) == 2                   # after the first release nothing is held


def test_no_hold_by_default_or_in_demo_mode():
    out = []
    a = NovaTurnAssembler(SpeakerMapper(single_speaker=True), out.append, hold_s=15.0)
    a.add([W("Hi", 0.0, 0.3, 0)])
    a.tick(4.0)
    assert len(out) == 1


# ---------- Flux (USE_FLUX=true) ----------

from backend.stt.turns import FluxTurnAssembler  # noqa: E402


def test_flux_long_turn_is_one_turn_not_one_per_word():
    """Real run: Flux's EndOfTurn for a 10 s opening turn came after the old 4 s leftover
    expiry, which emitted every word on its own as it aged: 145 turns for 9."""
    out = []
    f = FluxTurnAssembler(SpeakerMapper(), out.append)
    t = 0.5
    for i in range(20):  # 20 words over ~10 s, finals arriving as speech goes on
        f.add([W("w%d" % i, t, t + 0.3)])
        f.tick(t + 1.0)
        t += 0.5
    assert out == []
    f.end_of_turn(0.0, 10.56)
    f.add([W("Okay.", 11.13, 11.53, 1)])  # the next speaker: the window is settled
    assert len(out) == 1 and len(out[0]["text"].split()) == 20


def test_flux_waits_for_a_late_nova_final():
    out = []
    f = FluxTurnAssembler(SpeakerMapper(), out.append)
    f.add([W("Here's", 0.5, 0.8), W("the", 0.8, 0.9)])
    f.end_of_turn(0.0, 1.8)
    f.tick(2.5)
    f.add([W("case.", 0.9, 1.3)])  # Nova's last final for the window arrives after EndOfTurn
    f.tick(4.5)
    assert len(out) == 1 and out[0]["text"] == "Here's the case."


def test_flux_hand_over_keeps_words_and_numbering():
    """Giving up on Flux used to drop the words it still held and restart ids at t1."""
    from backend.stt.pipeline import Hearing
    import asyncio
    events = []
    h = Hearing(asyncio.Queue(), SpeakerMapper(), events.append, use_flux=True)
    h.flux_turns.offsets = [1.0] * 5  # clocks disagree
    h.flux_turns._n = 3
    h.flux_turns._buf = [W("still", 50.0, 50.4), W("here", 50.5, 50.9)]
    assert h._flux_on() is False
    h.nova_turns.flush()
    assert events and events[-1]["text"] == "still here" and events[-1]["turn_id"] == "t4"


def test_vocabulary_matches_the_model():
    """keyterm prompting is Nova-3 only; NOVA_MODEL=nova-2 needs keywords instead."""
    from backend.stt.pipeline import vocabulary_settings
    assert vocabulary_settings("nova-3", ["MECE", "unit economics"]) == {"keyterm": ["MECE", "unit economics"]}
    assert vocabulary_settings("nova-2", ["MECE", "unit economics"]) == {"keywords": ["MECE", "unit", "economics"]}
    assert vocabulary_settings("nova-3", []) == {}
