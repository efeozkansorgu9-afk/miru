"""
Precompute
==========
The weekly maths: every fund against every other fund, once, so that a
request only ever reads a row.

Nothing here is new arithmetic. Weekly returns come from `src.analysis`, and
the prices they are built on come from `src.data`; this module aligns those
per-fund series into one matrix, correlates it, and says how sure it is.

Three things are worth reading before changing any of it.

**The matrix is not inner-joined.** `src.data` builds a basket by dropping
every date some fund in it is missing, which is right for five funds a
reader chose and wrong for fourteen hundred: one fund launched last month
would cut the window to last month for everybody. So each fund keeps its own
weekly returns and they are aligned on the union of weeks, with holes. Every
pair is then measured on the weeks that pair actually shares, which is why
`n_weeks` is stored per row and not per run.

**Correlation is computed by matrix algebra, not by iterating pairs.** With
holes, `DataFrame.corr()` falls back to a Python loop over ~950,000 pairs.
The same numbers come out of four matrix products — see `pairwise_pearson`.

**Every verdict is read off the end of the interval that argues against it.**
A point estimate of 0.90 on twelve weeks and one on three years are not the
same claim, and the bucket is required to notice: "overlapping" asks whether
the *lower* bound still clears the line, "unrelated" asks whether the
*upper* bound is still under it. A wide interval therefore fails both and
lands in `uncertain`, which is the honest answer and not a missing one.

Bucket values are stored as codes, not as the Turkish shown on screen. That
is this repository's rule for anything crossing a boundary — the API
"returns numbers and state codes, never display text" — and the frontend
already phrases every finding it draws. The five codes, and the words they
stand for:

    overlapping        Örtüşen
    inverse            Ters yönlü
    similar            Benzer
    moderate           Orta düzeyde
    unrelated          İlişkisiz
    uncertain          Belirsiz
    insufficient_data  Yetersiz veri
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from src import analysis as an

logger = logging.getLogger(__name__)

#: How much history to correlate over. Three years of weekly returns is ~156
#: observations, which is wide enough for the intervals below to be worth
#: quoting and recent enough that a fund's strategy has probably not changed
#: underneath it.
HISTORY_MONTHS = 36

#: Neighbours kept per fund, at each end.
TOP_N = 10

#: 95%, as the two-sided normal quantile the Fisher interval is built from.
Z_95 = 1.959963984540054


@dataclass(frozen=True)
class Thresholds:
    """Where the bucket lines sit.

    Every one of them is a product decision that will be argued about, so
    all five are in one object and every one can be overridden from the
    environment without a deploy.
    """

    #: A pair is "overlapping" when the interval's lower bound clears this.
    overlapping: float = 0.85
    #: ... and "similar" when it clears this.
    similar: float = 0.60
    #: A pair is "inverse" when the interval's UPPER bound is under this.
    #: Negative, and the sign is part of the value rather than applied later.
    inverse: float = -0.60
    #: A pair is "unrelated" when the whole interval sits inside ±this.
    unrelated: float = 0.30
    #: Fewer shared weeks than this and no verdict is given at all.
    min_weeks: int = 52
    #: A fund with more than this share of zero-return weeks is not being
    #: priced, it is being carried. Correlations against it measure the
    #: pricing schedule rather than the holdings.
    max_stale_ratio: float = 0.30

    @classmethod
    def from_env(cls, env: Optional[dict] = None) -> "Thresholds":
        """Read overrides from the environment, keeping the defaults above.

        A value that will not parse is a typo in a deployment variable, and
        silently keeping the default would hide it until someone wondered
        why the numbers had not moved. So it raises.
        """
        env = os.environ if env is None else env
        prefix = "MIRU_CORR_"
        fields = {
            "overlapping": ("OVERLAPPING_MIN", float),
            "similar": ("SIMILAR_MIN", float),
            "inverse": ("INVERSE_MAX", float),
            "unrelated": ("UNRELATED_MAX", float),
            "min_weeks": ("MIN_WEEKS", int),
            "max_stale_ratio": ("MAX_STALE_RATIO", float),
        }
        values = {}
        for name, (suffix, cast) in fields.items():
            raw = env.get(prefix + suffix)
            if raw is None or not str(raw).strip():
                continue
            try:
                values[name] = cast(str(raw).strip())
            except ValueError as exc:
                raise ValueError(
                    f"{prefix}{suffix}={raw!r} is not a valid {cast.__name__}"
                ) from exc
        return cls(**values)


@dataclass(frozen=True)
class FundSeriesStats:
    """What one fund's own return series looks like, before any pairing."""

    code: str
    history_weeks: int
    stale_ratio: float


