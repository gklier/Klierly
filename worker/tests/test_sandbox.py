import math

import pytest
from scipy import stats as sp

from .conftest import AUTH


def run(client, code, params, expect=200):
    r = client.post("/sandbox/run", json={"code": code, "params": params}, headers=AUTH)
    assert r.status_code == expect, r.text
    return r.json()["results"] if expect == 200 else r.json()["detail"]["code"]


def test_runs_a_pure_solver_per_seed(client):
    code = "def solve(p):\n    w = p['w']\n    return {'answer': sum(p['v'][-w:]) / w, 'n': len(p['v'])}\n"
    out = run(client, code, [{"v": [1, 2, 3, 4], "w": 2}, {"v": [10, 20, 30], "w": 3}])
    assert [r["value"]["answer"] for r in out] == [3.5, 20.0]


def test_stats_helpers_match_scipy(client):
    code = """def solve(p):
    return {'t': stats.t_cdf(p['x'], p['df']), 'f': stats.f_sf(p['x'], 3, 20), 'c': stats.chi2_sf(p['x'], 4), 'n': stats.norm_ppf(0.975),
            'b': stats.binom_cdf(3, 10, 0.4), 'tp': stats.t_ppf(0.975, p['df'])}
"""
    out = run(client, code, [{"x": x, "df": df} for x in (0.3, 1.7, 4.2) for df in (5, 24)])
    for r, (x, df) in zip(out, [(x, df) for x in (0.3, 1.7, 4.2) for df in (5, 24)]):
        v = r["value"]
        assert v["t"] == pytest.approx(sp.t.cdf(x, df), rel=1e-12)
        assert v["f"] == pytest.approx(sp.f.sf(x, 3, 20), rel=1e-12)
        assert v["c"] == pytest.approx(sp.chi2.sf(x, 4), rel=1e-12)
        assert v["n"] == pytest.approx(sp.norm.ppf(0.975), rel=1e-12)
        assert v["b"] == pytest.approx(sp.binom.cdf(3, 10, 0.4), rel=1e-12)
        assert v["tp"] == pytest.approx(sp.t.ppf(0.975, df), rel=1e-12)


@pytest.mark.parametrize("bad", [
    "import os\ndef solve(p):\n    return 1",
    "def solve(p):\n    return __import__('os').system('id')",
    "def solve(p):\n    return open('/etc/passwd').read()",
    "def solve(p):\n    return ().__class__.__bases__",
    "def solve(p):\n    return getattr(p, 'x')",
    "def solve(p):\n    return eval('1+1')",
    "def solve(p):\n    return math.__dict__",
    "def solve(p):\n    return 'x'.format(1)",
    "def solve(p):\n    return (lambda: 1)()",
    "x = 1\ndef solve(p):\n    return x",
    "def other(p):\n    return 1",
    "def solve(p):\n    return f'{p}'",
])
def test_unsafe_code_is_refused_before_running(client, bad):
    assert run(client, bad, [{}], expect=400) == "bad_solver"


def test_runaway_and_failing_solvers_are_contained(client):
    loop = "def solve(p):\n    while True:\n        pass\n"
    assert run(client, loop, [{}], expect=422) in ("solver_timeout", "solver_failed")
    mem = "def solve(p):\n    a = [0] * 10**10\n    return 1\n"
    out = run(client, mem, [{}])
    assert out[0]["ok"] is False
    err = "def solve(p):\n    return 1 / p['z']\n"
    out = run(client, err, [{"z": 0}, {"z": 2}])
    assert out[0]["ok"] is False and "ZeroDivisionError" in out[0]["error"] and out[1]["value"] == 0.5
    nan = "def solve(p):\n    return math.sqrt(-1) if p['z'] else 1e308 * 10\n"
    assert run(client, nan, [{"z": 0}])[0]["ok"] is False


def test_limits_on_size_and_count(client):
    assert run(client, "def solve(p):\n    return 1\n" + "# x\n" * 3000, [{}], expect=400) == "bad_solver"
    assert run(client, "def solve(p):\n    return 1\n", [{}] * 401, expect=400) == "bad_params"


def test_requires_token(client):
    assert client.post("/sandbox/run", json={"code": "def solve(p):\n    return 1", "params": [{}]}).status_code == 401
