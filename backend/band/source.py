"""One place that hands out band data, whatever BAND_TRANSPORT says.

    src = BandSource.from_env(emit)          # emit(event_dict) puts band.status on the bus
    await src.start()                        # connect; mic stays OFF
    await src.mic(True)                      # session start: LED solid blue, audio flows
    chunk = await src.pcm_q.get()            # 2560 bytes = 80 ms, 16 kHz mono s16le
    m = await src.motion_q.get()             # MotionSample (session seconds, g, deg/s)
    tap = await src.tap_q.get()              # "double" or "single"

Transports:
  ble         the real band over Bluetooth (kit)
  serial      the real band over the USB cable (kit)
  sim         the kit's pretend band. Audio is silence unless SIM_WAV=path/to/16k-mono.wav,
              which is then played in real time while the mic is on. Taps: keyboard.
  laptop-mic  no band. Laptop microphone for audio, keyboard for taps (d = double, s = single).

Handlers stay short: they only push to queues (plan.md section 3.1).
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import wave
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Union

from .audio import CHUNK_BYTES, CHUNK_S, SAMPLE_RATE, Chunker, LoudnessTimeline, rms_db

log = logging.getLogger("undertone.band")

Emit = Callable[[dict], Union[None, Awaitable[None]]]
TRANSPORTS = ("ble", "serial", "sim", "laptop-mic")


@dataclass
class MotionSample:
    t: float  # seconds since session start (or since connect, outside a session)
    ax: float
    ay: float
    az: float
    gx: float
    gy: float
    gz: float


async def _call(emit: Optional[Emit], event: dict) -> None:
    if emit is None:
        return
    r = emit(event)
    if asyncio.iscoroutine(r):
        await r


class BandSource:
    def __init__(self, transport: str = "sim", number: int = 13, emit: Optional[Emit] = None,
                 sim_wav: Optional[str] = None, keyboard: Optional[bool] = None) -> None:
        if transport not in TRANSPORTS:
            raise ValueError("BAND_TRANSPORT must be one of %s, got %r" % (TRANSPORTS, transport))
        self.transport = transport
        self.number = number
        self.emit = emit
        self.sim_wav = sim_wav
        self.keyboard = sys.stdin.isatty() if keyboard is None else keyboard
        self.pcm_q: asyncio.Queue = asyncio.Queue(maxsize=500)      # ~40 s of audio
        self.motion_q: asyncio.Queue = asyncio.Queue(maxsize=2000)  # ~20 s at 100 Hz
        self.tap_q: asyncio.Queue = asyncio.Queue()
        self.loudness = LoudnessTimeline()
        self.chunker = Chunker()
        self.band = None
        self.connected = False
        self.mic_on = False
        self.battery_pct: Optional[int] = None
        self.dropped_chunks = 0
        self._decoder = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._t0 = time.time()
        self._tasks: list = []
        self._mic_stream = None

    @classmethod
    def from_env(cls, emit: Optional[Emit] = None) -> "BandSource":
        return cls(transport=os.getenv("BAND_TRANSPORT", "sim").strip() or "sim",
                   number=int(os.getenv("VEXO_BAND_NUMBER") or 13), emit=emit,
                   sim_wav=os.getenv("SIM_WAV") or None,
                   keyboard=None if os.getenv("KEYBOARD_TAPS") is None else os.getenv("KEYBOARD_TAPS") == "1")

    # ---------- clock ----------

    def reset_clock(self) -> None:
        """Call at session start: motion times and the audio clock restart at 0."""
        self._t0 = time.time()
        self.chunker.reset()
        self.loudness.reset()
        while not self.pcm_q.empty():
            self.pcm_q.get_nowait()

    def now(self) -> float:
        return time.time() - self._t0

    @property
    def audio_seconds(self) -> float:
        return self.chunker.seconds

    # ---------- lifecycle ----------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if self.transport == "laptop-mic":
            self.connected = True
        else:
            await self._connect_band()
        if self.keyboard and self.transport in ("sim", "laptop-mic"):
            threading.Thread(target=self._keyboard_thread, daemon=True).start()
            log.info("keyboard taps on: type d + Enter = double-tap, s + Enter = single tap")
        await self._status()

    async def stop(self) -> None:
        await self.mic(False)
        for t in self._tasks:
            t.cancel()
        if self.band is not None:
            try:
                await self.band.disconnect()
            except Exception:  # noqa: BLE001
                pass
        self.connected = False
        await self._status()

    async def _connect_band(self) -> None:
        from .kit import load_kit
        Band, PcmDecoder = load_kit()
        if PcmDecoder is not None:
            self._decoder = PcmDecoder()  # slow the first time: build before the mic goes on
        else:
            log.warning("`av` not installed: band audio cannot be decoded (uv add av). Using silence.")
        opts = {}
        if self.transport == "sim":
            opts["auto_tap"] = False  # taps come from the keyboard or HTTP, never on a timer
        self.band = await Band.connect(self.number, transport=self.transport, auto_reconnect=True, **opts)
        b = self.band
        b.on("double-tap", lambda e: self.tap_q.put_nowait("double"))
        b.on("tap", lambda e: self.tap_q.put_nowait("single"))
        b.on("motion", self._on_motion)
        b.on("audio", self._on_audio)
        b.on("battery", self._on_battery)
        b.on("notice", self._on_notice)
        b.on("reconnecting", lambda e: self._spawn(self._on_link(False)))
        b.on("reconnected", lambda e: self._spawn(self._on_reconnected()))
        b.on("disconnect", lambda e: self._spawn(self._on_link(False)))
        await self._apply_settings()
        self.connected = True
        log.info("connected to %s over %s", getattr(b, "name", self.number), self.transport)

    async def _apply_settings(self) -> None:
        b = self.band
        try:
            await b.set_motion(accel_range=8)  # default 2 g clips real gestures
        except Exception as e:  # noqa: BLE001
            log.warning("set_motion failed: %s", e)
        await b.configure(motion=100, sensors="both", events=True, battery=60, audio=self.mic_on)

    async def mic(self, on: bool) -> None:
        """Mic on = session running. On the real band this also locks the LED solid blue."""
        if on == self.mic_on:
            return
        self.mic_on = on
        if self.transport == "laptop-mic":
            self._laptop_mic(on)
        elif self.band is not None:
            await self.band.configure(audio=on)
            if on and self.transport == "sim" and self.sim_wav:
                self._tasks.append(asyncio.create_task(self._play_wav(self.sim_wav)))
        await self._status()

    # ---------- band handlers (short: push and return) ----------

    def _on_motion(self, m) -> None:
        if m.ax is None:  # gyro-only sample
            return
        t = (m.time - self._t0) if getattr(m, "time", None) else self.now()
        s = MotionSample(t, m.ax, m.ay, m.az, m.gx or 0.0, m.gy or 0.0, m.gz or 0.0)
        try:
            self.motion_q.put_nowait(s)
        except asyncio.QueueFull:
            self.motion_q.get_nowait()
            self.motion_q.put_nowait(s)

    def _on_audio(self, a) -> None:
        if not self.mic_on or (self.transport == "sim" and self.sim_wav):
            return
        pcm = self._decoder.feed(a) if self._decoder is not None else b"\x00" * 640
        self._push_pcm(pcm)

    def _on_battery(self, e) -> None:
        pct = e.get("percent") if hasattr(e, "get") else None
        if pct is None:
            pct = getattr(e, "percent", None)
        self.battery_pct = int(pct) if pct is not None else None
        self._spawn(self._status())

    def _on_notice(self, e) -> None:
        log.warning("band notice: %s %s", getattr(e, "kind", e), getattr(e, "arg", ""))

    async def _on_link(self, up: bool) -> None:
        self.connected = up
        await self._status()

    async def _on_reconnected(self) -> None:
        self.connected = True
        try:
            await self._apply_settings()  # the kit restores most of it; ranges we set again to be sure
        except Exception as e:  # noqa: BLE001
            log.warning("re-applying settings failed: %s", e)
        await self._status()

    # ---------- PCM path ----------

    def _push_pcm(self, pcm: bytes) -> None:
        for chunk in self.chunker.feed(pcm):
            self.loudness.add(self.chunker.seconds, rms_db(chunk))
            try:
                self.pcm_q.put_nowait(chunk)
            except asyncio.QueueFull:
                self.dropped_chunks += 1

    async def _play_wav(self, path: str) -> None:
        """sim + SIM_WAV: play a 16 kHz mono 16-bit wav in real time while the mic is on."""
        with wave.open(path, "rb") as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SAMPLE_RATE, 1, 2):
                log.error("SIM_WAV must be 16 kHz mono 16-bit; convert with: "
                          "ffmpeg -i in.wav -ar 16000 -ac 1 -sample_fmt s16 out.wav")
                return
            frames = CHUNK_BYTES // 2
            start = time.monotonic()
            n = 0
            while self.mic_on:
                data = w.readframes(frames)
                if len(data) < CHUNK_BYTES:
                    data = data + b"\x00" * (CHUNK_BYTES - len(data))  # past the end: silence
                self._push_pcm(data)
                n += 1
                await asyncio.sleep(max(0.0, start + n * CHUNK_S - time.monotonic()))

    def _laptop_mic(self, on: bool) -> None:
        if not on:
            if self._mic_stream is not None:
                try:
                    self._mic_stream.stop()
                    self._mic_stream.close()
                except Exception:  # noqa: BLE001
                    pass
                self._mic_stream = None
            return
        loop = self._loop
        try:
            import sounddevice as sd

            def cb(indata, frames, t, status):  # audio thread
                loop.call_soon_threadsafe(self._push_pcm, bytes(indata))

            self._mic_stream = sd.RawInputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                                                 blocksize=CHUNK_BYTES // 2, callback=cb)
            self._mic_stream.start()
            return
        except ImportError:
            pass
        import pyaudio  # comes with pipecat-ai[local]

        pa = pyaudio.PyAudio()

        def pa_cb(data, frames, t, status):
            loop.call_soon_threadsafe(self._push_pcm, data)
            return (None, pyaudio.paContinue)

        s = pa.open(format=pyaudio.paInt16, channels=1, rate=SAMPLE_RATE, input=True,
                    frames_per_buffer=CHUNK_BYTES // 2, stream_callback=pa_cb)

        class _Wrap:  # same stop/close shape as sounddevice
            def stop(self_inner):
                s.stop_stream()

            def close(self_inner):
                s.close()
                pa.terminate()

        self._mic_stream = _Wrap()

    # ---------- taps without a band ----------

    def tap(self, kind: str) -> None:
        """Pretend tap, from the keyboard or an HTTP route. kind: "double" or "single"."""
        if kind not in ("double", "single"):
            raise ValueError(kind)
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self.tap_q.put_nowait, kind)

    def _keyboard_thread(self) -> None:
        for line in sys.stdin:
            c = line.strip().lower()
            if c == "d":
                self.tap("double")
            elif c == "s":
                self.tap("single")

    # ---------- status ----------

    def status_event(self) -> dict:
        return {"type": "band.status", "connected": self.connected, "transport": self.transport,
                "battery_pct": self.battery_pct, "mic_on": self.mic_on}

    async def _status(self) -> None:
        await _call(self.emit, self.status_event())

    def _spawn(self, coro) -> None:
        self._tasks.append(asyncio.ensure_future(coro))
        self._tasks = [t for t in self._tasks if not t.done()]
