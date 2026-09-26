"""
Request and response models
===========================
The wire format for `api.main`. Pydantic models only: no fetching, no maths,
no decisions — every number here is copied out of `src.data`, `src.analysis`
or `src.inflation` by a `from_*` classmethod, so this file cannot quietly
disagree with them.

Two rules shape everything below.

**Field names match the dataclasses.** `diversification_ratio` is
`diversification_ratio`, `weekly_observations` is `weekly_observations`. A
renamed field means someone reading `src/analysis.py` and someone reading a
JSON payload are talking about different things without knowing it.

**No prose the user will read.** The backend returns numbers and state
codes; the frontend writes the sentence. So this file carries `groups`,
`weights` and `threshold`, and never "%38 of your money moves together"; it
carries `kind` on a failure, and never an explanation of it. That is not
only about Turkish: an English sentence baked in here would be just as
stuck, and the frontend that has the numbers can phrase the finding for the
screen it is drawing.
"""

from __future__ import annotations

from datetime import date as _date
from datetime import datetime as _date_time
from typing import Literal, Optional

import pandas as pd
from pydantic import BaseModel, Field, model_validator

from src import analysis as an
from src import data as dl
from src import inflation as inf

# ----------------------------------------------------------------------
# State codes the frontend branches on
# ----------------------------------------------------------------------

# Why `analysis` is null, when it is. `ok` means it is there.
AnalysisStatus = Literal["ok", "no_funds", "window_too_short"]

# Why `full_analysis` is null. `not_needed` is the common case: nothing was
# excluded, so the trimmed matrix already covers every fund that returned
# data and a second analysis would repeat it.
FullAnalysisStatus = Literal["ok", "not_needed", "no_funds", "window_too_short", "out_of_window"]

# Why `real_return` is null. `unavailable` covers every expected CPI failure
# — no API key, no network, a rejected key — which `load_cpi` reports by
# returning None rather than raising.
RealReturnStatus = Literal["ok", "unavailable", "not_applicable"]

# Why `rolling_correlation` is null. `single_fund` is a basket with no pair
# to correlate; `not_enough_weeks` is a shared history too short to draw a
# history of, which is a young basket rather than a failure.
RollingStatus = Literal["ok", "single_fund", "not_enough_weeks"]

# Which series the real return was measured on. Worth stating, because in
# staged mode it is *not* the investor's own return: it is what the units
# they hold today would have done over the window, with no deposits in it.
# The investor's own money-weighted return is `purchases.xirr`.
ReturnBasis = Literal["lump_sum", "held_units"]

Mode = Literal["simple", "staged"]

# How to read the lira figure on a holding. Mirrors `analysis.PURCHASE_BASES`;
# the assert below keeps the two from drifting apart silently.
AmountBasis = Literal["paid", "current_value"]
assert set(AmountBasis.__args__) == set(an.PURCHASE_BASES)


# ----------------------------------------------------------------------
# Requests
# ----------------------------------------------------------------------


class FundAmount(BaseModel):
    """One holding, stated the way its owner happens to know it.

    People know a holding in one of two ways and rarely both: what they paid
    for it, or what a portfolio screen says it is worth today. `basis` says
    which, and the two may be mixed freely across one basket.

    Either way the server turns it into units bought on a date, and every
    number after that is computed one way. See `analysis.build_purchase_plan`.
    """

    code: str = Field(min_length=1, max_length=20, examples=["GAL"])
    amount: float = Field(gt=0, examples=[10000.0])
    basis: AmountBasis = Field(
        default="current_value",
        description=(
            "'current_value': the amount is what the holding is worth today, "
            "held since `date`. 'paid': the amount is the money that went in "
            "on `date`."
        ),
    )
    date: Optional[_date] = Field(
        default=None,
        examples=["2024-03-15"],
        description=(
            "When the holding started. Required for basis 'paid', since an "
            "amount paid says nothing without the day it was paid. Optional "
            "for 'current_value', which falls back to the start of the "
            "available window."
        ),
    )

    @model_validator(mode="after")
    def _paid_needs_a_date(self) -> "FundAmount":
        if self.basis == "paid" and self.date is None:
            raise ValueError(
                "a 'paid' amount needs the date it was paid; without it the "
                "units it bought are unknowable. Use 'current_value' if you "
                "only know what the holding is worth now."
            )
        return self


class PurchaseIn(BaseModel):
    """One line of a staged basket: this much lira into this fund, this day."""

    # A plain `date`, not a `pd.Timestamp`: pandas types have no JSON schema,
    # so one here takes /openapi.json — and therefore /docs — down with it.
    # `analysis._to_timestamp` accepts a `date` and normalises it anyway.
    # Imported under an alias because the field is also called `date`, and
    # a field whose name matches its annotation is one pydantic cannot read.
    date: _date = Field(examples=["2024-01-15"])
    code: str = Field(min_length=1, max_length=20, examples=["GAL"])
    amount: float = Field(gt=0, examples=[5000.0])
    basis: AmountBasis = Field(
        default="paid",
        description=(
            "Defaults to 'paid', which is what a dated purchase normally "
            "means. 'current_value' reads the amount as what that tranche is "
            "worth today instead."
        ),
    )


