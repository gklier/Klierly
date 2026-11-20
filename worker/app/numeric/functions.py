"""Vetted numerical routines used to check quantitative questions.

Every function validates its arguments strictly and raises ``WorkerError``
(400 ``invalid_args``) for anything missing, extra, mistyped or out of domain.
Nothing here evaluates arbitrary code.
"""
from __future__ import annotations

import ast
import math
import operator
from typing import Any, Callable

import numpy as np
from scipy import stats

from ..errors import WorkerError

MAX_LIST = 10_000
MAX_EXPR_LEN = 500


def bad(message: str) -> WorkerError:
    return WorkerError(400, "invalid_args", message)


# ---------------------------------------------------------------- validation
def _num(args: dict[str, Any], name: str, *, default: float | None = None) -> float:
    if name not in args or args[name] is None:
        if default is None:
            raise bad(f"Missing argument '{name}'.")
        return default
    v = args[name]
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise bad(f"Argument '{name}' must be a number.")
    v = float(v)
    if not math.isfinite(v):
        raise bad(f"Argument '{name}' must be finite.")
    return v


def _int(args: dict[str, Any], name: str, *, minimum: int = 1) -> int:
    v = _num(args, name)
    if v != int(v):
        raise bad(f"Argument '{name}' must be a whole number.")
    if v < minimum:
        raise bad(f"Argument '{name}' must be at least {minimum}.")
    return int(v)


def _list(args: dict[str, Any], name: str, *, min_len: int = 1) -> list[float]:
    if name not in args:
        raise bad(f"Missing argument '{name}'.")
    v = args[name]
    if not isinstance(v, list):
        raise bad(f"Argument '{name}' must be a list of numbers.")
    if len(v) < min_len:
        raise bad(f"Argument '{name}' needs at least {min_len} value(s).")
    if len(v) > MAX_LIST:
        raise bad(f"Argument '{name}' is too long (max {MAX_LIST}).")
    out = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(float(x)):
            raise bad(f"Argument '{name}' must contain only finite numbers.")
        out.append(float(x))
    return out


def _choice(args: dict[str, Any], name: str, options: tuple[str, ...], default: str | None = None) -> str:
    v = args.get(name, default)
    if v not in options:
        raise bad(f"Argument '{name}' must be one of: {', '.join(options)}.")
    return v


def _pair(args: dict[str, Any], a: str, b: str, *, min_len: int = 1) -> tuple[list[float], list[float]]:
    x, y = _list(args, a, min_len=min_len), _list(args, b, min_len=min_len)
    if len(x) != len(y):
        raise bad(f"'{a}' and '{b}' must have the same length.")
    return x, y


def _df_model(args: dict[str, Any]) -> tuple[int, int, int]:
    n, k = _int(args, "n", minimum=2), _int(args, "k", minimum=1)
    if n - k - 1 <= 0:
        raise bad("n - k - 1 must be positive.")
    return n, k, n - k - 1


# ---------------------------------------------------------------- expression
_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS: dict[str, Callable[..., float]] = {
    "sqrt": math.sqrt, "exp": math.exp, "ln": math.log, "log10": math.log10,
    "abs": abs, "min": min, "max": max, "round": round,
}


def _eval(node: ast.AST, names: dict[str, float], depth: int = 0) -> float:
    if depth > 40:
        raise bad("Expression is nested too deeply.")
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise bad("Only numbers are allowed in expressions.")
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id not in names:
            raise bad(f"Unknown name '{node.id}' in expression.")
        return names[node.id]
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval(node.operand, names, depth + 1))
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        left, right = _eval(node.left, names, depth + 1), _eval(node.right, names, depth + 1)
        if isinstance(node.op, ast.Pow) and (abs(right) > 64 or abs(left) > 1e6):
            raise bad("Exponent or base is too large.")
        if isinstance(node.op, ast.Div) and right == 0:
            raise bad("Division by zero.")
        result = _BIN[type(node.op)](left, right)
        if isinstance(result, complex):
            raise bad("Expression has no real value.")
        return float(result)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        vals = [_eval(a, names, depth + 1) for a in node.args]
        fn = node.func.id
        if fn in ("min", "max"):
            if not vals:
                raise bad(f"{fn}() needs at least one value.")
        elif fn == "round":
            if len(vals) not in (1, 2):
                raise bad("round() takes one or two values.")
            return float(round(vals[0], int(vals[1]))) if len(vals) == 2 else float(round(vals[0]))
        elif len(vals) != 1:
            raise bad(f"{fn}() takes exactly one value.")
        try:
            return float(_FUNCS[fn](*vals))
        except (ValueError, OverflowError) as exc:
            raise bad(f"{fn}() is not defined for that value.") from exc
    raise bad("Expression contains something that is not allowed.")