# ----------------------------------------------------------------------
# Weekly returns, aligned but not inner-joined
# ----------------------------------------------------------------------


def weekly_return_matrix(long_df: pd.DataFrame) -> pd.DataFrame:
    """A week × fund matrix of returns, with a hole wherever a fund is absent.

    Each fund is resampled and differenced on its own through
    `analysis.to_weekly_returns`, then the columns are concatenated on the
    union of their weeks. Doing it per fund is what keeps one fund's missing
    week from deleting that week for everybody, and it keeps the weekly
    convention — W-FRI, last observed price, never forward filled — in the
    one module that defines it.

    A consequence worth knowing: a fund that misses a week has a two-week
    return on the far side of the gap, and that is paired against its
    neighbour's one-week return. That is the existing convention rather than
    a choice made here, and `stale_ratio` is what catches the funds where it
    happens often enough to matter.
    """
    if long_df.empty:
        return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))

    columns: dict[str, pd.Series] = {}
    for code, group in long_df.groupby("fund_code", sort=True):
        prices = (
            group.set_index("date")["price"]
            .sort_index()
            .to_frame(name=code)
            .astype("float64")
        )
        # Duplicate dates would make resample ambiguous; data.py's own
        # cleaning already drops them, this is belt and braces.
        prices = prices[~prices.index.duplicated(keep="last")]
        returns = an.to_weekly_returns(prices)
        if returns.empty:
            continue
        columns[code] = returns[code]

    if not columns:
        return pd.DataFrame(index=pd.DatetimeIndex([], name="date"))

    matrix = pd.concat(columns.values(), axis=1, keys=columns.keys()).sort_index()
    matrix.index.name = "date"
    return matrix


def series_stats(matrix: pd.DataFrame) -> dict[str, FundSeriesStats]:
    """Per-fund history length and the share of its weeks that did not move.

    A zero return is stored as an exact 0.0 by `pct_change` when two
    consecutive observed prices are identical, which for a Turkish fund
    usually means the price was restated rather than recalculated. The ratio
    is over the fund's own observed weeks, not over the calendar.
    """
    stats: dict[str, FundSeriesStats] = {}
    for code in matrix.columns:
        series = matrix[code].dropna()
        n = int(len(series))
        zeros = int((series == 0.0).sum())
        stats[code] = FundSeriesStats(
            code=code,
            history_weeks=n,
            stale_ratio=(zeros / n) if n else 1.0,
        )
    return stats


# ----------------------------------------------------------------------
# Correlation, pairwise-complete, without a pair loop
# ----------------------------------------------------------------------