class AnalyzeRequest(BaseModel):
    """A basket, described either way, plus how much history to ask for.

    Exactly one of `funds` and `purchases`. They are the two modes of
    `analyze_basket`: amounts as they stand, or dated deposits whose weights
    come out as today's market value.
    """

    funds: Optional[list[FundAmount]] = Field(
        default=None,
        min_length=1,
        description="Simple mode: the basket as it stands, one amount per fund.",
    )
    purchases: Optional[list[PurchaseIn]] = Field(
        default=None,
        min_length=1,
        description=(
            "Staged mode: dated deposits. A fund may appear as often as it "
            "was bought into. Buys only — amounts are positive."
        ),
    )
    months: int = Field(
        default=dl.DEFAULT_MONTHS,
        ge=1,
        le=dl.MAX_MONTHS,
        description=(
            f"History to request, in months. Capped at {dl.MAX_MONTHS}: the "
            f"TEFAS price endpoint reaches back 5 years and silently "
            f"truncates anything longer."
        ),
    )
    group_threshold: float = Field(
        default=an.GROUP_THRESHOLD,
        gt=0.0,
        le=1.0,
        description="Pair correlation at which two funds count as moving together.",
    )

    @model_validator(mode="after")
    def _exactly_one_mode(self) -> "AnalyzeRequest":
        if (self.funds is None) == (self.purchases is None):
            raise ValueError(
                "send exactly one of 'funds' (a basket as it stands) or "
                "'purchases' (dated deposits)"
            )
        return self

    @model_validator(mode="after")
    def _no_duplicate_funds(self) -> "AnalyzeRequest":
        if self.funds is not None:
            seen = [f.code for f in self.funds]
            duplicates = sorted({c for c in seen if seen.count(c) > 1})
            if duplicates:
                raise ValueError(
                    f"each fund may appear once in 'funds'; {duplicates} "
                    f"repeated — use 'purchases' to buy the same fund twice"
                )
        return self

    @property
    def mode(self) -> Mode:
        return "simple" if self.funds is not None else "staged"

    @property
    def codes(self) -> list[str]:
        """Requested codes, deduplicated, in the order they were given."""
        rows = self.funds if self.funds is not None else self.purchases
        out: list[str] = []
        for row in rows:
            if row.code not in out:
                out.append(row.code)
        return out


# ----------------------------------------------------------------------
# Shared shapes
# ----------------------------------------------------------------------


class Series(BaseModel):
    """A dated value series as two parallel arrays."""

    dates: list[str]
    values: list[float]

    @classmethod
    def from_series(cls, s: pd.Series) -> "Series":
        return cls(
            dates=[d.strftime("%Y-%m-%d") for d in s.index],
            values=[float(v) for v in s.to_numpy()],
        )


class RollingPair(BaseModel):
    """One pair's correlation over the moving window, plus its flat average.

    `full_period` is the same number the correlation matrix carries, kept
    here so a caller drawing one pair does not have to cross reference the
    matrix to say what the period as a whole came to.
    """

    codes: list[str]  # exactly two
    # Null where a window was degenerate: a fund that did not move at all
    # across it has no variance to correlate. `analysis.rolling_correlation`
    # leaves these in rather than dropping them, so a gap on a chart is the
    # gap that was measured and not two sides joined across it.
    values: list[Optional[float]]
    full_period: float


class RollingCorrelation(BaseModel):
    """Every pair's moving window correlation, on one shared date axis.

    The dates are carried once rather than per pair. Every series comes from
    the weekly returns of the same matrix, so they are the same dates by
    construction, and repeating them for each of a basket's pairs would be
    most of the payload.

    Pairs are sorted by `full_period`, strongest first, so the caller can
    draw the first one without deciding anything.
    """

    window_weeks: int
    # The grouping line, sent with the series so a chart draws the same
    # threshold the finding above it was cut at, rather than its own guess.
    threshold: float
    dates: list[str]
    pairs: list[RollingPair]


class Correlation(BaseModel):
    """A square correlation matrix, with its labels alongside it."""

    codes: list[str]
    matrix: list[list[Optional[float]]]

    @classmethod
    def from_frame(cls, df: pd.DataFrame) -> "Correlation":
        codes = [str(c) for c in df.columns]
        return cls(
            codes=codes,
            # NaN is not JSON. A pair that cannot be correlated — a flat
            # series has no variance to correlate — travels as null, and the
            # frontend can show a blank cell rather than the string "NaN".
            matrix=[
                [None if pd.isna(v) else float(v) for v in row]
                for row in df.to_numpy()
            ],
        )


