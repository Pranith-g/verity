"""Drive a demo study with a built-in simulator, through the same ask/tell path a real client uses."""

from __future__ import annotations

import logging
import threading

import numpy as np

from ..core.simulators import SIMULATORS
from ..db import SessionLocal
from ..models import Run, Study
from ..schemas import ResultIn
from . import studies

log = logging.getLogger("vdc.autorun")

_active: dict[str, threading.Event] = {}
_guard = threading.Lock()


def is_active(study_id: str) -> bool:
    with _guard:
        return study_id in _active


def active_count() -> int:
    with _guard:
        return len(_active)


def stop(study_id: str) -> bool:
    with _guard:
        ev = _active.get(study_id)
    if ev is not None:
        ev.set()
    return ev is not None


def start(study_id: str, batch: int, until: str) -> bool:
    with _guard:
        if study_id in _active:
            return False
        cancel = threading.Event()
        _active[study_id] = cancel
    name = f"autorun-{study_id}"
    threading.Thread(target=_loop, args=(study_id, batch, until, cancel), daemon=True, name=name).start()
    return True


def _loop(study_id: str, batch: int, until: str, cancel: threading.Event) -> None:
    try:
        while not cancel.is_set():
            with SessionLocal() as session:
                study = session.get(Study, study_id)
                if study is None or study.demo_simulator is None:
                    return
                sim = SIMULATORS[study.demo_simulator]
                if until == "ready" and study.declared_at is not None:
                    return
                suggestions, _ = studies.ask(session, study, batch)
                # Also pick up anything left pending by an earlier, interrupted loop.
                pending = studies._pending(session, study)
                if not pending:
                    return
                results = [ResultIn(run_id=r.id, value=float(sim.at_unit(np.array([[r.u, r.v]]))[0])) for r in pending]
                del suggestions
                studies.tell(session, study, results)
                session.expire_all()
            cancel.wait(0.05)
    except Exception:  # pragma: no cover - a background thread must never die silently
        log.exception("autorun for study %s failed", study_id)
    finally:
        with _guard:
            _active.pop(study_id, None)


__all__ = ["Run", "is_active", "start", "stop"]
