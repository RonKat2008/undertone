"""Voice memory routes (contracts: VoiceList, VoiceSummary, WearerVoice, SessionVoices, ReprocessResult).

    GET    /voices                       every remembered voice + the wearer's state
    GET    /voices/wearer                the wearer voiceprint's state
    POST   /voices/wearer/enrol          {"seconds": 15}: speak alone now; the band's last N s
    POST   /voices/wearer/enrol/wav      body: 16 kHz mono 16-bit WAV of the wearer alone
    DELETE /voices/wearer                clear the wearer voiceprint (bootstrapping starts over)
    POST   /voices/reprocess             {"session_ids": [...]} or {} for every recorded conversation
    GET    /voices/{voice_id}
    POST   /voices/{voice_id}/name       {"name": "Dylan"}
    POST   /voices/{voice_id}/merge      {"into": "v2"}: this voice is the same person as v2
    DELETE /voices/{voice_id}            forget: voiceprint and exemplars deleted
    GET    /sessions/{session_id}/voices who was recognised in that conversation
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.contracts import ReprocessResult, SessionVoices, VoiceList, VoiceSummary, WearerVoice
from backend.deps import get_app_state
from backend.state import AppState
from backend.voices import naming, store, views
from backend.voices.audio import pcm16_to_float
from backend.voices.enrol import EnrolError, wav_bytes_to_samples
from backend.voices.service import VoiceMemory, voice_memory

log = logging.getLogger("undertone.voices")

router = APIRouter(tags=["voices"])

MAX_WAV_BYTES = 4 * 1024 * 1024  # about 2 min of 16 kHz 16-bit audio
ENROL_MAX_S = 20.0  # the recorder's rolling pre-buffer


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MergeBody(BaseModel):
    into: str = Field(min_length=1, max_length=40)


class EnrolBody(BaseModel):
    seconds: float = Field(default=15.0, ge=6.0, le=ENROL_MAX_S)


class ReprocessBody(BaseModel):
    session_ids: list[str] | None = Field(default=None, max_length=500)


def _vm(st: AppState = Depends(get_app_state)) -> VoiceMemory:
    return voice_memory(st)


def _on(vm: VoiceMemory) -> VoiceMemory:
    if not vm.enabled:
        raise HTTPException(409, "voice memory is off (VOICE_MEMORY=0)")
    return vm


@router.get("/voices", response_model=VoiceList)
def list_voices(vm: VoiceMemory = Depends(_vm)) -> VoiceList:
    if not vm.enabled:
        return VoiceList(enabled=False, wearer=WearerVoice(state="none", has_voiceprint=False))
    return views.voice_list(vm.db, True, vm.model)


@router.get("/voices/wearer", response_model=WearerVoice)
def get_wearer(vm: VoiceMemory = Depends(_vm)) -> WearerVoice:
    return views.wearer_view(_on(vm).db)


@router.post("/voices/wearer/enrol", response_model=WearerVoice)
async def enrol_live(body: EnrolBody | None = None, vm: VoiceMemory = Depends(_vm)) -> WearerVoice:
    """Speak alone for `seconds` after calling this; the band's audio for that window is used."""
    _on(vm)
    secs = (body or EnrolBody()).seconds
    if vm.recorder is None:
        raise HTTPException(409, "no band audio (the band is not attached or RECORD_AUDIO=0)")
    await asyncio.sleep(secs)
    pcm = vm.recorder.recent_audio(secs)
    if not pcm:
        raise HTTPException(409, "no band audio arrived: is the mic on (a session or ALWAYS_ON)?")
    return await _enrol(vm, pcm16_to_float(pcm))


@router.post("/voices/wearer/enrol/wav", response_model=WearerVoice)
async def enrol_wav(request: Request, vm: VoiceMemory = Depends(_vm)) -> WearerVoice:
    _on(vm)
    data = await request.body()
    if not data or len(data) > MAX_WAV_BYTES:
        raise HTTPException(413 if data else 422, "send a 16 kHz mono 16-bit WAV of at most 4 MB")
    try:
        samples = wav_bytes_to_samples(data)
    except EnrolError as exc:
        raise HTTPException(422, str(exc)) from exc
    return await _enrol(vm, samples)


async def _enrol(vm: VoiceMemory, samples) -> WearerVoice:  # type: ignore[no-untyped-def]
    try:
        await vm.enrol(samples)
    except EnrolError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return views.wearer_view(vm.db)


@router.delete("/voices/wearer", response_model=WearerVoice)
def clear_wearer(vm: VoiceMemory = Depends(_vm)) -> WearerVoice:
    naming.clear_wearer(_on(vm).db)
    return views.wearer_view(vm.db)


@router.post("/voices/reprocess", response_model=ReprocessResult)
async def reprocess(body: ReprocessBody | None = None, vm: VoiceMemory = Depends(_vm)) -> ReprocessResult:
    queued, skipped = _on(vm).reprocess((body or ReprocessBody()).session_ids)
    return ReprocessResult(queued=queued, skipped=skipped)


def _voice(vm: VoiceMemory, voice_id: str) -> store.VoiceRow:
    row = store.get_voice(_on(vm).db, voice_id)
    if row is None or row.is_wearer:
        raise HTTPException(404, f"voice {voice_id} not found")
    return row


@router.get("/voices/{voice_id}", response_model=VoiceSummary)
def get_voice(voice_id: str, vm: VoiceMemory = Depends(_vm)) -> VoiceSummary:
    return views.voice_summary(vm.db, _voice(vm, voice_id))


@router.post("/voices/{voice_id}/name", response_model=VoiceSummary)
def name_voice(voice_id: str, body: NameBody, vm: VoiceMemory = Depends(_vm)) -> VoiceSummary:
    _voice(vm, voice_id)
    try:
        return views.voice_summary(vm.db, naming.name_voice(vm.db, voice_id, body.name))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/voices/{voice_id}/merge", response_model=VoiceSummary)
def merge_voice(voice_id: str, body: MergeBody, vm: VoiceMemory = Depends(_vm)) -> VoiceSummary:
    _voice(vm, voice_id)
    _voice(vm, body.into)
    if body.into == voice_id:
        raise HTTPException(422, "cannot merge a voice into itself")
    return views.voice_summary(vm.db, naming.merge_voices(vm.db, body.into, voice_id, vm.cfg))


@router.delete("/voices/{voice_id}")
def forget_voice(voice_id: str, vm: VoiceMemory = Depends(_vm)) -> dict[str, str]:
    _voice(vm, voice_id)
    naming.forget_voice(vm.db, voice_id)
    return {"forgotten": voice_id}


@router.get("/sessions/{session_id}/voices", response_model=SessionVoices)
def session_voices(session_id: str, vm: VoiceMemory = Depends(_vm)) -> SessionVoices:
    if vm.db.get_session(session_id) is None:
        raise HTTPException(404, f"session {session_id} not found")
    if not vm.enabled:
        return SessionVoices(session_id=session_id, status="off")
    return views.session_view(vm.db, session_id, True)
