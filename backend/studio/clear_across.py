"""Optional first-language hint for the Clear Across coach.

Never inferred: the wearer chooses a family (or none). The hint only appends one or two extra
examples to the judge instructions of `word_misfit`, `time_or_who_unclear` and `directness_fit`,
so the judge knows which patterns are likely for this wearer. Rules, policy and rubric are untouched.

    with_first_language(spec, family) -> CoachSpec   # pure; returns a new spec, never mutates
"""

from __future__ import annotations

from typing import Literal, get_args

from backend.contracts import CoachSpec

FirstLanguageFamily = Literal[
    "romance", "sinitic", "japanese_korean", "slavic", "south_asian", "arabic", "germanic",
]
FIRST_LANGUAGE_FAMILIES: tuple[str, ...] = get_args(FirstLanguageFamily)

_PREFIX = " Likely for this wearer (first language family chosen by them): "

_HINTS: dict[str, dict[str, str]] = {
    "romance": {
        "word_misfit": "false friends such as 'eventually' for 'possibly', 'actually' for 'currently', "
                       "'assist' for 'attend', 'sensible' for 'sensitive', 'pretend' for 'intend'.",
        "time_or_who_unclear": "a dropped subject ('Is very busy this week') where the listener cannot "
                               "tell who is meant.",
    },
    "sinitic": {
        "time_or_who_unclear": "a past or future event told with no time word and a present verb "
                               "('I call the client and they say no'), so the listener cannot tell "
                               "whether it already happened; 'he' and 'she' swapped for the same person.",
    },
    "japanese_korean": {
        "directness_fit": "repeated apologies or 'sorry, but...' before a simple request or a "
                          "disagreement count toward the over-apologetic end.",
        "word_misfit": "a borrowed English-looking word used with its home meaning, such as 'mansion' "
                       "for 'apartment' or 'claim' for 'complaint'.",
    },
    "slavic": {
        "directness_fit": "bare imperatives for requests ('Send me the file.', 'Explain again.') can land "
                          "blunter than intended and count toward the blunt end.",
        "time_or_who_unclear": "'it' or 'they' with no clear person when the subject is left out.",
    },
    "south_asian": {
        "word_misfit": "phrases that many listeners outside South Asia do not know, such as 'prepone' "
                       "(move earlier), 'revert' meaning 'reply', or 'out of station' meaning 'away'.",
        "time_or_who_unclear": "an ongoing state in a progressive form ('I am knowing him since college') "
                               "where it is unclear whether it is still true.",
    },
    "arabic": {
        "time_or_who_unclear": "a present form for something that started in the past ('I work here "
                               "since 2019'), or 'he' and 'she' swapped for the same person.",
    },
    "germanic": {
        "word_misfit": "false friends such as 'become' for 'get' ('I became the parcel'), 'eventually' "
                       "for 'possibly', 'actual' for 'current', 'handy' for 'mobile phone'.",
        "directness_fit": "a plain 'No, that is wrong' or 'You must...' can land blunter than intended "
                          "and counts toward the blunt end.",
    },
}


def with_first_language(spec: CoachSpec, family: str | None) -> CoachSpec:
    """A copy of `spec` with the family's extra examples appended to the matching questions.

    `None` returns an equal copy. Questions the coach does not define are skipped, so any coach is
    safe to pass. Raises ValueError for an unknown family.
    """
    if family is None:
        return spec.model_copy(deep=True)
    hints = _HINTS.get(family)
    if hints is None:
        raise ValueError(f"unknown first_language_family {family!r}; use one of {list(FIRST_LANGUAGE_FAMILIES)}")
    questions = {
        qid: (q.model_copy(update={"instructions": q.instructions + _PREFIX + hints[qid]})
              if qid in hints else q.model_copy(deep=True))
        for qid, q in spec.questions.items()
    }
    return spec.model_copy(deep=True, update={"questions": questions})
