"""
Analysis Layer
==============
Pure portfolio maths over a price matrix. Give it prices and weights, get
numbers back.

This module knows nothing about TEFAS, `FundDataset`, caching or the UI. It
takes a date × fund DataFrame and a dict of lot sizes, and it neither prints
nor persists anything — which is what makes it testable by hand and safe to
call from a notebook, a script or a dashboard alike.

    from src.analysis import analyze_basket, find_fund_groups
    result = analyze_basket(prices, {"GAL": 10_000, "AFO": 5_000})
    result.diversification_ratio
    find_fund_groups(result.correlation, result.weights).groups

A basket bought in instalments is passed as dated purchases instead of lot
sizes. The maths downstream is unchanged; only where the weights come from
differs — market value today rather than the amounts that were paid in:

    result = analyze_basket(prices, purchases=[
        ("2024-01-15", "GAL", 5_000),
        ("2024-07-01", "GAL", 5_000),
        ("2025-02-03", "AFO", 4_000),
    ])
    result.purchases.xirr
    result.purchases.value_series  # market_value and invested, two lines
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as _date, datetime
from typing import Iterable, Mapping, Optional, Sequence, Union

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

# Default pair correlation above which two funds count as moving together.
# 0.85 is deliberately strict: at that level a pair contributes almost
# nothing to diversification, which is the claim a group is making.
GROUP_THRESHOLD = 0.85

# XIRR solver bounds. The lower one is a floor, not a guess: at -99.99% a
# year a holding has effectively gone to zero, and anything the solver finds
# below that is it walking off rather than an answer about the basket. The
# upper one exists only so a bracket exists at all. A root outside the pair
# is reported as no root — see `xirr`.
XIRR_BOUNDS = (-0.9999, 1e6)
XIRR_ITERATIONS = 200
XIRR_TOLERANCE = 1e-9  # judged against the size of the cash flows, not absolutely

# XIRR discounts in calendar years, by the usual 365-day convention.
DAYS_PER_YEAR = 365.0

# How the lira figure attached to a purchase should be read.
#
# People know their holdings in one of two ways and rarely both. Some
# remember what they paid; most read a portfolio screen that tells them what
# it is worth now. Both describe the same thing — a number of units bought on
# a date — and this layer converts either into that, so nothing downstream
# has to care which way it arrived.
#
#   BASIS_PAID           the money that went in on `date`
#                        units = amount / price on the fill date
#
#   BASIS_CURRENT_VALUE  what the holding is worth on the last priced day
#                        units = amount / the last price, and those units are
#                        then treated as having been bought on `date`
BASIS_PAID = "paid"
BASIS_CURRENT_VALUE = "current_value"
PURCHASE_BASES = (BASIS_PAID, BASIS_CURRENT_VALUE)

# Columns of `PurchasePlan.value_series`. Two lines, never one: the market
# value jumps on the day money goes in, and a single line would show that
# jump exactly as it shows a gain.
VALUE_COLUMN = "market_value"
INVESTED_COLUMN = "invested"


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


# What `analyze_basket(purchases=...)` accepts per row: a `Purchase`, or the
# plain triple most callers already have on hand.
PurchaseInput = Union["Purchase", tuple, list]


@dataclass(frozen=True)
class Purchase:
    """One holding, stated either as what it cost or as what it is worth.

    `basis` says which. It defaults to `BASIS_PAID`, so a `(date, code,
    amount)` triple still means what it always meant.
    """

    date: pd.Timestamp
    code: str
    amount: float
    basis: str = BASIS_PAID


@dataclass(frozen=True)
class Fill:
    """A purchase as the price matrix could actually execute it.

    `date` is the day the money was meant to go in; `fill_date` is the
    trading day it bought units on. The two differ when the request landed
    on a weekend or a public holiday, and `was_shifted` says so rather than
    leaving the caller to compare dates and guess whether it mattered.
    """

    code: str
    date: pd.Timestamp
    fill_date: pd.Timestamp
    # The lira that went in on `fill_date`. For a holding stated at today's
    # value this is derived rather than given: the units it buys today, priced
    # on the day they were bought. That is what the money must have been for
    # the holding to be worth what the user says it is now, and it is the
    # figure XIRR discounts.
    amount: float
    price: float
    units: float
    basis: str = BASIS_PAID
    # What the caller actually said, before any conversion. Equal to `amount`
    # for a paid holding; today's value for one stated that way.
    stated_amount: float = 0.0

    @property
    def was_shifted(self) -> bool:
        return self.fill_date != self.date

    @property
    def was_converted(self) -> bool:
        """True when `amount` was worked back from today's value."""
        return self.basis == BASIS_CURRENT_VALUE

    @property
    def shifted_days(self) -> int:
        return int((self.fill_date - self.date).days)