# ----------------------------------------------------------------------
# Coverage — src.data
# ----------------------------------------------------------------------


class FundCoverage(BaseModel):
    """What one fund actually returned. Mirrors `data.FundCoverage`."""

    fund_code: str
    fund_name: str
    first_date: str
    last_date: str
    row_count: int
    expected_business_days: int
    span_days: int
    coverage_ratio: float
    is_sparse: bool

    @classmethod
    def from_dataclass(cls, cov: dl.FundCoverage) -> "FundCoverage":
        return cls(
            fund_code=cov.fund_code,
            fund_name=cov.fund_name,
            first_date=cov.first_date.strftime("%Y-%m-%d"),
            last_date=cov.last_date.strftime("%Y-%m-%d"),
            row_count=cov.row_count,
            expected_business_days=cov.expected_business_days,
            span_days=cov.span_days,
            coverage_ratio=cov.coverage_ratio,
            is_sparse=cov.is_sparse,
        )


class MatrixCoverage(BaseModel):
    """The common window of one price matrix. Mirrors `data.MatrixCoverage`."""

    fund_codes: list[str]
    start: Optional[str]
    end: Optional[str]
    trading_days: int
    weekly_observations: int
    is_empty: bool
    below_weekly_threshold: bool

    @classmethod
    def from_dataclass(cls, cov: dl.MatrixCoverage) -> "MatrixCoverage":
        return cls(
            fund_codes=list(cov.fund_codes),
            start=cov.start.strftime("%Y-%m-%d") if cov.start is not None else None,
            end=cov.end.strftime("%Y-%m-%d") if cov.end is not None else None,
            trading_days=cov.trading_days,
            weekly_observations=cov.weekly_observations,
            is_empty=cov.is_empty,
            below_weekly_threshold=cov.below_weekly_threshold,
        )


class FundFailure(BaseModel):
    """A code that returned nothing usable. Mirrors `data.FundFailure`.

    `kind` is the field to branch on — `request_failed`, `unknown_code`,
    `no_prices_in_window`,
    `no_valid_prices`, `no_data_unverified`. `reason` is an English
    diagnostic for logs and bug reports; it is not a string to put on a
    screen, in any language.
    """

    fund_code: str
    kind: str
    reason: str

    @classmethod
    def from_dataclass(cls, f: dl.FundFailure) -> "FundFailure":
        return cls(fund_code=f.fund_code, kind=f.kind, reason=f.reason)


class FundExclusion(BaseModel):
    """A fund with prices that the trimmed matrix leaves out. Mirrors
    `data.FundExclusion`.

    `kind` is the field to branch on — `stale_series` for a fund whose
    prices stopped early, `window_cost` for one that would shorten the
    window the rest share. `reason` is an English diagnostic for logs, and
    carries the numbers behind the decision; like `FundFailure.reason` it is
    not a string to put on a screen, in any language.
    """

    fund_code: str
    kind: str
    reason: str

    @classmethod
    def from_dataclass(cls, e: dl.FundExclusion) -> "FundExclusion":
        return cls(fund_code=e.fund_code, kind=e.kind, reason=e.reason)


class Coverage(BaseModel):
    """The whole coverage report. Mirrors `data.FundDataset` minus the frames."""

    requested_codes: list[str]
    requested_start: str
    requested_end: str
    ok_codes: list[str]
    sparse_codes: list[str]
    full_coverage: MatrixCoverage
    trimmed_coverage: MatrixCoverage
    fund_coverage: dict[str, FundCoverage]
    # Funds that returned data but were left out of the trimmed matrix,
    # each tagged with a `kind` the same way a failure is.
    excluded_codes: dict[str, FundExclusion]
    failed_codes: dict[str, FundFailure]
    fund_names: dict[str, str]
    # Things the request asked for and did not get, e.g. a window clamped to
    # MAX_MONTHS. English and diagnostic, and unlike `excluded_codes` and
    # `failed_codes` it carries no `kind`: a note is a free-text remark
    # about the request, not one of a closed set of outcomes.
    notes: list[str]
    from_cache: bool

    @classmethod
    def from_dataset(cls, ds: dl.FundDataset) -> "Coverage":
        return cls(
            requested_codes=list(ds.requested_codes),
            requested_start=ds.requested_start.strftime("%Y-%m-%d"),
            requested_end=ds.requested_end.strftime("%Y-%m-%d"),
            ok_codes=ds.ok_codes,
            sparse_codes=ds.sparse_codes,
            full_coverage=MatrixCoverage.from_dataclass(ds.full_coverage),
            trimmed_coverage=MatrixCoverage.from_dataclass(ds.trimmed_coverage),
            fund_coverage={
                c: FundCoverage.from_dataclass(v) for c, v in ds.fund_coverage.items()
            },
            excluded_codes={
                c: FundExclusion.from_dataclass(v)
                for c, v in ds.excluded_codes.items()
            },
            failed_codes={
                c: FundFailure.from_dataclass(v) for c, v in ds.failed_codes.items()
            },
            fund_names=dict(ds.fund_names),
            notes=list(ds.notes),
            from_cache=ds.from_cache,
        )


