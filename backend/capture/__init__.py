"""Conversation capture: keep each conversation's audio, serve its transcript, judge if it is worth keeping.

    wav.py       WavWriter: a WAV file written by a thread; the audio path only enqueues
    recorder.py  Recorder: tapped per 80 ms chunk (BandSource.chunk_tap), rolling pre-buffer
    media.py     where recordings live (<db dir>/media/recordings), caps, pruning, safe paths
    verdict.py   KEEP_QUESTIONS + classify(): one Gemini Decisions call, rule fallback
    store.py     verdict/recording effects on the sessions table and on disk
    routes.py    GET /sessions/{id}/transcript, GET /sessions/{id}/audio, POST /sessions/{id}/keep

Env: RECORD_AUDIO (default on), UNDERTONE_MEDIA_MAX_MB (default 2000). One file is capped at 30 min.
"""
