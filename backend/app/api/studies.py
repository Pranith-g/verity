"""Studies: bring your own simulator, ask which runs to buy, tell what came back."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Study
from ..schemas import AskIn, AskOut, AutorunIn, StateOut, StudyCreate, StudyOut, TellIn, TellOut
from ..services import autorun, studies
from .deps import require_key

router = APIRouter(prefix="/api/studies", tags=["studies"], dependencies=[Depends(require_key)])


@router.post("", response_model=StudyOut, status_code=201)
def create_study(body: StudyCreate, session: Session = Depends(get_session)) -> StudyOut:
    return studies.study_out(session, studies.create(session, body))


@router.get("", response_model=list[StudyOut])
def list_studies(session: Session = Depends(get_session)) -> list[StudyOut]:
    rows = session.scalars(select(Study).order_by(Study.created_at.desc()).limit(200))
    return [studies.study_out(session, s, autorun.is_active(s.id)) for s in rows]


@router.get("/{study_id}", response_model=StudyOut)
def get_study(study_id: str, session: Session = Depends(get_session)) -> StudyOut:
    return studies.study_out(session, studies.get(session, study_id), autorun.is_active(study_id))


@router.delete("/{study_id}", status_code=204)
def delete_study(study_id: str, session: Session = Depends(get_session)) -> Response:
    study = studies.get(session, study_id)
    autorun.stop(study_id)
    session.delete(study)
    session.commit()
    studies.forget(study_id)
    return Response(status_code=204)


@router.post("/{study_id}/ask", response_model=AskOut)
def ask(study_id: str, body: AskIn | None = None, session: Session = Depends(get_session)) -> AskOut:
    """Name the next runs to buy. Suggestions stay reserved until their results are reported."""
    study = studies.get(session, study_id)
    suggestions, message = studies.ask(session, study, (body or AskIn()).n)
    return AskOut(suggestions=suggestions, message=message)


@router.post("/{study_id}/tell", response_model=TellOut)
def tell(study_id: str, body: TellIn, session: Session = Depends(get_session)) -> TellOut:
    """Report results, either for suggested runs (run_id) or for points you chose yourself (x1, x2)."""
    study = studies.get(session, study_id)
    accepted, done, stop = studies.tell(session, study, body.results)
    return TellOut(accepted=accepted, runs_done=done, stop=stop)


@router.get("/{study_id}/state", response_model=StateOut)
def state(study_id: str, session: Session = Depends(get_session)) -> StateOut:
    """Everything needed to draw the study: the surrogate, the runs, its features and the stop rule."""
    return studies.state(session, studies.get(session, study_id), autorun.is_active(study_id))


@router.post("/{study_id}/autorun", status_code=202)
def start_autorun(study_id: str, body: AutorunIn | None = None, session: Session = Depends(get_session)) -> dict:
    """Demo studies only: let the server play the simulator's part."""
    study = studies.get(session, study_id)
    if study.demo_simulator is None:
        raise HTTPException(409, "only studies created with a demo_simulator can run by themselves")
    body = body or AutorunIn()
    started = autorun.start(study_id, body.batch, body.until)
    return {"started": started, "running": True}


@router.delete("/{study_id}/autorun", status_code=200)
def stop_autorun(study_id: str, session: Session = Depends(get_session)) -> dict:
    studies.get(session, study_id)
    return {"stopped": autorun.stop(study_id)}
