"""The numerical core: surrogate, feature listing, proposals, stop rule, referee."""

import numpy as np
import pytest

from app.core.learner import (
    LearnerConfig,
    bowl_vertex,
    build_field,
    certify,
    depth_threshold,
    largest_gap,
    lhs_maximin,
    min_pair_distance,
    propose,
)
from app.core.race import make_race, nelder_mead_trace
from app.core.real_data import REAL_DATASETS
from app.core.referee import audit, make_truth
from app.core.simulators import SIMULATORS, TEST_FUNCTIONS
from app.core.surrogate import ThinPlate, grid_points
from app.core.topology import features

CFG = LearnerConfig()


def test_surrogate_interpolates_exactly():
    rng = np.random.default_rng(0)
    pts = rng.random((60, 2))
    vals = SIMULATORS["peaks"].at_unit(pts)
    s = ThinPlate(pts, vals)
    assert np.abs(s(pts) - vals).max() < 1e-8


def test_surrogate_reproduces_a_plane():
    rng = np.random.default_rng(1)
    pts = rng.random((20, 2))
    s = ThinPlate(pts, 2 + 3 * pts[:, 0] - pts[:, 1])
    q = rng.random((50, 2))
    assert np.allclose(s(q), 2 + 3 * q[:, 0] - q[:, 1], atol=1e-8)


def test_surrogate_rejects_bad_input():
    with pytest.raises(ValueError):
        ThinPlate(np.zeros((2, 2)), np.zeros(2))
    with pytest.raises(ValueError):
        ThinPlate(np.zeros((5, 3)), np.zeros(5))


def test_features_of_two_wells():
    g = 41
    p = grid_points(g)
    z = -np.exp(-60 * ((p[:, 0] - 0.25) ** 2 + (p[:, 1] - 0.5) ** 2)) - 0.6 * np.exp(
        -60 * ((p[:, 0] - 0.75) ** 2 + (p[:, 1] - 0.5) ** 2)
    )
    mins = sorted((f for f in features(z, g) if f.kind == "min" and f.depth > 0.05), key=lambda f: -f.depth)
    assert len(mins) == 2
    assert mins[0].depth == pytest.approx(1.0, abs=0.02)  # the deeper well spans the whole range
    assert mins[1].depth == pytest.approx(0.6, abs=0.05)  # the shallower one rises to the pass between them
    assert mins[1].merge >= 0 and mins[0].merge == -1


def test_feature_depth_is_stable_under_small_noise():
    """The property the whole method leans on: an error of eps moves each depth by at most 2*eps."""
    g = 41
    z = SIMULATORS["peaks"].at_unit(grid_points(g))
    noise = np.random.default_rng(2).uniform(-0.05, 0.05, z.shape)
    clean = sorted((f.depth for f in features(z, g) if f.depth > 1.0), reverse=True)
    noisy = sorted((f.depth for f in features(z + noise, g) if f.depth > 0.5), reverse=True)[: len(clean)]
    assert len(noisy) == len(clean)
    assert np.abs(np.array(clean) - np.array(noisy)).max() <= 2 * 0.05 + 1e-9


def test_peaks_truth_has_five_features():
    truth = make_truth(SIMULATORS["peaks"], CFG.grid, 0.05)
    assert len(truth.significant) == 5


def test_referee_scores_the_truth_as_perfect_and_a_flat_surface_as_empty():
    truth = make_truth(SIMULATORS["peaks"], CFG.grid, 0.05)
    perfect = audit(0, truth.z, truth.all, truth)
    assert perfect.complete and perfect.rmse == 0
    flat = np.full_like(truth.z, truth.z.mean())
    empty = audit(0, flat, features(flat, CFG.grid), truth)
    assert empty.captured == 0 and not empty.complete


def test_depth_threshold_uses_only_observed_values():
    assert depth_threshold(np.array([1.0, 3.0]), 0.1, None) == pytest.approx(0.2)
    assert depth_threshold(np.array([1.0, 3.0]), 0.1, 0.7) == 0.7
    assert depth_threshold(np.array([]), 0.1, None) == 0.0


def test_propose_starts_with_random_runs_and_respects_pending():
    rng = np.random.default_rng(3)
    first = propose(np.empty((0, 2)), np.empty(0), np.empty((0, 2)), 6, rng, 0.0, CFG)
    assert len(first) == 6 and all(p.reason == "init" and p.predicted is None for p in first)
    pend = np.array([[p.u, p.v] for p in first])
    second = propose(np.empty((0, 2)), np.empty(0), pend, 20, rng, 0.0, CFG)
    assert len(second) == CFG.n_init - 6  # never more initial runs than needed


def test_lhs_maximin_is_latin_deterministic_and_well_spread():
    a, b = lhs_maximin(12, 7), lhs_maximin(12, 7)
    assert np.array_equal(a, b)  # one design per seed, however often it is asked for
    for k in range(2):  # exactly one point in every row and every column
        assert sorted(np.floor(a[:, k] * 12).astype(int)) == list(range(12))
    rand = [np.random.default_rng(s).random((12, 2)) for s in range(20)]
    assert min_pair_distance(a) > 2 * np.median([min_pair_distance(r) for r in rand])
    assert largest_gap(a, 49)[0] < np.median([largest_gap(r, 49)[0] for r in rand])


