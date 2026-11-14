"""PRIVATE: what the LLM is asked for (language only, no numbers, no timeline).

`generate.py` asks Gemini for a `DebriefDraft`; `local.assemble` merges it with the locally
computed parts (numbers, timeline, bookmark ts/source/snippet) into a contract `Debrief`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class _Wire(BaseModel):
    model_config = ConfigDict(extra="ignore")


class BookmarkNote(_Wire):
    index: int = Field(description="0-based index of the bookmark in the list given in the prompt")
    what_happened: str
    follow_up: str | None = None


class BetterVersionDraft(_Wire):
    original: str = Field(description="The wearer's weakest answer, copied word for word from the transcript")
    rewritten: str


class DebriefDraft(_Wire):
    headline_fact: str
    strength: str
    one_fix: str
    if_then: str
    best_moment_quote: str = Field(description="One sentence copied word for word from a ME turn")
    vs_last_time: str | None = None
    notes: list[str] = Field(default_factory=list)
    bookmarks: list[BookmarkNote] = Field(default_factory=list)
    better_version: BetterVersionDraft | None = None


# Hard word limits checked in code (schema length limits are ignored by Gemini).
MAX_WORDS: dict[str, int] = {"headline_fact": 32, "strength": 28, "one_fix": 28, "if_then": 24}