# ----------------------------------------------------------------------
# Analysis — src.analysis
# ----------------------------------------------------------------------


class Drawdown(BaseModel):
    """Mirrors `analysis.Drawdown`."""

    depth: float  # negative fraction, e.g. -0.23 for a 23% fall
    peak_date: str
    trough_date: str
    peak_value: float
    trough_value: float
    duration_days: int

    @classmethod
    def from_dataclass(cls, d: an.Drawdown) -> "Drawdown":
        return cls(
            depth=d.depth,
            peak_date=d.peak_date.strftime("%Y-%m-%d"),
            trough_date=d.trough_date.strftime("%Y-%m-%d"),
            peak_value=d.peak_value,
            trough_value=d.trough_value,
            duration_days=d.duration_days,
        )


class Fill(BaseModel):
    """One purchase as the price matrix executed it. Mirrors `analysis.Fill`.

    `was_shifted` says the money landed on a day the user did not name —
    a weekend or a public holiday buys on the next trading day.
    """

    code: str
    date: str
    fill_date: str
    # The lira that went in on `fill_date`. Derived, not given, when the
    # holding was stated at today's value.
    amount: float
    price: float
    units: float
    was_shifted: bool
    shifted_days: int
    basis: AmountBasis
    # What the request actually said, before conversion. Equal to `amount`
    # for a paid holding.
    stated_amount: float
    was_converted: bool

    @classmethod
    def from_dataclass(cls, f: an.Fill) -> "Fill":
        return cls(
            code=f.code,
            date=f.date.strftime("%Y-%m-%d"),
            fill_date=f.fill_date.strftime("%Y-%m-%d"),
            amount=f.amount,
            price=f.price,
            units=f.units,
            was_shifted=f.was_shifted,
            shifted_days=f.shifted_days,
            basis=f.basis,
            stated_amount=f.stated_amount,
            was_converted=f.was_converted,
        )


class StagedValueSeries(BaseModel):
    """The two chart lines from `PurchasePlan.value_series`.

    Two, never one: `market_value` jumps on the day money arrives, and a
    single line would show that jump exactly as it shows a gain. The gap
    between the lines is the gain.
    """

    dates: list[str]
    market_value: list[float]
    invested: list[float]

    @classmethod
    def from_frame(cls, df: pd.DataFrame) -> "StagedValueSeries":
        return cls(
            dates=[d.strftime("%Y-%m-%d") for d in df.index],
            market_value=[float(v) for v in df[an.VALUE_COLUMN].to_numpy()],
            invested=[float(v) for v in df[an.INVESTED_COLUMN].to_numpy()],
        )


class PurchasePlan(BaseModel):
    """Mirrors `analysis.PurchasePlan`.

    `xirr` is null when the solve did not converge — the module returns no
    number rather than a made-up one, and so does this.
    """

    fills: list[Fill]
    units: dict[str, float]
    market_value: dict[str, float]
    total_invested: float
    total_value: float
    absolute_gain: float
    xirr: Optional[float]
    valued_on: str
    first_purchase: str
    is_single_dated: bool
    shifted_fills: list[Fill]
    # Holdings whose cost was worked back from what they are worth today.
    converted_fills: list[Fill]
    value_series: StagedValueSeries

    @classmethod
    def from_dataclass(cls, p: an.PurchasePlan) -> "PurchasePlan":
        return cls(
            fills=[Fill.from_dataclass(f) for f in p.fills],
            units=dict(p.units),
            market_value=dict(p.market_value),
            total_invested=p.total_invested,
            total_value=p.total_value,
            absolute_gain=p.absolute_gain,
            xirr=p.xirr,
            valued_on=p.valued_on.strftime("%Y-%m-%d"),
            first_purchase=p.first_purchase.strftime("%Y-%m-%d"),
            is_single_dated=p.is_single_dated,
            shifted_fills=[Fill.from_dataclass(f) for f in p.shifted_fills],
            converted_fills=[Fill.from_dataclass(f) for f in p.converted_fills],
            value_series=StagedValueSeries.from_frame(p.value_series),
        )


class RankGap(BaseModel):
    """One pair whose linear and rank correlations are far apart.

    `correlation` is the Pearson coefficient the grouping and the heatmap
    both use; `rank_correlation` is Spearman over the same weekly returns.
    The two parting company means a few weeks are carrying the pair: Pearson
    weights a week by the size of the move, Spearman only by its place in
    the order.
    """

    codes: list[str]
    correlation: float
    rank_correlation: float
    gap: float  # signed, positive when Pearson reads higher

    @classmethod
    def from_dataclass(cls, g: an.RankGap) -> "RankGap":
        return cls(
            codes=list(g.codes),
            correlation=g.correlation,
            rank_correlation=g.rank_correlation,
            gap=g.gap,
        )


