"""Restricted execution of AI-written solver code for Learn Mode.

The model writes a pure ``solve(p)`` function; this module decides whether it may run, runs it in a separate
resource-limited process, and returns plain numbers. The model never supplies an answer: code computes it.

Layers (none is a perfect boundary on its own; together they are a reasonable one for a private deployment):
1. AST allowlist: no imports, no attribute access except a few vetted ones, no dunder names, no calls to anything
   but allowlisted builtins and the vetted ``math`` / ``stats`` helpers, bounded source size.
2. Separate interpreter process (``python -I``) with CPU, memory and file-size limits and a wall-clock timeout.
3. The process receives code and parameters on stdin and writes JSON to stdout; it has no inherited secrets
   (empty environment). It cannot be given network isolation here: run the worker in a container without egress.
"""
from __future__ import annotations

import ast
import json
import math
import subprocess
import sys
from typing import Any

from .errors import WorkerError

MAX_CODE_CHARS = 6000
MAX_INSTANCES = 400
TIMEOUT_S = 20
CPU_S = 10
MEM_BYTES = 768 * 1024 * 1024

ALLOWED_NODES = (
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.Assign, ast.AugAssign, ast.AnnAssign, ast.Expr,
    ast.If, ast.For, ast.While, ast.Break, ast.Continue, ast.Pass, ast.IfExp, ast.Compare, ast.BoolOp, ast.BinOp,
    ast.UnaryOp, ast.Call, ast.Name, ast.Load, ast.Store, ast.Constant, ast.List, ast.Tuple, ast.Dict, ast.Set,
    ast.Subscript, ast.Slice, ast.ListComp, ast.GeneratorExp, ast.DictComp, ast.comprehension, ast.Attribute,
    ast.keyword, ast.Starred, ast.And, ast.Or, ast.Not, ast.USub, ast.UAdd, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.FloorDiv, ast.Mod, ast.Pow, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot,
)
SAFE_BUILTINS = ("abs", "min", "max", "sum", "len", "range", "round", "int", "float", "bool", "list", "tuple", "dict",
                 "set", "zip", "enumerate", "sorted", "reversed", "pow", "divmod", "any", "all", "map", "filter")
NAMESPACES = ("math", "stats")
LIST_METHODS = ("append", "extend", "index", "count", "sort", "items", "keys", "values", "get")
# Only these names may be called besides locals defined in the code itself.
FORBIDDEN_NAMES = ("eval", "exec", "compile", "open", "getattr", "setattr", "delattr", "globals", "locals", "vars",
                   "input", "print", "__import__", "type", "object", "super", "breakpoint", "memoryview", "bytes", "bytearray")


def validate_source(code: str, fn: str = "solve") -> None:
    if not isinstance(code, str) or not code.strip():
        raise WorkerError(400, "bad_solver", "No solver code was given.")
    if len(code) > MAX_CODE_CHARS:
        raise WorkerError(400, "bad_solver", "The solver is too long.")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as e:
        raise WorkerError(400, "bad_solver", f"The solver has a syntax error: {e.msg} (line {e.lineno}).")
    fns = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    if len(fns) != len(tree.body) or fn not in [f.name for f in fns]:
        raise WorkerError(400, "bad_solver", f"The code must contain only function definitions, including def {fn}(p).")
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            raise WorkerError(400, "bad_solver", f"{type(node).__name__} is not allowed in a solver.")
        if isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in FORBIDDEN_NAMES:
                raise WorkerError(400, "bad_solver", f"The name '{node.id}' is not allowed.")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                raise WorkerError(400, "bad_solver", "Attributes starting with an underscore are not allowed.")
            base_ok = isinstance(node.value, ast.Name) and node.value.id in NAMESPACES
            if not base_ok and node.attr not in LIST_METHODS:
                raise WorkerError(400, "bad_solver", f"The attribute '.{node.attr}' is not allowed.")
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > 80:
            raise WorkerError(400, "bad_solver", "String constants are limited to 80 characters.")


