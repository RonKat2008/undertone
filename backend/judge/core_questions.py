"""The ten Core Coach questions (plan.md 4.3). Always on; coaches add their own.

Each is a CoachQuestion. `CoachQuestion.model_dump()` is already in the shape the
Gemini Decisions API accepts ({"type", "instructions", "criteria"?}).

The judge input (see judge.format_input) labels the parts:
  OTHER PERSON (previous turn): ... | none — the wearer is speaking first
  WEARER (turn being judged): ...
  TIMING: the wearer started X s before / immediately as / X s after the other person finished
  MOTION: ...

Score answers go on the wire 1-BASED (1..len(criteria)); see judge/decisions.py.
"""

from __future__ import annotations

from backend.contracts import ChoiceQuestion, CoachQuestion, NoulQuestion, ScoreQuestion

_SCOPE = "Judge only the WEARER's turn. "

CORE_QUESTIONS: dict[str, CoachQuestion] = {
    "interrupted": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer interrupt the other person, i.e. start talking before the other person "
        "had finished their thought? True if the TIMING line says the wearer started before the "
        "other person finished, or the other person's turn is visibly cut off mid-sentence (ends "
        "with a dash or an unfinished clause) and the wearer took over, including finishing the "
        "other person's sentence for them. A cut-off turn counts even when TIMING shows a short "
        "gap (the transcript timing is approximate). Starting immediately as they stopped is a "
        "weaker sign on its own. "
        "False if the other person had clearly finished their thought, if there is no previous "
        "turn, or if the wearer only gave a brief backchannel like 'mm-hm'."
    ),
    "asked_question": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer ask the other person at least one question that invites them to respond "
        "or confirm? Leading and tag questions that push for agreement ('You're going to take it, "
        "right?', '..., don't we?') DO count. Rhetorical questions the wearer immediately answers "
        "themselves, filler tags like 'you know?', and uptalk on a hedged statement do not count."
    ),
    "question_type": ChoiceQuestion(
        instructions=_SCOPE
        + "Classify the most important question the wearer asked the other person in this turn.",
        criteria={
            "open": "Invites an explanation or story, usually how / what / why / tell me "
            "(e.g. 'How does the client define success here?').",
            "closed": "Can be answered with yes / no or a single fact "
            "(e.g. 'Is the data annual?').",
            "leading": "Pushes the other person toward the answer the wearer wants "
            "(e.g. 'Don't you think costs are the real issue?').",
            "none": "The wearer asked no genuine question in this turn.",
        },
    ),
    "answered_the_question": NoulQuestion(
        instructions=_SCOPE
        + "If the other person's previous turn asked the wearer a question or made a request, did "
        "the wearer's turn actually answer it (even briefly or partially)? False if the wearer "
        "deflects, changes the subject, or only makes false starts and restarts without ever "
        "delivering an answer. If the other person asked nothing, or there is no previous turn, "
        "answer true."
    ),
    "hedging": NoulQuestion(
        instructions=_SCOPE
        + "Does the wearer noticeably hedge, undercutting their own point with qualifiers such as "
        "'I think maybe', 'I'm not sure but', 'kind of', 'sort of', 'possibly', 'I guess', 'might', "
        "noncommittal vagueness ('at some point', 'maybe', 'whenever'), or apologising for their "
        "idea? One mild, appropriate qualifier is not hedging; repeated or stacked qualifiers are. "
        "Fillers like 'um' are not hedges, and a definite answer is not hedged."
    ),
    "rambling": NoulQuestion(
        instructions=_SCOPE
        + "Is the wearer's turn rambling: long, repetitive, or wandering, with the main point "
        "buried or never stated, so it could be said in far fewer words? A long turn that stays "
        "structured and on point is not rambling."
    ),
    "acknowledged": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer acknowledge what the other person just said before moving on: reacting "
        "to it ('that sounds hard', 'fair point', 'welcome back'), paraphrasing it, thanking them "
        "for it, or signalling they heard it ('mm-hm, right') and then following up on that same "
        "topic? A bare 'okay' or 'yeah' followed by a change of subject does not count."
    ),
    "tone": ChoiceQuestion(
        instructions=_SCOPE
        + "Which single word best describes how the wearer comes across in this turn, judged from "
        "the words they chose (and the MOTION line if relevant)?",
        criteria={
            "confident": "Clear, direct, owns their point without over-qualifying.",
            "nervous": "Many fillers, hedges, restarts or apologies; sounds unsure.",
            "defensive": "Justifies themselves, pushes back on or deflects the other person.",
            "warm": "Friendly and engaged with the other person, shows interest or appreciation.",
            "flat": "Disengaged, minimal, or monotone; little energy or interest.",
        },
    ),
    "clarity": ScoreQuestion(
        instructions=_SCOPE
        + "How clear and easy to follow is the wearer's turn? Judge structure and directness, not "
        "whether the content is correct.",
        criteria=[
            "1 - Very unclear: no discernible point, hard to follow at all.",
            "2 - Unclear: a point exists but is buried in filler, restarts or tangents.",
            "3 - Mixed: the main point comes through but with noticeable wandering or filler.",
            "4 - Clear: a clear point with a mostly logical order and little filler.",
            "5 - Very clear: concise, well structured, the point is stated up front.",
        ],
    ),
    "commitment_made": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer commit to a specific action with a time or an owner, e.g. 'I'll send the "
        "deck tonight' or 'I'll email Priya in legal tomorrow'? False for vague or conditional "
        "intentions ('we should catch up sometime', 'I'll try to read it when I can', 'I might "
        "look at some point') and for things done within the conversation itself."
    ),
}

CORE_QUESTION_IDS: tuple[str, ...] = tuple(CORE_QUESTIONS)
