# Verify, Don't Chase

A service that helps you build a fast stand-in (a surrogate) for a slow simulator with as few
simulator runs as possible. You run the simulator; the service tells you **which runs to buy next**
and **when you can stop**.

It has two parts:

- **API** (`backend/`, Python + FastAPI): studies with an ask/tell loop, a stop rule, and a
  three-way benchmark.
- **Web app** (`frontend/`, React + TypeScript): a live benchmark page, a workbench for your
  own studies, and three real-world applications (air quality, traffic flow, weather).

## How it works

1. **Hunt on the stand-in.** After every batch the service fits a smooth surface through the runs
   so far and lists that surface's peaks, valleys and passes, each with a depth. This costs no
   simulator time.
2. **Pay only to check.** The deepest unchecked feature gets one run on top of it, a few beside it,
   and one more wherever a bowl fitted to those runs says the real bottom is.
3. **Keep an honest error estimate.** About a third of each batch goes to fresh random points and
   the biggest blind spot. Every run is predicted before it is bought, so every run is also a test.
4. **Stop on evidence.** The stop rule passes when every deep feature has been checked, the latest
   24 runs all missed by less than half the depth you care about, and no blind spot is wider than
   7% of the map.

## Run it locally

Two terminals.

```bash
# 1. API on http://localhost:8000  (interactive reference at /docs)
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload

# 2. Web app on http://localhost:5173
cd frontend
npm install
npm run dev
```

Or as one container (API and web app on port 8000):

```bash
docker compose up --build
```

## Use it from code

```bash
python examples/client.py
```

The loop is three calls:

```bash
# create a study: two inputs with their ranges
curl -X POST localhost:8000/api/studies -H 'Content-Type: application/json' -d '{
  "name": "Wing lift",
  "inputs": [{"name": "angle", "low": -5, "high": 15}, {"name": "speed", "low": 20, "high": 90}],
  "output_name": "lift", "min_depth_rel": 0.05, "max_runs": 400}'

# ask which runs to buy
curl -X POST localhost:8000/api/studies/<id>/ask -H 'Content-Type: application/json' -d '{"n": 6}'

# tell what came back; the reply carries the stop rule's verdict
curl -X POST localhost:8000/api/studies/<id>/tell -H 'Content-Type: application/json' \
  -d '{"results": [{"run_id": 1, "value": 0.42}]}'
```

Suggested runs stay reserved until you report them, so several workers can ask at once without
getting the same point. You can also report points you chose yourself with `x1`, `x2`, `value`.

| Endpoint | What it does |
|---|---|
| `POST /api/studies` | Create a study |
| `GET /api/studies`, `GET /api/studies/{id}` | List, read |
| `POST /api/studies/{id}/ask` | Next runs to buy |
| `POST /api/studies/{id}/tell` | Report results; returns the stop verdict |
| `GET /api/studies/{id}/state` | Stand-in surface, runs, features, stop rule, history |
| `POST`/`DELETE /api/studies/{id}/autorun` | Demo studies: let a built-in simulator answer |
| `DELETE /api/studies/{id}` | Delete a study and its runs |
| `POST /api/races`, `GET /api/races/{id}/events` | Start a benchmark; follow it as server-sent events |
| `GET /api/benchmarks/init-design` | Saved comparison of random vs maximin-LHS opening runs |
| `GET /api/apps`, `GET /api/apps/{key}` | Applications: status, accuracy, forecast surface, readings |
| `GET /api/apps/{key}/model` | The application's own reference function, and why no benchmark function is used |
| `POST /api/apps/{key}/predict` | Forecast for one pair of inputs, with a 95% range and its category |
| `POST /api/apps/{key}/readings` | Add field readings; the model retrains and returns before/after |
| `POST /api/apps/{key}/readings/sample` | Simulated sensors: noisy readings at random points, then retrain |
| `POST /api/apps/{key}/train` | Learn the application's surrogate again from scratch |
| `GET /api/health` | Liveness check (always open) |

## Settings