@dataclass(frozen=True)
class PurchasePlan:
    """What a list of purchases holds today, and what it cost to get there."""

    fills: tuple[Fill, ...]  # chronological
    units: dict[str, float]  # per fund, summed over all of its purchases
    market_value: dict[str, float]  # per fund, at the last priced day
    total_invested: float  # lira paid in, undiscounted
    total_value: float  # what those units are worth on `valued_on`
    absolute_gain: float  # total_value - total_invested, in lira
    xirr: Optional[float]  # annualised; None when the solve did not converge
    valued_on: pd.Timestamp
    value_series: pd.DataFrame = field(repr=False)  # VALUE_ and INVESTED_COLUMN

    @property
    def shifted_fills(self) -> tuple[Fill, ...]:
        """Purchases that did not land on the day they were dated."""
        return tuple(f for f in self.fills if f.was_shifted)

    @property
    def first_purchase(self) -> pd.Timestamp:
        return self.fills[0].fill_date

    @property
    def is_single_dated(self) -> bool:
        """True when every purchase bought on the same day."""
        return len({f.fill_date for f in self.fills}) == 1

    @property
    def converted_fills(self) -> tuple[Fill, ...]:
        """Holdings whose cost was worked back from today's value."""
        return tuple(f for f in self.fills if f.was_converted)


@dataclass(frozen=True)
class BasketAnalysis:
    """Everything computed for one basket over one price matrix."""

    weights: dict[str, float]  # normalised to sum to 1
    correlation: Optional[pd.DataFrame]  # None for a single-fund basket
    # Spearman: the same pairs measured on the ranks of the weekly returns
    # rather than their sizes. `None` for a single fund, like `correlation`.
    #
    # Nothing groups on it. `find_fund_groups` is fed `correlation` and
    # stays that way, so no grouping, weight or headline moves because this
    # exists. It is here to be *compared* against `correlation`: Pearson
    # weights a week by how large the move was, Spearman only by where it
    # came in the order, so the two parting company on a pair means a
    # handful of weeks are carrying that pair's coefficient. Measured over
    # 406 pairs of 29 funds on five years of weekly returns, the pairs the
    # grouping actually acts on (Pearson >= 0.85) agree to a median of
    # 0.005 and never part by more than 0.051, while mid-range pairs part
    # by around 0.16 — and for those, removing the single week of
    # 2021-12-24 moves Pearson two thirds of the way to Spearman while
    # leaving Spearman where it was.
    rank_correlation: Optional[pd.DataFrame]
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
    # Set only when the basket was described as dated purchases. `weights`
    # then comes from `purchases.market_value`, and everything the plan
    # knows that a lot-size basket cannot — XIRR, what was paid in, when —
    # lives here rather than being flattened into the fields above.
    purchases: Optional[PurchasePlan] = None

    @property
    def is_single_fund(self) -> bool:
        return len(self.weights) == 1

    @property
    def is_staged(self) -> bool:
        """True when the basket was bought over more than one day."""
        return self.purchases is not None and not self.purchases.is_single_dated


@dataclass(frozen=True)
class FundGroup:
    """A set of funds where *every* pair correlates above the threshold."""

    codes: tuple[str, ...]
    weight: float  # fraction of the basket, 0..1
    min_correlation: float  # the weakest pair inside the group

    @property
    def size(self) -> int:
        return len(self.codes)


@dataclass(frozen=True)
class Standalone:
    """A fund that pairs with nothing above the threshold."""

    code: str
    weight: float


@dataclass(frozen=True)
class GroupingResult:
    """Groups plus the leftovers, for one correlation matrix."""

    groups: list[FundGroup]  # sorted by weight, heaviest first
    standalone: list[Standalone]  # sorted by weight, heaviest first
    threshold: float

    @property
    def grouped_weight(self) -> float:
        """Share of the basket sitting inside a group. Never exceeds 1.0."""
        return sum(g.weight for g in self.groups)


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------


