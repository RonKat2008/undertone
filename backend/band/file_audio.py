"""A WAV file as the band's microphone (BAND_TRANSPORT=file, BAND_AUDIO_FILE=path).

The band sends one Opus packet per 20 ms; `BandSource._on_audio` decodes each to 640 bytes
of PCM and hands it to `_push_pcm`. The file transport does the same, paced in real time:
20 ms of the file, every 20 ms, into `_push_pcm`. With `opus=True` (BAND_FILE_OPUS=1) each
frame first goes through the band's codec (Opus, CELT, 24 kbit/s) and the kit's
`PcmDecoder`, so the pipeline hears what it would hear from a real band's packets.
"""
from __future__ import annotations

import wave
from typing import Iterator, Optional

from .audio import SAMPLE_RATE

FRAME_S = 0.02
FRAME_BYTES = int(SAMPLE_RATE * FRAME_S) * 2  # 640: one band packet of PCM


def wav_frames(path: str) -> Iterator[bytes]:
    """640-byte (20 ms) frames of a 16 kHz mono 16-bit WAV; the last one padded with silence.
    A missing or wrong file raises here, not at the first frame."""
    w = wave.open(path, "rb")
    if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SAMPLE_RATE, 1, 2):
        w.close()
        raise ValueError("%s must be 16 kHz mono 16-bit; convert with: "
                         "ffmpeg -i in.wav -ar 16000 -ac 1 -sample_fmt s16 out.wav" % path)
    return _frames(w)


def _frames(w) -> Iterator[bytes]:
    with w:
        while True:
            data = w.readframes(FRAME_BYTES // 2)
            if not data:
                return
            if len(data) < FRAME_BYTES:
                data += b"\x00" * (FRAME_BYTES - len(data))
            yield data


class OpusRoundTrip:
    """PCM frame -> Opus packet like the band's -> PCM, through the kit's PcmDecoder."""

    def __init__(self, decoder=None) -> None:
        import av
        import numpy as np

        self._np = np
        self._av = av
        enc = av.CodecContext.create("libopus", "w")
        enc.sample_rate = SAMPLE_RATE
        enc.layout = "mono"
        enc.format = "s16"
        enc.bit_rate = 24000
        enc.options = {"application": "lowdelay", "frame_duration": "20", "vbr": "off"}  # CELT, like the band
        enc.open()
        self._enc = enc
        if decoder is None:
            from .kit import load_kit
            _, PcmDecoder = load_kit()
            decoder = PcmDecoder()
        self._dec = decoder
        self._pts = 0
        self.seq = 0

    def __call__(self, frame: bytes) -> bytes:
        x = self._np.frombuffer(frame, dtype="<i2").reshape(1, -1)
        f = self._av.AudioFrame.from_ndarray(x, format="s16", layout="mono")
        f.sample_rate = SAMPLE_RATE
        f.pts = self._pts
        self._pts += x.shape[1]
        out = b""
        for packet in self._enc.encode(f):
            out += self._dec.feed(bytes(packet), self.seq)
            self.seq = (self.seq + 1) & 0xFFFF
        return out


def make_frame_filter(opus: bool) -> Optional["OpusRoundTrip"]:
    return OpusRoundTrip() if opus else None
