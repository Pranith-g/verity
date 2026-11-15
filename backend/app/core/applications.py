"""Real-world applications: three city-scale prediction problems, each a function of two inputs.

Each application pairs an expensive *reference model* (here a physically shaped closed form that
stands in for a dispersion model, a traffic assignment model or a weather model) with the Verify
learner, which decides which reference runs to buy and when the fast surrogate is good enough.
Field readings that people add later are blended into the surrogate on top of those runs.

The reference models are synthetic but calibrated to realistic magnitudes; they are not
measurements. The output bands use published category breakpoints where one exists (India's
National Air Quality Index for PM2.5).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

Array = np.ndarray


@dataclass(frozen=True)
class InputDef:
    key: str
    label: str
    unit: str
    low: float
    high: float
    step: float
    fmt: str = "number"  # number | hour | weekday | doy (how the web app writes a value)


@dataclass(frozen=True)
class Band:
    upto: float  # upper edge of the band (inclusive); the last band uses inf
    label: str
    color: str
    advice: str


@dataclass(frozen=True)
class Application:
    key: str
    name: str
    tagline: str
    description: str
    reference_name: str  # what the expensive model stands for
    inputs: tuple[InputDef, InputDef]
    output_label: str
    output_unit: str
    bands: tuple[Band, ...]
    truth: Callable[[Array, Array], Array]
    noise: Callable[[Array], Array]  # standard deviation of a field reading, given the true value
    details: Callable[[float, float, float], list[tuple[str, str]]]
    hue: int  # accent hue for the web app
    budget: int = 260
    examples: tuple[tuple[str, float, float], ...] = field(default_factory=tuple)

    @property
    def box(self) -> tuple[float, float, float, float]:
        a, b = self.inputs
        return (a.low, a.high, b.low, b.high)

    def to_unit(self, x1: Array, x2: Array) -> tuple[Array, Array]:
        a, b = self.inputs
        return (np.asarray(x1, float) - a.low) / (a.high - a.low), (np.asarray(x2, float) - b.low) / (b.high - b.low)

    def to_real(self, u: Array, v: Array) -> tuple[Array, Array]:
        a, b = self.inputs
        return a.low + np.asarray(u, float) * (a.high - a.low), b.low + np.asarray(v, float) * (b.high - b.low)

    def truth_unit(self, uv: Array) -> Array:
        uv = np.atleast_2d(np.asarray(uv, dtype=float))
        x1, x2 = self.to_real(uv[:, 0], uv[:, 1])
        return np.asarray(self.truth(x1, x2), dtype=float)

    def band(self, value: float) -> Band:
        for b in self.bands:
            if value <= b.upto:
                return b
        return self.bands[-1]


def _g(x: Array, mu: float, s: float) -> Array:
    return np.exp(-(((x - mu) / s) ** 2))


# ---------------------------------------------------------------- air quality
def _pm25(hour: Array, wind: Array) -> Array:
    """PM2.5 (µg/m³) by hour of day and wind speed.

    Emissions follow the traffic and cooking cycle (morning and evening peaks); wind dilutes them;
    a shallow night-time boundary layer traps them when the air is still.
    """
    emission = 16 + 58 * _g(hour, 8.6, 1.7) + 50 * _g(hour, 19.2, 2.1) + 10 * _g(hour, 13.5, 2.6)
    dilution = 1.0 / (1.0 + 0.42 * (wind - 0.5) + 0.012 * (wind - 0.5) ** 2)
    night = 0.5 * (1 + np.cos(2 * np.pi * (hour - 2.5) / 24))
    trap = 1.0 + 1.1 * night * np.exp(-wind / 2.2)
    return 9 + emission * dilution * trap


def _pm25_noise(v: Array) -> Array:
    return 2.0 + 0.07 * np.abs(v)


_NAQI = [(0, 30, 0, 50), (30, 60, 50, 100), (60, 90, 100, 200), (90, 120, 200, 300), (120, 250, 300, 400)]


def naqi_pm25(c: float) -> float:
    """India NAQI sub-index for 24-hour PM2.5 (CPCB breakpoints), linear inside each band."""
    c = max(0.0, c)
    for lo, hi, ilo, ihi in _NAQI:
        if c <= hi:
            return ilo + (c - lo) * (ihi - ilo) / (hi - lo)
    return min(500.0, 400 + (c - 250) * 100 / 130)


def _air_details(hour: float, wind: float, value: float) -> list[tuple[str, str]]:
    who = value / 15.0
    return [
        ("AQI sub-index (NAQI)", f"{naqi_pm25(value):.0f}"),
        ("vs WHO 24-h guideline", f"{who:.1f}x"),
        ("Dilution by wind", f"{100 * (1 - 1 / (1 + 0.42 * (wind - 0.5))):.0f}%"),
    ]


AIR = Application(
    key="air-quality",
    name="Air quality",
    tagline="PM2.5 forecast from the hour of day and the wind",
    description=(
        "Fine-particle pollution in a busy city. Rush-hour emissions push PM2.5 up twice a day; wind "
        "dilutes it and a still night traps it near the ground. The surrogate replaces a slow "
        "dispersion model, so a forecast takes microseconds instead of minutes."
    ),
    reference_name="Dispersion model",
    inputs=(
        InputDef("hour", "Hour of day", "h", 0.0, 24.0, 0.25, "hour"),
        InputDef("wind", "Wind speed", "m/s", 0.5, 12.0, 0.1),
    ),
    output_label="PM2.5",
    output_unit="µg/m³",
    bands=(
        Band(30, "Good", "#2ee59d", "Minimal impact. A good time to be outdoors."),
        Band(60, "Satisfactory", "#a3e635", "Minor breathing discomfort for sensitive people."),
        Band(90, "Moderate", "#ffc24b", "Sensitive groups should shorten long outdoor exertion."),
        Band(120, "Poor", "#ff8a3d", "Breathing discomfort for most people on long exposure."),
        Band(250, "Very poor", "#ff5468", "Respiratory illness on prolonged exposure. Wear a mask."),
        Band(float("inf"), "Severe", "#c026d3", "Affects healthy people too. Stay indoors."),
    ),
    truth=_pm25,
    noise=_pm25_noise,
    details=_air_details,
    hue=150,
    examples=(("Morning rush, still air", 8.5, 1.0), ("Windy afternoon", 14.0, 8.0), ("Calm midnight", 0.0, 1.5)),
)


# ---------------------------------------------------------------- traffic
def _congestion(hour: Array, day: Array) -> Array:
    """Congestion level (% extra travel time over free flow) by hour of day and day of week (0 = Monday)."""
    weekday = 1.0 / (1.0 + np.exp((day - 4.55) / 0.42))
    weekend = 1.0 - weekday
    friday = _g(day, 4.0, 0.75)
    monday = _g(day, 0.0, 1.2)
    am = 60 * _g(hour, 8.8, 1.6) * weekday * (1 + 0.15 * monday - 0.2 * friday)
    pm = 66 * _g(hour, 18.1, 2.0) * weekday * (1 + 0.38 * friday)
    lunch = 14 * _g(hour, 13.2, 2.2) * weekday
    leisure = 42 * _g(hour, 14.8, 2.7) * weekend * (1 - 0.35 * _g(day, 6.0, 0.6))
    night = 3 + 2 * _g(hour, 23.0, 1.5) * (friday + weekend)
    return night + am + pm + lunch + leisure


def _congestion_noise(v: Array) -> Array:
    return 2.5 + 0.06 * np.abs(v)


def _traffic_details(hour: float, day: float, value: float) -> list[tuple[str, str]]:
    trip = 12.0 * (1 + max(0.0, value) / 100)  # a 10 km trip that takes 12 minutes in free flow
    speed = 50.0 / (1 + max(0.0, value) / 100)
    return [
        ("10 km trip takes", f"{trip:.0f} min"),
        ("Average speed", f"{speed:.0f} km/h"),
        ("Time lost per trip", f"{trip - 12:.0f} min"),
    ]


TRAFFIC = Application(
    key="traffic",
    name="Traffic flow",
    tagline="Congestion forecast across the week, hour by hour",
    description=(
        "Road congestion on a city's arterial network, as extra travel time over free flow. Weekday "
        "commutes peak in the morning and the evening (worst on Friday evening); weekends trade them "
        "for a midday leisure wave. The surrogate stands in for a traffic assignment model."
    ),
    reference_name="Traffic assignment model",
    inputs=(
        InputDef("hour", "Hour of day", "h", 0.0, 24.0, 0.25, "hour"),
        InputDef("day", "Day of week", "", 0.0, 6.0, 1.0, "weekday"),
    ),
    output_label="Congestion",
    output_unit="%",
    bands=(
        Band(20, "Free flow", "#2ee59d", "Roads are open. Any route works."),
        Band(40, "Light", "#a3e635", "A few slow spots. Allow a little extra time."),
        Band(60, "Moderate", "#ffc24b", "Busy roads. Consider leaving 15 minutes early."),
        Band(80, "Heavy", "#ff8a3d", "Expect queues at junctions. Public transport may be faster."),
        Band(float("inf"), "Gridlock", "#ff5468", "Stop-and-go traffic. Shift the trip if you can."),
    ),
    truth=_congestion,
    noise=_congestion_noise,
    details=_traffic_details,
    hue=28,
    budget=340,
    examples=(("Monday 9 am", 9.0, 0.0), ("Friday 6 pm", 18.0, 4.0), ("Sunday 3 pm", 15.0, 6.0)),
)


# ---------------------------------------------------------------- weather
def _temperature(doy: Array, hour: Array) -> Array:
    """Air temperature (°C) in a hot, monsoon-climate city by day of year and hour of day.

    Hottest in May before the monsoon, cooled and damped by monsoon cloud in July-September,
    a brief October warm spell, and cool clear winter nights.
    """
    winter = _g(doy, 5.0, 42.0) + _g(doy, 370.0, 42.0)
    season = 26.5 + 6.2 * _g(doy, 135.0, 36.0) - 4.6 * winter - 2.4 * _g(doy, 215.0, 34.0) + 1.0 * _g(doy, 292.0, 18.0)
    swing = 5.6 + 3.2 * _g(doy, 95.0, 48.0) - 2.6 * _g(doy, 215.0, 38.0) + 1.6 * winter
    phase = 2 * np.pi * (hour - 14.5) / 24
    shape = 0.88 * np.cos(phase) + 0.12 * np.cos(2 * phase)
    return season + swing * shape


def _temperature_noise(v: Array) -> Array:
    return np.full_like(np.asarray(v, float), 1.1)


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _weather_details(doy: float, hour: float, value: float) -> list[tuple[str, str]]:
    hours = np.linspace(0, 24, 49)
    day = _temperature(np.full_like(hours, doy), hours)
    return [
        ("Fahrenheit", f"{value * 9 / 5 + 32:.0f} °F"),
        ("Day's range (model)", f"{day.min():.0f}–{day.max():.0f} °C"),
        ("Season", _season(doy)),
    ]


def _season(doy: float) -> str:
    if doy < 60 or doy >= 335:
        return "Winter"
    if doy < 155:
        return "Summer"
    if doy < 275:
        return "Monsoon"
    return "Post-monsoon"


WEATHER = Application(
    key="weather",
    name="Weather",
    tagline="Temperature forecast through the year and the day",
    description=(
        "Near-surface air temperature in a hot monsoon-climate city. A pre-monsoon heat peak in May, "
        "cloudy monsoon months with small day-night swings, and cool clear winter nights. The surrogate "
        "replaces a numerical weather model run for each date and hour."
    ),
    reference_name="Numerical weather model",
    inputs=(
        InputDef("doy", "Day of year", "", 1.0, 365.0, 1.0, "doy"),
        InputDef("hour", "Hour of day", "h", 0.0, 24.0, 0.25, "hour"),
    ),
    output_label="Temperature",
    output_unit="°C",
    bands=(
        Band(10, "Cold", "#60a5fa", "Layer up, especially early in the morning."),
        Band(18, "Cool", "#22d3ee", "A light jacket is enough."),
        Band(26, "Pleasant", "#2ee59d", "Comfortable for most outdoor plans."),
        Band(32, "Warm", "#ffc24b", "Stay hydrated outdoors."),
        Band(38, "Hot", "#ff8a3d", "Avoid strenuous activity in the afternoon sun."),
        Band(float("inf"), "Extreme heat", "#ff5468", "Heat-wave conditions. Stay indoors at midday."),
    ),
    truth=_temperature,
    noise=_temperature_noise,
    details=_weather_details,
    hue=205,
    examples=(("15 May, 3 pm", 135.0, 15.0), ("1 Jan, 6 am", 1.0, 6.0), ("1 Aug, noon", 213.0, 12.0)),
)


APPLICATIONS: dict[str, Application] = {a.key: a for a in (AIR, TRAFFIC, WEATHER)}