class BasketAnalysis(BaseModel):
    """Mirrors `analysis.BasketAnalysis`, minus the weekly return frame.

    `weights` are fractions summing to 1. In staged mode they are today's
    market value, not the lira paid in — `purchases.market_value` holds the
    same thing in lira, and the difference between the two is the point of
    staged mode.
    """

    weights: dict[str, float]
    correlation: Optional[Correlation]  # null for a single-fund basket
    diversification_ratio: Optional[float]  # null when the basket has no variance
    basket_volatility: float
    fund_volatility: dict[str, float]
    weighted_fund_volatility: float
    # Each fund's share of the basket's weekly variance, summing to 1; a
    # fund moving against the rest comes out negative. Empty when the
    # basket has no variance. Groups' shares are the sums of their members'.
    risk_contribution: dict[str, float]
    max_drawdown: Drawdown
    weekly_observations: int
    start: str
    end: str
    is_single_fund: bool
    is_staged: bool
    basket_value: Series  # deposit-free, normalised to 1.0 at `start`
    purchases: Optional[PurchasePlan]  # null in simple mode
    # Pairs the Pearson matrix above and a Spearman one over the same weekly
    # returns disagree about. Reporting only: the grouping never sees the
    # rank matrix. Usually empty, and empty is a normal answer.
    #
    # The rank matrix itself is not sent. The only question asked of it is
    # where it parts company with Pearson, and that is answered here; a
    # second full matrix on the wire would be a payload nothing reads.
    rank_gaps: list["RankGap"]

    @classmethod
    def from_dataclass(cls, a: an.BasketAnalysis) -> "BasketAnalysis":
        ratio = a.diversification_ratio
        return cls(
            weights=dict(a.weights),
            correlation=(
                Correlation.from_frame(a.correlation)
                if a.correlation is not None
                else None
            ),
            # NaN is not JSON, and it means something specific here: a
            # basket with no variance at all, where nothing was diversified
            # away because there was nothing to diversify.
            diversification_ratio=None if pd.isna(ratio) else float(ratio),
            basket_volatility=a.basket_volatility,
            fund_volatility=dict(a.fund_volatility),
            weighted_fund_volatility=a.weighted_fund_volatility,
            risk_contribution={c: round(v, 4) for c, v in a.risk_contribution.items()},
            max_drawdown=Drawdown.from_dataclass(a.max_drawdown),
            weekly_observations=a.weekly_observations,
            start=a.start.strftime("%Y-%m-%d"),
            end=a.end.strftime("%Y-%m-%d"),
            is_single_fund=a.is_single_fund,
            is_staged=a.is_staged,
            basket_value=Series.from_series(a.basket_value),
            purchases=(
                PurchasePlan.from_dataclass(a.purchases)
                if a.purchases is not None
                else None
            ),
            rank_gaps=[
                RankGap.from_dataclass(g)
                for g in an.find_rank_gaps(a.correlation, a.rank_correlation)
            ],
        )


class FundGroup(BaseModel):
    """Mirrors `analysis.FundGroup`."""

    codes: list[str]
    weight: float  # fraction of the basket, 0..1
    min_correlation: float
    size: int

    @classmethod
    def from_dataclass(cls, g: an.FundGroup) -> "FundGroup":
        return cls(
            codes=list(g.codes),
            weight=g.weight,
            min_correlation=g.min_correlation,
            size=g.size,
        )


class Standalone(BaseModel):
    """Mirrors `analysis.Standalone`."""

    code: str
    weight: float

    @classmethod
    def from_dataclass(cls, s: an.Standalone) -> "Standalone":
        return cls(code=s.code, weight=s.weight)


class Grouping(BaseModel):
    """Mirrors `analysis.GroupingResult`.

    Everything a sentence about concentration needs and nothing of the
    sentence itself: which funds move together, how much of the basket they
    are, how weakly the group holds, and the threshold it was judged at. An
    empty `groups` list is a normal — and good — result, not an error.
    """

    groups: list[FundGroup]  # heaviest first
    standalone: list[Standalone]  # heaviest first
    threshold: float
    grouped_weight: float  # share of the basket inside a group, 0..1

    @classmethod
    def from_dataclass(cls, r: an.GroupingResult) -> "Grouping":
        return cls(
            groups=[FundGroup.from_dataclass(g) for g in r.groups],
            standalone=[Standalone.from_dataclass(s) for s in r.standalone],
            threshold=r.threshold,
            grouped_weight=r.grouped_weight,
        )


