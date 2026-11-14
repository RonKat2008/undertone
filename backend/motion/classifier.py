"""Hand motion from the band's accel + gyro (plan.md 4.2).

1 s windows, 50% overlap. Features per window:
  a_rms   RMS of gravity-removed acceleration magnitude (g)
  g_mean  mean gyro magnitude (deg/s)
  freq    dominant frequency of the motion (Hz), from an FFT of the combined signal
States: still (both low) / fidget (moderate, repetitive, ~2-6 Hz) / gesture (everything else that moves).
hand_energy: one 0-1 number, 0 frozen, ~0.5 natural gesturing, 1 overdoing it.

Thresholds come from a 15 s calibration (5 s still, 5 s gesture, 5 s fidget), saved per band.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional, Sequence

import numpy as np

CAL_DIR = Path(os.getenv("UNDERTONE_DATA", Path(__file__).resolve().parents[2] / ".undertone"))


@dataclass
class Features:
    t: float        # window end, session seconds
    a_rms: float
    g_mean: float
    freq: float
    periodicity: float  # share of spectral power in the peak band, 0-1


@dataclass
class Thresholds:
    still_a: float = 0.03      # g
    still_g: float = 15.0      # deg/s
    gesture_a: float = 0.15    # typical a_rms while gesturing naturally (hand_energy 0.5)
    gesture_g: float = 60.0
    fidget_freq: float = 2.0   # Hz: at or above this, repetitive motion counts as fidget
    fidget_max_a: float = 0.35  # above this it is big gesturing, not fidgeting

    def save(self, band: int) -> Path:
        CAL_DIR.mkdir(parents=True, exist_ok=True)
        p = CAL_DIR / ("motion-band-%d.json" % band)
        p.write_text(json.dumps(asdict(self), indent=2))
        return p

    @classmethod
    def load(cls, band: int) -> "Thresholds":
        p = CAL_DIR / ("motion-band-%d.json" % band)
        if p.exists():
            return cls(**json.loads(p.read_text()))
        return cls()


def features(samples: Sequence, t_end: Optional[float] = None) -> Optional[Features]:
    """samples: objects with t, ax, ay, az, gx, gy, gz (t in seconds)."""
    if len(samples) < 10:
        return None
    t = np.array([s.t for s in samples])
    a = np.array([[s.ax, s.ay, s.az] for s in samples])
    g = np.array([[s.gx, s.gy, s.gz] for s in samples])
    a_dyn = a - a.mean(axis=0)                      # gravity removed (the band barely turns in 1 s)
    a_mag = np.linalg.norm(a_dyn, axis=1)
    g_mag = np.linalg.norm(g, axis=1)
    a_rms = float(np.sqrt(np.mean(a_mag ** 2)))
    g_mean = float(np.mean(g_mag))
    # resample onto an even grid by time stamp (plan: place samples by m.t, not nominal rate)
    dur = float(t[-1] - t[0])
    if dur <= 0:
        return Features(t_end if t_end is not None else float(t[-1]), a_rms, g_mean, 0.0, 0.0)
    n = len(samples)
    grid = np.linspace(t[0], t[-1], n)
    # combine the dominant accel axis and gyro so both kinds of wrist motion show up
    sig = np.interp(grid, t, a_dyn[:, int(np.argmax(a_dyn.var(axis=0)))]) / (a_rms + 1e-6) \
        + np.interp(grid, t, g[:, int(np.argmax(g.var(axis=0)))] - g[:, int(np.argmax(g.var(axis=0)))].mean()) / (g_mean + 1e-6)
    sig = sig * np.hanning(n)
    spec = np.abs(np.fft.rfft(sig)) ** 2
    freqs = np.fft.rfftfreq(n, d=dur / (n - 1))
    band = (freqs >= 0.5) & (freqs <= 10)
    if not band.any() or spec[band].sum() <= 0:
        return Features(t_end if t_end is not None else float(t[-1]), a_rms, g_mean, 0.0, 0.0)
    i = int(np.argmax(np.where(band, spec, 0)))
    peak = spec[max(0, i - 1): i + 2].sum()
    return Features(t_end if t_end is not None else float(t[-1]), a_rms, g_mean, float(freqs[i]),
                    float(peak / spec[band].sum()))


def classify(f: Features, th: Thresholds) -> tuple:
    """(state, confidence)."""
    if f.a_rms < th.still_a and f.g_mean < th.still_g:
        margin = min(1 - f.a_rms / th.still_a, 1 - f.g_mean / th.still_g)
        return "still", round(0.5 + 0.5 * max(0.0, margin), 2)
    if f.freq >= th.fidget_freq and f.a_rms <= th.fidget_max_a and f.periodicity >= 0.25:
        conf = 0.5 + 0.5 * min(1.0, (f.freq - th.fidget_freq) / 2) * min(1.0, f.periodicity / 0.6)
        return "fidget", round(min(conf, 0.99), 2)
    conf = 0.5 + 0.5 * min(1.0, (f.a_rms - th.still_a) / max(th.gesture_a - th.still_a, 1e-6))
    return "gesture", round(min(conf, 0.99), 2)


def hand_energy(f: Features, th: Thresholds) -> float:
    """0 at the still threshold, 0.5 at calibrated natural gesturing, 1 at twice that."""
    a = (f.a_rms - th.still_a) / max(th.gesture_a - th.still_a, 1e-6)
    g = (f.g_mean - th.still_g) / max(th.gesture_g - th.still_g, 1e-6)
    x = max(a, g)
    return round(float(min(1.0, max(0.0, x * 0.5))), 3)


class MotionClassifier:
    """Feed samples in; get a motion state every hop (0.5 s)."""

    def __init__(self, th: Optional[Thresholds] = None, window_s: float = 1.0, hop_s: float = 0.5,
                 smooth: float = 0.5) -> None:
        self.th = th or Thresholds()
        self.window_s = window_s
        self.hop_s = hop_s
        self.smooth = smooth
        self._buf: List = []
        self._next: Optional[float] = None
        self.energy = 0.0

    def add(self, s) -> Optional[dict]:
        """Returns {state, hand_energy, confidence, ts, features} when a window completes."""
        self._buf.append(s)
        if self._next is None:
            self._next = s.t + self.window_s
        if s.t < self._next:
            return None
        lo = s.t - self.window_s
        self._buf = [x for x in self._buf if x.t >= lo]
        self._next = s.t + self.hop_s
        f = features(self._buf, t_end=s.t)
        if f is None:
            return None
        state, conf = classify(f, self.th)
        e = hand_energy(f, self.th)
        self.energy = self.smooth * self.energy + (1 - self.smooth) * e
        return {"state": state, "hand_energy": round(self.energy, 3), "confidence": conf, "ts": round(s.t, 2),
                "features": f}


def calibrate(still: List[Features], gesture: List[Features], fidget: List[Features]) -> Thresholds:
    """Thresholds from the three 5 s recordings. Falls back to defaults where a step is empty."""
    d = Thresholds()

    def pct(xs, q):
        return float(np.percentile(xs, q)) if xs else None

    s_a, s_g = pct([f.a_rms for f in still], 90), pct([f.g_mean for f in still], 90)
    m_a = pct([f.a_rms for f in gesture + fidget], 10)
    m_g = pct([f.g_mean for f in gesture + fidget], 10)
    if s_a is not None and m_a is not None and m_a > s_a:
        d.still_a = (s_a + m_a) / 2
    elif s_a is not None:
        d.still_a = s_a * 1.5
    if s_g is not None and m_g is not None and m_g > s_g:
        d.still_g = (s_g + m_g) / 2
    elif s_g is not None:
        d.still_g = s_g * 1.5
    if gesture:
        d.gesture_a = max(float(np.median([f.a_rms for f in gesture])), d.still_a * 2)
        d.gesture_g = max(float(np.median([f.g_mean for f in gesture])), d.still_g * 2)
    if gesture and fidget:
        gf = float(np.median([f.freq for f in gesture]))
        ff = float(np.median([f.freq for f in fidget]))
        if ff > gf:
            d.fidget_freq = min(3.0, max(1.5, (gf + ff) / 2))
        d.fidget_max_a = max(float(np.percentile([f.a_rms for f in fidget], 95)) * 1.3, d.still_a * 2)
    return d


def synth_samples(kind: str, seconds: float, t0: float = 0.0, rate: int = 100, seed: int = 0):
    """Fake band samples for tests and fixtures: 'still', 'gesture' (slow, big) or 'fidget' (fast, small)."""
    from types import SimpleNamespace
    rng = np.random.default_rng(seed)
    out = []
    for i in range(int(seconds * rate)):
        t = t0 + i / rate
        if kind == "still":
            a, g, f = 0.005, 2.0, 0.0
        elif kind == "gesture":
            a, g, f = 0.25, 90.0, 0.8
        else:
            a, g, f = 0.08, 35.0, 4.0
        w = math.sin(2 * math.pi * f * t) if f else 0.0
        n = rng.normal(0, 0.004, 6)
        out.append(SimpleNamespace(t=t, ax=a * w + n[0], ay=0.3 * a * w + n[1], az=1.0 + n[2],
                                   gx=g * w + n[3] * 100, gy=0.5 * g * w + n[4] * 100, gz=n[5] * 100))
    return out
