import json
import math

import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm
from scipy import stats

from .conftest import AUTH, SAMPLE


def val(compute, fn, args):
    r = compute(fn, args)
    assert r.status_code == 200, r.text
    return r.json()["value"]


def code(compute, fn, args):
    r = compute(fn, args)
    assert r.status_code == 400, r.text
    return r.json()["detail"]["code"]


def test_hand_computed(compute):
    assert val(compute, "regression_predict", {"intercept": 10, "coefficients": [2, -3], "values": [4, 1.5]}) == pytest.approx(13.5)
    assert val(compute, "t_statistic", {"estimate": 2.989, "std_error": 0.31}) == pytest.approx(9.6419, abs=1e-4)
    assert val(compute, "t_statistic", {"estimate": 1.2, "std_error": 0.1, "hypothesized": 1}) == pytest.approx(2.0)
    assert val(compute, "r_squared", {"sse": 25, "sst": 100}) == pytest.approx(0.75)
    assert val(compute, "adjusted_r_squared", {"r2": 0.75, "n": 21, "k": 4}) == pytest.approx(1 - 0.25 * 20 / 16)
    assert val(compute, "f_statistic", {"r2": 0.75, "n": 21, "k": 4}) == pytest.approx((0.75 / 4) / (0.25 / 16))
    assert val(compute, "rmse", {"sse": 64, "n": 18, "k": 1}) == pytest.approx(2.0)
    assert val(compute, "aic_ols", {"sse": 50, "n": 25, "k": 2}) == pytest.approx(25 * math.log(2) + 6)
    assert val(compute, "bic_ols", {"sse": 50, "n": 25, "k": 2}) == pytest.approx(25 * math.log(2) + 3 * math.log(25))
    assert val(compute, "mean", {"values": [1, 2, 6]}) == pytest.approx(3)
    assert val(compute, "sample_std_dev", {"values": [2, 4, 4, 4, 5, 5, 7, 9]}) == pytest.approx(2.13809, abs=1e-5)
    assert val(compute, "linear_trend_forecast", {"intercept": 100, "slope": 2.5, "t": 13}) == pytest.approx(132.5)
    assert val(compute, "seasonal_forecast", {"trend_value": 200, "seasonal_index": 1.2, "model": "multiplicative"}) == pytest.approx(240)
    assert val(compute, "seasonal_forecast", {"trend_value": 200, "seasonal_index": -15, "model": "additive"}) == pytest.approx(185)


def test_forecasting_worked_example(compute):
    series = [120, 132, 128, 140, 136]
    assert val(compute, "moving_average_forecast", {"series": series, "window": 3}) == pytest.approx(404 / 3)
    r = compute("exponential_smoothing_forecast", {"series": series, "alpha": 0.3}).json()
    assert r["value"] == pytest.approx(131.4108)
    assert r["detail"]["forecasts"] == pytest.approx([120, 120, 123.6, 124.92, 129.444, 131.4108])
    actual, forecast = [132, 128, 140, 136], [120, 123.6, 124.92, 129.444]
    assert val(compute, "mad", {"actual": actual, "forecast": forecast}) == pytest.approx(9.509)
    assert val(compute, "mse", {"actual": actual, "forecast": forecast}) == pytest.approx(108.436884)
    assert val(compute, "mape", {"actual": actual, "forecast": forecast}) == pytest.approx(7.0301065, abs=1e-6)
    assert val(compute, "exponential_smoothing_forecast", {"series": [10, 20], "alpha": 1}) == pytest.approx(20)
    assert val(compute, "exponential_smoothing_forecast", {"series": [10, 20], "alpha": 0.5, "initial": 30}) == pytest.approx(20)


