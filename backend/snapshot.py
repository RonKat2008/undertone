"""Catch-up for late joiners on WS /ws.

A dashboard or phone that connects (or refreshes) mid-session would otherwise see nothing
until the next session. The snapshot keeps the latest state from the bus and replays it,
as ordinary contract events, to each new connection before live streaming starts:

    band.status, device.status (per phone), coach.activated, then for the current or last
    session: session.started, its turns, nudges, bookmarks, signals, the latest metrics,
    and if it is over, session.ended and the debrief.

    snap = Snapshot(bus)              # in the lifespan, once
    for ev in snap.events(): ...      # in /ws, before the live stream
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

MAX_TURNS = 200
MAX_EVENTS = 200


class Snapshot:
    def __init__(self, bus: Any) -> None:
        self.band: Optional[Any] = None
        self.devices: Dict[str, Any] = {}
        self.coach: Optional[Any] = None
        self.started: Optional[Any] = None
        self.turns: List[Any] = []
        self.marks: List[Any] = []  # nudges, bookmarks, signals, in arrival order
        self.metrics: Optional[Any] = None
        self.ended: Optional[Any] = None
        self.debrief: Optional[Any] = None
        bus.on("*", self._on)

    async def _on(self, ev: Any) -> None:
        self.add(ev)

    def add(self, ev: Any) -> None:
        t = getattr(ev, "type", None)
        if t == "band.status":
            self.band = ev
        elif t == "device.status":
            self.devices[ev.device_id] = ev
        elif t == "coach.activated":
            self.coach = ev
        elif t == "session.started":
            self.started, self.ended, self.debrief, self.metrics = ev, None, None, None
            self.turns, self.marks = [], []
        elif self.started is None:
            return
        elif t == "turn.final":
            self.turns.append(ev)
            del self.turns[:-MAX_TURNS]
        elif t in ("nudge", "bookmark", "signal"):
            self.marks.append(ev)
            del self.marks[:-MAX_EVENTS]
        elif t == "metrics":
            self.metrics = ev
        elif t == "session.ended":
            self.ended = ev
        elif t == "debrief":
            self.debrief = ev

    def events(self) -> List[Any]:
        out: List[Any] = []
        if self.band is not None:
            out.append(self.band)
        out.extend(self.devices.values())
        if self.coach is not None:
            out.append(self.coach)
        if self.started is not None:
            out.append(self.started)
            stream = sorted(self.turns + self.marks, key=_ts)
            out.extend(stream)
            if self.metrics is not None:
                out.append(self.metrics)
            if self.ended is not None:
                out.append(self.ended)
            if self.debrief is not None:
                out.append(self.debrief)
        return out


def _ts(ev: Any) -> float:
    return float(getattr(ev, "end", None) or getattr(ev, "ts", None) or 0.0)