def pairwise_pearson(matrix: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Pearson correlation and shared-week counts for every pair at once.

    Each pair is measured over the weeks both funds have, so the usual
    single-pass formula is applied with per-pair sums, and every one of
    those sums is a matrix product:

        Z  the returns with holes filled by zero
        M  1 where a return exists, 0 where it does not

        n   = Mᵀ M            weeks the pair shares
        Sxy = Zᵀ Z            Σxy over those weeks
        Sx  = Zᵀ M            Σx  over those weeks (Sy is its transpose)
        Sxx = (Z²)ᵀ M         Σx² over those weeks (Syy is its transpose)

    Filling holes with zero is safe *because* of M: a hole contributes zero
    to a sum whose count also excludes it, so no fabricated observation ever
    reaches the arithmetic. The alternative, iterating 950,000 pairs in
    Python, computes the same numbers about three orders of magnitude slower.

    Returns the correlation matrix, the pairwise count matrix, and the codes
    in column order. Pairs whose denominator vanishes — a fund that never
    moved over the shared weeks — come back as NaN rather than as a number,
    and the caller drops them.
    """
    codes = list(matrix.columns)
    values = matrix.to_numpy(dtype="float64", copy=True)

    mask = np.isfinite(values)
    z = np.where(mask, values, 0.0)
    m = mask.astype("float64")

    n = m.T @ m
    sxy = z.T @ z
    sx = z.T @ m
    sy = sx.T
    sxx = (z * z).T @ m
    syy = sxx.T

    with np.errstate(invalid="ignore", divide="ignore"):
        numerator = n * sxy - sx * sy
        var_x = n * sxx - sx * sx
        var_y = n * syy - sy * sy
        denominator = np.sqrt(var_x * var_y)
        corr = np.where(denominator > 0, numerator / denominator, np.nan)

    # Floating point can put a self-correlation at 1.0000000000000002, and
    # arctanh of that is infinite. Clip before anyone takes a z of it.
    corr = np.clip(corr, -1.0, 1.0)
    np.fill_diagonal(corr, 1.0)
    return corr, n, codes


def fisher_interval(
    corr: np.ndarray, n: np.ndarray, z: float = Z_95
) -> tuple[np.ndarray, np.ndarray]:
    """A 95% interval per pair, on that pair's own number of weeks.

    Fisher's transform, `z = arctanh(r)`, is what makes this possible in one
    vectorised pass: on that scale the sampling distribution is
    approximately normal with a standard error of `1/sqrt(n-3)` that depends
    on nothing but the count, so the interval is built in z and mapped back
    with `tanh`. The asymmetry everyone expects near ±1 comes out of the
    mapping rather than being put in by hand.

    `n <= 3` has no interval at all — the standard error is undefined — and
    comes back NaN on both ends. Those pairs are below `min_weeks` many
    times over and are bucketed `insufficient_data` before anyone reads
    these numbers.
    """
    with np.errstate(invalid="ignore", divide="ignore"):
        zr = np.arctanh(np.clip(corr, -0.999999999999, 0.999999999999))
        # `np.where`, not `np.maximum`: maximum propagates the NaN to every
        # pair instead of masking the few with too few weeks.
        se = 1.0 / np.sqrt(np.where(n > 3.0, n - 3.0, np.nan))
        low = np.tanh(zr - z * se)
        high = np.tanh(zr + z * se)
    return low, high


# ----------------------------------------------------------------------
# Buckets
# ----------------------------------------------------------------------

BUCKET_OVERLAPPING = "overlapping"
BUCKET_INVERSE = "inverse"
BUCKET_SIMILAR = "similar"
BUCKET_MODERATE = "moderate"
BUCKET_UNRELATED = "unrelated"
BUCKET_UNCERTAIN = "uncertain"
BUCKET_INSUFFICIENT = "insufficient_data"

#: In precedence order. The first bucket whose test a pair passes is the one
#: it gets, so this tuple is the rule and not just a list of names.
BUCKETS = (
    BUCKET_INSUFFICIENT,
    BUCKET_OVERLAPPING,
    BUCKET_INVERSE,
    BUCKET_SIMILAR,
    BUCKET_MODERATE,
    BUCKET_UNRELATED,
    BUCKET_UNCERTAIN,
)


def bucket_matrix(
    corr: np.ndarray,
    n: np.ndarray,
    ci_low: np.ndarray,
    ci_high: np.ndarray,
    stale: np.ndarray,
    thresholds: Thresholds,
) -> np.ndarray:
    """One verdict per pair, decided on the interval rather than the estimate.

    Every test reads the end of the interval that could refute its claim,
    never the point estimate:

        insufficient_data  the measurement itself is not trustworthy
        overlapping        ci_low  > 0.85       these are one holding
        inverse            ci_high < -0.60      these move against each other
        similar            ci_low  > 0.60       these move together
        moderate           whole interval in 0.30 .. 0.60
        unrelated          whole interval inside ±0.30
        uncertain          the interval crosses a line, so no verdict

    Precedence is the order above and is expressed as `np.select`, whose
    first-match rule *is* the precedence — nothing depends on the order
    assignments happen to be written in.

    `insufficient_data` comes first and wins outright. When the measurement
    is not trustworthy the answer is that it is not trustworthy, never a
    bucket with a caveat attached.

    `unrelated` is a claim about the whole interval, not about its top end.
    An interval running from -0.95 to -0.90 has an upper bound under 0.30
    and is the opposite of unrelated; requiring the lower bound to clear
    -0.30 as well is what keeps "these have nothing to do with each other"
    meaning that, and `inverse` is where those pairs go instead.

    `moderate` exists because without it `uncertain` was two different
    answers wearing one label: pairs the data could not place, and pairs the
    data placed perfectly well in the gap between "unrelated" and "similar".
    A pair sitting at 0.45 with an interval of 0.38 to 0.51 is not an
    unresolved measurement — it is a resolved measurement of a moderate
    relationship, and it belongs somewhere other than the pairs whose
    interval runs from 0.2 to 0.7.

    Its band is not a new threshold. It is bounded by `unrelated` below and
    `similar` above, the same two numbers those buckets use, so moving
    either line moves this one with it and a gap can never open between
    them. What is left in `uncertain` afterwards is exactly the pairs whose
    interval straddles one of the lines — the ones where no verdict is
    available rather than a middling one.

    `stale` is the per-fund zero-return share as a 1-D array in column
    order; a pair is disqualified when *either* fund is above the line,
    which is what the outer-or below expresses.
    """
    too_few = n < thresholds.min_weeks
    stale_pair = (stale[:, None] > thresholds.max_stale_ratio) | (
        stale[None, :] > thresholds.max_stale_ratio
    )
    unusable = too_few | stale_pair | ~np.isfinite(corr) | ~np.isfinite(ci_low)

    # Every non-insufficient pair has a finite interval on both ends, so
    # these comparisons are only reached where they mean something.
    finite = np.isfinite(ci_low) & np.isfinite(ci_high)
    conditions = [
        unusable,
        finite & (ci_low > thresholds.overlapping),
        finite & (ci_high < thresholds.inverse),
        finite & (ci_low > thresholds.similar),
        finite
        & (ci_low > thresholds.unrelated)
        & (ci_high < thresholds.similar),
        finite
        & (ci_high < thresholds.unrelated)
        & (ci_low > -thresholds.unrelated),
    ]
    choices = [
        BUCKET_INSUFFICIENT,
        BUCKET_OVERLAPPING,
        BUCKET_INVERSE,
        BUCKET_SIMILAR,
        BUCKET_MODERATE,
        BUCKET_UNRELATED,
    ]
    return np.select(conditions, choices, default=BUCKET_UNCERTAIN).astype(object)


# ----------------------------------------------------------------------
# Neighbours
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class Neighbour:
    fund_code: str
    neighbour_code: str
    correlation: float
    ci_low: Optional[float]
    ci_high: Optional[float]
    n_weeks: int
    bucket: str
    direction: str


def top_neighbours(
    corr: np.ndarray,
    n: np.ndarray,
    ci_low: np.ndarray,
    ci_high: np.ndarray,
    buckets: np.ndarray,
    codes: Sequence[str],
    top_n: int = TOP_N,
) -> list[Neighbour]:
    """The `top_n` strongest and `top_n` weakest neighbours of every fund.

    Ranked on the interval, not on the point estimate, and by the same end
    of it the bucket is judged on: the high list sorts by `ci_low`
    descending, so the fund that comes first is the one whose *worst case*
    is strongest, and the low list sorts by `ci_high` ascending. Ranking on
    the point estimate instead lets an under-powered pair outrank a
    well-measured one — a correlation of 0.99 on nine shared weeks sits
    above 0.95 on three years, and it is the nine week pair that is more
    likely to be an accident. Measured on this universe: pairs sharing under
    26 weeks put 8.7% of themselves above |r| = 0.9, against 2.6% for pairs
    with the full history.

    Pairs bucketed `insufficient_data` are not ranked at all. They are not
    ranked low, or ranked and then hidden — they never enter the sort, so a
    fund's ten neighbours are ten measurements that meant something, and a
    fund with nothing measurable simply has fewer than ten.

    Both ends can name the same pair only when a fund has fewer than
    `2 * top_n` usable neighbours, so the two lists are merged on the pair
    and the high end wins, keeping the primary key unique.
    """
    rows: list[Neighbour] = []
    index = np.arange(len(codes))

    for i, code in enumerate(codes):
        eligible = (
            (buckets[i] != BUCKET_INSUFFICIENT)
            & np.isfinite(ci_low[i])
            & np.isfinite(ci_high[i])
        )
        eligible[i] = False  # a fund is not its own neighbour
        if not eligible.any():
            continue

        candidates = index[eligible]
        by_low = candidates[np.argsort(-ci_low[i][candidates], kind="stable")]
        by_high = candidates[np.argsort(ci_high[i][candidates], kind="stable")]

        picked: dict[int, str] = {}
        for j in by_low[:top_n]:
            picked[int(j)] = "high"
        for j in by_high[:top_n]:
            picked.setdefault(int(j), "low")

        r = corr[i]

        for j, direction in picked.items():
            rows.append(
                Neighbour(
                    fund_code=code,
                    neighbour_code=codes[j],
                    correlation=float(r[j]),
                    ci_low=_maybe(ci_low[i, j]),
                    ci_high=_maybe(ci_high[i, j]),
                    n_weeks=int(n[i, j]),
                    bucket=str(buckets[i, j]),
                    direction=direction,
                )
            )
    return rows


def _maybe(value: float) -> Optional[float]:
    """NaN is absent, and absent belongs in the database as NULL."""
    return float(value) if np.isfinite(value) else None
