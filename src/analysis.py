"""
Analysis Layer
==============
Pure portfolio maths over a price matrix. Give it prices and weights, get
numbers back.

This module knows nothing about TEFAS, `FundDataset`, caching or the UI. It
takes a date × fund DataFrame and a dict of lot sizes, and it neither prints
nor persists anything — which is what makes it testable by hand and safe to
call from a notebook, a script or a dashboard alike.

    from src.analysis import analyze_basket
    result = analyze_basket(prices, {"GAL": 10_000, "AFO": 5_000})
    result.diversification_ratio
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Optional

import numpy as np
import pandas as pd

# Everything is computed on weekly returns and annualised from there.
WEEKS_PER_YEAR = 52

# Weekly sampling rule: the last observed price in each week ending Friday.
#
# Daily returns are the wrong input for this application. Several Turkish
# funds — hedge funds and debt-instrument funds especially — price staleley,
# repeating or lagging their marks. On daily data that shows up as low
# cross-fund correlation, which makes a concentrated basket look diversified:
# precisely the error this tool exists to catch. Weekly sampling gives the
# stale marks time to catch up, so the correlation reflects the funds rather
# than their pricing calendars.
WEEKLY_RULE = "W-FRI"


# ----------------------------------------------------------------------
# Result types
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class Drawdown:
    """The worst peak-to-trough fall in the basket's value."""

    depth: float  # negative fraction, e.g. -0.23 for a 23% fall
    peak_date: pd.Timestamp
    trough_date: pd.Timestamp
    peak_value: float
    trough_value: float

    @property
    def duration_days(self) -> int:
        return int((self.trough_date - self.peak_date).days)


@dataclass(frozen=True)
class BasketAnalysis:
    """Everything computed for one basket over one price matrix."""

    weights: dict[str, float]  # normalised to sum to 1
    correlation: Optional[pd.DataFrame]  # None for a single-fund basket
    diversification_ratio: float
    basket_volatility: float  # annualised
    fund_volatility: dict[str, float]  # annualised, per fund
    weighted_fund_volatility: float  # the ratio's numerator, annualised
    max_drawdown: Drawdown
    weekly_observations: int  # weekly returns the estimates rest on
    start: pd.Timestamp
    end: pd.Timestamp
    weekly_returns: pd.DataFrame = field(repr=False)
    basket_value: pd.Series = field(repr=False)

    @property
    def is_single_fund(self) -> bool:
        return len(self.weights) == 1


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------


def analyze_basket(
    prices: pd.DataFrame,
    weights: Mapping[str, float],
) -> BasketAnalysis:
    """
    Analyse a basket of funds over an aligned price matrix.

    Parameters
    ----------
    prices : pd.DataFrame
        Date × fund price matrix, DatetimeIndex, one column per fund, no
        missing values. Align it before calling (see `src.data`).
    weights : mapping of str to float
        Lot sizes in lira. Normalised internally, so absolute scale does not
        matter; the ratios between funds do. Must cover exactly the columns
        of `prices`.

    Returns
    -------
    BasketAnalysis

    Raises
    ------
    ValueError
        On empty or misaligned input, missing or non-positive prices,
        negative weights, a non-positive total weight, or fewer than two
        weekly observations to estimate from.
    """
    prices = _validate_prices(prices)
    w = _normalize_weights(weights, list(prices.columns))

    returns = to_weekly_returns(prices)
    if len(returns) < 2:
        raise ValueError(
            f"need at least 2 weekly returns to estimate anything, got "
            f"{len(returns)} — the price matrix spans too short a window"
        )

    value = basket_value_series(prices, w)

    # Weekly volatility per fund, and the basket's own. The basket series is
    # sampled the same way the funds are so the ratio compares like with like.
    fund_vol_weekly = returns.std()
    basket_returns = value.resample(WEEKLY_RULE).last().dropna().pct_change().dropna()
    basket_vol_weekly = float(basket_returns.std())

    weighted_vol = float((pd.Series(w) * fund_vol_weekly).sum())

    return BasketAnalysis(
        weights=w,
        correlation=returns.corr() if returns.shape[1] > 1 else None,
        diversification_ratio=_diversification_ratio(weighted_vol, basket_vol_weekly),
        basket_volatility=_annualize(basket_vol_weekly),
        fund_volatility={c: _annualize(v) for c, v in fund_vol_weekly.items()},
        weighted_fund_volatility=_annualize(weighted_vol),
        max_drawdown=max_drawdown(value),
        weekly_observations=int(len(returns)),
        start=prices.index[0],
        end=prices.index[-1],
        weekly_returns=returns,
        basket_value=value,
    )


