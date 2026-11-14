"""Pure topic near-duplicate rules and stable, incremental label -> canonical assignment.

Two labels are one topic when their *core* words (lower-case, singular, stopwords and generic
nouns such as "place", "issue", "habits" removed) are equal, when the shorter core is contained in
the longer one and includes its head noun (the last word: "roadmap" / "product roadmap",
"heating" / "broken heating"), or when the cores are near-identical strings.

Assignment is incremental: labels are processed in first-seen order and each joins the first
existing canonical it matches, else becomes a canonical itself. A canonical never moves, so a
topic keeps its id (`topic:<slug of canonical>`) as new conversations arrive.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from difflib import SequenceMatcher

NEAR_DUPLICATE = 0.88

STOPWORDS: frozenset[str] = frozenset("""
a about above after again against all almost also am an and any are aren around as at back be because
been before being below between both but by can cannot could couldn did didn do does doesn doing don done
down during each either else even ever every few for from further get gets getting go goes going gone got
had hadn has hasn have haven having he her here hers herself him himself his how however i if in into is
isn it its itself just keep kind least less let lets like likes liked lot lots made make makes making many
may maybe me might mine more most much must my myself need needs never next no nor not now of off often
okay ok on once one only or other others our ours ourselves out over own pretty probably quite rather
really right said same say says see seem seems she should shouldn since so some something sort still such
sure take tell than that the their theirs them themselves then there these they thing things think
thinking this those though through thought to too try trying under until up upon us very was wasn way we
well were weren what when where whether which while who whom whose why will with won would wouldn yeah yes
yet you your yours yourself yourselves um uh hmm mm basically actually literally anyway mean know
want wanted wants come came look looks looked looking feel felt give gave put sounds sound good great
fine bad big little new old first last long great tried trying talk talked talking ask asked tell told
start started finally again honestly already always last week weeks month day days today tomorrow
yesterday time times year years lot part bit stuff guess hear heard instead alive local whole
cut write read send run stop help move pick split wait waiting lead push shard happen happened use used
let's i'm i've i'll i'd you're you've we're we've they're it's that's there's what's don't didn't can't
won't isn't doesn't
""".split())

# Nouns too generic to be a topic on their own; ignored when comparing labels (singular forms).
GENERIC_NOUNS: frozenset[str] = frozenset("""
place spot shop venue issue problem trouble thing stuff habit plan idea situation topic subject matter
discussion conversation chat update question detail option
""".split())

WORD = re.compile(r"[a-z][a-z0-9'\-]*")


def singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("ches", "shes", "sses", "xes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is", "ics")):
        return word[:-1]
    return word


def content_words(label: str) -> tuple[str, ...]:
    """Singular, non-stopword words of a label."""
    return tuple(singular(w) for w in WORD.findall(label.lower()) if w not in STOPWORDS)


def core(label: str) -> tuple[str, ...]:
    """Content words minus generic nouns: what the label is actually about."""
    return tuple(w for w in content_words(label) if w not in GENERIC_NOUNS)


def is_weak(label: str) -> bool:
    """Nothing but stopwords and generic nouns ("place", "the issue", "plans")."""
    return not core(label)


def same_topic(a: str, b: str) -> bool:
    ca, cb = core(a), core(b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    short, long_ = sorted((ca, cb), key=len)
    if len(short) < len(long_) and set(short) <= set(long_) and long_[-1] in short:
        return True
    return SequenceMatcher(None, " ".join(ca), " ".join(cb)).ratio() >= NEAR_DUPLICATE


def assign(labels: Iterable[str], existing: Mapping[str, str]) -> dict[str, str]:
    """`existing` (label -> canonical) extended with every new, non-weak label in `labels`.
    Labels are taken in the order given (first seen first); existing entries never change."""
    mapping = dict(existing)
    canonicals = list(dict.fromkeys(mapping.values()))
    for label in labels:
        if label in mapping or is_weak(label):
            continue
        target = next((c for c in canonicals if same_topic(label, c)), None)
        if target is None:
            canonicals.append(label)
            target = label
        mapping[label] = target
    return mapping


def map_labels(labels: Iterable[str], mapping: Mapping[str, str]) -> tuple[str, ...]:
    """Canonical labels for one conversation, deduped, order kept. Labels missing from `mapping`
    are assigned on the fly (not stored); weak labels are dropped."""
    wanted = list(labels)
    full = assign(wanted, mapping) if any(w not in mapping for w in wanted) else mapping
    return tuple(dict.fromkeys(full[w] for w in wanted if w in full))
