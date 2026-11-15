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
    kind: str = Field(description='"test" for an analytic test function, "real" for a measured dataset')
    inputs: tuple[str, str]
    output: str
    source: str


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


# ---------------------------------------------------------------- real-world applications
class AppInputOut(BaseModel):
    key: str
    label: str
    unit: str
    low: float
    high: float
    step: float
    fmt: str


class AppBandOut(BaseModel):
    upto: float | None  # None for the open-ended top band
    label: str
    color: str
    advice: str


class AppExampleOut(BaseModel):
    label: str
    x1: float
    x2: float


class AppMetricsOut(BaseModel):
    rmse: float | None  # against the reference model on the 49 x 49 grid, output units
    mae: float | None
    r2: float | None
    max_error: float | None
    obs_fit: float | None  # mean |model - reading| over the field readings
    typical_miss: float | None  # 95% miss on fresh random runs (the learner's own estimate)


class AppHistoryOut(BaseModel):
    runs: int
    rmse: float
    r2: float
    ready: bool


class AppRunOut(BaseModel):
    x1: float
    x2: float
    u: float
    v: float
    value: float
    reason: str


class AppObservationOut(BaseModel):
    id: int
    x1: float
    x2: float
    u: float
    v: float
    value: float
    kind: str
    source: str
    before: float | None
    now: float | None  # what the current model says at the same point
    created_at: datetime


class AppFeatureOut(BaseModel):
    kind: str  # min | max
    x1: float
    x2: float
    value: float
    depth: float


class AppPointOut(BaseModel):
    x1: float
    x2: float
    u: float
    v: float
    reason: str


class AppSummaryOut(BaseModel):
    key: str
    name: str
    tagline: str
    description: str
    reference_name: str
    inputs: list[AppInputOut]
    output_label: str
    output_unit: str
    bands: list[AppBandOut]
    examples: list[AppExampleOut]
    hue: int
    budget: int
    status: Literal["idle", "training", "ready", "budget"]
    runs: int
    observations: int
    version: int
    metrics: AppMetricsOut


class AppStateOut(AppSummaryOut):
    grid: int
    z: str | None  # base64 little-endian float32, grid*grid, node i = a*grid + b at (a, b)/(grid-1)
    z_min: float | None
    z_max: float | None
    sim_runs: list[AppRunOut]
    readings: list[AppObservationOut]
    features: list[AppFeatureOut]
    suggestions: list[AppPointOut]
    history: list[AppHistoryOut]
    stop: StopOut | None
    train_ms: float | None
    trained_at: datetime | None


class AppTrainIn(BaseModel):
    reset: bool = Field(default=True, description="Throw away the reference runs and learn again from scratch")
    pace_ms: int = Field(default=60, ge=0, le=1000, description="Pause between batches, so the web app can animate")
    budget: int | None = Field(default=None, ge=24, le=600, description="Most reference runs to buy (default per app)")


class AppPredictIn(BaseModel):
    x1: float
    x2: float

    @field_validator("x1", "x2")
    @classmethod
    def _finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("must be a finite number")
        return v


class AppDetailOut(BaseModel):
    label: str
    value: str


class AppPredictOut(BaseModel):
    x1: float
    x2: float
    value: float
    low: float  # estimated 95% interval
    high: float
    band: AppBandOut
    reference: float  # what the expensive reference model says (shown for checking)
    error: float
    sensitivity: list[float]  # change in output per unit of each input, at this point
    details: list[AppDetailOut]
    nearest: float  # distance to the closest data point, as a share of the map
    micros: float  # time to evaluate the surrogate, microseconds
    version: int


class AppReadingIn(BaseModel):
    x1: float
    x2: float
    value: float
    kind: Literal["sensor", "verified"] = "sensor"

    @field_validator("x1", "x2", "value")
    @classmethod
    def _finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("must be a finite number")
        return v


class AppReadingsIn(BaseModel):
    readings: list[AppReadingIn] = Field(min_length=1, max_length=500)
    source: Literal["manual", "csv", "sample", "feed"] = "manual"


class AppSampleIn(BaseModel):
    n: int = Field(default=1, ge=1, le=50)
    source: Literal["sample", "feed"] = "sample"


class AppRetrainItemOut(BaseModel):
    id: int
    x1: float
    x2: float
    value: float
    before: float  # model's prediction at the point before retraining
    after: float  # after retraining
    tolerance: float  # how far off the model may be before the reading counts as a surprise
    surprise: bool  # |before - value| > tolerance (the allowed miss, widened by sensor noise for sensor readings)


class AppRetrainOut(BaseModel):
    items: list[AppRetrainItemOut]
    version: int
    retrain_ms: float
    metrics_before: AppMetricsOut
    metrics_after: AppMetricsOut
    allowed_miss: float
    max_shift: float  # largest change of the surface anywhere on the grid, output units
    suggestions: list[AppPointOut]


class AppLandscapeOut(BaseModel):
    peaks: int  # local maxima deeper than 5% of the output range
    valleys: int
    thumb: str  # base64 little-endian float32, thumb_grid*thumb_grid, same node layout as the main grid


class AppTermOut(BaseModel):
    symbol: str
    meaning: str


class AppBenchmarkOut(BaseModel):
    key: str
    name: str
    note: str
    landscape: AppLandscapeOut
    distance: float  # between (peaks, valleys) counts of the benchmark and the application
    closest: bool
    reason: str


class AppModelOut(BaseModel):
    function_name: str
    formula: list[str]
    terms: list[AppTermOut]
    shape: str
    general: str
    thumb_grid: int
    landscape: AppLandscapeOut
    benchmarks: list[AppBenchmarkOut]
