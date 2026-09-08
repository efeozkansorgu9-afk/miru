"""
Data Layer
==========
Turns a list of fund codes into aligned price matrices plus a coverage
report. This module answers only "which funds do we have, over which common
window, and how much of that window is usable" — no analysis, no UI.

Two matrices are always produced and neither is preferred:

    full     every code that returned data, on their common dates
    trimmed  the funds worth their cost to the window: a late starter is
             dropped only when including it would shorten the window the
             others share too much, on *their* common dates

The caller compares "complete basket, short history" against "long history,
incomplete basket" and decides. This module does not choose.

Run the coverage report from the command line:

    python -m src.data                  # demo basket
    python -m src.data GAL AFO TI2 --months 36
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
import warnings
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional, Sequence

import pandas as pd

from src.tefas_client import (
    DateLike,
    TEFASClient,
    TEFASRequestError,
    _parse_date,
)

logger = logging.getLogger(__name__)

# Correlation estimates built on fewer weekly observations than this carry
# confidence intervals too wide to act on. We only report the count and the
# flag — hiding data or raising on it is the UI layer's call, not ours.
MIN_WEEKLY_OBSERVATIONS = 100

# Slack at the recent end: a fund whose last price is within this many days of
# the newest price in the basket is still trading, not stale. The slack absorbs
# weekends, public holidays and TEFAS's publishing lag.
COVERAGE_TOLERANCE_DAYS = 7

# How much of the common window one fund may cost before it is left out.
# Exclusion is not free: a dropped fund takes its share of the basket out of
# the analysis entirely. So the test is what including it actually costs the
# others, not whether it happens to be younger than the request. A fund that
# trims a 60-month window to 59 is worth keeping; one that trims 36 months to
# 2 is not.
MAX_WINDOW_LOSS = 0.20

# A clean year is ~252 trading days against ~262 business days: the ~10
# missing ones are Turkish public holidays and hit every fund alike, so a
# healthy series sits near 0.96. Below this, the fund has gaps of its own —
# and a gappy fund silently narrows the inner join for the whole basket.
MIN_COVERAGE_RATIO = 0.93

# Why a fund produced nothing. Prose is for the report; the tag is what the
# UI branches on — "no such fund" and "this fund closed" are different things
# to tell someone.
FAILURE_UNKNOWN_CODE = "unknown_code"
FAILURE_NO_PRICES_IN_WINDOW = "no_prices_in_window"
FAILURE_NO_VALID_PRICES = "no_valid_prices"
FAILURE_UNVERIFIED = "no_data_unverified"
# The request never completed, so nothing at all was observed about the fund.
# Kept apart from every kind above because those are findings and this is the
# absence of one: it must never be cached, and it must never be reported as
# "no prices in this window", which is a claim the request did not support.
FAILURE_REQUEST_FAILED = "request_failed"

# Why a fund that *did* return data was still left out of TRIMMED. Same
# split of duties as the failure kinds above: the sentence is for the
# report, the tag is what a caller branches on. The two are different
# things to tell someone — one fund stopped trading, the other is simply
# younger than the basket — and they are not interchangeable.
EXCLUSION_STALE_SERIES = "stale_series"
EXCLUSION_WINDOW_COST = "window_cost"

# How far back the TEFAS price endpoint reaches; a fund delisted before this
# is indistinguishable from a code that never existed.
PRICE_HISTORY_YEARS = 5

# The same 5 years cap how much history can be *requested*, counted from
# today rather than from `end_date`. tefas-crawler snaps anything longer to
# its 60-month bucket and returns the truncated series without a word
# (`_months_back` falls through to `_VALID_PERIODS[-1]`). Unchecked, that
# clamp is invisible in the worst way: every fund comes back starting at the
# 5-year mark, so every fund looks like it has a short history and TRIMMED
# comes out empty. Clamp it here and say so.
MAX_MONTHS = PRICE_HISTORY_YEARS * 12

DEFAULT_MONTHS = 36

CACHE_DIR = Path("data/cache")

# Bumped when the cached payload's shape changes, so old files are ignored
# instead of misread.
_CACHE_VERSION = 2

# Where "TEFAS answered, and had nothing for this fund" is remembered, and
# for how long. Separate from the price cache on purpose: an absence is a
# much weaker claim than a price, it is the one that a transient failure can
# forge, and it therefore gets minutes rather than the price cache's day.
#
# Ten minutes is long enough to stop a basket refetching the same empty fund
# on every press, and short enough that a fund wrongly recorded as empty is
# retried within one sitting rather than at tomorrow's first request.
#
# A request that *failed* is never written here at all. That is the whole
# fix: one rate-limited response used to be persisted for the day as a fact
# about the fund, which turned something measurable into "insufficient data"
# — the exact inversion of this product's rule about not claiming what it
# has not measured.
ABSENCE_FILE = "absences.json"
ABSENCE_TTL_SECONDS = 600

# How many consecutive failed requests mean TEFAS is down rather than busy.
# Past this the batch loop stops retrying each fund: when nothing is
# answering, three attempts per fund is the same answer three times, and
# across the weekly job's ~1374 funds it is an hour of it.
_OUTAGE_STREAK = 5


# ----------------------------------------------------------------------
# Result types
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class FundCoverage:
    """What one fund actually returned."""

    fund_code: str
    fund_name: str
    first_date: pd.Timestamp
    last_date: pd.Timestamp
    row_count: int
    expected_business_days: int

    @property
    def span_days(self) -> int:
        return int((self.last_date - self.first_date).days)

    @property
    def coverage_ratio(self) -> float:
        """Rows delivered over business days in the fund's own date range.

        Holidays put a healthy fund near 0.96, not 1.0. What this catches is
        the fund with a hole in the middle of its series — which costs the
        whole basket those dates in the inner join, invisibly, unless someone
        is looking at this number.
        """
        if self.expected_business_days <= 0:
            return 0.0
        return self.row_count / self.expected_business_days

    @property
    def is_sparse(self) -> bool:
        return self.coverage_ratio < MIN_COVERAGE_RATIO


@dataclass(frozen=True)
class FundFailure:
    """A code that produced no usable series, and why."""

    fund_code: str
    kind: str
    reason: str

    def __str__(self) -> str:
        return self.reason


@dataclass(frozen=True)
class FundExclusion:
    """A fund with usable prices that TRIMMED still leaves out, and why."""

    fund_code: str
    kind: str
    reason: str

    def __str__(self) -> str:
        return self.reason


@dataclass(frozen=True)
class MatrixCoverage:
    """The common window of one price matrix and how well sampled it is."""

    fund_codes: list[str]
    start: Optional[pd.Timestamp]
    end: Optional[pd.Timestamp]
    trading_days: int
    weekly_observations: int

    @property
    def is_empty(self) -> bool:
        return self.trading_days == 0

    @property
    def below_weekly_threshold(self) -> bool:
        """True when weekly correlation estimates would be unreliable."""
        return self.weekly_observations < MIN_WEEKLY_OBSERVATIONS


@dataclass(frozen=True)
class FundDataset:
    """Everything the caller needs to pick a basket and explain the choice."""

    full: pd.DataFrame
    trimmed: pd.DataFrame
    full_coverage: MatrixCoverage
    trimmed_coverage: MatrixCoverage
    fund_coverage: dict[str, FundCoverage]
    excluded_codes: dict[str, FundExclusion]
    failed_codes: dict[str, FundFailure]
    requested_codes: list[str]
    requested_start: pd.Timestamp
    requested_end: pd.Timestamp
    from_cache: bool = False
    fund_names: dict[str, str] = field(default_factory=dict)
    # Things the caller asked for but did not get. Empty on a clean run.
    notes: list[str] = field(default_factory=list)

    @property
    def ok_codes(self) -> list[str]:
        """Codes that returned usable data, in the order requested."""
        return [c for c in self.requested_codes if c not in self.failed_codes]

    @property
    def sparse_codes(self) -> list[str]:
        """Funds with gaps inside their own range — they narrow the join."""
        return [c for c, cov in self.fund_coverage.items() if cov.is_sparse]


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------


def load_price_data(
    fund_codes: Sequence[str],
    months: int = DEFAULT_MONTHS,
    end_date: Optional[DateLike] = None,
    client: Optional[TEFASClient] = None,
    use_cache: bool = True,
    cache_dir: Path | str = CACHE_DIR,
    delay: float = 0.5,
    max_window_loss: float = MAX_WINDOW_LOSS,
) -> FundDataset:
    """
    Fetch each fund, align the series and report coverage.

    Parameters
    ----------
    fund_codes : sequence of str
        Fund codes to fetch. Duplicates are dropped, order is preserved.
    months : int
        How much history to ask for, counted back from `end_date`. Clamped to
        `MAX_MONTHS`; any clamping lands in `FundDataset.notes` and raises a
        `UserWarning`.
    end_date : str | date | datetime, optional
        Right edge of the window. Defaults to today.
    client : TEFASClient, optional
        Injected for tests; one is created if omitted.
    use_cache : bool
        Read (and write) today's parquet cache under `cache_dir`.
    cache_dir : Path | str
        Where cached frames live. Defaults to `data/cache`.
    delay : float
        Seconds between fund requests, matching TEFASClient's own pacing.
    max_window_loss : float
        The share of the common window a fund may cost and still be kept in
        `trimmed`. Above it the fund is excluded, as it is when including it
        would drop the window below `MIN_WEEKLY_OBSERVATIONS`.

    Returns
    -------
    FundDataset
        Both matrices, per-fund coverage, and the codes that dropped out.
    """
    codes = _dedupe(fund_codes)
    if not codes:
        raise ValueError("fund_codes is empty — nothing to fetch")
    if months < 1:
        raise ValueError(f"months must be >= 1, got {months}")

    end = pd.Timestamp(_parse_date(end_date) if end_date else date.today())
    start, notes = _resolve_start(end, months)

    long_df, raw_failures, listed, from_cache = _gather(
        codes, start, end, client, delay, use_cache, cache_dir
    )

    return _build(
        long_df=long_df,
        raw_failures=raw_failures,
        listed=listed,
        codes=codes,
        start=start,
        end=end,
        from_cache=from_cache,
        notes=notes,
        max_window_loss=max_window_loss,
    )


def format_coverage_report(ds: FundDataset) -> str:
    """Render the coverage report as plain text."""
    lines: list[str] = []
    add = lines.append

    span = f"{ds.requested_start.date()} → {ds.requested_end.date()}"
    add("=" * 72)
    add(f"COVERAGE REPORT   requested {span}   ({len(ds.requested_codes)} codes)")
    if ds.from_cache:
        add("(served from today's cache)")
    for note in ds.notes:
        add(f"!! {note}")
    add("=" * 72)

    add("")
    add("Per fund")
    add(f"  {'code':<6} {'first':<12} {'last':<12} {'rows':>6} {'cov':>6}  name")
    for code in ds.requested_codes:
        cov = ds.fund_coverage.get(code)
        if cov is None:
            failure = ds.failed_codes.get(code)
            label = f"[{failure.kind}] {failure.reason}" if failure else "no data"
            add(f"  {code:<6} {'—':<12} {'—':<12} {0:>6} {'—':>6}  FAILED {label}")
            continue
        mark = " ⚠️" if cov.is_sparse else ""
        add(
            f"  {code:<6} {cov.first_date.date()!s:<12} {cov.last_date.date()!s:<12} "
            f"{cov.row_count:>6} {cov.coverage_ratio:>5.0%}{mark or ' '}  {cov.fund_name[:32]}"
        )

    add("")
    add(_format_matrix("FULL     (all codes with data, inner join)", ds.full_coverage))
    add(_format_matrix("TRIMMED  (funds worth their cost to the window)", ds.trimmed_coverage))

    add("")
    if ds.sparse_codes:
        add(f"Gappy series (coverage below {MIN_COVERAGE_RATIO:.0%} of business days)")
        for code in ds.sparse_codes:
            cov = ds.fund_coverage[code]
            missing = cov.expected_business_days - cov.row_count
            add(
                f"  {code:<6} {cov.coverage_ratio:.0%} — {missing} business days missing "
                f"inside {cov.first_date.date()}..{cov.last_date.date()}; "
                f"these dates drop out of every matrix it joins"
            )
    else:
        add("Gappy series: none (holiday-only gaps)")

    add("")
    if ds.failed_codes:
        add("Failed (no usable data returned)")
        for code, failure in ds.failed_codes.items():
            add(f"  {code:<6} [{failure.kind}] {failure.reason}")
    else:
        add("Failed: none")

    add("")
    if ds.excluded_codes:
        add("Dropped from TRIMMED")
        for code, exclusion in ds.excluded_codes.items():
            add(f"  {code:<6} [{exclusion.kind}] {exclusion.reason}")
    else:
        add("Dropped from TRIMMED: none")

    add("=" * 72)
    return "\n".join(lines)


def print_coverage_report(ds: FundDataset) -> None:
    print(format_coverage_report(ds))


# ----------------------------------------------------------------------
# Fetching
# ----------------------------------------------------------------------


def _gather(
    codes: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    client: Optional[TEFASClient],
    delay: float,
    use_cache: bool,
    cache_dir: Path | str,
) -> tuple[pd.DataFrame, dict[str, dict], dict[str, bool], bool]:
    """Prices for every code, from the cache where possible.

    The cache holds prices, and only prices. So a code the cache has no rows
    for is not "a fund with no prices" — it is a code this cache cannot
    answer for, and it gets asked again. That is what makes a transient
    failure self-healing: the good rows from the same run stay cached, and
    the fund that failed is retried on the next request rather than at
    tomorrow's.

    Asked again *unless* the absence cache says TEFAS answered for it within
    the last few minutes, which is the one case where "no rows" is a fact
    with a short shelf life rather than a gap in what we know.

    `from_cache` means the whole basket came off the disk. A run that had to
    fetch even one code reports False, because the note it feeds says the
    result was served from cache and that would no longer be true.
    """
    cache_path = _cache_path(cache_dir, codes, start, end)
    cached = _read_cache(cache_path) if use_cache else None

    def fetch(wanted: list[str], seed: pd.DataFrame, known: dict[str, dict]):
        nonlocal client
        client = client or TEFASClient()
        fresh, raw = _fetch_all(wanted, start, end, client, delay)
        frames = [f for f in (seed, fresh) if not f.empty]
        merged = pd.concat(frames, ignore_index=True) if frames else _empty_long()
        failures = {**known, **raw}
        flags = _registry_flags(client, codes, merged, failures)
        if use_cache:
            _write_cache(cache_path, merged, flags)
            _remember_absences(cache_dir, raw, start, end)
        return merged, failures, flags, False

    if cached is None:
        return fetch(codes, _empty_long(), {})

    cached_df, listed = cached
    priced = set(cached_df["fund_code"].unique()) if not cached_df.empty else set()
    missing = [code for code in codes if code not in priced]
    if not missing:
        return cached_df, {}, listed, True

    remembered = _recent_absences(cache_dir, missing, start, end)
    retry = [code for code in missing if code not in remembered]
    if not retry:
        return cached_df, remembered, listed, True

    logger.info(
        "Cache %s has no prices for %s; asking TEFAS again rather than "
        "treating that as an answer",
        cache_path.name,
        ", ".join(retry),
    )
    return fetch(retry, cached_df, remembered)


def _fetch_all(
    codes: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    client: TEFASClient,
    delay: float,
) -> tuple[pd.DataFrame, dict[str, dict]]:
    """Fetch every code, keeping the ones that fail instead of dropping them.

    Records only what was observed here; the registry lookup turns that into
    a diagnosis later, so this stays cheap and cacheable.

    Three outcomes per code, not two. `no_rows` and `no_valid_prices` are
    findings: TEFAS answered and the fund had nothing usable. `request_failed`
    is the absence of a finding, and it is tracked separately because the
    caller may cache the first two and must not cache the third.

    Failures get a cooldown after them, and once `_OUTAGE_STREAK` requests in
    a row have failed the per-fund retries are dropped. Rate limiting is the
    expected cause of one failure and backing off is the cure; nothing
    answering at all is a different situation, and retrying 1374 funds three
    times each is an hour spent confirming it.
    """
    frames: list[pd.DataFrame] = []
    raw: dict[str, dict] = {}
    consecutive_failures = 0

    for i, code in enumerate(codes, 1):
        logger.info("Fetching %s (%d/%d)", code, i, len(codes))
        outage = consecutive_failures >= _OUTAGE_STREAK

        try:
            df = client.fetch_history(
                code, start.date(), end.date(), attempts=1 if outage else 3
            )
        except TEFASRequestError as exc:
            consecutive_failures += 1
            raw[code] = {"observed": "request_failed", "error": str(exc)}
            logger.warning(
                "Request for %s failed (%d in a row); recorded as unmeasured, "
                "not as an empty fund",
                code,
                consecutive_failures,
            )
            if i < len(codes):
                # Longer than the ordinary spacing: whatever refused that
                # request is likely to refuse the next one too.
                time.sleep(delay * 4 if not outage else delay)
            continue

        consecutive_failures = 0

        if df.empty:
            raw[code] = {"observed": "no_rows"}
        else:
            usable = df[df["price"].notna() & (df["price"] > 0)]
            if usable.empty:
                raw[code] = {"observed": "no_valid_prices", "rows": int(len(df))}
            else:
                frames.append(usable)

        if i < len(codes):
            time.sleep(delay)

    if not frames:
        return _empty_long(), raw

    return pd.concat(frames, ignore_index=True), raw


def _registry_flags(
    client: TEFASClient,
    codes: list[str],
    long_df: pd.DataFrame,
    raw_failures: dict[str, dict],
) -> dict[str, bool]:
    """Which requested codes TEFAS currently lists.

    The history endpoint answers an invalid code and a delisted fund the same
    way — empty — so the registry is the only thing that separates "no such
    fund" from "this fund is gone". Looked up only when something actually
    needs explaining: a code with no data, or a fund whose prices stop early.

    Returns an empty dict if the registry is unavailable; callers degrade to
    an unverified reason rather than accusing a live fund of not existing.
    """
    suspect = set(raw_failures)
    if not long_df.empty:
        last = long_df.groupby("fund_code")["date"].max()
        stale_before = last.max() - pd.Timedelta(days=COVERAGE_TOLERANCE_DAYS)
        suspect |= set(last[last < stale_before].index)

    if not suspect:
        return {}

    try:
        registry = client.list_fund_codes()
    except Exception as exc:
        logger.warning("Fund registry unavailable, failures stay unverified: %s", exc)
        return {}

    return {code: code in registry for code in codes}


def _empty_long() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "date": pd.Series(dtype="datetime64[ns]"),
            "fund_code": pd.Series(dtype="object"),
            "fund_name": pd.Series(dtype="object"),
            "price": pd.Series(dtype="float64"),
        }
    )


# ----------------------------------------------------------------------
# Assembly
# ----------------------------------------------------------------------


def _build(
    long_df: pd.DataFrame,
    raw_failures: dict[str, dict],
    listed: dict[str, bool],
    codes: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    from_cache: bool,
    notes: Optional[list[str]] = None,
    max_window_loss: float = MAX_WINDOW_LOSS,
) -> FundDataset:
    fund_coverage = _per_fund_coverage(long_df, codes)
    fund_names = {c: cov.fund_name for c, cov in fund_coverage.items()}

    ok = [c for c in codes if c in fund_coverage]
    full = _matrix(long_df, ok)

    keep, excluded = _split_by_window(
        fund_coverage, ok, listed, long_df, max_window_loss
    )
    trimmed = _matrix(long_df, keep)

    return FundDataset(
        full=full,
        trimmed=trimmed,
        full_coverage=_matrix_coverage(full),
        trimmed_coverage=_matrix_coverage(trimmed),
        fund_coverage=fund_coverage,
        excluded_codes=excluded,
        failed_codes=_classify_failures(
            [c for c in codes if c not in fund_coverage], raw_failures, listed
        ),
        requested_codes=codes,
        requested_start=start,
        requested_end=end,
        from_cache=from_cache,
        fund_names=fund_names,
        notes=list(notes or []),
    )


def _classify_failures(
    codes: list[str],
    raw_failures: dict[str, dict],
    listed: dict[str, bool],
) -> dict[str, FundFailure]:
    """Turn "returned nothing" into something a user can act on."""
    cutoff = (date.today() - pd.DateOffset(years=PRICE_HISTORY_YEARS)).date()
    out: dict[str, FundFailure] = {}

    for code in codes:
        observed = raw_failures.get(code, {}).get("observed", "no_rows")

        if observed == "request_failed":
            # Tested first, and never falls through to the registry branches
            # below. Those all describe the fund — it is not listed, it is
            # listed but silent — and none of them is supportable when the
            # request did not complete. The honest answer is that we do not
            # know, and it is the only failure kind that says a retry is
            # worth something.
            out[code] = FundFailure(
                code,
                FAILURE_REQUEST_FAILED,
                "TEFAS did not answer for this fund; nothing was measured, "
                "so try again shortly",
            )
        elif observed == "no_valid_prices":
            rows = raw_failures[code].get("rows", 0)
            out[code] = FundFailure(
                code,
                FAILURE_NO_VALID_PRICES,
                f"{rows} rows returned, none with a usable price",
            )
        elif code not in listed:
            # Registry unavailable: say what we saw, do not guess a cause.
            out[code] = FundFailure(
                code,
                FAILURE_UNVERIFIED,
                "no prices returned; fund registry unavailable, cause unverified",
            )
        elif listed[code]:
            out[code] = FundFailure(
                code,
                FAILURE_NO_PRICES_IN_WINDOW,
                "listed on TEFAS but returned no prices for this window",
            )
        else:
            # Not in the registry and nothing in the price API's 5-year reach.
            # A fund delisted before that cutoff leaves no trace TEFAS will
            # serve, so it is genuinely indistinguishable from a typo here.
            out[code] = FundFailure(
                code,
                FAILURE_UNKNOWN_CODE,
                f"not a TEFAS fund code today, and no prices since {cutoff} — "
                f"invalid code, or a fund closed before then",
            )

    return out


def _resolve_start(end: pd.Timestamp, months: int) -> tuple[pd.Timestamp, list[str]]:
    """Left edge of the window we can actually get, plus what we had to give up.

    Two ways to fall off the 5-year cliff: asking for more than 60 months, or
    asking for a window whose *start* predates the cliff even though the span
    is short (an `end_date` set well in the past). Both are clamped, and both
    leave a note — a silently shortened window would make every fund look
    newly launched.
    """
    notes: list[str] = []
    start = end - pd.DateOffset(months=months)
    earliest = pd.Timestamp(date.today()) - pd.DateOffset(months=MAX_MONTHS)

    if months > MAX_MONTHS:
        notes.append(
            f"requested {months} months of history; TEFAS serves at most "
            f"{MAX_MONTHS} — window shortened"
        )

    if start < earliest:
        notes.append(
            f"window would start {start.date()}, before TEFAS's earliest "
            f"available {earliest.date()} — start moved forward"
        )
        start = earliest

    for note in notes:
        warnings.warn(note, UserWarning, stacklevel=3)

    return start, notes


def _per_fund_coverage(long_df: pd.DataFrame, codes: list[str]) -> dict[str, FundCoverage]:
    if long_df.empty:
        return {}

    out: dict[str, FundCoverage] = {}
    for code, grp in long_df.groupby("fund_code", sort=False):
        if code not in codes:
            continue
        names = grp["fund_name"].dropna()
        first, last = grp["date"].min(), grp["date"].max()
        out[code] = FundCoverage(
            fund_code=code,
            fund_name=str(names.iloc[-1]) if len(names) else code,
            first_date=first,
            last_date=last,
            row_count=int(len(grp)),
            expected_business_days=int(len(pd.bdate_range(first, last))),
        )
    # Report in the order the caller asked for.
    return {c: out[c] for c in codes if c in out}


def _matrix(long_df: pd.DataFrame, codes: list[str]) -> pd.DataFrame:
    """
    date × fund price matrix over the codes' common dates.

    Deliberately no forward fill: missing days are exchange holidays shared by
    every fund, and the inner join already removes them. Filling would invent
    zero-return days and understate volatility.
    """
    if not codes or long_df.empty:
        return pd.DataFrame(index=pd.DatetimeIndex([], name="date"), columns=codes, dtype="float64")

    subset = long_df[long_df["fund_code"].isin(codes)]
    wide = subset.pivot_table(index="date", columns="fund_code", values="price", aggfunc="last")
    wide = wide.reindex(columns=codes)
    wide = wide.dropna(how="any").sort_index()
    wide.index.name = "date"
    wide.columns.name = None
    return wide


def _split_by_window(
    fund_coverage: dict[str, FundCoverage],
    codes: list[str],
    listed: dict[str, bool],
    long_df: pd.DataFrame,
    max_window_loss: float = MAX_WINDOW_LOSS,
) -> tuple[list[str], dict[str, FundExclusion]]:
    """
    Keep the funds worth keeping: the ones that do not cost the rest too much.

    The question is not whether a fund is younger than the request. It is what
    including it does to the window everyone shares, because that window is
    what the analysis actually runs on. A fund that starts a month into a
    five-year request costs the others almost nothing; a fund that starts two
    months ago costs them everything. The first is worth keeping even though
    neither covers the request in full, and the old rule threw out both.

    So a late starter is excluded only when including it would either cost
    more than `max_window_loss` of the common window, or push that window
    below `MIN_WEEKLY_OBSERVATIONS` when dropping it would not. Both tests are
    counted in weekly observations, the sample size everything downstream
    rests on, so "20% shorter" means 20% fewer weeks to estimate from.

    The cost is measured one fund at a time, always against the fund that
    currently sets the common start. Removing it hands the constraint to the
    next-latest, which is then judged the same way, so nothing is dropped on
    account of a fund that has itself already been dropped.

    Funds whose prices stop early are a separate matter and still go out
    regardless of cost: a series that ended cannot be compared against one
    that has not.
    """
    tolerance = pd.Timedelta(days=COVERAGE_TOLERANCE_DAYS)

    # The recent edge is set by the data, not the calendar: today may be a
    # weekend and TEFAS publishes with a lag.
    latest = max((c.last_date for c in fund_coverage.values()), default=None)

    keep: list[str] = []
    excluded: dict[str, FundExclusion] = {}

    for code in codes:
        cov = fund_coverage[code]
        if latest is not None and cov.last_date < latest - tolerance:
            # This is the closure the data *can* prove: the fund traded, then
            # stopped. If the registry has also dropped it, it is delisted
            # rather than merely suspended.
            gone = listed.get(code)
            state = {True: "still listed, suspended?", False: "delisted"}.get(
                gone, "registry unverified"
            )
            excluded[code] = FundExclusion(
                fund_code=code,
                kind=EXCLUSION_STALE_SERIES,
                reason=(
                    f"last price {cov.last_date.date()}, stale against "
                    f"{latest.date()} ({state})"
                ),
            )
        else:
            keep.append(code)

    while len(keep) > 1:
        binder = max(keep, key=lambda c: fund_coverage[c].first_date)
        rest = [c for c in keep if c != binder]

        with_weeks = _matrix_coverage(_matrix(long_df, keep)).weekly_observations
        without_weeks = _matrix_coverage(_matrix(long_df, rest)).weekly_observations
        if without_weeks <= with_weeks:
            # Nothing to gain: this fund is not what limits the window.
            break

        loss = 1 - with_weeks / without_weeks
        crosses_threshold = (
            with_weeks < MIN_WEEKLY_OBSERVATIONS <= without_weeks
        )
        if loss <= max_window_loss and not crosses_threshold:
            break

        excluded[binder] = FundExclusion(
            fund_code=binder,
            kind=EXCLUSION_WINDOW_COST,
            reason=(
                f"starts {fund_coverage[binder].first_date.date()}; including "
                f"it would cut the common window from {without_weeks} weeks "
                f"to {with_weeks} weeks ({loss:.0%} shorter)"
            ),
        )
        keep = rest

    return keep, excluded


def _matrix_coverage(wide: pd.DataFrame) -> MatrixCoverage:
    codes = [str(c) for c in wide.columns]
    if wide.empty:
        return MatrixCoverage(codes, None, None, 0, 0)

    idx = pd.DatetimeIndex(wide.index)
    # Distinct calendar weeks with at least one aligned trading day: the
    # effective sample size for anything computed on weekly returns.
    weeks = int(idx.to_period("W").nunique())
    return MatrixCoverage(
        fund_codes=codes,
        start=idx.min(),
        end=idx.max(),
        trading_days=int(len(idx)),
        weekly_observations=weeks,
    )


# ----------------------------------------------------------------------
# Cache
# ----------------------------------------------------------------------


def _cache_path(cache_dir: Path | str, codes: list[str], start, end) -> Path:
    key = "|".join(
        [str(_CACHE_VERSION), ",".join(sorted(codes)), str(start.date()), str(end.date())]
    )
    digest = hashlib.sha1(key.encode()).hexdigest()[:12]
    return Path(cache_dir) / f"prices_{digest}.parquet"


def _read_cache(
    path: Path,
) -> Optional[tuple[pd.DataFrame, dict[str, bool]]]:
    """Return today's cached prices and registry flags, or None.

    Failures are **not** read back, even from files that still carry them.
    Entries written before the split recorded `raw_failures` next to the
    prices under the same day-long TTL, so a fund that happened to be
    rate-limited during one basket was served as "returned no prices" until
    midnight. Such a file is skipped outright rather than partly trusted:
    the prices in it are fine, but the set of codes it claims to have asked
    about is exactly what cannot be believed, and refetching is cheap.

    There is no migration. The entries expire on their own within the day.
    """
    meta_path = path.with_suffix(".json")
    if not path.exists():
        return None

    written = date.fromtimestamp(path.stat().st_mtime)
    if written != date.today():
        logger.info("Cache %s is from %s, refetching", path.name, written)
        return None

    try:
        df = pd.read_parquet(path)
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    except Exception as exc:  # corrupt or half-written cache: just refetch
        logger.warning("Ignoring unreadable cache %s: %s", path.name, exc)
        return None

    if meta.get("raw_failures"):
        logger.info(
            "Cache %s predates the failure split and carries %d cached "
            "failure(s); ignoring it and refetching",
            path.name,
            len(meta["raw_failures"]),
        )
        return None

    logger.info("Loaded %d rows from cache %s", len(df), path.name)
    # Registry flags are cached too, so a cached run diagnoses failures
    # exactly the way the fetching run did.
    return df, meta.get("listed", {})


def _write_cache(
    path: Path,
    long_df: pd.DataFrame,
    listed: dict[str, bool],
) -> None:
    """Persist prices and registry flags. Never failures.

    What goes in here gets a day. Nothing that a single refused request could
    have produced is allowed to earn that, which is why the signature has no
    room for a failure to be passed in by accident.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        long_df.to_parquet(path, index=False)
        path.with_suffix(".json").write_text(
            json.dumps({"listed": listed}, indent=2)
        )
    except Exception as exc:  # a cache we cannot write is not a fatal error
        logger.warning("Could not write cache %s: %s", path.name, exc)