def test_distributions_match_scipy(compute):
    for t, df in [(2.0, 57), (-3.1, 12), (0.4, 5.5), (9.63, 58)]:
        assert val(compute, "p_value_t", {"t": t, "df": df}) == pytest.approx(2 * stats.t.sf(abs(t), df), rel=1e-12)
    assert val(compute, "p_value_t", {"t": 1.7, "df": 20, "tails": 1}) == pytest.approx(stats.t.sf(1.7, 20))
    assert val(compute, "p_value_t", {"t": -1.7, "df": 20, "tails": 1}) == pytest.approx(stats.t.sf(-1.7, 20))
    assert val(compute, "p_value_f", {"f": 4.2, "df1": 3, "df2": 40}) == pytest.approx(stats.f.sf(4.2, 3, 40))
    assert val(compute, "p_value_z", {"z": 1.96}) == pytest.approx(0.0499958, abs=1e-6)
    assert val(compute, "t_critical", {"df": 58}) == pytest.approx(stats.t.ppf(0.975, 58))
    assert val(compute, "t_critical", {"df": 10, "confidence": 0.9}) == pytest.approx(1.812461, abs=1e-5)
    r = compute("confidence_interval_t", {"estimate": 2.989, "std_error": 0.3104, "df": 58, "bound": "lower"}).json()
    m = stats.t.ppf(0.975, 58) * 0.3104
    assert r["value"] == pytest.approx(2.989 - m) and r["detail"]["upper"] == pytest.approx(2.989 + m) and r["detail"]["margin"] == pytest.approx(m)


def test_simple_regression_and_correlation(compute):
    x, y = [1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1]
    ref = stats.linregress(x, y)
    assert val(compute, "simple_regression", {"x": x, "y": y, "output": "slope"}) == pytest.approx(ref.slope)
    assert val(compute, "simple_regression", {"x": x, "y": y, "output": "intercept"}) == pytest.approx(ref.intercept)
    assert val(compute, "simple_regression", {"x": x, "y": y, "output": "r2"}) == pytest.approx(ref.rvalue ** 2)
    assert val(compute, "correlation", {"x": x, "y": y}) == pytest.approx(ref.rvalue)


def test_expression(compute):
    assert val(compute, "expression", {"expr": "39.863 + 2.479*20 - 2.998*10"}) == pytest.approx(59.463)
    assert val(compute, "expression", {"expr": "b0 + b1*x", "vars": {"b0": 1, "b1": 2, "x": 3}}) == pytest.approx(7)
    assert val(compute, "expression", {"expr": "sqrt(16) + 2^3 - abs(-1) + max(1, 2) + round(2.567, 1)"}) == pytest.approx(15.6)
    assert val(compute, "expression", {"expr": "exp(ln(5)) + log10(1000)"}) == pytest.approx(8)
    for bad in ["__import__('os').system('id')", "open('/etc/passwd')", "x", "1/0", "(1).real", "[1,2]", "'a'*3",
                "9**9**9", "lambda: 1", "sqrt(-1)", "1 if 1 else 2", "a.b", ""]:
        assert code(compute, "expression", {"expr": bad}) in ("invalid_args", "non_finite_result"), bad
    assert code(compute, "expression", {"expr": "sqrt(2)", "vars": {"sqrt": 1}}) == "invalid_args"
    assert code(compute, "expression", {"expr": "1+" * 300 + "1"}) == "invalid_args"