# The child process source. It re-validates the code (defence in depth), builds the namespaces and runs solve().
_RUNNER = r'''
import ast, json, math, resource, sys
payload = json.loads(sys.stdin.read())
resource.setrlimit(resource.RLIMIT_CPU, (payload["cpu"], payload["cpu"]))
resource.setrlimit(resource.RLIMIT_AS, (payload["mem"], payload["mem"]))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
from scipy import stats as _st
import statistics as _s

class Stats:
    norm_cdf = staticmethod(lambda x, mu=0.0, sd=1.0: float(_st.norm.cdf(x, mu, sd)))
    norm_ppf = staticmethod(lambda q, mu=0.0, sd=1.0: float(_st.norm.ppf(q, mu, sd)))
    norm_pdf = staticmethod(lambda x, mu=0.0, sd=1.0: float(_st.norm.pdf(x, mu, sd)))
    t_cdf = staticmethod(lambda x, df: float(_st.t.cdf(x, df)))
    t_sf = staticmethod(lambda x, df: float(_st.t.sf(x, df)))
    t_ppf = staticmethod(lambda q, df: float(_st.t.ppf(q, df)))
    chi2_cdf = staticmethod(lambda x, df: float(_st.chi2.cdf(x, df)))
    chi2_sf = staticmethod(lambda x, df: float(_st.chi2.sf(x, df)))
    chi2_ppf = staticmethod(lambda q, df: float(_st.chi2.ppf(q, df)))
    f_cdf = staticmethod(lambda x, d1, d2: float(_st.f.cdf(x, d1, d2)))
    f_sf = staticmethod(lambda x, d1, d2: float(_st.f.sf(x, d1, d2)))
    f_ppf = staticmethod(lambda q, d1, d2: float(_st.f.ppf(q, d1, d2)))
    binom_pmf = staticmethod(lambda k, n, p: float(_st.binom.pmf(k, n, p)))
    binom_cdf = staticmethod(lambda k, n, p: float(_st.binom.cdf(k, n, p)))
    mean = staticmethod(lambda a: float(sum(a) / len(a)))
    stdev = staticmethod(lambda a: float(_s.stdev(a)))
    variance = staticmethod(lambda a: float(_s.variance(a)))
    median = staticmethod(lambda a: float(_s.median(a)))
    logistic = staticmethod(lambda z: 1.0 / (1.0 + math.exp(-z)))

SAFE = {k: getattr(__builtins__, k) if not isinstance(__builtins__, dict) else __builtins__[k] for k in payload["builtins"]}
ns = {"__builtins__": SAFE, "math": math, "stats": Stats}
exec(compile(ast.parse(payload["code"]), "<solver>", "exec"), ns)
fn = ns[payload["fn"]]
def fin(x, d=0):
    if isinstance(x, bool): return True
    if isinstance(x, (int, float)): return math.isfinite(x)
    if d > 3: return False
    if isinstance(x, dict): return all(isinstance(k, str) and fin(v, d + 1) for k, v in x.items())
    if isinstance(x, (list, tuple)): return len(x) <= 200 and all(fin(v, d + 1) for v in x)
    return isinstance(x, str) and len(x) <= 200
out = []
for p in payload["params"]:
    try:
        r = fn(p)
        if not fin(r):
            out.append({"ok": False, "error": "NonFinite: the result was not a finite number or a small structure of them"}); continue
        out.append({"ok": True, "value": r})
    except Exception as e:  # noqa: BLE001 - reported per instance
        out.append({"ok": False, "error": type(e).__name__ + ": " + str(e)[:120]})
sys.stdout.write(json.dumps(out, allow_nan=False, default=lambda o: str(o)))
'''


def _finite(x: Any, depth: int = 0) -> bool:
    if isinstance(x, bool):
        return True
    if isinstance(x, (int, float)):
        return math.isfinite(x)
    if depth > 3:
        return False
    if isinstance(x, dict):
        return all(isinstance(k, str) and _finite(v, depth + 1) for k, v in x.items())
    if isinstance(x, (list, tuple)):
        return len(x) <= 200 and all(_finite(v, depth + 1) for v in x)
    return isinstance(x, str) and len(x) <= 200


def run_solver(code: str, params: list[dict[str, Any]], fn: str = "solve") -> list[dict[str, Any]]:
    """Run ``fn(p)`` for each parameter dict. Returns one {ok, value|error} per instance, in order."""
    validate_source(code, fn)
    if not isinstance(params, list) or not params or len(params) > MAX_INSTANCES:
        raise WorkerError(400, "bad_params", f"Give between 1 and {MAX_INSTANCES} parameter sets.")
    if len(json.dumps(params)) > 400_000:
        raise WorkerError(400, "bad_params", "The parameter sets are too large.")
    payload = {"code": code, "fn": fn, "params": params, "builtins": list(SAFE_BUILTINS), "cpu": CPU_S, "mem": MEM_BYTES}
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-c", _RUNNER], input=json.dumps(payload), capture_output=True, text=True,
            timeout=TIMEOUT_S, env={"OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}, check=False,
        )
    except subprocess.TimeoutExpired:
        raise WorkerError(422, "solver_timeout", "The solver took too long and was stopped.")
    if proc.returncode != 0:
        raise WorkerError(422, "solver_failed", "The solver could not be run (it may have used too much time or memory).")
    try:
        results = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise WorkerError(422, "solver_failed", "The solver produced output that could not be read.")
    for r in results:
        if r["ok"] and not _finite(r["value"]):
            r.update(ok=False, error="NonFinite: the result was not a finite number or a small structure of them", value=None)
    return results