# ----------------------------------------------------------------------
# Absence cache
# ----------------------------------------------------------------------
#
# "TEFAS answered and had nothing for this fund, in this window, minutes
# ago." Keyed per fund and per window rather than per basket, so two baskets
# holding the same empty fund do not each go and ask; keyed on the window
# because a fund with no prices in twelve months may well have some in sixty,
# and a shorter window's silence is not evidence about a longer one.
#
# Best effort throughout. A lost or unwritable file costs one refetch, and
# two processes writing at once may drop an entry — which is also one
# refetch. Nothing here is allowed to fail a request.


def _absence_path(cache_dir: Path | str) -> Path:
    return Path(cache_dir) / ABSENCE_FILE


def _absence_key(code: str, start, end) -> str:
    return f"{code}|{start.date()}|{end.date()}"


def _load_absences(cache_dir: Path | str) -> dict[str, dict]:
    path = _absence_path(cache_dir)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        logger.warning("Ignoring unreadable absence cache: %s", exc)
        return {}


def _recent_absences(
    cache_dir: Path | str, codes: Sequence[str], start, end
) -> dict[str, dict]:
    """The codes among `codes` confirmed empty inside the TTL."""
    stored = _load_absences(cache_dir)
    now = time.time()
    out: dict[str, dict] = {}

    for code in codes:
        entry = stored.get(_absence_key(code, start, end))
        if not entry:
            continue
        if now - entry.get("at", 0) > ABSENCE_TTL_SECONDS:
            continue
        out[code] = {
            k: v for k, v in entry.items() if k != "at"
        }

    if out:
        logger.info(
            "Skipping refetch of %s: TEFAS confirmed empty within the last "
            "%d minutes",
            ", ".join(sorted(out)),
            ABSENCE_TTL_SECONDS // 60,
        )
    return out