def test_invalid_args(compute):
    assert code(compute, "nope", {}) == "unknown_function"
    assert code(compute, "mean", {"values": [1], "extra": 1}) == "invalid_args"
    assert code(compute, "mean", {}) == "invalid_args"
    assert code(compute, "mean", {"values": []}) == "invalid_args"
    assert code(compute, "mean", {"values": ["1"]}) == "invalid_args"
    assert code(compute, "mean", {"values": [True]}) == "invalid_args"
    assert code(compute, "mean", {"values": list(range(10_001))}) == "invalid_args"
    assert code(compute, "p_value_t", {"t": 1, "df": 0}) == "invalid_args"
    assert code(compute, "p_value_t", {"t": 1, "df": -3}) == "invalid_args"
    assert code(compute, "p_value_t", {"t": 1, "df": 5, "tails": 3}) == "invalid_args"
    assert code(compute, "t_statistic", {"estimate": 1, "std_error": 0}) == "invalid_args"
    assert code(compute, "exponential_smoothing_forecast", {"series": [1, 2], "alpha": 0}) == "invalid_args"
    assert code(compute, "exponential_smoothing_forecast", {"series": [1, 2], "alpha": 1.2}) == "invalid_args"
    assert code(compute, "mad", {"actual": [1, 2], "forecast": [1]}) == "invalid_args"
    assert code(compute, "mape", {"actual": [0, 2], "forecast": [1, 1]}) == "invalid_args"
    assert code(compute, "moving_average_forecast", {"series": [1, 2], "window": 3}) == "invalid_args"
    assert code(compute, "moving_average_forecast", {"series": [1, 2], "window": 1.5}) == "invalid_args"
    assert code(compute, "adjusted_r_squared", {"r2": 0.5, "n": 3, "k": 2}) == "invalid_args"
    assert code(compute, "adjusted_r_squared", {"r2": 1.5, "n": 30, "k": 2}) == "invalid_args"
    assert code(compute, "r_squared", {"sse": 5, "sst": 0}) == "invalid_args"
    assert code(compute, "correlation", {"x": [1, 1, 1], "y": [1, 2, 3]}) == "invalid_args"
    assert code(compute, "confidence_interval_t", {"estimate": 1, "std_error": 1, "df": 5, "bound": "middle"}) == "invalid_args"
    assert code(compute, "confidence_interval_t", {"estimate": 1, "std_error": 1, "df": 5, "bound": "lower", "confidence": 95}) == "invalid_args"
    assert code(compute, "f_statistic", {"r2": 1, "n": 30, "k": 2}) == "non_finite_result"
    assert code(compute, "aic_ols", {"sse": 0, "n": 30, "k": 2}) == "non_finite_result"
    assert code(compute, "regression_predict", {"intercept": 1, "coefficients": [1, 2], "values": [1]}) == "invalid_args"


def test_functions_listing(client):
    fns = client.get("/numeric/functions", headers=AUTH).json()["functions"]
    assert len(fns) == 25 and all({"name", "description", "args", "returns"} <= set(f) for f in fns)


def test_ols_matches_statsmodels_and_fixture(client):
    df = pd.read_csv(SAMPLE / "store-sales.csv")
    df["ad_spend*promo"] = df["ad_spend"] * df["promo"]
    xs = ["ad_spend", "price", "promo", "ad_spend*promo"]
    r = client.post("/numeric/ols", headers=AUTH, json={"columns": {c: df[c].tolist() for c in ["sales", *xs]}, "y": "sales", "x": xs})
    assert r.status_code == 200, r.text
    got = r.json()
    ref = sm.OLS(df["sales"], sm.add_constant(df[xs])).fit()
    assert got["n"] == 60 and got["k"] == 4
    assert got["r2"] == pytest.approx(ref.rsquared) and got["adj_r2"] == pytest.approx(ref.rsquared_adj)
    assert got["rmse"] == pytest.approx(np.sqrt(ref.mse_resid)) and got["f"] == pytest.approx(ref.fvalue)
    assert got["f_p"] == pytest.approx(ref.f_pvalue, rel=1e-6) and got["sse"] == pytest.approx(ref.ssr)
    for term, name in zip(got["terms"], ["const", *xs]):
        assert term["estimate"] == pytest.approx(ref.params[name]) and term["std_error"] == pytest.approx(ref.bse[name])
        assert term["t"] == pytest.approx(ref.tvalues[name]) and term["p"] == pytest.approx(ref.pvalues[name], rel=1e-6)
    stored = json.loads((SAMPLE / "model-output.json").read_text())["model_b"]
    assert stored["r2"] == pytest.approx(got["r2"]) and stored["terms"][4]["estimate"] == pytest.approx(got["terms"][4]["estimate"])


def test_ols_rejects_bad_input(client):
    post = lambda body: client.post("/numeric/ols", headers=AUTH, json=body)  # noqa: E731
    assert post({"columns": {"y": [1, 2, 3, 4], "a": [1, 2, 3, 4], "b": [2, 4, 6, 8]}, "y": "y", "x": ["a", "b"]}).json()["detail"]["code"] == "invalid_args"
    assert post({"columns": {"y": [1, 2, 3]}, "y": "y", "x": ["zz"]}).status_code == 400
    assert post({"columns": {"y": [1, 2, 3], "a": [1, 2]}, "y": "y", "x": ["a"]}).status_code == 400
