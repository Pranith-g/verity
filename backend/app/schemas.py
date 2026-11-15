"""Request and response shapes."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InputSpec(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    low: float
    high: float

    @model_validator(mode="after")
    def _ordered(self) -> InputSpec:
        if not (math.isfinite(self.low) and math.isfinite(self.high)) or self.high <= self.low:
            raise ValueError("high must be greater than low, and both must be finite")
        return self


class StudyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    inputs: list[InputSpec] | None = Field(
        default=None, description="Exactly two inputs. Optional when demo_simulator is given."
    )
    output_name: str = Field(default="output", max_length=40)
    min_depth_rel: float = Field(default=0.05, ge=0.01, le=0.5, description="Share of the observed output range")
    min_depth_abs: float | None = Field(default=None, gt=0, description="Output units; overrides the relative value")
    max_runs: int = Field(default=400, ge=20)
    seed: int = Field(default=1, ge=0, le=2**31 - 1)
    demo_simulator: str | None = None

    @model_validator(mode="after")
    def _two_inputs(self) -> StudyCreate:
        if self.demo_simulator is None and (self.inputs is None or len(self.inputs) != 2):
            raise ValueError("a study needs exactly two inputs (or a demo_simulator)")
        if self.inputs is not None and len(self.inputs) != 2:
            raise ValueError("a study needs exactly two inputs")
        return self


class StopOut(BaseModel):
    ready: bool
    features_checked: bool
    surprises_small: bool
    no_blind_spot: bool
    unchecked: int
    deep_features: int
    worst_recent_miss: float | None
    typical_miss: float | None
    allowed_miss: float
    largest_gap: float
    max_gap: float
    depth: float
    notes: list[str] = []


class StudyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: datetime
    inputs: list[InputSpec]
    output_name: str
    min_depth_rel: float
    min_depth_abs: float | None
    max_runs: int
    seed: int
    demo_simulator: str | None
    runs_done: int
    runs_pending: int
    declared_at: int | None
    status: Literal["collecting", "learning", "ready", "out_of_budget"]
    autorun: bool = False


class SuggestionOut(BaseModel):
    run_id: int
    x1: float
    x2: float
    reason: str
    predicted: float | None


class AskIn(BaseModel):
    n: int = Field(default=6, ge=1)


class AskOut(BaseModel):
    suggestions: list[SuggestionOut]
    message: str | None = None


class ResultIn(BaseModel):
    run_id: int | None = None
    x1: float | None = None
    x2: float | None = None
    value: float

    @field_validator("value")
    @classmethod
    def _finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("value must be a finite number")
        return v

    @model_validator(mode="after")
    def _target(self) -> ResultIn:
        if self.run_id is None and (self.x1 is None or self.x2 is None):
            raise ValueError("give either run_id, or both x1 and x2")
        return self


class TellIn(BaseModel):
    results: list[ResultIn] = Field(min_length=1, max_length=256)


class TellOut(BaseModel):
    accepted: int
    runs_done: int
    stop: StopOut | None


class RunOut(BaseModel):
    id: int
    status: str
    seq: int | None
    u: float
    v: float
    x1: float
    x2: float
    reason: str
    predicted: float | None
    value: float | None


class FeatureOut(BaseModel):
    kind: Literal["min", "max"]
    u: float
    v: float
    x1: float
    x2: float
    value: float
    depth: float
    deep: bool
    checked: bool


class StateOut(BaseModel):
    study: StudyOut
    grid: int
    z: str | None  # base64 float32, grid*grid, node i = a*grid + b
    z_min: float | None
    z_max: float | None
    runs: list[RunOut]
    features: list[FeatureOut]
    stop: StopOut | None
    history: list[dict]


class AutorunIn(BaseModel):
    batch: int = Field(default=6, ge=1, le=16)
    until: Literal["ready", "budget"] = "ready"


class SimulatorOut(BaseModel):
    key: str
    name: str
    note: str
    box: tuple[float, float, float, float]


class RaceCreate(BaseModel):
    simulator: str
    tau: float = Field(default=0.05, ge=0.01, le=0.5)
    budget: int = Field(default=360, ge=60)
    seed: int = Field(default=1, ge=0, le=2**31 - 1)


class RaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    simulator: str
    tau: float
    budget: int
    seed: int
    status: str
    summary: dict | None


class OverviewOut(BaseModel):
    version: str
    uptime_s: float
    studies: int
    by_status: dict[str, int]
    runs_done: int
    runs_pending: int
    races_total: int
    races_running: int
    autoruns_active: int
    activity: list[int]  # runs reported per bucket, oldest first
    activity_bucket_min: int
