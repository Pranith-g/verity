"""Database tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(UTC)


class Study(Base):
    """One surrogate being learned for one simulator."""

    __tablename__ = "studies"

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=_id)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    seed: Mapped[int] = mapped_column(Integer, default=1)
    max_runs: Mapped[int] = mapped_column(Integer, default=400)
    # inputs: [{"name", "low", "high"}, {"name", "low", "high"}]; output_name; min_depth_rel; min_depth_abs
    config: Mapped[dict] = mapped_column(JSON)
    demo_simulator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    declared_at: Mapped[int | None] = mapped_column(Integer, nullable=True)  # runs when the stop rule first passed
    history: Mapped[list] = mapped_column(JSON, default=list)

    runs: Mapped[list[Run]] = relationship(back_populates="study", cascade="all, delete-orphan")


class Run(Base):
    """One simulator run: suggested (pending) or reported back (done)."""

    __tablename__ = "runs"
    __table_args__ = (Index("ix_runs_study_status", "study_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(8), default="pending")  # pending | done
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)  # order in which results arrived
    u: Mapped[float] = mapped_column(Float)  # position on the unit square
    v: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(8))  # init | explore | verify | fill | manual
    predicted: Mapped[float | None] = mapped_column(Float, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    study: Mapped[Study] = relationship(back_populates="runs")


class RaceRecord(Base):
    """A finished (or running) three-way benchmark."""

    __tablename__ = "races"

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=_id)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    simulator: Mapped[str] = mapped_column(String(40))
    tau: Mapped[float] = mapped_column(Float)
    budget: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(8), default="running")  # running | done | failed | stopped
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
