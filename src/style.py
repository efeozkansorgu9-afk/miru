"""
Returns-based style analysis: what a fund's weekly returns are made of.

Correlation says two funds are the same thing. This says what that thing
is. Each fund's weekly returns are explained as a mix of a few asset-class
factors — Turkish equity, gold, silver, dollar, euro, TL money market, TL
bonds, foreign equity — with the weights constrained the way Sharpe's style
analysis constrains them: none negative, and together they add up to one.
The answer reads as a portfolio: "96% gold", "70% dollar, 25% TL rate".

## The factors are funds

Each factor is represented by a passive, long-lived TEFAS fund of that kind
rather than by a market index. That is deliberate and it is disclosed on
the page. The index series would need a second data source this project
cannot verify from where the code is written; the funds are already in the
weekly grid, priced on the same days with the same lags and after the same
kind of fees as the funds being explained, and they refresh with every
weekly run. Sharpe's own formulation uses investable asset-class indices;
a passive fund is the investable version here.

Which fund stands for a factor is **pinned** (`PINNED`): the funds the
typicality rule chose on the first live run — for each factor, the
candidate with full history whose median correlation with the other
candidates was highest. Re-choosing every week let the fund behind a factor
change from one snapshot to the next, so a group's name could change with
nothing about the group having changed. The rule now runs only as a
fallback, for a factor whose pinned fund lacks full history in the window.

A proxy fund is **left out of its own group's series** before the group is
fitted (`group_series(..., exclude=...)`). The gold group contains AFO, the
fund standing for gold; fitting the group with AFO inside it partly fits
AFO against itself and flatters the R².

## How sure a composition is

`bootstrap_ranges` refits every group on moving-block resamples of the
weeks (blocks of `BOOT_BLOCK` weeks, so clusters of volatile weeks stay
together) and reports each weight's 5th and 95th percentile. The factors
move together — dollar and euro funds at 0.82 over the window — and a
constrained regression can trade weight between collinear factors without
fitting any worse; the range is what shows whether "Dolar %72" is a
measurement or one of several equally good answers.

## Not every fund gets a label

The fit is reported with it (`r2`, the share of the fund's weekly variance
the mix explains). Below `MIN_R2` the page prints no composition: a mix that
explains a fraction of a fund's movement is a guess wearing percentages,
and this site does not make claims it has not measured.

## The solver

Minimise ||y - Xw||² subject to w >= 0 and sum(w) = 1, per fund, on the
weeks both the fund and every factor have a return. Written as a quadratic
in the per-fund Gram matrix `G = XᵀX` and `c = Xᵀy`, so every fund is solved
at once by accelerated projected gradient (FISTA) with a Euclidean
projection onto the simplex after each step. `scipy` is not a dependency
and does not need to be. The objective is convex, so the iteration
converges to the global optimum; `ITERATIONS` is set so that the weights
change by under 1e-6 between the last steps on the live universe.

Imports `precompute` only for `series_stats`-style conventions; touches no
network and no database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

#: Factor keys in display order, each with its candidate funds. The API
#: returns keys only; the Turkish label is the frontend's.
FACTORS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("tr_equity", ("DZE", "AKU", "TIE", "YEF", "HBU")),
    ("gold", ("AFO", "GTA", "HBF", "OJK", "DBA", "FIB")),
    ("silver", ("GUM", "GTZ", "DMG", "YZG", "GMC")),
    ("usd", ("AKE", "YBE", "YMD", "ZP6")),
    ("eur", ("EUZ", "IUF", "DSD", "FKE", "DOV")),
    ("tl_rate", ("DLY", "HSL", "AAL", "BGP", "FSK", "FIL")),
    ("tl_bond", ("AK2", "APT", "DBB", "FI3", "GUV")),
    ("foreign_equity", ("AFA", "TFF", "GUH")),
)

#: The proxy per factor, pinned from the first live run (2026-09-26), when the
#: typicality rule chose exactly these. Used whenever the fund has full
#: history in the window; otherwise that factor falls back to the rule.
PINNED: dict[str, str] = {
    "tr_equity": "TIE",
    "gold": "AFO",
    "silver": "GTZ",
    "usd": "AKE",
    "eur": "IUF",
    "tl_rate": "DLY",
    "tl_bond": "APT",
    "foreign_equity": "TFF",
}
#: Moving-block bootstrap: resamples, block length in weeks, solver steps
#: (warm-started from the full-sample fit, so far fewer are needed), and
#: the percentiles reported.
BOOT_SAMPLES = 100
BOOT_BLOCK = 8
BOOT_ITERATIONS = 600
BOOT_PERCENTILES = (5.0, 95.0)

#: A proxy must have a return in at least this share of the window's weeks.
MIN_PROXY_COVERAGE = 0.98
#: Below this, the composition is not reported.
MIN_R2 = 0.60
#: Weeks a fund needs alongside the factors before it is analysed at all.
MIN_WEEKS = 52
ITERATIONS = 4000


@dataclass(frozen=True)
class Style:
    #: Factor key -> weight, every factor present, summing to 1.
    weights: dict[str, float]
    r2: float
    weeks: int


@dataclass(frozen=True)
class StyleModel:
    #: Factor key -> the fund standing for it this week. Factors with no
    #: usable candidate are absent, and the analysis runs without them.
    proxies: dict[str, str]
    factors: pd.DataFrame  # week × factor key, rows with any gap dropped


def _median_offdiag(corr: np.ndarray) -> np.ndarray:
    c = corr.copy()
    np.fill_diagonal(c, np.nan)
    with np.errstate(all="ignore"):
        return np.nanmedian(c, axis=1)


def choose_proxies(returns: pd.DataFrame) -> StyleModel:
    """Pick the most typical full-history candidate for every factor."""
    window = returns.dropna(how="all")
    n_weeks = len(window)
    proxies: dict[str, str] = {}
    for key, candidates in FACTORS:
        present = [
            c for c in candidates
            if c in window.columns
            and window[c].notna().sum() >= MIN_PROXY_COVERAGE * n_weeks
        ]
        pinned = PINNED.get(key)
        if pinned in present:
            proxies[key] = pinned
            continue
        if not present:
            continue
        if len(present) == 1:
            proxies[key] = present[0]
            continue
        corr = window[present].corr().to_numpy()
        typical = _median_offdiag(corr)
        proxies[key] = present[int(np.nanargmax(typical))]

    factors = pd.DataFrame(
        {key: window[code] for key, code in proxies.items()}, index=window.index
    ).dropna(how="any")
    return StyleModel(proxies=proxies, factors=factors)


def _project_simplex(v: np.ndarray) -> np.ndarray:
    """Row-wise Euclidean projection onto {w >= 0, sum w = 1}."""
    n, k = v.shape
    u = -np.sort(-v, axis=1)
    css = np.cumsum(u, axis=1) - 1.0
    idx = np.arange(1, k + 1)
    cond = u - css / idx > 0
    rho = k - 1 - np.argmax(cond[:, ::-1], axis=1)
    theta = css[np.arange(n), rho] / (rho + 1)
    return np.maximum(v - theta[:, None], 0.0)


def solve_simplex_ls(
    G: np.ndarray,
    c: np.ndarray,
    iterations: int = ITERATIONS,
    start: Optional[np.ndarray] = None,
) -> np.ndarray:
    """min ½wᵀGw − cᵀw on the simplex, for a stack of problems at once.

    `G` is (n, k, k), `c` is (n, k). FISTA with step 1/L, L the largest
    eigenvalue of each G. `start` warm-starts every problem (it is projected
    onto the simplex first); the objective is convex, so the start changes
    how fast the answer is reached, never which answer.
    """
    n, k = c.shape
    L = np.linalg.eigvalsh(G)[:, -1]
    L = np.where(L > 0, L, 1.0)
    w = _project_simplex(start.copy()) if start is not None else np.full((n, k), 1.0 / k)
    z = w.copy()
    t = 1.0
    for _ in range(iterations):
        grad = np.einsum("nij,nj->ni", G, z) - c
        w_next = _project_simplex(z - grad / L[:, None])
        t_next = (1.0 + np.sqrt(1.0 + 4.0 * t * t)) / 2.0
        z = w_next + ((t - 1.0) / t_next) * (w_next - w)
        w, t = w_next, t_next
    return w


def analyse(returns: pd.DataFrame, model: StyleModel, min_weeks: int = MIN_WEEKS) -> dict[str, Style]:
    """Style of every column of `returns` against the model's factors.

    Each fund is fitted on the weeks it shares with the factor matrix; a
    fund with fewer than `min_weeks` of them is left out rather than fitted
    on too little.
    """
    keys = list(model.factors.columns)
    if not keys:
        return {}
    idx = model.factors.index
    X = model.factors.to_numpy(dtype="float64")            # T × K
    Y = returns.reindex(idx).to_numpy(dtype="float64")     # T × N
    M = np.isfinite(Y)
    Yz = np.where(M, Y, 0.0)
    Mf = M.astype("float64")

    n_obs = Mf.sum(axis=0)
    keep = n_obs >= min_weeks
    if not keep.any():
        return {}
    Yz, Mf, n_obs = Yz[:, keep], Mf[:, keep], n_obs[keep]
    codes = [c for c, k in zip(returns.columns, keep) if k]

    # Per-fund Gram matrices over each fund's own weeks.
    G = np.einsum("tn,ti,tj->nij", Mf, X, X)
    c = np.einsum("tn,ti->ni", Yz, X)
    W = solve_simplex_ls(G, c)

    yy = (Yz * Yz).sum(axis=0)
    ybar = Yz.sum(axis=0) / n_obs
    sst = yy - n_obs * ybar**2
    sse = yy - 2.0 * (W * c).sum(axis=1) + np.einsum("ni,nij,nj->n", W, G, W)
    with np.errstate(invalid="ignore", divide="ignore"):
        r2 = np.where(sst > 0, 1.0 - sse / sst, np.nan)

    out: dict[str, Style] = {}
    for i, code in enumerate(codes):
        out[code] = Style(
            weights={k: float(W[i, j]) for j, k in enumerate(keys)},
            r2=float(r2[i]),
            weeks=int(n_obs[i]),
        )
    return out


def group_series(
    returns: pd.DataFrame, codes: list[str], exclude: Optional[set[str]] = None
) -> pd.Series:
    """An equal-weight group's weekly return: the mean of whoever priced.

    `exclude` drops the factor proxies, so a group is never fitted against a
    fund that is inside it. A group made of nothing but proxies keeps them,
    rather than becoming an empty series.
    """
    keep = [c for c in codes if not exclude or c not in exclude] or list(codes)
    return returns[keep].mean(axis=1, skipna=True)


def _systems(Y: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-column Gram matrices and cross products over each column's own weeks."""
    M = np.isfinite(Y)
    Yz = np.where(M, Y, 0.0)
    Mf = M.astype("float64")
    G = np.einsum("tn,ti,tj->nij", Mf, X, X)
    c = np.einsum("tn,ti->ni", Yz, X)
    return G, c, Mf.sum(axis=0)


