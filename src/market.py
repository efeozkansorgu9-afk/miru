"""
How many different things the fund universe actually holds.

Every tradeable fund is measured against every other, the same way the fund
pages measure a pair — weekly returns, Pearson, a 95% Fisher interval on the
pair's own shared weeks, the same thresholds — and then partitioned into
groups in which **every** pair is `overlapping`: the lower end of its
interval above 0.85. A group here makes the same claim a group in the basket
tool makes, about a whole market instead of five funds.

## Why complete linkage, and not connected components

Joining every overlapping pair and reading off the connected components is
the obvious method and the wrong one: it chains. A money market fund that
overlaps a short bond fund that overlaps a long bond fund would put the
money market fund and the long bond fund in one group, and nothing about
those two says they are one holding. The basket tool refuses chains for the
same reason (it groups by cliques).

Complete linkage is agglomerative clustering where the distance between two
groups is their *farthest* pair. Merging only while that distance is under
the line means every pair inside every group clears it — the clique
property — while still giving a partition, so each fund is counted exactly
once. The distance is `1 - ci_low`, so the test is read off the end of the
interval that argues against the claim, as everywhere else. A pair that
cannot be measured (too few shared weeks) has infinite distance, so no group
ever contains a pair nobody measured.

The partition is not the unique best one — a fund can overlap members of two
groups and still sit in only one — and the page says so. What it guarantees
is the property the claim needs: inside a group, every pair was measured
and every pair overlaps.

## What it is computed from

The weekly price grid the job already stores (`fund_prices`), differenced
the way `precompute.weekly_return_matrix` differences a fund's own prices:
a missed week gives a two-week return on its far side, never a filled one.
So the coefficients here are the ones the fund pages quote, from the same
functions (`pairwise_pearson`, `fisher_interval`, `series_stats`).

Imports `precompute` and nothing that touches the network or a database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from src import precompute as pc

#: Why a fund was left out of the grouping. Closed set.
UNMEASURED_SHORT = "short_history"
UNMEASURED_STALE = "stale_prices"


@dataclass(frozen=True)
class MarketCluster:
    """Funds of which every pair overlaps."""

    codes: list[str]
    #: The lowest `ci_low` among its pairs: the weakest claim the group rests on.
    weakest_ci_low: float
    #: Median point estimate over its pairs, for a sense of how tight it is.
    median_correlation: float


@dataclass(frozen=True)
class MarketGrouping:
    clusters: list[MarketCluster]
    #: Measured funds that joined no group.
    singletons: list[str]
    #: Funds not measured at all, and why.
    unmeasured: dict[str, str]
    window_start: Optional[pd.Timestamp]
    window_end: Optional[pd.Timestamp]
    thresholds: pc.Thresholds = field(default_factory=pc.Thresholds)

    @property
    def measured(self) -> int:
        return sum(len(c.codes) for c in self.clusters) + len(self.singletons)

    @property
    def groups_total(self) -> int:
        """Distinct movements: every multi-fund group plus every fund alone."""
        return len(self.clusters) + len(self.singletons)


def returns_from_grid(grid: pd.DataFrame) -> pd.DataFrame:
    """Weekly returns from the stored W-FRI price grid, one fund at a time.

    Each column is differenced over its own observed weeks and put back on
    the grid's index, so a blank week leaves a hole and the return after it
    spans two weeks — the same convention `weekly_return_matrix` applies to
    raw prices. Nothing is filled.
    """
    if grid.empty:
        return grid.copy()
    columns = {}
    for code in grid.columns:
        prices = grid[code].dropna()
        prices = prices[prices > 0]
        returns = prices.pct_change().dropna()
        if not returns.empty:
            columns[code] = returns
    if not columns:
        return pd.DataFrame(index=grid.index)
    return pd.DataFrame(columns).reindex(grid.index)


def complete_linkage(distance: np.ndarray, cut: float) -> list[list[int]]:
    """Partition by complete linkage, merging while the farthest pair < `cut`.

    `distance` is square and symmetric with `inf` where a pair may never
    share a group; it is copied, not modified. Plain Lance-Williams: after
    merging j into i, the distance from the new group to any k is the larger
    of the two old ones. One argmin over the matrix per merge, which for
    ~1,400 funds is a few seconds and is paid once per weekly snapshot.
    """
    d = np.array(distance, dtype="float64", copy=True)
    n = d.shape[0]
    np.fill_diagonal(d, np.inf)
    members: list[Optional[list[int]]] = [[i] for i in range(n)]

    while True:
        flat = int(np.argmin(d))
        i, j = divmod(flat, n)
        if not np.isfinite(d[i, j]) or d[i, j] >= cut:
            break
        if i > j:
            i, j = j, i
        merged = np.maximum(d[i], d[j])
        d[i, :] = merged
        d[:, i] = merged
        d[i, i] = np.inf
        d[j, :] = np.inf
        d[:, j] = np.inf
        members[i] = members[i] + members[j]  # type: ignore[operator]
        members[j] = None

    return [m for m in members if m is not None]


def group_market(
    returns: pd.DataFrame, thresholds: Optional[pc.Thresholds] = None
) -> MarketGrouping:
    """Partition a week × fund return matrix into overlapping groups."""
    t = thresholds or pc.Thresholds()
    if returns.empty or returns.shape[1] == 0:
        return MarketGrouping([], [], {}, None, None, t)

    stats = pc.series_stats(returns)
    unmeasured: dict[str, str] = {}
    keep: list[str] = []
    for code in returns.columns:
        s = stats[code]
        if s.history_weeks < t.min_weeks:
            unmeasured[code] = UNMEASURED_SHORT
        elif s.stale_ratio > t.max_stale_ratio:
            unmeasured[code] = UNMEASURED_STALE
        else:
            keep.append(code)

    observed = returns.dropna(how="all")
    start = observed.index.min() if not observed.empty else None
    end = observed.index.max() if not observed.empty else None

    if not keep:
        return MarketGrouping([], [], unmeasured, start, end, t)

    matrix = returns[keep]
    corr, n, codes = pc.pairwise_pearson(matrix)
    low, _ = pc.fisher_interval(corr, n)

    measurable = (n >= t.min_weeks) & np.isfinite(low)
    distance = np.where(measurable, 1.0 - low, np.inf)
    # `ci_low > overlapping` is the claim; as a distance that is strictly
    # under `1 - overlapping`.
    groups = complete_linkage(distance, cut=1.0 - t.overlapping)

    clusters: list[MarketCluster] = []
    singletons: list[str] = []
    for idx in groups:
        if len(idx) == 1:
            singletons.append(codes[idx[0]])
            continue
        sub = np.ix_(idx, idx)
        iu = np.triu_indices(len(idx), k=1)
        lows = low[sub][iu]
        rs = corr[sub][iu]
        clusters.append(
            MarketCluster(
                codes=sorted(codes[k] for k in idx),
                weakest_ci_low=float(np.min(lows)),
                median_correlation=float(np.median(rs)),
            )
        )

    clusters.sort(key=lambda c: (-len(c.codes), c.codes[0]))
    singletons.sort()
    return MarketGrouping(clusters, singletons, unmeasured, start, end, t)


def risk_shares(returns: pd.DataFrame, weights: dict[str, float]) -> dict[str, float]:
    """Each fund's share of an asset-weighted market portfolio's variance.

    The Euler decomposition the basket tool uses — w_i (Σw)_i / wᵀΣw, the
    shares summing to exactly 1 — over every fund with a known size, weighted
    by that size. It answers "of all the movement in the money held in TEFAS
    funds, how much comes from each group", which the money bar alone does
    not: a group holding a tenth of the money in equity funds can carry far
    more than a tenth of the movement.

    Σ is pairwise-complete, like every correlation here: each fund is
    demeaned over its own weeks and each pair's covariance is taken over the
    weeks both priced. Four matrix products rather than pandas' pairwise
    loop, which over ~1,200 funds is ~700,000 pairs. A pairwise matrix need
    not be positive semi-definite, so a total that comes out non-positive
    returns an empty dict rather than shares nobody could read.
    """
    codes = [c for c in returns.columns if weights.get(c, 0) > 0]
    if not codes:
        return {}
    R = returns[codes].to_numpy(dtype="float64")
    M = np.isfinite(R)
    means = np.nanmean(np.where(M, R, np.nan), axis=0)
    Z = np.where(M, R - means, 0.0)
    Mf = M.astype("float64")
    n = Mf.T @ Mf
    with np.errstate(invalid="ignore", divide="ignore"):
        cov = np.where(n > 1, (Z.T @ Z) / (n - 1), 0.0)
    w = np.array([weights[c] for c in codes], dtype="float64")
    w = w / w.sum()
    marginal = cov @ w
    total = float(w @ marginal)
    if not np.isfinite(total) or total <= 0:
        return {}
    return {c: float(w[i] * marginal[i] / total) for i, c in enumerate(codes)}
