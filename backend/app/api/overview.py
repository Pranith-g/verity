"""One call that summarises the whole service, for the web app's status bar and studies dashboard."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import __version__
from ..db import get_session
from ..models import RaceRecord, Run, Study
from ..schemas import OverviewOut
from ..services import autorun, races
from ..services.studies import study_out
from .deps import require_key

router = APIRouter(prefix="/api", tags=["service"], dependencies=[Depends(require_key)])

_STARTED = time.time()
BUCKETS = 24  # activity sparkline: 24 buckets
BUCKET_MIN = 5  # of 5 minutes each, so the last two hours


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite hands back naive timestamps


@router.get("/overview", response_model=OverviewOut)
def overview(session: Session = Depends(get_session)) -> OverviewOut:
    """Counts by study status, runs reported, races run, and runs reported per 5 minutes over the last 2 hours."""
    by_status = {"collecting": 0, "learning": 0, "ready": 0, "out_of_budget": 0}
    for study in session.scalars(select(Study).limit(500)):
        by_status[study_out(session, study).status] += 1

    runs_done = session.scalar(select(func.count()).select_from(Run).where(Run.status == "done")) or 0
    runs_pending = session.scalar(select(func.count()).select_from(Run).where(Run.status == "pending")) or 0
    races_total = session.scalar(select(func.count()).select_from(RaceRecord)) or 0

    now = datetime.now(UTC)
    since = now - timedelta(minutes=BUCKETS * BUCKET_MIN)
    activity = [0] * BUCKETS
    for (at,) in session.execute(select(Run.completed_at).where(Run.status == "done", Run.completed_at >= since)):
        if at is None:
            continue
        age = (now - _utc(at)).total_seconds() / 60
        i = BUCKETS - 1 - int(age // BUCKET_MIN)
        if 0 <= i < BUCKETS:
            activity[i] += 1

    return OverviewOut(
        version=__version__,
        uptime_s=round(time.time() - _STARTED, 1),
        studies=sum(by_status.values()),
        by_status=by_status,
        runs_done=runs_done,
        runs_pending=runs_pending,
        races_total=races_total,
        races_running=races.running(),
        autoruns_active=autorun.active_count(),
        activity=activity,
        activity_bucket_min=BUCKET_MIN,
    )
