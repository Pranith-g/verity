"""Benchmarks: three strategies on one built-in simulator, streamed live."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..core.simulators import SIMULATORS
from ..db import get_session
from ..models import RaceRecord
from ..schemas import RaceCreate, RaceOut, SimulatorOut
from ..services import races
from .deps import require_key

router = APIRouter(prefix="/api", tags=["benchmark"], dependencies=[Depends(require_key)])


@router.get("/simulators", response_model=list[SimulatorOut])
def simulators() -> list[SimulatorOut]:
    return [SimulatorOut(**{f: getattr(s, f) for f in SimulatorOut.model_fields}) for s in SIMULATORS.values()]


@router.post("/races", response_model=RaceOut, status_code=201)
def create_race(body: RaceCreate, session: Session = Depends(get_session)) -> RaceRecord:
    settings = get_settings()
    if body.simulator not in SIMULATORS:
        raise HTTPException(422, f"unknown simulator '{body.simulator}'")
    if body.budget > settings.race_max_budget:
        raise HTTPException(422, f"budget may be at most {settings.race_max_budget}")
    if races.running() >= settings.max_concurrent_races:
        raise HTTPException(429, "too many races are running; try again in a moment")
    race_id = races.start(body.simulator, body.tau, body.budget, body.seed)
    rec = session.get(RaceRecord, race_id)
    assert rec is not None
    return rec


@router.get("/races", response_model=list[RaceOut])
def list_races(session: Session = Depends(get_session)) -> list[RaceRecord]:
    return list(session.scalars(select(RaceRecord).order_by(RaceRecord.created_at.desc()).limit(50)))


@router.get("/races/{race_id}", response_model=RaceOut)
def get_race(race_id: str, session: Session = Depends(get_session)) -> RaceRecord:
    rec = session.get(RaceRecord, race_id)
    if rec is None:
        raise HTTPException(404, "race not found")
    return rec


@router.delete("/races/{race_id}", status_code=200)
def cancel_race(race_id: str, session: Session = Depends(get_session)) -> dict:
    """Stop a running race early, for example when its only viewer has moved on to another one."""
    if session.get(RaceRecord, race_id) is None:
        raise HTTPException(404, "race not found")
    return {"stopped": races.cancel(race_id)}


@router.get("/races/{race_id}/events")
async def race_events(race_id: str) -> StreamingResponse:
    """Server-sent events: one 'truth' event, then a 'step' per learner batch, then 'done'."""
    live = races.get_live(race_id)
    if live is None:
        raise HTTPException(410, "this race is no longer in memory; fetch its summary instead")

    async def stream() -> AsyncIterator[str]:
        i = 0
        idle = 0.0
        while True:
            while i < len(live.events):
                yield f"data: {json.dumps(live.events[i], separators=(',', ':'))}\n\n"
                i += 1
                idle = 0.0
            if live.done and i >= len(live.events):
                return
            await asyncio.sleep(0.03)
            idle += 0.03
            if idle >= 10:
                yield ": keep-alive\n\n"
                idle = 0.0

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