# ----------------------------------------------------------------------
# Real return — src.inflation
# ----------------------------------------------------------------------


class RealReturn(BaseModel):
    """Mirrors `inflation.RealReturn`, plus which series it was measured on.

    `basis` matters. In simple mode (`lump_sum`) these are the investor's own
    returns. In staged mode (`held_units`) they are what the units held today
    would have done over the window, with no deposits in it — the
    investor's own money-weighted return is `analysis.purchases.xirr`, which
    accounts for when each deposit arrived. Presenting the two as the same
    number would be the exact error staged mode exists to avoid.
    """

    basis: ReturnBasis
    total: float
    annual: float
    nominal_total: float
    nominal_annual: float
    inflation_total: float
    cpi_start: float
    cpi_end: float
    series_code: str
    latest_cpi_month: str
    stale_months: int
    is_extrapolated: bool
    real_value: Series  # the nominal series restated in end-of-window prices

    @classmethod
    def from_dataclass(cls, r: inf.RealReturn, basis: ReturnBasis) -> "RealReturn":
        return cls(
            basis=basis,
            total=r.total,
            annual=r.annual,
            nominal_total=r.nominal_total,
            nominal_annual=r.nominal_annual,
            inflation_total=r.inflation_total,
            cpi_start=r.cpi_start,
            cpi_end=r.cpi_end,
            series_code=r.series_code,
            latest_cpi_month=r.latest_cpi_month.strftime("%Y-%m"),
            stale_months=r.stale_months,
            is_extrapolated=r.is_extrapolated,
            real_value=Series.from_series(r.real_value),
        )


# ----------------------------------------------------------------------
# Responses
# ----------------------------------------------------------------------


class Fund(BaseModel):
    """One row of the fund registry, for an autocomplete."""

    code: str
    title: str


class FundsResponse(BaseModel):
    """Every fund TEFAS currently lists."""

    count: int
    funds: list[Fund]


class HealthResponse(BaseModel):
    """Liveness. Deliberately does not touch TEFAS.

    A health check that called out to a third party would report *their*
    outage as this service being down, and would be slow enough that a load
    balancer would act on it.
    """

    status: Literal["ok"]
    version: str


class AnalyzeResponse(BaseModel):
    """Everything a screen needs for one basket, as numbers and state codes.

    Null fields are normal and always explained by their neighbouring
    `*_status`: a basket whose funds all returned nothing has `analysis:
    null` and `analysis_status: "no_funds"`, with `coverage.failed_codes`
    carrying a `kind` per code.

    `full_analysis` is the same basket over the *full* matrix — every fund
    that returned data, on their shorter common window. It is filled in only
    when `coverage.excluded_codes` is non-empty, i.e. when the two matrices
    would actually differ, and lets a screen show what including the
    excluded funds would cost.
    """

    mode: Mode
    months: int
    requested_codes: list[str]

    coverage: Coverage

    analysis_status: AnalysisStatus
    analysis: Optional[BasketAnalysis]
    grouping: Optional[Grouping]

    full_analysis_status: FullAnalysisStatus
    full_analysis: Optional[BasketAnalysis]
    full_grouping: Optional[Grouping]

    real_return_status: RealReturnStatus
    real_return: Optional[RealReturn]

    rolling_status: RollingStatus
    rolling_correlation: Optional[RollingCorrelation]

    #: The applied fee of every requested code TEFAS's fee list carries.
    #: Empty when the list could not be fetched; a missing code is unknown,
    #: not free.
    fees: dict[str, "FeeOut"] = Field(default_factory=dict)


# ----------------------------------------------------------------------
# Fund pages
# ----------------------------------------------------------------------

#: What a correlation pair was judged to be. English constants on the wire,
#: the same strings `src.precompute` writes into Postgres; the page turns
#: them into Turkish. Adding one here without adding it there, or the other
#: way round, is the bug this Literal exists to catch.
Bucket = Literal[
    "overlapping",
    "inverse",
    "similar",
    "moderate",
    "unrelated",
    "uncertain",
    "insufficient_data",
]

#: Why a return is missing. Codes, never sentences.
ReturnUnavailable = Literal[
    "insufficient_history",
    "cpi_unavailable",
    "cpi_window_before_series",
]


class FundReturnOut(BaseModel):
    """One fund over one window. Total return, not annualised.

    `months` is what was asked for; `window_start` and `window_end` are what
    was measured, and they are not decoration. The window ends at the last
    month TÜİK has published an index for, not at today, so a "12 month"
    figure published on the 20th runs to the end of last month. The page is
    expected to print these two rather than say "the last 12 months".

    Both figures are measured over exactly this window, so the difference
    between them is inflation and nothing else.
    """

    months: int
    nominal: Optional[float] = None
    real: Optional[float] = None
    nominal_unavailable: Optional[ReturnUnavailable] = None
    real_unavailable: Optional[ReturnUnavailable] = None
    #: Month starts. Null together, when there was no window to measure.
    window_start: Optional[_date] = None
    window_end: Optional[_date] = None
    #: Risk over the same window, off the weekly series. Only on the page's
    #: own fund; a neighbour's returns carry none of these.
    volatility: Optional[float] = None
    max_drawdown: Optional[float] = None
    #: The TL return restated in dollars at TCMB's rate on the window's
    #: first and last business days; null when no rate was available.
    usd: Optional[float] = None


