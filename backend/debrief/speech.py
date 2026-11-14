"""Spoken debrief: number wording for TTS, the ~20 s recap script, and Deepgram Aura-2 TTS.

Never logs the API key or request headers.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from pathlib import Path

import httpx

from backend import config
from backend.config import load_settings
from backend.contracts import Debrief

logger = logging.getLogger(__name__)

TTS_URL = "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en"
TTS_TIMEOUT_S = 15.0
MAX_TTS_CHARS = 2000
TARGET_WORDS = 60
MAX_WORDS = 75  # about 25 s at the wearer-facing TTS pace; the prompt aims for ~60
MIN_TRIMMED_WORDS = 6
NEXT_TIME = "Next time:"
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

# ---------- numbers -> words ----------
_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_SCALES = ((1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand"))
_NUMBER_RE = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%))?(?![\w])")


def _under_thousand(n: int) -> str:
    parts: list[str] = []
    if n >= 100:
        parts.append(f"{_ONES[n // 100]} hundred")
        n %= 100
    if n >= 20:
        parts.append(_TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else ""))
    elif n > 0 or not parts:
        parts.append(_ONES[n])
    return " ".join(parts)


def _int_words(n: int) -> str:
    if n < 1000:
        return _under_thousand(n)
    parts: list[str] = []
    for value, name in _SCALES:
        if n >= value:
            parts.append(f"{_int_words(n // value)} {name}")
            n %= value
    if n:
        parts.append(_under_thousand(n))
    return " ".join(parts)


def _number_match(m: re.Match[str]) -> str:
    whole, frac, pct = m.group(1), m.group(2), m.group(3)
    words = _int_words(int(whole.replace(",", "")))
    if frac:
        words += " point " + " ".join(_ONES[int(d)] for d in frac)
    if pct:
        words += " percent"
    return words


def say_numbers(text: str) -> str:
    """Rewrite digits as words for speech: "68%" -> "sixty-eight percent", "7.5" -> "seven point five"."""
    return _NUMBER_RE.sub(_number_match, text)


# ---------- spoken recap ----------
_QUOTE_CHARS = re.compile(r"[\"“”„«»]|(?<![A-Za-z])[‘’]|[‘’](?![A-Za-z])")
_CLAUSE_END = (",", ";", ":", "—", "-")


def _first_sentence(text: str) -> str:
    """Text up to the first . ! ? followed by whitespace, ignoring ones inside double quotes."""
    in_quote = False
    for i, ch in enumerate(text):
        if ch in "\"“”":
            in_quote = not in_quote if ch == '"' else ch == "“"
        elif ch in ".!?" and not in_quote and i + 1 < len(text) and text[i + 1].isspace():
            return text[: i + 1]
    return text


def _clean(text: str) -> str:
    return " ".join(_QUOTE_CHARS.sub("", text).split())


def _end_sentence(text: str) -> str:
    text = text.rstrip(" ,;:—-")
    return text if text.endswith((".", "!", "?")) else text + "."


def _outside_quotes(prefix: str) -> bool:
    """True when every quote opened in `prefix` is closed, so a cut here keeps quotes whole."""
    return prefix.count('"') % 2 == 0 and prefix.count("“") <= prefix.count("”")


def _shorten(text: str, over: int) -> str | None:
    """Drop the last clause outside quotes (else `over` words, backing off to a point outside
    quotes). None if it cannot shrink."""
    words = text.split()
    if len(words) <= MIN_TRIMMED_WORDS:
        return None
    for k in range(len(words) - 1, MIN_TRIMMED_WORDS - 1, -1):
        prefix = " ".join(words[:k])
        if words[k - 1].endswith(_CLAUSE_END) and _outside_quotes(prefix):
            return _end_sentence(prefix)
    for k in range(max(len(words) - over, MIN_TRIMMED_WORDS), MIN_TRIMMED_WORDS - 1, -1):
        prefix = " ".join(words[:k])
        if _outside_quotes(prefix):
            return _end_sentence(prefix)
    return None


def _fit(parts: list[str], extra: int) -> list[str]:
    """Shorten headline/strength/fix (longest first; ties: strength, fix, headline) until under MAX_WORDS."""
    parts = list(parts)
    open_idx = [1, 2, 0]
    while open_idx and (over := _count(parts) + extra - MAX_WORDS) > 0:
        idx = max(open_idx, key=lambda i: len(parts[i].split()))
        shorter = _shorten(parts[idx], over)
        if shorter is None:
            open_idx.remove(idx)
        else:
            parts[idx] = shorter
    over = _count(parts) + extra - MAX_WORDS
    if over > 0:  # the if_then alone is too long: keep it, but cap it
        words = parts[3].split()
        parts[3] = _end_sentence(" ".join(words[: max(len(words) - over, MIN_TRIMMED_WORDS)]))
    return parts


def _if_then_line(if_then: str) -> str:
    first = if_then.split(" ", 1)[0]
    if first and first[0].isupper() and not first.startswith("I") and first[1:2].islower():
        if_then = first[0].lower() + if_then[1:]
    return if_then


def _count(parts: list[str]) -> int:
    return sum(len(p.split()) for p in parts)


def spoken_text(debrief: Debrief) -> str:
    """The ~20 s spoken recap: headline_fact -> strength -> one_fix -> if_then, 45-70 words."""
    raw = [debrief.headline_fact, debrief.strength, debrief.one_fix, debrief.if_then]
    full = [" ".join(say_numbers(p).split()) for p in raw]
    prefix_words = len(NEXT_TIME.split())
    parts = full
    if _count(parts) + prefix_words > TARGET_WORDS:
        parts = [_first_sentence(p) for p in full]
    parts = [_clean(p) for p in _fit(parts, prefix_words)]  # trim with quotes visible, then drop them
    headline, strength, fix, if_then = (_end_sentence(p) if p else p for p in parts)
    script = " ".join(p for p in (headline, strength, fix, f"{NEXT_TIME} {_if_then_line(if_then)}") if p)
    return _truncate(" ".join(script.split()), MAX_TTS_CHARS - 1)


# ---------- TTS ----------
def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    return (cut[:space] if space > 0 else cut).rstrip()


def _client() -> httpx.AsyncClient:
    """Factory for the TTS HTTP client (tests swap this to inject a MockTransport)."""
    return httpx.AsyncClient(timeout=TTS_TIMEOUT_S)


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.chmod(tmp, 0o644)  # mkstemp creates 0600; the /media static server must read it
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


async def _request_tts(text: str, key: str) -> bytes | None:
    headers = {"Authorization": f"Token {key}", "Content-Type": "application/json"}
    try:
        async with _client() as client:
            resp = await client.post(TTS_URL, headers=headers, json={"text": text})
    except httpx.TimeoutException:
        logger.warning("tts: request timed out")
        return None
    except httpx.HTTPError as exc:
        logger.warning("tts: network error (%s)", type(exc).__name__)
        return None
    if resp.status_code != 200:
        logger.warning("tts: HTTP %s from Deepgram", resp.status_code)
        return None
    if not resp.content:
        logger.warning("tts: empty audio body")
        return None
    return resp.content


async def speak(text: str, session_id: str) -> str | None:
    """Deepgram Aura-2 TTS -> MEDIA_DIR/{session_id}.mp3. Returns "/media/{id}.mp3" or None. Never raises."""
    try:
        if not _SESSION_ID_RE.match(session_id or ""):
            logger.warning("tts: invalid session_id, skipping")
            return None
        text = _truncate(" ".join((text or "").split()), MAX_TTS_CHARS)
        if not text:
            logger.warning("tts: empty text, skipping")
            return None
        key = load_settings().deepgram_api_key
        if not key:
            logger.warning("tts: DEEPGRAM_API_KEY missing, no audio")
            return None
        audio = await _request_tts(text, key)
        if audio is None:
            return None
        try:
            _write_atomic(Path(config.MEDIA_DIR) / f"{session_id}.mp3", audio)
        except OSError as exc:
            logger.warning("tts: could not write audio (%s)", type(exc).__name__)
            return None
        return f"/media/{session_id}.mp3"
    except Exception:  # never raise into the debrief pipeline
        logger.exception("tts: unexpected failure")
        return None
