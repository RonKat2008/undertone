"""Is Undertone actually listening? One truthful picture for GET /health, /band/diag and
/band/status, plus the two things that act on it: a once-per-transition warning and a
watchdog that re-arms a band mic that stopped sending audio.

    report = listening_report(ctl)                 # dict, JSON-ready, no secrets
    report["listening_ok"], report["listening_reason"]

Every value here is read from objects that already exist (BandSource, SessionController,
Hearing, AlwaysOn); nothing in this module talks to the network.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional, Tuple

log = logging.getLogger("undertone.listening")

AUDIO_STALE_S = 3.0        # chunks come every 80 ms: 3 s without one is a stall
STT_CONNECT_GRACE_S = 10.0  # a fresh Deepgram worker has this long to connect
VOICE_DB = -45.0            # louder than this over the last window = someone is talking
NO_WORDS_S = 10.0           # ... and no transcript for this long = speech-to-text is not hearing
JUDGE_FAIL_STREAK = 3
Clock = Callable[[], float]


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or default)
    except ValueError:
        return default


def _age(at: Optional[float], now: float) -> Optional[float]:
    return None if at is None else round(max(0.0, now - at), 1)


# ---------- speech-to-text state ----------

def stt_state(ctl: Any, now: float) -> dict:
    """connecting / up / reconnecting / down / off, with the last error class (never text)."""
    hearing = getattr(ctl, "hearing", None)
    mode = getattr(ctl, "stt", "off")
    started = getattr(ctl, "stt_started_at", None)
    heard = getattr(ctl, "last_heard_at", None)
    if hearing is not None and getattr(hearing, "last_transcript_at", None) is not None:
        heard = max(heard or 0.0, hearing.last_transcript_at)
    err = getattr(hearing, "last_error", None) if hearing is not None else getattr(ctl, "stt_error", None)
    err_at = getattr(hearing, "last_error_at", None) if hearing is not None else None
    if mode == "off":
        state = "off"
    elif hearing is None:
        state, err = "down", err or getattr(ctl, "stt_error", None) or "not started"
    elif not getattr(hearing, "running", True):
        state, err = "down", err or "worker stopped"
    elif getattr(hearing, "connected", True):
        state = "up"
    elif err is not None and (started is None or (err_at or 0) >= started):
        state = "reconnecting"
    else:
        state = "connecting"
    return {"mode": mode, "state": state, "last_error": err, "last_error_age_s": _age(err_at, now),
            "worker_age_s": _age(started, now), "last_transcript_age_s": _age(heard, now)}


# ---------- the whole picture ----------

def listening_report(ctl: Any, extra: Optional[dict] = None, clock: Clock = time.monotonic) -> dict:
    """GET /band/diag (and the `listening` block of /health). `extra` adds judge / phone data."""
    now = clock()
    band = ctl.band
    status = band.status_event()
    secs = float(getattr(band, "audio_seconds", 0.0) or 0.0)
    loud = getattr(band, "loudness", None)
    recent = loud.mean_db(max(0.0, secs - 5.0), secs) if (loud is not None and secs > 0) else None
    voice = loud.mean_db(max(0.0, secs - NO_WORDS_S), secs) if (loud is not None and secs > 0) else None
    chunk_age = _age(getattr(band, "last_chunk_at", None), now)
    gap = silent_for(band, now)
    quiet_s = None if gap is None else round(gap, 1)
    stt = stt_state(ctl, now)
    ao = getattr(ctl, "always_on", None)
    rec = getattr(ctl, "recorder", None)
    report = {
        "band_connected": bool(status.get("connected")),
        "transport": status.get("transport"),
        "battery_pct": status.get("battery_pct"),
        "mic_on": bool(getattr(band, "mic_on", False)),
        "audio_seconds": round(secs, 1),
        "audio_age_s": chunk_age,
        "audio_arriving": bool(status.get("connected")) and getattr(band, "mic_on", False)
        and quiet_s is not None and quiet_s < AUDIO_STALE_S,
        "chunks_received": getattr(band, "chunks_received", None),
        "recent_level_db": None if recent is None else round(recent, 1),
        "queued_chunks": band.pcm_q.qsize() if hasattr(band, "pcm_q") else None,
        "dropped_chunks": getattr(band, "dropped_chunks", 0),
        "decoder_ok": bool(getattr(band, "decoder_ok", True)),
        "stt": stt,
        "last_word_age_s": stt["last_transcript_age_s"],
        "conversation_id": getattr(ctl, "session_id", None),
        "always_on": {"enabled": True, **ao.describe()} if ao is not None else {"enabled": False},
        "recording": rec is not None and getattr(rec, "active_session", None) is not None,
        "recorder_attached": rec is not None and getattr(band, "chunk_tap", None) is not None,
        "audio_watchdog": getattr(getattr(ctl, "audio_watchdog", None), "describe", lambda: None)(),
        **(extra or {}),
    }
    reasons = problems(report, quiet_s, voice, expected=expected_listening(ctl))
    report["listening_ok"] = not reasons
    report["listening_reason"] = reasons[0][1] if reasons else None
    report["degraded"] = [r for _, r in reasons] + _service_problems(report, ctl)
    return report


def expected_listening(ctl: Any) -> bool:
    return getattr(ctl, "always_on", None) is not None or bool(getattr(ctl, "running", False))


def problems(r: dict, silent_for: Optional[float], voice_db: Optional[float],
             expected: bool = True) -> List[Tuple[str, str]]:
    """(key, human reason), most basic first. The key is stable (for transition logging)."""
    out: List[Tuple[str, str]] = []
    if not r["band_connected"]:
        return [("band", "Band is not connected")]
    if not r["mic_on"]:
        return [("mic", "Mic is off" if expected else "Mic is off (no session running)")]
    if not r["decoder_ok"]:
        out.append(("decoder", "Band audio cannot be decoded (install av); only silence is sent"))
    if silent_for is not None and silent_for >= AUDIO_STALE_S:
        out.append(("audio", "No audio from the band for %.0f s" % silent_for))
    stt = r["stt"]
    st, err = stt["state"], stt["last_error"]
    if st == "off":
        out.append(("stt", "Speech-to-text is off (STT=off)"))
    elif st == "down":
        out.append(("stt", "Speech-to-text is down: %s" % (err or "not running")))
    elif st == "reconnecting":
        out.append(("stt", "Speech-to-text is reconnecting: %s" % (err or "connection lost")))
    elif st == "connecting" and (stt["worker_age_s"] or 0) >= STT_CONNECT_GRACE_S:
        out.append(("stt", "Speech-to-text has not connected after %.0f s" % stt["worker_age_s"]))
    elif st == "up" and voice_db is not None and voice_db > VOICE_DB and silent_for is not None \
            and silent_for < AUDIO_STALE_S and (stt["last_transcript_age_s"] is None
                                                or stt["last_transcript_age_s"] >= NO_WORDS_S) \
            and (stt["worker_age_s"] or 0) >= NO_WORDS_S:
        out.append(("words", "Speech-to-text is not returning words (voice-level audio, no transcript "
                             "for %.0f s)" % NO_WORDS_S))
    return out


def _service_problems(r: dict, ctl: Any) -> List[str]:
    out = []
    streak = r.get("judge_fail_streak") or 0
    if r.get("judge") == "decisions" and streak >= JUDGE_FAIL_STREAK:
        out.append("Decisions judge failed %d turns in a row; using rules" % streak)
    if getattr(ctl, "running", False) and r.get("phones_connected") == 0:
        out.append("No phone connected: nudges have nowhere to buzz")
    return out


# ---------- acting on it ----------

@dataclass
class TransitionLog:
    """WARNING once when listening goes bad (or the cause changes), INFO when it recovers."""
    bad_key: Optional[str] = None
    since: Optional[float] = None

    def update(self, report: dict, expected: bool, now: float) -> None:
        reason = report["listening_reason"]
        key = None if report["listening_ok"] or not expected else _key(reason)
        if key == self.bad_key:
            return
        if key is None:
            log.info("listening: OK again (after %.0f s)", now - (self.since or now))
            self.bad_key, self.since = None, None
            return
        log.warning("listening: NOT OK: %s", reason)
        self.bad_key, self.since = key, self.since or now


def _key(reason: Optional[str]) -> str:
    if not reason:
        return "?"
    return reason.split(":")[0].split(" for ")[0].split(" after ")[0]


@dataclass
class AudioWatchdog:
    """Band connected, mic on, no chunks for `stall_s`: re-arm the mic, at most `max_retries`
    times per stall, `stall_s` apart. Reset when audio flows again."""
    stall_s: float = field(default_factory=lambda: _env_float("AUDIO_STALL_S", 8.0))
    max_retries: int = 3
    retries: int = 0
    gave_up: bool = False
    _next: float = 0.0
    total_rearms: int = 0

    def due(self, connected: bool, mic_on: bool, silent_for: Optional[float], now: float) -> bool:
        if not connected or not mic_on or silent_for is None or silent_for < self.stall_s:
            if silent_for is not None and silent_for < AUDIO_STALE_S:
                self.retries, self.gave_up, self._next = 0, False, 0.0
            return False
        if self.retries >= self.max_retries or now < self._next:
            if self.retries >= self.max_retries and not self.gave_up:
                self.gave_up = True
                log.error("audio watchdog: still no audio after %d mic re-arms; check the band "
                          "(battery, Bluetooth range) or reconnect it", self.retries)
            return False
        self.retries += 1
        self.total_rearms += 1
        self._next = now + self.stall_s
        return True

    def describe(self) -> dict:
        return {"stall_s": self.stall_s, "retries": self.retries, "gave_up": self.gave_up,
                "total_rearms": self.total_rearms}


def silent_for(band: Any, now: float) -> Optional[float]:
    last, since = getattr(band, "last_chunk_at", None), getattr(band, "mic_on_since", None)
    if last is not None and (since is None or last >= since):
        return now - last
    return None if since is None else now - since