def bootstrap_ranges(
    series: pd.DataFrame,
    model: StyleModel,
    styles: dict,
    samples: int = BOOT_SAMPLES,
    block: int = BOOT_BLOCK,
    seed: int = 0,
) -> dict:
    """Each fitted column's weight range over moving-block resamples.

    Returns column -> factor key -> (low, high) at `BOOT_PERCENTILES`. The
    same resampled weeks are used for every column in a replicate, and every
    replicate starts from that column's full-sample weights. Seeded, so a
    snapshot's ranges are reproducible.
    """
    cols = [c for c in series.columns if c in styles]
    keys = list(model.factors.columns)
    if not cols or not keys:
        return {}
    X = model.factors.to_numpy(dtype="float64")
    Y = series[cols].reindex(model.factors.index).to_numpy(dtype="float64")
    T = X.shape[0]
    if T < 2 * block:
        return {}
    start = np.array([[styles[c].weights[k] for k in keys] for c in cols])
    rng = np.random.default_rng(seed)
    starts_per = int(np.ceil(T / block))
    Gs, cs, inits = [], [], []
    for _ in range(samples):
        s = rng.integers(0, T - block + 1, size=starts_per)
        idx = (s[:, None] + np.arange(block)[None, :]).ravel()[:T]
        G, c, _ = _systems(Y[idx], X[idx])
        Gs.append(G)
        cs.append(c)
        inits.append(start)
    W = solve_simplex_ls(
        np.concatenate(Gs), np.concatenate(cs), BOOT_ITERATIONS, np.concatenate(inits)
    ).reshape(samples, len(cols), len(keys))
    lo, hi = np.percentile(W, BOOT_PERCENTILES, axis=0)
    return {
        col: {k: (float(lo[j, i]), float(hi[j, i])) for i, k in enumerate(keys)}
        for j, col in enumerate(cols)
    }


def reportable(style: Optional[Style]) -> bool:
    return style is not None and np.isfinite(style.r2) and style.r2 >= MIN_R2
