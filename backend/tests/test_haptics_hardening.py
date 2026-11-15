"""Haptics Connector hardening found in QA: who may pair, pairing codes are single-use and
short-lived, bounded strings, and an unknown device on the test buzz."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

_TMP = Path(tempfile.mkdtemp(prefix="undertone-haptics-hard-"))
os.environ.setdefault("UNDERTONE_DB", str(_TMP / "haptics.db"))
os.environ.setdefault("UNDERTONE_ENV_FILE", str(_TMP / "does-not-exist.env"))

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import haptics, haptics_port  # noqa: E402
from backend.haptics import hub as hub_mod  # noqa: E402

OUTSIDER = ("203.0.113.9", 5000)


@pytest.fixture(autouse=True)
def _reset_port() -> Any:
    yield
    haptics_port.reset_sender()


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(haptics.router)
    return app


def test_a_stranger_on_the_wifi_cannot_mint_a_device_token() -> None:
    """A self-made pairing would pass the owner check (device token) and unlock approve/revoke."""
    app = _app()
    with TestClient(app, client=OUTSIDER) as outsider:
        assert outsider.post("/pair", json={}).status_code == 403
        reg = outsider.post("/v1/apps", json={"name": "Stranger"}).json()
        assert outsider.post(f"/v1/apps/{reg['app_id']}/approve").status_code == 403


def test_a_paired_phone_may_still_start_a_pairing() -> None:
    app = _app()
    with TestClient(app) as laptop:
        token = laptop.post("/pair").json()["device_token"]
    with TestClient(app, client=OUTSIDER) as phone:
        assert phone.post("/pair", headers={"X-Device-Token": token}).status_code == 200


def test_a_pairing_code_works_once() -> None:
    with TestClient(_app()) as c:
        p = c.post("/pair").json()
        assert c.post("/pair/claim", json={"code": p["code"]}).status_code == 200
        again = c.post("/pair/claim", json={"code": p["code"]})
        assert again.status_code == 404 and p["device_token"] not in again.text


def test_a_pairing_code_dies_once_the_phone_connects_by_qr() -> None:
    with TestClient(_app()) as c:
        p = c.post("/pair").json()
        with c.websocket_connect(f"/ws/device/{p['device_id']}?token={p['device_token']}"):
            pass
        assert c.post("/pair/claim", json={"code": p["code"]}).status_code == 404


def test_a_pairing_code_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app()
    with TestClient(app) as c:
        p = c.post("/pair").json()
        hub = app.state.haptics
        hub.devices[p["device_id"]].created_at -= hub_mod.CODE_TTL_S + 1
        assert c.post("/pair/claim", json={"code": p["code"]}).status_code == 404


def test_strings_are_bounded() -> None:
    big = "x" * 100_000
    with TestClient(_app()) as c:
        assert c.post("/pair", json={"name": big}).status_code == 422
        assert c.post("/v1/apps", json={"name": "ok", "origin": big}).status_code == 422
        assert c.post("/pair/claim", json={"code": big}).status_code == 422
        p = c.post("/pair", json={"name": "n" * 100}).json()
        assert len(p["name"]) <= 40


def test_test_buzz_to_an_unknown_device_is_404() -> None:
    with TestClient(_app()) as c:
        r = c.post("/haptics/test", json={"pattern": "tap", "device_id": "nope"})
        assert r.status_code == 404