def to_weekly_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """
    Weekly percentage returns from the last observed price of each week.

    Not forward-filled. `resample().last()` picks a real observation from
    inside each week rather than carrying a stale one across the boundary,
    and weeks with no trading at all are dropped instead of invented. A
    dropped week makes its neighbour a two-week return, which is a small
    distortion applied identically to every fund — unlike filling, which
    would manufacture zero-return weeks and depress both volatility and
    correlation.
    """
    weekly = prices.resample(WEEKLY_RULE).last().dropna(how="all")
    return weekly.pct_change().dropna(how="any")


def basket_value_series(prices: pd.DataFrame, weights: Mapping[str, float]) -> pd.Series:
    """
    Value of a buy-and-hold basket, normalised to 1.0 at the first date.

    Weights are applied once, at the start, and then left alone: units are
    bought on day one and held. No rebalancing is assumed, so a fund that
    outperforms grows its share of the basket exactly as it would in a real
    unrebalanced account.
    """
    first = prices.iloc[0]
    units = pd.Series({c: weights[c] / first[c] for c in prices.columns})
    return (prices * units).sum(axis=1)


def max_drawdown(value: pd.Series) -> Drawdown:
    """
    Worst peak-to-trough fall in a value series, with the dates it happened.

    Computed on the full-resolution series rather than the weekly one: the
    weekly grid would miss a trough that fell and recovered inside a week,
    and would report a Friday instead of the day it actually happened.
    """
    running_peak = value.cummax()
    drawdowns = value / running_peak - 1.0

    trough_date = drawdowns.idxmin()
    depth = float(drawdowns.loc[trough_date])

    # The peak this trough fell from: the last date at or before the trough
    # where the series was at its running maximum.
    upto = value.loc[:trough_date]
    peak_date = upto.idxmax()

    return Drawdown(
        depth=depth,
        peak_date=peak_date,
        trough_date=trough_date,
        peak_value=float(value.loc[peak_date]),
        trough_value=float(value.loc[trough_date]),
    )


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _validate_prices(prices: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(prices, pd.DataFrame):
        raise ValueError(f"prices must be a DataFrame, got {type(prices).__name__}")
    if prices.empty or prices.shape[1] == 0:
        raise ValueError("prices is empty — nothing to analyse")
    if not isinstance(prices.index, pd.DatetimeIndex):
        raise ValueError("prices must be indexed by date (DatetimeIndex)")

    if prices.isna().any().any():
        gaps = prices.columns[prices.isna().any()].tolist()
        raise ValueError(
            f"prices contains missing values in {gaps} — align the matrix "
            f"before analysing it; this layer will not fill them"
        )
    if (prices <= 0).any().any():
        bad = prices.columns[(prices <= 0).any()].tolist()
        raise ValueError(f"prices contains non-positive values in {bad}")

    if not prices.index.is_monotonic_increasing:
        prices = prices.sort_index()
    return prices


def _normalize_weights(weights: Mapping[str, float], columns: list[str]) -> dict[str, float]:
    """Lira amounts in, fractions of the basket out."""
    missing = [c for c in columns if c not in weights]
    extra = [c for c in weights if c not in columns]
    if missing or extra:
        raise ValueError(
            f"weights must cover exactly the priced funds; "
            f"missing weights for {missing}, weights for unpriced {extra}"
        )

    negative = {c: weights[c] for c in columns if weights[c] < 0}
    if negative:
        raise ValueError(f"negative weights are not supported: {negative}")

    total = float(sum(weights[c] for c in columns))
    if total <= 0:
        raise ValueError(f"total weight must be positive, got {total}")

    return {c: float(weights[c]) / total for c in columns}


def _diversification_ratio(weighted_vol: float, basket_vol: float) -> float:
    """
    Weighted sum of fund volatilities over the basket's actual volatility.

    1.0 means the funds move as one and holding several bought nothing; the
    further above 1.0, the more their independent movement cancels out.
    """
    if basket_vol <= 0:
        # A basket with no variance at all: nothing was diversified away
        # because there was nothing to diversify.
        return float("nan") if weighted_vol > 0 else 1.0
    return weighted_vol / basket_vol


def _annualize(weekly_vol: float) -> float:
    return float(weekly_vol) * np.sqrt(WEEKS_PER_YEAR)
