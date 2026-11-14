"""Voice and body together (plan.md 4.2).

    fusion = Fusion(emit)                 # emit(event_dict)
    fusion.on_turn(turn_final_event)      # every turn.final
    fusion.on_motion(motion_event, pace_wpm, baseline_wpm)   # every motion window
    fusion.fidget_listening_s             # read by B's motion rules ("fidget while they talk > 8 s")

Emits `signal` events:
  checked_out  still hands + no question from the wearer during a long stretch of the other
               person talking
  nerves       hands freeze and pace jumps >25% above baseline within the same 10 s
"""
from __future__ import annotations

from collections import deque
from typing import Callable, Deque, Optional, Tuple


class Fusion:
    def __init__(self, emit: Callable[[dict], None], checked_out_s: float = 45.0, nerves_window_s: float = 10.0,
                 nerves_pace_jump: float = 0.25, cooldown_s: float = 60.0) -> None:
        self.emit = emit
        self.checked_out_s = checked_out_s
        self.nerves_window_s = nerves_window_s
        self.nerves_pace_jump = nerves_pace_jump
        self.cooldown_s = cooldown_s
        self.current_speaker: Optional[str] = None
        self.fidget_listening_s = 0.0
        self._last_motion_ts: Optional[float] = None
        self._other_talk_since_my_question = 0.0
        self._recent: Deque[Tuple[float, str, Optional[str]]] = deque()  # (ts, state, speaker)
        self._last_signal = {"nerves": -1e9, "checked_out": -1e9}
        self._ever_gestured = False

    # ---------- inputs ----------

    def on_turn(self, turn: dict) -> None:
        dur = max(0.0, turn["end"] - turn["start"])
        if turn["speaker"] == "other":
            self._other_talk_since_my_question += dur
        elif "?" in turn["text"]:
            self._other_talk_since_my_question = 0.0

    def speaker_now(self, speaker: Optional[str]) -> None:
        """Who is talking right now (from the latest partial or turn)."""
        self.current_speaker = speaker

    def on_motion(self, m: dict, pace_wpm: Optional[float] = None, baseline_wpm: Optional[float] = None) -> None:
        ts, state = m["ts"], m["state"]
        dt = 0.5 if self._last_motion_ts is None else max(0.0, min(2.0, ts - self._last_motion_ts))
        self._last_motion_ts = ts
        spk = m.get("speaker_context")
        self._recent.append((ts, state, spk))
        while self._recent and ts - self._recent[0][0] > self.nerves_window_s:
            self._recent.popleft()
        if state == "gesture":
            self._ever_gestured = True

        # fidget while the other person speaks
        if state == "fidget" and spk == "other":
            self.fidget_listening_s += dt
        elif state != "fidget" or spk != "other":
            self.fidget_listening_s = 0.0

        # checked out: hands mostly still over the last 10 s, after a long stretch of them talking
        last = [s for (_, s, _) in self._recent]
        if (self._other_talk_since_my_question >= self.checked_out_s and len(last) >= 10
                and last.count("still") / len(last) >= 0.7):
            self._signal("checked_out", ts, "Hands still and no question for %ds of them talking"
                         % int(self._other_talk_since_my_question))
            self._other_talk_since_my_question = 0.0

        # nerves: wearer talking, hands froze in the last 10 s after moving before, pace jumped
        mine = [s for (_, s, sp) in self._recent if sp == "me"]
        if (pace_wpm and baseline_wpm and self._ever_gestured and len(mine) >= 6
                and mine.count("still") / len(mine) >= 0.8
                and pace_wpm > baseline_wpm * (1 + self.nerves_pace_jump)):
            self._signal("nerves", ts, "Hands froze and pace jumped to %d wpm (usual %d)"
                         % (pace_wpm, baseline_wpm))

    def _signal(self, kind: str, ts: float, detail: str) -> None:
        if ts - self._last_signal[kind] < self.cooldown_s:
            return
        self._last_signal[kind] = ts
        self.emit({"type": "signal", "kind": kind, "detail": detail, "ts": round(ts, 2)})
