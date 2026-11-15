# Verify, Don't Chase

A service that helps you build a fast stand-in (a surrogate) for a slow simulator with as few
simulator runs as possible. You run the simulator; the service tells you **which runs to buy next**
and **when you can stop**.

It has two parts:

- **API** (`backend/`, Python + FastAPI): studies with an ask/tell loop, a stop rule, and a
  three-way benchmark.
- **Web app** (`frontend/`, React + TypeScript): a live benchmark page and a workbench for your
  own studies.

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
cd backend  && ruff check . && pytest -q          # 24 tests
cd frontend && npm run typecheck && npm test && npm run build
python -m scripts.measure                         # from backend/: re-measure the table below
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

## Limits you should know about

- **The stop rule is a heuristic, not a proof.** 41 out of 41 on seven toy simulators is evidence,
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
backend/app/services/  study logic, background races, demo auto-run
backend/app/api/       HTTP routes
backend/tests/         pytest suite
backend/scripts/       measure.py: the table above
frontend/src/pages/    Benchmark, Studies, Study workbench
frontend/src/components/  field map, charts, stop-rule list
examples/client.py     ask/tell loop with the standard library
```

Based on: A. Diaw, M. McKerns, I. Sagert, L. G. Stanton, M. S. Murillo, "Efficient learning of
accurate surrogates for simulations of complex systems", Nature Machine Intelligence 6, 568-577
(2024), arXiv:2207.12855.