def analyze_basket(
    prices: pd.DataFrame,
    weights: Optional[Mapping[str, float]] = None,
    *,
    purchases: Optional[Iterable["PurchaseInput"]] = None,
) -> BasketAnalysis:
    """
    Analyse a basket of funds over an aligned price matrix.

    Give it either `weights` or `purchases`, never both.

    Parameters
    ----------
    prices : pd.DataFrame
        Date × fund price matrix, DatetimeIndex, one column per fund, no
        missing values. Align it before calling (see `src.data`).
    weights : mapping of str to float, optional
        Lot sizes in lira. Normalised internally, so absolute scale does not
        matter; the ratios between funds do. Must cover exactly the columns
        of `prices`. Taken as the basket's composition exactly as given — a
        basket bought in one go, described by what sits in it.
    purchases : iterable, optional
        Dated deposits, each a `Purchase`, a `(date, fund_code, amount)`
        triple, or a `(date, fund_code, amount, basis)` quadruple. The same
        fund may appear as often as it was bought into. Buys only: a
        non-positive amount is rejected rather than read as a sale.

        See `build_purchase_plan` for what `basis` does. Mixing the two in
        one basket is supported and is the point of the field.

        The weights this produces are **today's market value** — units
        bought at each purchase date's price, summed per fund, priced at the
        last day of the matrix — not the lira that went in. That is the
        basket's real concentration: money that went into a fund that has
        since doubled occupies twice the room it was given.

        Note that this differs from passing the same amounts as `weights`,
        which are read as-is. A single purchase per fund on the matrix's
        first day gives an identical value series, drawdown and correlation,
        but weights that have drifted with the prices since.

    Returns
    -------
    BasketAnalysis
        With `purchases` set to the resolved `PurchasePlan` when dated
        purchases were given, and `None` when lot sizes were.

    Raises
    ------
    ValueError
        On empty or misaligned input, missing or non-positive prices,
        negative weights, a non-positive total weight, fewer than two weekly
        observations to estimate from, neither or both of `weights` and
        `purchases`, or a purchase this matrix cannot execute (see
        `build_purchase_plan`).
    """
    prices = _validate_prices(prices)

    if (weights is None) == (purchases is None):
        raise ValueError(
            "give exactly one of weights (a basket bought in one go) or "
            "purchases (dated deposits) — not both, and not neither"
        )

    plan: Optional[PurchasePlan] = None
    if purchases is not None:
        plan = build_purchase_plan(prices, purchases)
        unbought = [c for c in prices.columns if c not in plan.market_value]
        if unbought:
            raise ValueError(
                f"priced funds with no purchases: {unbought} — pass a matrix "
                f"covering exactly the funds that were bought"
            )
        weights = plan.market_value

    w = _normalize_weights(weights, list(prices.columns))

    returns = to_weekly_returns(prices)
    if len(returns) < 2:
        raise ValueError(
            f"need at least 2 weekly returns to estimate anything, got "
            f"{len(returns)} — the price matrix spans too short a window"
        )

    # A deposit-free series in both cases: volatility and drawdown measured
    # on the staged market value would read every deposit as a recovery and
    # every stretch before one as a shallower fall. For purchases that means
    # the units actually held, carried across the whole window — the honest
    # counterfactual for "what would today's holding have done" — and not
    # the market-value weights re-bought at day-one prices, which would put
    # money in on a day it was not there.
    value = (
        held_value_series(prices, plan.units)
        if plan is not None
        else basket_value_series(prices, w)
    )

    # Weekly volatility per fund, and the basket's own. The basket series is
    # sampled the same way the funds are so the ratio compares like with like.
    fund_vol_weekly = returns.std()
    basket_returns = value.resample(WEEKLY_RULE).last().dropna().pct_change().dropna()
    basket_vol_weekly = float(basket_returns.std())

    weighted_vol = float((pd.Series(w) * fund_vol_weekly).sum())

    return BasketAnalysis(
        weights=w,
        correlation=returns.corr() if returns.shape[1] > 1 else None,
        # `DataFrame.corr`, not `Series.corr`, and not only for the shape:
        # the Series version routes Spearman through `scipy.stats`, which
        # this project does not depend on and does not install. The frame
        # version ranks in pandas' own code, so this adds no dependency.
        rank_correlation=(
            returns.corr(method="spearman") if returns.shape[1] > 1 else None
        ),
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
        purchases=plan,
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


def build_purchase_plan(
    prices: pd.DataFrame,
    purchases: Iterable["PurchaseInput"],
) -> PurchasePlan:
    """
    Resolve dated deposits against a price matrix into units, value and XIRR.

    Each purchase buys `amount / price` units at the price of its fill date,
    and those units are then held: nothing is sold, nothing rebalanced. Per
    fund the units are summed and marked at the last priced day, which is
    what `analyze_basket` weights the basket by.

    Fill dates
    ----------
    A purchase dated on a day the funds did not price — a weekend, a public
    holiday, a day the matrix's inner join dropped — fills on the **next**
    priced day. `PurchasePlan.shifted_fills` lists every purchase this
    happened to, so a caller can say so rather than quietly reporting units
    bought at a price on a date the user never named.

    A purchase dated *before* the matrix starts is an error, not a shift.
    Moving it forward would silently answer a different question — one about
    a shorter holding period — and the resulting return would flatter or
    punish the fund for weeks the user never held it. Widen the window or
    fix the date.

    Parameters
    ----------
    prices : pd.DataFrame
        Date × fund price matrix, as for `analyze_basket`.
    purchases : iterable
        `Purchase` objects, `(date, fund_code, amount)` triples, or
        `(date, fund_code, amount, basis)` quadruples. Dates accept `str`,
        `date`, `datetime` or `pd.Timestamp`.

        `basis` is `"paid"` (the default) when the amount is the money that
        went in on that date, or `"current_value"` when it is what the
        holding is worth on the last priced day. The two may be mixed freely
        in one list: both are turned into units bought on a date before
        anything else runs, so weights, XIRR and returns are computed exactly
        one way.

    Returns
    -------
    PurchasePlan

    Raises
    ------
    ValueError
        On an empty list, a malformed entry, a non-positive amount, a fund
        the matrix does not price, a date before the matrix starts, or a
        date after its last priced day.
    """
    prices = _validate_prices(prices)
    fills = _fill_purchases(prices, _coerce_purchases(purchases))

    units: dict[str, float] = {}
    for fill in fills:
        units[fill.code] = units.get(fill.code, 0.0) + fill.units

    last = prices.iloc[-1]
    valued_on = prices.index[-1]
    market_value = {code: held * float(last[code]) for code, held in units.items()}

    total_invested = float(sum(f.amount for f in fills))
    total_value = float(sum(market_value.values()))

    # Money out is negative on the day it left, the holding is one positive
    # flow on the day it is valued. One sign change, so the rate is unique.
    cashflows = [(f.fill_date, -f.amount) for f in fills]
    cashflows.append((valued_on, total_value))

    return PurchasePlan(
        fills=fills,
        units=units,
        market_value=market_value,
        total_invested=total_invested,
        total_value=total_value,
        absolute_gain=total_value - total_invested,
        xirr=xirr(cashflows),
        valued_on=valued_on,
        value_series=_purchase_value_series(prices, fills),
    )


def xirr(
    cashflows: Sequence[tuple],
    bounds: tuple[float, float] = XIRR_BOUNDS,
) -> Optional[float]:
    """
    The annual rate that discounts a dated cash flow series to zero.

    A plain percentage gain is the wrong number for a basket bought in
    instalments: it credits lira that arrived last month with the same
    working time as lira that arrived three years ago. XIRR asks instead
    what constant annual rate, applied to each deposit for exactly as long
    as it was invested, arrives at today's value.

    Solved by bisection rather than Newton. Deposits followed by one
    valuation give a single sign change, so the NPV is monotone in the rate
    and bisection cannot be thrown off by a bad starting point the way
    Newton can — and when there is no root inside `bounds` it says so
    instead of returning wherever it happened to stop.

    Parameters
    ----------
    cashflows : sequence of (date, amount)
        Negative out, positive in. Dates accept `str`, `date`, `datetime` or
        `pd.Timestamp`.
    bounds : (float, float)
        Rate bracket to search. Defaults to `XIRR_BOUNDS`.

    Returns
    -------
    float or None
        `None` — never a made-up number — when the flows do not admit a rate
        at all (fewer than two flows, all on one day, or all one sign) or
        when the solve does not converge inside `bounds`.
    """
    flows = [(_to_timestamp(when), float(amount)) for when, amount in cashflows]
    if len(flows) < 2:
        return None

    anchor = min(when for when, _ in flows)
    dated = [((when - anchor).days / DAYS_PER_YEAR, amount) for when, amount in flows]

    if max(years for years, _ in dated) <= 0:
        # Everything on one day. No time passed for a rate to act over, so
        # there is no annual rate to report — only an absolute gain.
        return None
    if not any(a > 0 for _, a in dated) or not any(a < 0 for _, a in dated):
        return None

    scale = sum(abs(a) for _, a in dated)

    def npv(rate: float) -> float:
        return sum(amount / (1.0 + rate) ** years for years, amount in dated)

    low, high = bounds
    try:
        f_low, f_high = npv(low), npv(high)
    except (OverflowError, ZeroDivisionError):
        return None
    if not math.isfinite(f_low) or not math.isfinite(f_high) or f_low * f_high > 0:
        # No sign change across the bracket: any root lies outside the range
        # of rates worth reporting.
        return None

    for _ in range(XIRR_ITERATIONS):
        middle = (low + high) / 2.0
        try:
            f_middle = npv(middle)
        except (OverflowError, ZeroDivisionError):
            return None
        if not math.isfinite(f_middle):
            return None
        if f_low * f_middle <= 0:
            high, f_high = middle, f_middle
        else:
            low, f_low = middle, f_middle

    rate = (low + high) / 2.0
    if abs(npv(rate)) > XIRR_TOLERANCE * scale:
        return None
    return float(rate)


def held_value_series(prices: pd.DataFrame, units: Mapping[str, float]) -> pd.Series:
    """
    Value of a fixed unit holding across the window, normalised to 1.0.

    The counterpart to `basket_value_series` for a basket described by the
    units it actually holds rather than by the lira that went in. Used for
    staged purchases, where the two differ: money that arrived in month 30
    bought its units at month 30's price, and pretending it bought at the
    window's opening price would misstate both the holding and its history.

    Normalised so the two functions return comparable series. Volatility and
    drawdown do not care about the scale anyway.
    """
    missing = [c for c in prices.columns if c not in units]
    if missing:
        raise ValueError(f"no units held for priced funds {missing}")

    held = pd.Series({c: float(units[c]) for c in prices.columns})
    value = (prices * held).sum(axis=1)
    first = float(value.iloc[0])
    if first <= 0:
        raise ValueError("holding is worth nothing at the start of the window")
    return value / first


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


def find_fund_groups(
    correlation: Optional[pd.DataFrame],
    weights: Mapping[str, float],
    threshold: float = GROUP_THRESHOLD,
) -> GroupingResult:
    """
    Find sets of funds that all move together, and the funds that don't.

    A group is a set in which *every* pair correlates at or above
    `threshold` — not a chain. If A-B and B-C both clear the threshold but
    A-C falls well below it, then A, B and C are not one group: A and C are
    only related through B, and calling them a single bloc would overstate
    the concentration. Chained (single-linkage) clustering makes exactly
    that mistake, so this walks the maximal fully-connected subsets instead.

    A fund can sit in more than one such subset. Each fund is reported once,
    in the heaviest group it belongs to, so the reported weights partition
    the basket and never sum above 100%.

    Parameters
    ----------
    correlation : pd.DataFrame or None
        Square fund × fund correlation matrix, as produced by
        `analyze_basket` (`BasketAnalysis.correlation`). `None` — a
        single-fund basket — yields no groups and that one fund standalone.
    weights : mapping of str to float
        Lot sizes or fractions; normalised internally, so the scale does not
        matter. Must cover exactly the funds in `correlation`.
    threshold : float
        Minimum pair correlation for two funds to count as moving together.
        Only positive correlations group: a pair that moves in opposite
        directions is diversification, not concentration, whatever a
        negative threshold would nominally admit.

    Returns
    -------
    GroupingResult
        Possibly with an empty `groups` list — a basket where nothing moves
        together is a normal, and good, result, not an error.
    """
    if correlation is None:
        codes = list(weights)
        w = _normalize_weights(weights, codes)
        return GroupingResult(
            groups=[],
            standalone=_standalone_list(codes, w),
            threshold=float(threshold),
        )

    codes = list(correlation.columns)
    if list(correlation.index) != codes:
        raise ValueError("correlation must be square with matching row/column labels")
    w = _normalize_weights(weights, codes)

    neighbours = _adjacency(correlation, codes, threshold)
    cliques = [c for c in _maximal_cliques(codes, neighbours) if len(c) >= 2]

    groups = _assign_disjoint(cliques, w, correlation)
    grouped = {code for g in groups for code in g.codes}

    return GroupingResult(
        groups=groups,
        standalone=_standalone_list([c for c in codes if c not in grouped], w),
        threshold=float(threshold),
    )


def rolling_correlation(
    prices: pd.DataFrame,
    pair: tuple[str, str],
    *,
    window: int,
) -> pd.Series:
    """
    Correlation of one pair of funds over a moving window of weeks.

    The single number `analyze_basket` reports is an average over the whole
    matrix, and an average hides its own history: two funds at 0.90 for the
    period may have sat at 0.40 for two years and 0.98 since, which is a
    different fact about a basket than a steady 0.90. This is that history.

    Computed on the same weekly returns as everything else in this module,
    and on the returns of the frame it is given, so a series taken from the
    matrix `analyze_basket` ran on lines up with the correlation it reported
    rather than being measured over slightly different weeks.

    No value is produced until a window is full, and nothing is filled. The
    first value sits at the end of the first complete window, which is where
    it belongs: it describes the weeks behind it, not the day it is drawn on.
    A window whose returns are degenerate — a fund that did not move at all
    across it, so the correlation is 0/0 — stays NaN rather than being
    dropped, because dropping it would join the two sides of a gap into a
    line that was never measured.

    Parameters
    ----------
    prices : pd.DataFrame
        Date × fund price matrix, as `analyze_basket` takes.
    pair : tuple of two str
        The two fund codes to correlate. Both must be columns of `prices`.
    window : int
        Window length in weekly observations, at least 2. Deliberately has
        no default: the length decides how much of a correlation's movement
        is the funds and how much is the estimator, and that is a judgement
        about the product, made where the product is configured.

    Returns
    -------
    pd.Series
        Correlation indexed by the week ending date it was measured to.
        **Empty** when there are fewer weekly observations than the window
        asks for: a window that never fills is a normal outcome for a young
        fund, not a failure, and the caller draws nothing rather than
        handling an exception.
    """
    prices = _validate_prices(prices)

    a, b = pair
    if a == b:
        raise ValueError(f"a fund cannot be correlated with itself: {a!r}")
    missing = [c for c in (a, b) if c not in prices.columns]
    if missing:
        raise ValueError(f"prices has no column for {missing}")
    window = int(window)
    if window < 2:
        raise ValueError(f"window must be at least 2 weeks, got {window}")

    weekly = to_weekly_returns(prices)
    name = f"{a}~{b}"

    if len(weekly) < window:
        # Right dtype, right index type, no rows. The caller can length-check
        # it like any other series.
        return weekly[a].iloc[:0].rename(name)

    rolled = weekly[a].rolling(window).corr(weekly[b])
    # `rolling` marks the warm-up NaN and the first real value lands at
    # position window - 1, so this trims exactly the warm-up and cannot
    # discard a measured one. A plain dropna would also swallow the
    # degenerate windows the docstring promises to leave visible.
    rolled = rolled.iloc[window - 1 :]
    # A correlation cannot exceed 1, but the running sums behind it can land
    # on 1.0000000000000002. Clipped so a chart axis and a comparison
    # against the grouping threshold both see the value the maths defines.
    return rolled.clip(-1.0, 1.0).rename(name)


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _to_timestamp(value) -> pd.Timestamp:
    """A date in any of the shapes a caller reasonably has, at midnight."""
    if isinstance(value, pd.Timestamp):
        stamp = value
    elif isinstance(value, (datetime, _date, str)):
        stamp = pd.Timestamp(value)
    else:
        raise ValueError(
            f"cannot read {value!r} as a date — pass a str, date, datetime "
            f"or pd.Timestamp"
        )
    if pd.isna(stamp):
        raise ValueError(f"cannot read {value!r} as a date")
    return stamp.normalize()


def _coerce_purchases(purchases: Iterable["PurchaseInput"]) -> list[Purchase]:
    """Whatever the caller passed, as validated `Purchase` objects."""
    out: list[Purchase] = []
    for position, item in enumerate(purchases):
        basis = BASIS_PAID
        if isinstance(item, Purchase):
            when, code, amount, basis = item.date, item.code, item.amount, item.basis
        elif isinstance(item, (tuple, list)):
            # The fourth value is optional, so every existing three value
            # caller keeps meaning exactly what it meant.
            if len(item) == 3:
                when, code, amount = item
            elif len(item) == 4:
                when, code, amount, basis = item
            else:
                raise ValueError(
                    f"purchase {position} must be (date, fund_code, amount) "
                    f"with an optional basis, got {len(item)} values: {item!r}"
                )
        else:
            raise ValueError(
                f"purchase {position} must be a Purchase or a "
                f"(date, fund_code, amount) triple, got {type(item).__name__}"
            )

        if basis not in PURCHASE_BASES:
            raise ValueError(
                f"purchase {position} has basis {basis!r}; expected one of "
                f"{list(PURCHASE_BASES)}"
            )

        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise ValueError(
                f"purchase {position} has a non-numeric amount: {amount!r}"
            ) from None
        if not amount > 0:
            # Also catches NaN. Sales are not modelled: with units leaving
            # the basket, today's holding no longer follows from the
            # purchase list alone, and every number here rests on that.
            raise ValueError(
                f"purchase {position} has amount {amount} — amounts must be "
                f"positive; this layer models purchases only, not sales"
            )

        out.append(
            Purchase(
                date=_to_timestamp(when),
                code=str(code),
                amount=amount,
                basis=basis,
            )
        )

    if not out:
        raise ValueError("no purchases given — nothing to analyse")
    return out


def _fill_purchases(
    prices: pd.DataFrame,
    purchases: list[Purchase],
) -> tuple[Fill, ...]:
    """Match each purchase to the day it could actually have bought units."""
    index = prices.index
    priced = set(prices.columns)
    fills: list[Fill] = []

    for item in purchases:
        if item.code not in priced:
            raise ValueError(
                f"purchase in {item.code} on {item.date.date()} has no prices "
                f"— the matrix covers {sorted(priced)}"
            )
        if item.date < index[0]:
            raise ValueError(
                f"purchase in {item.code} is dated {item.date.date()}, before "
                f"its prices start on {index[0].date()} — widen the window or "
                f"correct the date; moving the purchase forward would quietly "
                f"answer a question about a shorter holding period"
            )

        # First priced day at or after the request: a weekend or holiday
        # purchase buys on the next trading day, as it would in reality.
        position = int(index.searchsorted(item.date, side="left"))
        if position >= len(index):
            raise ValueError(
                f"purchase in {item.code} is dated {item.date.date()}, after "
                f"the last priced day {index[-1].date()} — there is no "
                f"trading day left to buy on"
            )

        fill_date = index[position]
        price = float(prices.at[fill_date, item.code])

        if item.basis == BASIS_CURRENT_VALUE:
            # The user is describing the holding by what it is worth now, so
            # the units follow from today's price. Those same units are then
            # treated as bought on `date`, and what they cost that day is
            # what the money must have been. Working the cost back this way,
            # rather than assuming the stated figure went in on the date, is
            # the whole point: a fund that has doubled since would otherwise
            # be credited with twice the money it was actually given, and
            # every return in the answer would be wrong.
            last_price = float(prices.iloc[-1][item.code])
            units = item.amount / last_price
            amount = units * price
        else:
            units = item.amount / price
            amount = item.amount

        fills.append(
            Fill(
                code=item.code,
                date=item.date,
                fill_date=fill_date,
                amount=amount,
                price=price,
                units=units,
                basis=item.basis,
                stated_amount=item.amount,
            )
        )

    return tuple(sorted(fills, key=lambda f: (f.fill_date, f.code)))


def _purchase_value_series(
    prices: pd.DataFrame,
    fills: tuple[Fill, ...],
) -> pd.DataFrame:
    """
    Two lines for a chart: what the basket is worth, and what it cost.

    `market_value` steps up on every purchase date because money arrived,
    not because anything gained. `invested` is that same money as a
    staircase, so the two together separate deposits from performance —
    the gap between the lines is the gain, and the jumps line up.

    Starts at the first fill: before it both lines are flat zero, which
    tells a reader nothing and squashes the rest of the chart.
    """
    added_units = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    added_cash = pd.Series(0.0, index=prices.index)
    for fill in fills:
        added_units.at[fill.fill_date, fill.code] += fill.units
        added_cash.at[fill.fill_date] += fill.amount

    held = added_units.cumsum()
    series = pd.DataFrame(
        {
            VALUE_COLUMN: (held * prices).sum(axis=1),
            INVESTED_COLUMN: added_cash.cumsum(),
        }
    )
    return series.loc[fills[0].fill_date:]


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
    """Lira in — lot sizes or market values — fractions of the basket out."""
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


def _adjacency(
    correlation: pd.DataFrame,
    codes: list[str],
    threshold: float,
) -> dict[str, set[str]]:
    """Who moves with whom: an edge per pair at or above the threshold.

    Anything not strictly positive is dropped regardless of the threshold,
    and a NaN — which is what a flat, zero-variance series correlates to —
    is treated as no edge rather than as a match.
    """
    neighbours: dict[str, set[str]] = {c: set() for c in codes}
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            rho = correlation.at[a, b]
            if pd.isna(rho) or rho <= 0 or rho < threshold:
                continue
            neighbours[a].add(b)
            neighbours[b].add(a)
    return neighbours


def _maximal_cliques(
    codes: list[str],
    neighbours: Mapping[str, set[str]],
) -> list[tuple[str, ...]]:
    """
    Every maximal fully-connected subset, via plain Bron-Kerbosch.

    Exponential in the worst case, which is fine here: a basket holds 2-15
    funds, so the recursion is over a graph small enough that the pivotless
    version stays both fast and readable.
    """
    order = {c: i for i, c in enumerate(codes)}
    found: list[tuple[str, ...]] = []

    def expand(clique: set[str], candidates: set[str], excluded: set[str]) -> None:
        if not candidates and not excluded:
            found.append(tuple(sorted(clique, key=order.__getitem__)))
            return
        for code in sorted(candidates, key=order.__getitem__):
            expand(
                clique | {code},
                candidates & neighbours[code],
                excluded & neighbours[code],
            )
            candidates = candidates - {code}
            excluded = excluded | {code}

    expand(set(), set(codes), set())
    return found


def _assign_disjoint(
    cliques: list[tuple[str, ...]],
    weights: Mapping[str, float],
    correlation: pd.DataFrame,
) -> list[FundGroup]:
    """
    Turn overlapping cliques into a partition, heaviest group first.

    Repeatedly takes the heaviest remaining candidate and removes its funds
    from the others. A clique stripped of some members is still fully
    connected, so what is left of a candidate stays a valid group — it just
    may shrink below two funds, at which point it stops being one.
    """
    groups: list[FundGroup] = []
    taken: set[str] = set()

    while True:
        candidates = []
        for clique in cliques:
            members = tuple(c for c in clique if c not in taken)
            if len(members) < 2:
                continue
            candidates.append((sum(weights[c] for c in members), members))
        if not candidates:
            return groups

        # Heaviest wins; ties go to the larger group, then to fund order, so
        # the same basket always groups the same way.
        weight, members = max(candidates, key=lambda c: (c[0], len(c[1]), c[1]))
        groups.append(
            FundGroup(
                codes=members,
                weight=float(weight),
                min_correlation=_min_pair_correlation(members, correlation),
            )
        )
        taken.update(members)


def _min_pair_correlation(codes: tuple[str, ...], correlation: pd.DataFrame) -> float:
    """The weakest link in a group — how tightly it actually holds together."""
    return float(
        min(
            correlation.at[a, b]
            for i, a in enumerate(codes)
            for b in codes[i + 1:]
        )
    )


def _standalone_list(codes: list[str], weights: Mapping[str, float]) -> list[Standalone]:
    ungrouped = [Standalone(code=c, weight=float(weights[c])) for c in codes]
    return sorted(ungrouped, key=lambda s: (-s.weight, s.code))