Environment variables, or `backend/.env` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `VDC_DATABASE_URL` | `sqlite:///./vdc.db` | Where studies are stored |
| `VDC_API_KEY` | unset | When set, every call except `/api/health` needs `X-API-Key` |
| `VDC_CORS_ORIGINS` | `["http://localhost:5173"]` | Browser origins allowed to call the API |
| `VDC_STATIC_DIR` | unset | Folder with the built web app to serve from `/` |
| `VDC_MAX_RUNS_PER_STUDY` | `1500` | Upper limit for a study's budget |

## Checks

```bash
cd backend  && ruff check . && pytest -q          # 43 tests
cd frontend && npm run typecheck && npm test && npm run build
python -m scripts.measure                         # from backend/: re-measure the table below
python -m scripts.compare_init                    # from backend/: random vs LHS opening runs, for the web app
```

## Measured behaviour

Eight seeded starts per built-in simulator, 420 runs each. "Finished" means the referee found every
true feature deeper than 5% of the range in the stand-in, with no invented ones.

| Simulator | Features | Verify finished (median runs) | Random finished | Chase finished |
|---|---|---|---|---|
| Rosenbrock | 4 | 8/8 (60) | 0/8 | 7/8 (216) |
| Easom | 2 | 8/8 (60) | 2/8 | 8/8 (174) |
| Himmelblau | 9 | 8/8 (99) | 0/8 | 1/8 |
| Peaks | 5 | 8/8 (102) | 6/8 (251) | 6/8 (315) |
| Six-hump camel | 10 | 8/8 (177) | 0/8 | 0/8 |
| Rastrigin | 41 | 8/8 (321) | 0/8 | 0/8 |
| Michalewicz | 8 | 0/8 | 0/8 | 0/8 |

Verify's stop rule passed in 41 of the 56 runs and the referee agreed all 41 times. It never passed
on Michalewicz, where no strategy finished.

## Real data

Real measured surfaces are listed separately from the test functions above: in the API
(`"kind": "real"` on `GET /api/simulators`), in the web app's sidebar ("Real data"), and in code
(`REAL_DATASETS` in `backend/app/core/real_data.py`, alongside `TEST_FUNCTIONS`). The default
benchmark scripts still run the test functions only, so the table above is unchanged.

| Dataset | Inputs → output | Grid | Source |
|---|---|---|---|
| Real terrain: Matterhorn | longitude, latitude → elevation (m) | 200 x 200, 2 arc-seconds (~43 x 62 m) | Copernicus DEM GLO-30, tile N45 E007 |

Between grid cells the value is read by bilinear interpolation, so the learner can ask for any
point in the box. Measured with `python -m scripts.measure terrain-matterhorn` (8 starts, 420 runs,
10 features deeper than 5% of the 1555-4229 m range):

| Strategy | Finished | Typical error |
|---|---|---|
| Verify | 0/8 | 1.71% |
| Random | 0/8 | 2.27% |
| Chase | 0/8 | 3.42% |

No strategy finished within 420 runs, and Verify's stop rule correctly never declared done. Real
terrain is rougher than any test function. To add another dataset, write a `.npz` into
`backend/app/data/real/` (`scripts/fetch_dem.py` crops elevation tiles) and list it in
`_CATALOGUE`.

Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018,
provided under COPERNICUS by the European Union and ESA; all rights reserved. It is a radar
surface model, so it reads low on very steep spires (the Matterhorn summit comes out near
4330 m, not 4478 m).

## Real-world applications

The web app's **Applications** page (`/apps`) puts the method to work on three city-scale forecasting
problems, each a function of two inputs:

| Application | Inputs → output | Reference model it stands in for | Categories |
|---|---|---|---|
| Air quality | hour of day, wind speed → PM2.5 (µg/m³) | dispersion model | India NAQI PM2.5 bands |
| Traffic flow | hour of day, day of week → congestion (% extra travel time) | traffic assignment model | free flow to gridlock |
| Weather | day of year, hour of day → temperature (°C) | numerical weather model | cold to extreme heat |

