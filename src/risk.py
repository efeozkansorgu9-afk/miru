"""
Risk figures for one fund over one return window, off its weekly series.

Pure arithmetic on the stored weekly grid, for the fund page. The window is
the one the return figures were measured on: it ends with `window_end`'s
month and starts `months` before that. `window_start` is **not** used for the
start — it is stored truncated to its month, so reading it as the first of
that month would widen a 12 month window to nearly 13, and the dollar
figure would carry an extra month of lira depreciation. `fund_returns`
starts the window at its last price minus `months`; so does this, to within
the few days between a month's last trading day and its last calendar day.

- Volatility: the standard deviation of weekly returns, annualised by
  sqrt(52). Weekly for the reason everything in this project is weekly:
  several funds price stalely, and daily returns understate how they move.
- Maximum drawdown: the largest fall from a running peak inside the window,
  on the weekly prices. Weekly sampling can miss an intra-week trough, so it
  is a floor on the daily figure, and the page does not claim otherwise.
- Dollar return: the TL return converted at TCMB's rate on the window's
  first and last business days. The TL return itself is measured on daily
  prices by the weekly job; only the conversion happens here.

Imports nothing of the project's own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

WEEKS_PER_YEAR = 52
#: Fewer weekly returns than this in a window and no volatility is given.
MIN_RETURNS = 12


@dataclass(frozen=True)
class WindowRisk:
    volatility: Optional[float]
    max_drawdown: Optional[float]
    weeks: int


def window_bounds(months: int, end_month) -> tuple[pd.Timestamp, pd.Timestamp]:
    """The last day of `end_month`, and `months` before it."""
    end = pd.Timestamp(end_month).to_period("M").end_time.normalize()
    return end - pd.DateOffset(months=months), end


def window_risk(weekly: pd.Series, months: int, end_month) -> WindowRisk:
    start, end = window_bounds(months, end_month)
    prices = weekly[(weekly.index >= start) & (weekly.index <= end)].dropna()
    prices = prices[prices > 0]
    if len(prices) < 2:
        return WindowRisk(None, None, int(len(prices)))
    returns = prices.pct_change().dropna()
    vol = (
        float(returns.std(ddof=1) * np.sqrt(WEEKS_PER_YEAR))
        if len(returns) >= MIN_RETURNS
        else None
    )
    peak = prices.cummax()
    mdd = float((prices / peak - 1.0).min())
    return WindowRisk(vol, mdd, int(len(prices)))


def usd_return(
    nominal: Optional[float], fx: Optional[pd.Series], months: int, end_month
) -> Optional[float]:
    """The TL return restated in dollars, or None without a rate for both ends."""
    if nominal is None or fx is None or fx.empty:
        return None
    start, end = window_bounds(months, end_month)
    after = fx[fx.index >= start]
    before = fx[fx.index <= end]
    if after.empty or before.empty:
        return None
    fx_start, fx_end = float(after.iloc[0]), float(before.iloc[-1])
    # A rate from more than a week outside the window is not this window's.
    if (after.index[0] - start).days > 7 or (end - before.index[-1]).days > 7:
        return None
    return (1.0 + nominal) * fx_start / fx_end - 1.0
