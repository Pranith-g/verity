"""What each application's reference model is, written out, and why none of the benchmark functions is used.

The benchmark functions (Peaks, Rastrigin, ...) are abstract test landscapes for checking the learner.
Their inputs and outputs carry no units and no physical meaning, so they cannot answer "what is PM2.5 at
8 am in still air". Each application therefore has its own reference model; this module holds the
plain-language explanation the web app shows next to it. The landscape comparison itself (peak and
valley counts) is measured, in ``services/applications.py``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelCard:
    function_name: str
    formula: tuple[str, ...]  # one equation per line, plain text
    terms: tuple[tuple[str, str], ...]  # (symbol, meaning)
    shape: str  # the landscape this produces, in one sentence
    why_not: dict[str, str]  # benchmark key -> why it does not fit this application


GENERAL = (
    "The benchmark functions are abstract test landscapes. Their inputs and outputs have no units and no physical "
    "meaning, so none of them can say what the output is at a real hour, wind speed, weekday or date. They exist to "
    "test the learner on surfaces whose every peak is known (see the Live benchmark page). An application needs a "
    "model of the real process, so each one has its own function, built from terms you can name and check."
)

GAUSS = ("g(x; μ, s)", "a smooth bump centred on μ with width s: exp(−((x − μ)/s)²)")

CARDS: dict[str, ModelCard] = {
    "air-quality": ModelCard(
        function_name="Emission × dilution × trapping",
        formula=(
            "PM2.5(h, w) = 9 + E(h) · D(w) · T(h, w)",
            "E(h) = 16 + 58·g(h; 8.6, 1.7) + 50·g(h; 19.2, 2.1) + 10·g(h; 13.5, 2.6)",
            "D(w) = 1 / (1 + 0.42·(w − 0.5) + 0.012·(w − 0.5)²)",
            "T(h, w) = 1 + 1.1·N(h)·exp(−w / 2.2),   N(h) = ½·(1 + cos(2π(h − 2.5)/24))",
        ),
        terms=(
            ("h, w", "hour of day (0–24) and wind speed (0.5–12 m/s)"),
            ("9", "regional background PM2.5 that is always present, µg/m³"),
            ("E(h)", "emissions through the day: morning rush, evening rush and cooking, a smaller midday bump"),
            ("D(w)", "dilution: stronger wind spreads the same emissions through more air"),
            ("T(h, w)", "trapping: a shallow night-time boundary layer holds pollution near the ground in still air"),
            ("N(h)", "how 'night' the hour is, highest at 02:30"),
            GAUSS,
        ),
        shape="Two pollution peaks at the rush hours in still air, falling smoothly as the wind picks up.",
        why_not={
            "peaks": "The closest shape, a few smooth hills and hollows, but they sit wherever the formula puts them. "
            "Pollution peaks have to sit at the rush hours and in still air, and grow as the wind drops.",
            "camel": "Six valleys in a mirror-symmetric pattern. Air pollution has no symmetry and only two daily "
            "peaks.",
            "himmelblau": "Four identical minima around a bump. Clean air is one broad low (windy afternoons), not "
            "four equal pits.",
            "rosenbrock": "A curved, nearly flat banana valley. PM2.5 falls steadily with wind; there is no curved "
            "valley.",
            "easom": "Flat everywhere except one narrow well. Pollution changes across the whole day, not in one "
            "pinhole.",
            "rastrigin": "An egg-box of 41 evenly spaced bumps. Pollution has two peaks a day, not a periodic grid.",
            "michalewicz": "Needle-thin channels. Pollution varies smoothly, over hours and metres per second.",
        },
    ),
    "traffic": ModelCard(
        function_name="Rush-hour waves × weekday pattern",
        formula=(
            "C(h, d) = Night + AM + PM + Lunch + Leisure",
            "AM = 60·g(h; 8.8, 1.6)·W(d)·(1 + 0.15·Mon(d) − 0.2·Fri(d))",
            "PM = 66·g(h; 18.1, 2.0)·W(d)·(1 + 0.38·Fri(d))",
            "Lunch = 14·g(h; 13.2, 2.2)·W(d),   Leisure = 42·g(h; 14.8, 2.7)·(1 − W(d))·(1 − 0.35·g(d; 6, 0.6))",
            "Night = 3 + 2·g(h; 23, 1.5)·(Fri(d) + 1 − W(d)),   W(d) = 1 / (1 + exp((d − 4.55)/0.42))",
        ),
        terms=(
            ("h, d", "hour of day (0–24) and day of week (0 = Monday … 6 = Sunday)"),
            ("C", "congestion: extra travel time over free flow, %"),
            ("W(d)", "how much of a working day d is: about 1 Monday–Friday, about 0 at the weekend"),
            ("Mon(d), Fri(d)", "bumps on Monday and Friday: heavier Monday mornings, the worst Friday evenings"),
            ("AM, PM", "the two commuter waves, each about two to three hours wide"),
            ("Leisure", "the weekend's midday shopping and outing wave, quieter on Sunday"),
            GAUSS,
        ),
        shape="Two long ridges across the working week at the rush hours, and a softer midday wave at the weekend.",
        why_not={
            "peaks": "The closest by peak and valley count, but its hills are scattered. Traffic needs long ridges "
            "running across all five weekdays at the same hours.",
            "camel": "Symmetric valleys. The week is not symmetric: Friday evening is the worst, Sunday the quietest.",
            "himmelblau": "Four equal minima around a bump. Traffic's low is one long night-time trough.",
            "rosenbrock": "One curved valley. Traffic has two straight ridges (the rush hours) and a weekend plateau.",
            "easom": "One narrow well on a flat plain. Congestion is shaped by the clock all day long.",
            "rastrigin": "Periodic in both inputs. Traffic repeats along the hour axis only, and the weekend breaks "
            "the pattern.",
            "michalewicz": "Ridges along the axes, the nearest to rush-hour bands, but needle-thin and placed by a "
            "formula. Rush hours last two to three hours.",
        },
    ),
    "weather": ModelCard(
        function_name="Seasonal cycle + daily cycle",
        formula=(
            "T(d, h) = S(d) + A(d) · (0.88·cos φ + 0.12·cos 2φ),   φ = 2π(h − 14.5)/24",
            "S(d) = 26.5 + 6.2·g(d; 135, 36) − 4.6·Win(d) − 2.4·g(d; 215, 34) + 1.0·g(d; 292, 18)",
            "A(d) = 5.6 + 3.2·g(d; 95, 48) − 2.6·g(d; 215, 38) + 1.6·Win(d)",
            "Win(d) = g(d; 5, 42) + g(d; 370, 42)",
        ),
        terms=(
            ("d, h", "day of year (1–365) and hour of day (0–24)"),
            ("S(d)", "the day's mean temperature: May heat, monsoon cooling in Jul–Sep, an October warm spell"),
            ("A(d)", "the day-night swing: wide under dry spring skies, narrow under monsoon cloud"),
            ("Win(d)", "winter, wrapping round the new year: cooler days, clear skies, wide swings"),
            ("cos φ", "the daily wave, warmest at 14:30 and coolest around dawn"),
            GAUSS,
        ),
        shape="One dominant pre-monsoon heat dome in May afternoons, a monsoon dip, and a smooth daily wave all year.",
        why_not={
            "peaks": "The closest by peak and valley count, but its hills are of similar size. Temperature has one "
            "dominant May peak and a daily wave that never stops.",
            "camel": "Six valleys. Temperature has one cold season, not six separate basins.",
            "himmelblau": "Four identical minima. Winter nights form one broad cold region.",
            "rosenbrock": "A nearly flat curved valley. Temperature swings strongly with the hour every day.",
            "easom": "Flat with one well. Temperature is never flat across the year.",
            "rastrigin": "An egg-box of 41 bumps. The daily cycle is one smooth wave, not a grid of bumps.",
            "michalewicz": "Knife-edge channels. Temperature changes over weeks and hours, not along thin lines.",
        },
    ),
}