For each one, the Verify learner buys reference-model runs until its stop rule passes (or the budget
runs out), and the fitted surrogate answers forecasts in tens of microseconds. Measured on start-up:
air quality certified at 222 runs (R² 99.0%), weather at 210 runs (R² 99.9%); traffic used its full
340-run budget without the stop rule passing (R² 99.0%), and the page says so.

**New data retrains the model.** Field readings are stored in the database (`app_observations`) and
blended into the surrogate at once: a *sensor* reading is treated as noisy, so the surface leans
towards it; a *verified* reading is matched exactly. The reply shows the forecast before and after,
whether the reading was a surprise (off by more than the learner's allowed miss, widened by sensor
noise for sensor readings), the change in accuracy, and where the learner would measure next. The page
also accepts CSV (pasted, or loaded from a file) and has a live simulated-sensor feed.

**Real data to try.** [`datasets/`](datasets/README.md) holds real historical readings for New Delhi
from Open-Meteo (CC BY 4.0): hourly PM2.5 through the November 2023 smog episode for the air-quality
app, and a year of 2023 temperatures for the weather app. Load one and watch the surprises get flagged
and the surface retrain.

**Which function each application uses.** None of the benchmark functions. Rastrigin, Peaks and the
rest are abstract test landscapes without units, there to test the learner. Each application has its
own function (written out term by term in its **Model function** panel), and the panel explains, for
each of the seven benchmarks, why it does not fit. It also measures which benchmark is closest in
shape (by the number of peaks and valleys deeper than 5% of the range): Peaks, for all three.

The reference models are physically shaped closed forms calibrated to realistic magnitudes, **not
measurements**. Accuracy on the page is measured against them, so readings that disagree with the
reference model (a local event, a faulty sensor) lower it. Reference runs live in the API process's
memory and are retrained, deterministically, after a restart; the readings persist.

## Limits you should know about

- **The stop rule is a heuristic, not a proof.** 41 out of 41 on seven test functions is evidence,
  not a guarantee. A feature narrower than the 7% blind-spot limit can still be missed.
- **Two inputs only.** Features are listed on a 49 x 49 grid, which does not extend past about
  three inputs.
- **Noise-free simulators only.** The stand-in passes exactly through every run.
- **"Chase" is a re-implementation** of optimizer-directed sampling (Diaw et al., 2024) with a
  plain Nelder-Mead optimizer, not the authors' code.
- **One API process.** Benchmark streams and demo auto-runs live in the process's memory. Studies
  themselves are safe across processes (row lock on Postgres), but run a single worker unless you
  move those two features to a shared queue.
- **Postgres is wired but untested.** The test suite runs on SQLite. Run it against Postgres
  before relying on `docker-compose.postgres.yml`.
- **No schema migrations yet.** Tables are created on start; add Alembic before changing models
  on a live database.
- **The API key is a single shared secret.** The web app keeps it in the browser's local storage.
  Put real user sign-in in front of it before exposing it publicly.
- **Cost grows with the cube of the run count.** A study is capped at 1500 runs.

## Layout

```
backend/app/core/      numerical core: surrogate, features, learner, referee, race (no web, no DB)
backend/app/core/real_data.py  real-data simulators, kept apart from the test functions
backend/app/core/applications.py  the three applications' reference models, inputs and categories
backend/app/services/applications.py  train, predict, and retrain on new readings
backend/app/data/real/ the measured grids (.npz) those simulators read
backend/app/services/  study logic, background races, demo auto-run
backend/app/api/       HTTP routes
backend/tests/         pytest suite
backend/scripts/       measure.py: the tables above; fetch_dem.py: crop an elevation tile
frontend/src/pages/    Benchmark, Studies, Study workbench, Applications
frontend/src/components/  field map, charts, stop-rule list
examples/client.py     ask/tell loop with the standard library
```

Based on: A. Diaw, M. McKerns, I. Sagert, L. G. Stanton, M. S. Murillo, "Efficient learning of
accurate surrogates for simulations of complex systems", Nature Machine Intelligence 6, 568-577
(2024), arXiv:2207.12855.