def _remember_absences(
    cache_dir: Path | str, raw_failures: dict[str, dict], start, end
) -> None:
    """Record the confirmed-empty codes. Failed requests are dropped.

    The filter is the point of the whole file, so it is done here rather than
    trusted to callers: whatever is handed in, only an answer TEFAS actually
    gave is written down.
    """
    keep = {
        code: info
        for code, info in raw_failures.items()
        if info.get("observed") in ("no_rows", "no_valid_prices")
    }
    dropped = len(raw_failures) - len(keep)
    if dropped:
        logger.info(
            "Not caching %d unanswered request(s); they will be retried", dropped
        )
    if not keep:
        return

    now = time.time()
    stored = _load_absences(cache_dir)
    # Expired entries go on the way past, so the file cannot grow forever.
    stored = {
        key: entry
        for key, entry in stored.items()
        if now - entry.get("at", 0) <= ABSENCE_TTL_SECONDS
    }
    for code, info in keep.items():
        stored[_absence_key(code, start, end)] = {**info, "at": now}

    try:
        path = _absence_path(cache_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(stored, indent=2))
    except Exception as exc:
        logger.warning("Could not write absence cache: %s", exc)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _dedupe(codes: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in codes:
        code = str(raw).strip().upper()
        if code and code not in seen:
            seen.add(code)
            out.append(code)
    return out


def _format_matrix(label: str, cov: MatrixCoverage) -> str:
    if cov.is_empty:
        return f"{label}\n  {len(cov.fund_codes)} funds — no common dates"

    flag = "  ⚠️  below threshold" if cov.below_weekly_threshold else "  ok"
    return (
        f"{label}\n"
        f"  funds ({len(cov.fund_codes)}): {', '.join(cov.fund_codes) or '—'}\n"
        f"  common range: {cov.start.date()} → {cov.end.date()}  "
        f"({cov.trading_days} trading days)\n"
        f"  weekly observations: {cov.weekly_observations} "
        f"(threshold {MIN_WEEKLY_OBSERVATIONS}){flag}"
    )


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------

# Three long-running funds, one 2026 launch, one closed fund, one code that
# was never a fund at all.
DEMO_BASKET = ["GAL", "AFO", "TI2", "KCR", "IAL", "ZZZZ"]


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Print the miru coverage report.")
    parser.add_argument("codes", nargs="*", default=None, help="fund codes (default: demo basket)")
    parser.add_argument("--months", type=int, default=DEFAULT_MONTHS)
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument(
        "--max-window-loss",
        type=float,
        default=MAX_WINDOW_LOSS,
        help="share of the common window a fund may cost before it is excluded",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    ds = load_price_data(
        args.codes or DEMO_BASKET,
        months=args.months,
        use_cache=not args.no_cache,
        max_window_loss=args.max_window_loss,
    )
    print()
    print_coverage_report(ds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
