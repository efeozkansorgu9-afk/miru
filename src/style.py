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

Which fund stands for a factor is not typed in. Each factor has a list of
candidates, and the one used is the **most typical of them**: the candidate
with full history over the window whose median correlation with the other
candidates is highest. So a candidate that is a poor example of its kind
never stands for the kind, and the choice is re-made every week from data.

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


def solve_simplex_ls(G: np.ndarray, c: np.ndarray, iterations: int = ITERATIONS) -> np.ndarray:
    """min ½wᵀGw − cᵀw on the simplex, for a stack of problems at once.

    `G` is (n, k, k), `c` is (n, k). FISTA with step 1/L, L the largest
    eigenvalue of each G.
    """
    n, k = c.shape
    L = np.linalg.eigvalsh(G)[:, -1]
    L = np.where(L > 0, L, 1.0)
    w = np.full((n, k), 1.0 / k)
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


def group_series(returns: pd.DataFrame, codes: list[str]) -> pd.Series:
    """An equal-weight group's weekly return: the mean of whoever priced."""
    return returns[codes].mean(axis=1, skipna=True)


def reportable(style: Optional[Style]) -> bool:
    return style is not None and np.isfinite(style.r2) and style.r2 >= MIN_R2