class FeeOut(BaseModel):
    """The fee a fund applies, as TEFAS publishes it (`src.fees`).

    `rate` is annual, as a fraction. `kind` is `management` for securities
    funds and `operating` for pension funds, whose field is the fund
    operating expense; the page names the two differently. A rate of 0 is
    passed on as reported, and may be a gap in TEFAS's data.
    """

    rate: float
    kind: Literal["management", "operating"]


class FundIdentity(BaseModel):
    """What a fund is. Every field but the code and name may be absent.

    `risk_value` is null for about a fifth of the registry and null means
    TEFAS did not say, not zero.
    """

    code: str
    name: str
    founder: Optional[str] = None
    fund_type: Optional[str] = None
    umbrella_type: Optional[str] = None
    category: Optional[str] = None
    total_assets: Optional[float] = None
    investor_count: Optional[int] = None
    risk_value: Optional[int] = None
    #: Null when TEFAS's fee list was unreachable or did not carry the code.
    fee: Optional[FeeOut] = None
    returns: list[FundReturnOut] = Field(default_factory=list)

    @classmethod
    def from_row(cls, row: dict) -> "FundIdentity":
        # `row["returns"]` is what `db._FUND_COLUMNS` aggregated out of
        # `fund_returns`, already ordered by window. There is no list of
        # periods written here on purpose: which windows exist is decided in
        # `src.windows.RETURN_PERIODS` and carried in the data, so adding one
        # does not need an edit in this file.
        returns = [FundReturnOut(**r) for r in row.get("returns") or []]
        return cls(
            code=row["code"],
            name=row["name"],
            founder=row.get("founder"),
            fund_type=row.get("fund_type"),
            umbrella_type=row.get("umbrella_type"),
            category=row.get("category"),
            total_assets=row.get("total_assets"),
            investor_count=row.get("investor_count"),
            risk_value=row.get("risk_value"),
            returns=returns,
        )


class NeighbourOut(BaseModel):
    """One stored pair, from the subject fund's side.

    The neighbour's own identity travels with it — size, investor count and
    returns included — because the page shows those in a popover the moment
    a row is clicked, and a second request per neighbour would be twenty
    round trips for one screen.
    """

    correlation: float
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    n_weeks: int
    bucket: Bucket
    fund: FundIdentity
    #: The neighbour's last `NEIGHBOUR_RECENT_WEEKS` weeks, base 100, for the
    #: small chart in its card. Optional so a page built against an API that
    #: predates it still renders — the card simply draws no chart.
    recent: Optional["WeeklySeriesOut"] = None


class DataFreshness(BaseModel):
    """When the numbers on this page were computed."""

    last_run_at: Optional[_date_time] = None
    universe_size: Optional[int] = None
    included_funds: Optional[int] = None
    #: Last month TÜİK has published. Real returns never run past it.
    cpi_latest_month: Optional[_date] = None


class WeeklySeriesOut(BaseModel):
    """One fund's weekly value line, as an index rather than as lira.

    ## Why an index and not prices

    A chart re-bases to whichever period the reader picked, so the absolute
    price is never drawn. Sending it would mean shipping the same information
    with four more significant figures per point.

    ## Why the dates are implied

    `values[i]` is the week ending `start + 7*i` days. Sending 214 ISO dates
    beside 214 numbers would roughly triple the payload of every one of the
    1372 pages to say something the reader can count.

    That is only safe because the grid is **complete**: `precompute.
    weekly_price_grid` reindexes onto every W-FRI between the first and last
    week, so a week the fund did not price is a `null` in `values`, not a
    missing entry. A dropped week would shift every later point by seven days
    and misdate the series. A null is also not filled in — a gap reads as a
    gap, which is the rule the rest of this codebase follows.
    """

    #: The week the series starts on: the Friday `values[0]` belongs to.
    start: _date
    #: Always 7. Stated rather than assumed, so a reader of the payload does
    #: not have to know the resampling convention to plot it.
    step_days: int = 7
    #: Base 100 at the first non-null week. Nulls are weeks with no price.
    values: list[Optional[float]] = Field(default_factory=list)