def evaluate_expression(expr: str, variables: dict[str, float] | None = None) -> float:
    if not isinstance(expr, str) or not expr.strip():
        raise bad("Argument 'expr' must be a non-empty string.")
    if len(expr) > MAX_EXPR_LEN:
        raise bad("Expression is too long.")
    try:
        tree = ast.parse(expr.replace("^", "**"), mode="eval")
    except SyntaxError as exc:
        raise bad("Expression could not be read.") from exc
    try:
        return _eval(tree.body, variables or {})
    except OverflowError as exc:
        raise WorkerError(400, "non_finite_result", "The result is too large.") from exc


def fn_expression(a: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    raw = a.get("vars") or {}
    if not isinstance(raw, dict) or len(raw) > 50:
        raise bad("Argument 'vars' must be an object of name → number.")
    names = {}
    for k in raw:
        if not isinstance(k, str) or not k.isidentifier() or k in _FUNCS:
            raise bad(f"'{k}' is not a valid variable name.")
        names[k] = _num(raw, k)
    return evaluate_expression(a.get("expr"), names), {}


# ---------------------------------------------------------------- regression
def fn_regression_predict(a):
    coefs, vals = _pair(a, "coefficients", "values")
    return _num(a, "intercept") + float(np.dot(coefs, vals)), {}


def fn_t_statistic(a):
    se = _num(a, "std_error")
    if se <= 0:
        raise bad("'std_error' must be positive.")
    return (_num(a, "estimate") - _num(a, "hypothesized", default=0.0)) / se, {}


def _tails(a) -> int:
    t = _num(a, "tails", default=2.0)
    if t not in (1.0, 2.0):
        raise bad("'tails' must be 1 or 2.")
    return int(t)


def _df(a, name="df") -> float:
    df = _num(a, name)
    if df <= 0:
        raise bad(f"'{name}' must be positive.")
    return df


def fn_p_value_t(a):
    t, df, tails = _num(a, "t"), _df(a), _tails(a)
    p = float(stats.t.sf(abs(t), df)) * 2 if tails == 2 else float(stats.t.sf(t, df))
    return min(p, 1.0), {"tails": tails}


def fn_p_value_f(a):
    f = _num(a, "f")
    if f < 0:
        raise bad("'f' cannot be negative.")
    return float(stats.f.sf(f, _df(a, "df1"), _df(a, "df2"))), {}


def fn_p_value_z(a):
    z, tails = _num(a, "z"), _tails(a)
    p = float(stats.norm.sf(abs(z))) * 2 if tails == 2 else float(stats.norm.sf(z))
    return min(p, 1.0), {"tails": tails}


def _confidence(a) -> float:
    c = _num(a, "confidence", default=0.95)
    if not 0 < c < 1:
        raise bad("'confidence' must be between 0 and 1 (for example 0.95).")
    return c


def fn_t_critical(a):
    return float(stats.t.ppf(1 - (1 - _confidence(a)) / 2, _df(a))), {}


def fn_confidence_interval_t(a):
    est, se = _num(a, "estimate"), _num(a, "std_error")
    if se <= 0:
        raise bad("'std_error' must be positive.")
    bound = _choice(a, "bound", ("lower", "upper", "margin"))
    margin = float(stats.t.ppf(1 - (1 - _confidence(a)) / 2, _df(a))) * se
    detail = {"lower": est - margin, "upper": est + margin, "margin": margin}
    return detail[bound], detail


def fn_r_squared(a):
    sse, sst = _num(a, "sse"), _num(a, "sst")
    if sst <= 0 or sse < 0 or sse > sst:
        raise bad("Need 0 ≤ SSE ≤ SST and SST > 0.")
    return 1 - sse / sst, {}


def _r2(a) -> float:
    r2 = _num(a, "r2")
    if not 0 <= r2 <= 1:
        raise bad("'r2' must be between 0 and 1.")
    return r2


def fn_adjusted_r_squared(a):
    n, k, dfe = _df_model(a)
    return 1 - (1 - _r2(a)) * (n - 1) / dfe, {}


def fn_f_statistic(a):
    n, k, dfe = _df_model(a)
    r2 = _r2(a)
    if r2 == 1:
        raise WorkerError(400, "non_finite_result", "F is undefined when R² is exactly 1.")
    return (r2 / k) / ((1 - r2) / dfe), {"df1": k, "df2": dfe}


def _sse(a) -> float:
    sse = _num(a, "sse")
    if sse < 0:
        raise bad("'sse' cannot be negative.")
    return sse


def fn_rmse(a):
    n, k, dfe = _df_model(a)
    return math.sqrt(_sse(a) / dfe), {"df": dfe}


def fn_aic_ols(a):
    n, k, _ = _df_model(a)
    sse = _sse(a)
    if sse == 0:
        raise WorkerError(400, "non_finite_result", "AIC is undefined when SSE is 0.")
    return n * math.log(sse / n) + 2 * (k + 1), {"formula": "n*ln(SSE/n) + 2(k+1)"}


def fn_bic_ols(a):
    n, k, _ = _df_model(a)
    sse = _sse(a)
    if sse == 0:
        raise WorkerError(400, "non_finite_result", "BIC is undefined when SSE is 0.")
    return n * math.log(sse / n) + (k + 1) * math.log(n), {"formula": "n*ln(SSE/n) + (k+1)*ln(n)"}


# ---------------------------------------------------------------- descriptive
def fn_mean(a):
    return float(np.mean(_list(a, "values"))), {}


def fn_sample_std_dev(a):
    return float(np.std(_list(a, "values", min_len=2), ddof=1)), {}


def _simple(a):
    x, y = _pair(a, "x", "y", min_len=2)
    xa, ya = np.array(x), np.array(y)
    sxx = float(np.sum((xa - xa.mean()) ** 2))
    syy = float(np.sum((ya - ya.mean()) ** 2))
    sxy = float(np.sum((xa - xa.mean()) * (ya - ya.mean())))
    return xa, ya, sxx, syy, sxy


def fn_correlation(a):
    _, _, sxx, syy, sxy = _simple(a)
    if sxx == 0 or syy == 0:
        raise bad("Correlation is undefined when a variable does not vary.")
    return sxy / math.sqrt(sxx * syy), {}


def fn_simple_regression(a):
    out = _choice(a, "output", ("slope", "intercept", "r2"))
    xa, ya, sxx, syy, sxy = _simple(a)
    if sxx == 0:
        raise bad("Slope is undefined when x does not vary.")
    slope = sxy / sxx
    intercept = float(ya.mean() - slope * xa.mean())
    if out == "r2" and syy == 0:
        raise bad("R² is undefined when y does not vary.")
    r2 = (sxy * sxy) / (sxx * syy) if syy else float("nan")
    detail = {"slope": slope, "intercept": intercept}
    if syy:
        detail["r2"] = r2
    return {"slope": slope, "intercept": intercept, "r2": r2}[out], detail


# ---------------------------------------------------------------- forecasting
def _errors(a):
    actual, forecast = _pair(a, "actual", "forecast")
    return np.array(actual), np.array(actual) - np.array(forecast)


def fn_mad(a):
    _, e = _errors(a)
    return float(np.mean(np.abs(e))), {}


def fn_mse(a):
    _, e = _errors(a)
    return float(np.mean(e ** 2)), {}


def fn_mape(a):
    actual, e = _errors(a)
    if np.any(actual == 0):
        raise bad("MAPE is undefined when an actual value is 0.")
    return float(np.mean(np.abs(e / actual)) * 100), {"unit": "percent"}


def fn_moving_average_forecast(a):
    series, w = _list(a, "series"), _int(a, "window")
    if w > len(series):
        raise bad("'window' cannot be longer than the series.")
    return float(np.mean(series[-w:])), {}


def fn_exponential_smoothing_forecast(a):
    series, alpha = _list(a, "series"), _num(a, "alpha")
    if not 0 < alpha <= 1:
        raise bad("'alpha' must be greater than 0 and at most 1.")
    f = _num(a, "initial", default=series[0])
    forecasts = [f]
    for y in series:
        f = alpha * y + (1 - alpha) * f
        forecasts.append(f)
    return f, {"forecasts": forecasts}


def fn_linear_trend_forecast(a):
    return _num(a, "intercept") + _num(a, "slope") * _num(a, "t"), {}


def fn_seasonal_forecast(a):
    model = _choice(a, "model", ("multiplicative", "additive"))
    tv, si = _num(a, "trend_value"), _num(a, "seasonal_index")
    return (tv * si if model == "multiplicative" else tv + si), {}


N, L, S = "number", "list of numbers", "string"
REGISTRY: dict[str, dict[str, Any]] = {
    "expression": {"fn": fn_expression, "args": {"expr": S, "vars": "object name→number (optional)"}, "description": "Evaluate arithmetic safely: + - * / ** ( ), sqrt exp ln log10 abs min max round.", "returns": "value of the expression"},
    "regression_predict": {"fn": fn_regression_predict, "args": {"intercept": N, "coefficients": L, "values": L}, "description": "Predicted value from a regression equation.", "returns": "intercept + sum(coefficient_i * value_i)"},
    "t_statistic": {"fn": fn_t_statistic, "args": {"estimate": N, "std_error": N, "hypothesized": "number (optional, default 0)"}, "description": "t ratio for a coefficient.", "returns": "(estimate - hypothesized) / std_error"},
    "p_value_t": {"fn": fn_p_value_t, "args": {"t": N, "df": N, "tails": "1 or 2 (optional, default 2)"}, "description": "p-value from Student's t distribution.", "returns": "p-value"},
    "p_value_f": {"fn": fn_p_value_f, "args": {"f": N, "df1": N, "df2": N}, "description": "Upper-tail p-value from the F distribution.", "returns": "p-value"},
    "p_value_z": {"fn": fn_p_value_z, "args": {"z": N, "tails": "1 or 2 (optional, default 2)"}, "description": "p-value from the standard normal distribution.", "returns": "p-value"},
    "t_critical": {"fn": fn_t_critical, "args": {"df": N, "confidence": "number in (0,1) (optional, default 0.95)"}, "description": "Two-sided critical t value.", "returns": "t*"},
    "confidence_interval_t": {"fn": fn_confidence_interval_t, "args": {"estimate": N, "std_error": N, "df": N, "confidence": "number in (0,1) (optional, default 0.95)", "bound": "lower | upper | margin"}, "description": "t confidence interval for an estimate.", "returns": "the requested bound"},
    "r_squared": {"fn": fn_r_squared, "args": {"sse": N, "sst": N}, "description": "Coefficient of determination.", "returns": "1 - SSE/SST"},
    "adjusted_r_squared": {"fn": fn_adjusted_r_squared, "args": {"r2": N, "n": N, "k": N}, "description": "Adjusted R² for n observations and k predictors.", "returns": "1 - (1-R²)(n-1)/(n-k-1)"},
    "f_statistic": {"fn": fn_f_statistic, "args": {"r2": N, "n": N, "k": N}, "description": "Overall F statistic from R².", "returns": "(R²/k)/((1-R²)/(n-k-1))"},
    "rmse": {"fn": fn_rmse, "args": {"sse": N, "n": N, "k": N}, "description": "Root mean square error (standard error of the regression).", "returns": "sqrt(SSE/(n-k-1))"},
    "aic_ols": {"fn": fn_aic_ols, "args": {"sse": N, "n": N, "k": N}, "description": "AIC for least squares, up to an additive constant.", "returns": "n*ln(SSE/n) + 2(k+1)"},
    "bic_ols": {"fn": fn_bic_ols, "args": {"sse": N, "n": N, "k": N}, "description": "BIC for least squares, up to an additive constant.", "returns": "n*ln(SSE/n) + (k+1)*ln(n)"},
    "mean": {"fn": fn_mean, "args": {"values": L}, "description": "Arithmetic mean.", "returns": "mean"},
    "sample_std_dev": {"fn": fn_sample_std_dev, "args": {"values": L}, "description": "Sample standard deviation (n-1).", "returns": "s"},
    "correlation": {"fn": fn_correlation, "args": {"x": L, "y": L}, "description": "Pearson correlation.", "returns": "r"},
    "simple_regression": {"fn": fn_simple_regression, "args": {"x": L, "y": L, "output": "slope | intercept | r2"}, "description": "Least-squares line for y on x.", "returns": "the requested quantity"},
    "mad": {"fn": fn_mad, "args": {"actual": L, "forecast": L}, "description": "Mean absolute deviation of forecast errors.", "returns": "MAD"},
    "mse": {"fn": fn_mse, "args": {"actual": L, "forecast": L}, "description": "Mean squared forecast error.", "returns": "MSE"},
    "mape": {"fn": fn_mape, "args": {"actual": L, "forecast": L}, "description": "Mean absolute percentage error, in percent.", "returns": "MAPE (%)"},
    "moving_average_forecast": {"fn": fn_moving_average_forecast, "args": {"series": L, "window": N}, "description": "Next-period moving-average forecast.", "returns": "mean of the last `window` values"},
    "exponential_smoothing_forecast": {"fn": fn_exponential_smoothing_forecast, "args": {"series": L, "alpha": N, "initial": "number (optional, default first value)"}, "description": "Next-period forecast; F1 = initial, F(t+1) = alpha*Y(t) + (1-alpha)*F(t).", "returns": "forecast after the last observation"},
    "linear_trend_forecast": {"fn": fn_linear_trend_forecast, "args": {"intercept": N, "slope": N, "t": N}, "description": "Linear trend forecast.", "returns": "intercept + slope*t"},
    "seasonal_forecast": {"fn": fn_seasonal_forecast, "args": {"trend_value": N, "seasonal_index": N, "model": "multiplicative | additive"}, "description": "Apply a seasonal index to a trend value.", "returns": "trend × index or trend + index"},
}


def describe() -> list[dict[str, Any]]:
    return [{"name": n, "description": s["description"], "args": s["args"], "returns": s["returns"]} for n, s in REGISTRY.items()]


def compute(fn: Any, args: Any) -> dict[str, Any]:
    spec = REGISTRY.get(fn) if isinstance(fn, str) else None
    if spec is None:
        raise WorkerError(400, "unknown_function", "That calculation is not available.")
    if not isinstance(args, dict):
        raise bad("'args' must be an object.")
    extra = set(args) - set(spec["args"])
    if extra:
        raise bad(f"Unexpected argument(s): {', '.join(sorted(map(str, extra)))}.")
    try:
        value, detail = spec["fn"](args)
    except WorkerError:
        raise
    except (ZeroDivisionError, FloatingPointError, OverflowError, ValueError) as exc:
        raise WorkerError(400, "non_finite_result", "The calculation has no finite result.") from exc
    value = float(value)
    if not math.isfinite(value):
        raise WorkerError(400, "non_finite_result", "The calculation has no finite result.")
    return {"value": value, "detail": detail}


def ols(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict) or not isinstance(body.get("columns"), dict):
        raise bad("'columns' must be an object of name → list of numbers.")
    cols, y_name, x_names = body["columns"], body.get("y"), body.get("x")
    if not isinstance(y_name, str) or not isinstance(x_names, list) or not x_names or len(x_names) > 30:
        raise bad("'y' must be a column name and 'x' a non-empty list of column names.")
    if len(set(x_names)) != len(x_names) or y_name in x_names:
        raise bad("Column names in 'x' must be distinct and differ from 'y'.")
    for name in [y_name, *x_names]:
        if not isinstance(name, str) or name not in cols:
            raise bad(f"Unknown column '{name}'.")
    y = np.array(_list(cols, y_name, min_len=3))
    xs = [np.array(_list(cols, n, min_len=3)) for n in x_names]
    n, k = len(y), len(xs)
    if any(len(x) != n for x in xs):
        raise bad("All columns must have the same length.")
    if n - k - 1 <= 0:
        raise bad("Not enough observations for this many predictors.")
    X = np.column_stack([np.ones(n), *xs])
    if np.linalg.matrix_rank(X) < k + 1:
        raise bad("Predictors are perfectly collinear (or constant); the model cannot be fitted.")
    xtx_inv = np.linalg.inv(X.T @ X)
    beta = xtx_inv @ X.T @ y
    resid = y - X @ beta
    sse, sst = float(resid @ resid), float(np.sum((y - y.mean()) ** 2))
    if sst == 0:
        raise bad("The response does not vary.")
    dfe = n - k - 1
    mse_ = sse / dfe
    se = np.sqrt(np.diag(xtx_inv) * mse_)
    r2 = 1 - sse / sst
    terms = []
    for name, b, s in zip(["Intercept", *x_names], beta, se):
        t = float(b / s) if s > 0 else None
        terms.append({"name": name, "estimate": float(b), "std_error": float(s), "t": t,
                      "p": float(stats.t.sf(abs(t), dfe) * 2) if t is not None else None})
    f = ((sst - sse) / k) / mse_ if mse_ > 0 else None
    return {"n": n, "k": k, "r2": r2, "adj_r2": 1 - (1 - r2) * (n - 1) / dfe, "rmse": math.sqrt(mse_),
            "f": f, "f_p": float(stats.f.sf(f, k, dfe)) if f is not None else None, "sse": sse, "sst": sst, "terms": terms}
