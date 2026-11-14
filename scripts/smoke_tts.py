"""Smoke test: one Deepgram Aura-2 TTS request. Never prints the API key."""
import os
import sys
import time

import httpx
from dotenv import load_dotenv

ENV_PATH = "/Users/ronitkatikaneni/undertone/.env"
DEFAULT_OUT = (
    "/private/tmp/claude-501/-Users-ronitkatikaneni/"
    "9d89ac26-794a-4c22-9aa4-8da482d82c9b/scratchpad/tts_smoke.mp3"
)
URL = "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en"
TEXT = (
    "You talked sixty-eight percent of the time and asked one question. "
    "Your structure was clear. Next time: when you hit thirty seconds, "
    "end with a question."
)


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    load_dotenv(ENV_PATH)
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        print("DEEPGRAM_API_KEY missing from .env")
        return 1
    headers = {"Authorization": f"Token {key}", "Content-Type": "application/json"}
    start = time.perf_counter()
    resp = httpx.post(URL, headers=headers, json={"text": TEXT}, timeout=60)
    elapsed_ms = (time.perf_counter() - start) * 1000
    if resp.status_code != 200:
        print(f"HTTP status: {resp.status_code}")
        print(resp.text)
        return 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(resp.content)
    print(f"HTTP status: {resp.status_code}")
    print(f"content-type: {resp.headers.get('content-type')}")
    print(f"bytes: {len(resp.content)}")
    print(f"elapsed ms: {elapsed_ms:.0f}")
    print(f"saved: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
