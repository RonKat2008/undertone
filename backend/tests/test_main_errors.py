"""main.py's HTTPException handler: str detail -> message; dict/list detail kept as data."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException

from backend.main import _http_exc


async def _body(exc: HTTPException) -> tuple[int, dict[str, Any]]:
    resp = await _http_exc(None, exc)  # type: ignore[arg-type]
    return resp.status_code, json.loads(bytes(resp.body))


async def test_str_detail_is_the_message() -> None:
    status, body = await _body(HTTPException(409, "no session running"))
    assert status == 409
    assert body == {"ok": False, "error": {"code": "http_409", "message": "no session running"}}


async def test_dict_detail_keeps_structure_and_code() -> None:
    exc = HTTPException(422, {"code": "invalid_coach", "message": "a; b", "errors": ["a", "b"]})
    status, body = await _body(exc)
    assert status == 422
    assert body == {"ok": False, "error": {"code": "invalid_coach", "message": "a; b",
                                           "details": {"errors": ["a", "b"]}}}


async def test_dict_detail_without_code_or_message_gets_defaults() -> None:
    status, body = await _body(HTTPException(422, {"errors": ["x"]}))
    assert status == 422
    assert body["error"]["code"] == "http_422" and body["error"]["details"] == {"errors": ["x"]}
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


async def test_list_detail_becomes_details() -> None:
    status, body = await _body(HTTPException(400, ["bad id", "bad name"]))
    assert status == 400
    assert body["error"]["code"] == "http_400" and body["error"]["details"] == ["bad id", "bad name"]
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