def test_opening_runs_come_from_one_design_across_calls():
    """Split over two calls (as parallel workers would), the opening runs are still the study's single LHS."""
    design = lhs_maximin(CFG.n_init, 42)
    first = propose(np.empty((0, 2)), np.empty(0), np.empty((0, 2)), 5, np.random.default_rng(0), 0.0, CFG, seed=42)
    pend = np.array([[p.u, p.v] for p in first])
    second = propose(np.empty((0, 2)), np.empty(0), pend, 20, np.random.default_rng(9), 0.0, CFG, seed=42)
    got = np.array([[p.u, p.v] for p in first + second])
    assert len(got) == CFG.n_init and all(p.reason == "init" for p in first + second)
    assert np.allclose(np.sort(got, axis=0), np.sort(design, axis=0))


def test_propose_targets_the_surrogates_own_extrema_and_never_repeats_points():
    sim = SIMULATORS["peaks"]
    rng = np.random.default_rng(4)
    pts = rng.random((40, 2))
    vals = sim.at_unit(pts)
    fld = build_field(pts, vals, CFG)
    depth = depth_threshold(vals, 0.05, None)
    props = propose(pts, vals, np.empty((0, 2)), 8, rng, depth, CFG, fld)
    assert len(props) == 8
    assert {p.reason for p in props} >= {"explore", "verify"}
    assert all(p.predicted is not None for p in props)
    everything = np.vstack([pts, [[p.u, p.v] for p in props]])
    d = np.sqrt(((everything[:, None] - everything[None]) ** 2).sum(-1)) + np.eye(len(everything))
    assert d.min() >= CFG.duplicate
    deepest = max(fld.features, key=lambda f: f.depth)
    assert any(np.hypot(p.u - fld.node_uv(deepest.node)[0], p.v - fld.node_uv(deepest.node)[1]) < 0.05 for p in props)


def test_bowl_vertex_finds_an_off_node_minimum():
    centre = np.array([0.52, 0.47])
    rng = np.random.default_rng(5)
    pts = 0.5 + rng.uniform(-0.05, 0.05, (8, 2))
    vals = ((pts - centre) ** 2).sum(axis=1)
    vertex = bowl_vertex("min", (0.5, 0.5), pts, vals, CFG)
    assert vertex is not None and np.hypot(vertex[0] - centre[0], vertex[1] - centre[1]) < 1e-6
    assert bowl_vertex("max", (0.5, 0.5), pts, vals, CFG) is None  # wrong curvature for a peak


def test_largest_gap():
    gap, centre = largest_gap(np.array([[0.0, 0.0]]), 11)
    assert gap == pytest.approx(np.sqrt(2)) and centre == (1.0, 1.0)


def test_stop_rule_refuses_without_evidence():
    sim = SIMULATORS["peaks"]
    pts = np.random.default_rng(6).random((30, 2))
    vals = sim.at_unit(pts)
    fld = build_field(pts, vals, CFG)
    status = certify(pts, vals, [], [], depth_threshold(vals, 0.05, None), CFG, fld)
    assert not status.ready and status.worst_recent_miss is None and not status.surprises_small


def test_nelder_mead_trace_goes_downhill_and_stays_in_the_box():
    trace = nelder_mead_trace(lambda u, v: (u - 0.3) ** 2 + (v - 0.7) ** 2, 0.9, 0.1, 0.07, 90, 1e-9)
    assert 3 <= len(trace) <= 92
    assert all(0 <= u <= 1 and 0 <= v <= 1 for u, v in trace)
    assert np.hypot(trace[-1][0] - 0.3, trace[-1][1] - 0.7) < 0.05


def test_verify_wins_on_peaks_and_its_stop_rule_is_right():
    race = make_race("peaks", seed=1, budget=300)
    for _ in race.frames():
        pass
    s = race.summary()
    assert s["verify"]["done_at"] is not None and s["verify"]["done_at"] <= 200
    assert s["verify"]["declared_at"] is not None and s["verify"]["declared_correct"] is True
    assert s["verify"]["rmse"] < s["random"]["rmse"]
    assert all(v["runs"] == 300 for v in s.values())


def test_real_data_is_kept_apart_from_the_test_functions():
    assert set(TEST_FUNCTIONS).isdisjoint(REAL_DATASETS)
    assert {s.kind for s in TEST_FUNCTIONS.values()} == {"test"}
    assert {s.kind for s in REAL_DATASETS.values()} == {"real"}
    assert SIMULATORS == {**TEST_FUNCTIONS, **REAL_DATASETS}


def test_terrain_grid_is_read_back_exactly_and_interpolated_between_cells():
    sim = REAL_DATASETS["terrain-matterhorn"]
    z, (x0, x1, y0, y1) = sim.fn.z, sim.box
    ny, nx = z.shape
    assert min(ny, nx) >= 50 and 1000 < z.min() < z.max() < 4500  # metres, an alpine window
    xs, ys = np.linspace(x0, x1, nx), np.linspace(y0, y1, ny)
    assert sim.at(xs[7], ys[11]) == pytest.approx(z[11, 7])
    mid = sim.at((xs[7] + xs[8]) / 2, (ys[11] + ys[12]) / 2)
    assert mid == pytest.approx(z[11:13, 7:9].mean())
    assert sim.at(x0 - 1, y0 - 1) == pytest.approx(z[0, 0])  # outside the box: the nearest edge


def test_terrain_has_features_for_the_referee():
    truth = make_truth(REAL_DATASETS["terrain-matterhorn"], CFG.grid, 0.05)
    assert len(truth.significant) >= 3
