"""Real-world applications: air quality, traffic flow and weather, each learned with Verify."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..core.applications import APPLICATIONS
from ..db import get_session
from ..schemas import (
    AppModelOut,
    AppPredictIn,
    AppPredictOut,
    AppReadingsIn,
    AppRetrainOut,
    AppSampleIn,
    AppStateOut,
    AppSummaryOut,
    AppTrainIn,
)
from ..services import applications as apps
from .deps import require_key

router = APIRouter(prefix="/api/apps", tags=["applications"], dependencies=[Depends(require_key)])


@router.get("", response_model=list[AppSummaryOut])
def list_apps(session: Session = Depends(get_session)) -> list[AppSummaryOut]:
    """Every application with its status and accuracy. The first call starts training them."""
    return [apps.summary(session, key) for key in APPLICATIONS]


@router.get("/{key}", response_model=AppStateOut)
def get_app(key: str, session: Session = Depends(get_session)) -> AppStateOut:
    """Everything needed to draw one application: surrogate surface, runs, readings, features, accuracy."""
    return apps.state(session, key)


@router.get("/{key}/model", response_model=AppModelOut)
def model(key: str) -> AppModelOut:
    """The application's own reference function, term by term, and why no benchmark function is used for it."""
    return apps.model_card(key)


@router.post("/{key}/train", status_code=202)
def train(key: str, body: AppTrainIn | None = None, session: Session = Depends(get_session)) -> dict:
    """Learn the surrogate again with the Verify learner (from scratch unless reset is false)."""
    apps.ensure(session, key)
    body = body or AppTrainIn()
    apps.start_training(key, reset=body.reset, pace_ms=body.pace_ms, budget=body.budget)
    return {"started": True}


@router.post("/{key}/predict", response_model=AppPredictOut)
def predict(key: str, body: AppPredictIn, session: Session = Depends(get_session)) -> AppPredictOut:
    """Forecast the output for one pair of inputs, with an estimated 95% interval and its category."""
    return apps.predict(session, key, body.x1, body.x2)


@router.post("/{key}/readings", response_model=AppRetrainOut)
def add_readings(key: str, body: AppReadingsIn, session: Session = Depends(get_session)) -> AppRetrainOut:
    """Add field readings; the surrogate is retrained on them at once and the before/after is returned."""
    return apps.add_readings(session, key, body.readings, body.source)


@router.post("/{key}/readings/sample", response_model=AppRetrainOut)
def sample_readings(
    key: str, body: AppSampleIn | None = None, session: Session = Depends(get_session)
) -> AppRetrainOut:
    """Simulate field sensors: readings at random places with realistic noise, then retrain."""
    body = body or AppSampleIn()
    return apps.sample_readings(session, key, body.n, body.source)


@router.delete("/{key}/readings/{reading_id}", status_code=204)
def delete_reading(key: str, reading_id: int, session: Session = Depends(get_session)) -> Response:
    apps.delete_reading(session, key, reading_id)
    return Response(status_code=204)


@router.delete("/{key}/readings")
def clear_readings(key: str, session: Session = Depends(get_session)) -> dict:
    """Remove every field reading and go back to the reference-model surrogate."""
    return {"removed": apps.clear_readings(session, key)}