class CPISeriesOut(BaseModel):
    """The published CPI, for the inflation line.

    Monthly, because that is how it exists. The index is a level for the
    whole month and is **never** interpolated to a day or carried past the
    last published month, so the line a page draws from this is a step that
    stops — not a curve, and not a flat continuation into the weeks TÜİK has
    not priced yet.

    `values[i]` is the month starting `start_month` plus `i` months.
    """

    start_month: _date
    #: The last month with a published index. The inflation line ends here.
    latest_month: _date
    #: Index levels as published, in the order the months run.
    values: list[float] = Field(default_factory=list)


class FundPageResponse(BaseModel):
    """Everything one fund page draws, in one payload.

    A fund with no measurable neighbours gets empty lists and a
    `neighbours_unavailable` code — not a 404. The fund exists, it is in the
    universe, and "we could not measure this one against anything" is a
    finding the page should state rather than a missing page.
    """

    fund: FundIdentity
    high: list[NeighbourOut] = Field(default_factory=list)
    low: list[NeighbourOut] = Field(default_factory=list)
    neighbours_unavailable: Optional[
        Literal["no_measurable_pairs", "fund_not_priced"]
    ] = None
    #: The chart's two lines, precomputed by the weekly job and embedded into
    #: the page at build time. Null when the run stored no series for this
    #: fund, which is a fund with no chart rather than a page with an error.
    series: Optional[WeeklySeriesOut] = None
    cpi: Optional[CPISeriesOut] = None
    freshness: DataFreshness


class FundListItem(BaseModel):
    code: str
    name: str
    founder: Optional[str] = None


class FundListResponse(BaseModel):
    """Every fund with a page. For static generation, not for search."""

    count: int
    funds: list[FundListItem]


# ----------------------------------------------------------------------
# The market grouping
# ----------------------------------------------------------------------


class StyleOut(BaseModel):
    """What a series is made of, by returns-based style analysis.

    `weights` has every factor key, non-negative, summing to 1. `reportable`
    is false when the mix explains too little of the series (`r2` under the
    model's `min_r2`); the frontend then prints no composition at all.
    """

    weights: dict[str, float]
    r2: float
    weeks: int
    reportable: bool


class StyleFactorOut(BaseModel):
    """One factor, and the fund standing for it in this snapshot."""

    key: str
    proxy: str


class MarketClusterOut(BaseModel):
    """Funds of which every pair overlaps, with what they have in common.

    `top_category` is TEFAS's own category string, passed through as data;
    the API still writes no Turkish of its own.
    """

    codes: list[str]
    size: int
    weakest_ci_low: float
    median_correlation: float
    founders: int
    top_category: Optional[str] = None
    top_category_share: Optional[float] = None
    total_assets: Optional[float] = None
    #: The group's share of the asset-weighted market portfolio's weekly
    #: variance (Euler decomposition, all shares summing to 1). Null when
    #: no fund sizes were known.
    risk_share: Optional[float] = None
    #: Lowest and highest applied fee among members with a non-zero one,
    #: over management fees when the group has any, else operating expenses.
    fee_low: Optional[float] = None
    fee_high: Optional[float] = None
    #: The style of the group's equal-weight weekly return.
    style: Optional[StyleOut] = None


class MarketResponse(BaseModel):
    """How many different things the fund universe holds.

    `listed` is every fund with a page; `measured` those with enough clean
    weekly history to be compared; the rest are in `unmeasured` by reason,
    never silently dropped. `groups_total` counts each multi-fund group once
    and each fund that joined none once.
    """

    listed: int
    measured: int
    groups_total: int
    clusters: list[MarketClusterOut]
    singletons: list[str]
    unmeasured: dict[str, list[str]]
    overlapping_threshold: float
    min_weeks: int
    window_start: Optional[_date] = None
    window_end: Optional[_date] = None
    total_assets_measured: Optional[float] = None
    last_run_at: Optional[_date_time] = None
    style_factors: list[StyleFactorOut] = Field(default_factory=list)
    style_min_r2: Optional[float] = None


class ShiftOut(BaseModel):
    """A pair whose correlation in one year differs from the other years'."""

    a: str
    b: str
    #: Inside the year.
    corr: float
    #: Over every week outside it.
    rest: float
    #: Fisher z difference over its standard error; sign follows corr - rest.
    z: float


class PeriodOut(BaseModel):
    """The style factors over one calendar year, or over the whole window."""

    key: str  # "2025", or "all" for the whole window
    start: _date
    end: _date
    weeks: int
    partial: bool
    #: Factor keys as codes.
    correlation: Correlation
    #: Annualised weekly volatility per factor key.
    volatility: dict[str, float]
    shifts: list[ShiftOut] = Field(default_factory=list)


class MarketPeriodsResponse(BaseModel):
    """How the asset classes related to each other, year by year."""

    factors: list[StyleFactorOut]
    whole: Optional[PeriodOut]
    periods: list[PeriodOut]
    #: Family-wise error rate per year, and the |z| line it implies.
    alpha: float
    z_critical: Optional[float]
