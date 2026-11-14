"""Shared Gemini 3.8 Flash helper for structured output (studio, debrief, growth).

Call shape verified with real calls on 14 Nov (scripts/smoke_flash.py):
`generate_content` + `response_json_schema` (a cleaned dict) + thinking level "low".
Measured: coach spec about 10 s, debrief about 5 s.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, TypeVar

from pydantic import BaseModel

from backend.config import load_settings

log = logging.getLogger(__name__)

FLASH_MODEL = "gemini-3.8-flash"
DEFAULT_TIMEOUT_S = 30.0

T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(RuntimeError):
    """No key, a timeout, an API error, or output that does not validate."""


def gemini_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Pydantic JSON Schema -> the subset Gemini actually enforces.

    Pydantic emits single-value Literals as `const` and tagged unions as
    `oneOf` + `discriminator`. Gemini silently ignores `const` and
    `discriminator`, so union branches go unenforced unless rewritten.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            cleaned = {k: walk(v) for k, v in node.items() if k != "discriminator"}
            if "const" in cleaned:
                cleaned["enum"] = [cleaned.pop("const")]
            if "oneOf" in cleaned:
                cleaned["anyOf"] = cleaned.pop("oneOf")
            return cleaned
        if isinstance(node, list):
            return [walk(item) for item in node]
        return node

    return walk(model.model_json_schema())


async def generate_structured(
    prompt: str,
    schema: type[T],
    *,
    thinking: str = "low",  # "minimal" is rejected by this model
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> T:
    """One structured call. Raises LLMUnavailable on any failure; callers own the fallback."""
    settings = load_settings()
    if not settings.has_gemini:
        raise LLMUnavailable("GEMINI_API_KEY is not set")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_json_schema=gemini_json_schema(schema),
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
    )
    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(model=FLASH_MODEL, contents=prompt, config=config),
            timeout=timeout_s,
        )
        return schema.model_validate_json(response.text)
    except asyncio.TimeoutError as exc:
        raise LLMUnavailable(f"{FLASH_MODEL} timed out after {timeout_s:.0f}s") from exc
    except Exception as exc:  # API errors and validation errors both mean "use the fallback"
        log.warning("structured generation failed: %s", type(exc).__name__)
        raise LLMUnavailable(f"{FLASH_MODEL} call failed: {type(exc).__name__}") from exc
