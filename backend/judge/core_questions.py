"""The ten Core Coach questions (plan.md 4.3). Always on; coaches add their own.

Each is a CoachQuestion. `CoachQuestion.model_dump()` is already in the shape the
Gemini Decisions API accepts ({"type", "instructions", "criteria"?}).

The judge input (see judge.format_input) labels the parts:
  OTHER PERSON (previous turn): ...
  WEARER (turn being judged, start-end s): ...
  OVERLAP: the wearer started X s before the other person finished | none
  MOTION: ...
"""

from __future__ import annotations

from backend.contracts import ChoiceQuestion, CoachQuestion, NoulQuestion, ScoreQuestion

_SCOPE = "Judge only the WEARER's turn. "

CORE_QUESTIONS: dict[str, CoachQuestion] = {
    "interrupted": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer interrupt the other person, i.e. start talking before the other person "
        "had finished their thought? True if the OVERLAP line shows the wearer started before the "
        "other person's turn ended, or the other person's turn is visibly cut off mid-sentence "
        "(ends with a dash or an unfinished clause) and the wearer took over. False if the other "
        "person had clearly finished, or the wearer only gave a brief backchannel like 'mm-hm'."
    ),
    "asked_question": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer ask the other person at least one genuine question that invites them to "
        "respond? Rhetorical questions the wearer answers themselves, and tag questions like "
        "'right?' or 'you know?', do not count."
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
        + "If the other person's previous turn asked the wearer a question or gave them a task, did "
        "the wearer's turn directly address it (even partially and early in the turn)? If the other "
        "person asked nothing, answer true only if the wearer's turn is a relevant response to what "
        "they said."
    ),
    "hedging": NoulQuestion(
        instructions=_SCOPE
        + "Does the wearer noticeably hedge, undercutting their own point with qualifiers such as "
        "'I think maybe', 'I'm not sure but', 'kind of', 'sort of', 'possibly', 'I guess', or "
        "apologising for their idea? One mild, appropriate qualifier is not hedging; repeated or "
        "stacked qualifiers are."
    ),
    "rambling": NoulQuestion(
        instructions=_SCOPE
        + "Is the wearer's turn rambling: long, repetitive, or wandering, with the main point "
        "buried or never stated, so it could be said in far fewer words? A long turn that stays "
        "structured and on point is not rambling."
    ),
    "acknowledged": NoulQuestion(
        instructions=_SCOPE
        + "Did the wearer explicitly acknowledge what the other person just said before moving on, "
        "e.g. by referring back to it, paraphrasing it, or thanking them for a specific point? "
        "Generic filler like 'okay so' or 'yeah' alone does not count."
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
        + "Did the wearer make a concrete promise or commitment to do something after the "
        "conversation, e.g. 'I'll send you the deck tonight' or 'I will follow up with the numbers "
        "on Monday'? Vague intentions ('we should catch up sometime') and things done within the "
        "conversation itself do not count."
    ),
}

CORE_QUESTION_IDS: tuple[str, ...] = tuple(CORE_QUESTIONS)
