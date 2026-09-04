"""
Data Layer
==========
Turns a list of fund codes into aligned price matrices plus a coverage
report. This module answers only "which funds do we have, over which common
window, and how much of that window is usable" — no analysis, no UI.

Two matrices are always produced and neither is preferred:

    full     every code that returned data, on their common dates
    trimmed  only the funds that cover the whole requested window,
             on *their* common dates

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
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional, Sequence

import pandas as pd

from src.tefas_client import DateLike, TEFASClient, _parse_date

logger = logging.getLogger(__name__)

# Correlation estimates built on fewer weekly observations than this carry
# confidence intervals too wide to act on. We only report the count and the
# flag — hiding data or raising on it is the UI layer's call, not ours.
MIN_WEEKLY_OBSERVATIONS = 100

# A fund whose first price lands within this many days of the requested start
# still counts as covering the window; the slack absorbs weekends, public
# holidays and TEFAS's publishing lag. Same slack applies at the recent end.
COVERAGE_TOLERANCE_DAYS = 7

# Why a fund produced nothing. Prose is for the report; the tag is what the
# UI branches on — "no such fund" and "this fund closed" are different things
# to tell someone.
FAILURE_UNKNOWN_CODE = "unknown_code"
FAILURE_NO_PRICES_IN_WINDOW = "no_prices_in_window"
FAILURE_NO_VALID_PRICES = "no_valid_prices"
FAILURE_UNVERIFIED = "no_data_unverified"

# How far back the TEFAS price endpoint reaches; a fund delisted before this
# is indistinguishable from a code that never existed.
PRICE_HISTORY_YEARS = 5

DEFAULT_MONTHS = 36

CACHE_DIR = Path("data/cache")

# Bumped when the cached payload's shape changes, so old files are ignored
# instead of misread.
_CACHE_VERSION = 2


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

    @property
    def span_days(self) -> int:
        return int((self.last_date - self.first_date).days)


@dataclass(frozen=True)
class FundFailure:
    """A code that produced no usable series, and why."""

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
    excluded_codes: dict[str, str]
    failed_codes: dict[str, FundFailure]
    requested_codes: list[str]
    requested_start: pd.Timestamp
    requested_end: pd.Timestamp
    from_cache: bool = False
    fund_names: dict[str, str] = field(default_factory=dict)

    @property
    def ok_codes(self) -> list[str]:
        """Codes that returned usable data, in the order requested."""
        return [c for c in self.requested_codes if c not in self.failed_codes]


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
) -> FundDataset:
    """
    Fetch each fund, align the series and report coverage.

    Parameters
    ----------
    fund_codes : sequence of str
        Fund codes to fetch. Duplicates are dropped, order is preserved.
    months : int
        How much history to ask for, counted back from `end_date`.
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
    start = end - pd.DateOffset(months=months)

    cache_path = _cache_path(cache_dir, codes, start, end)
    cached = _read_cache(cache_path) if use_cache else None

    if cached is not None:
        long_df, raw_failures, listed, from_cache = *cached, True
    else:
        client = client or TEFASClient()
        long_df, raw_failures = _fetch_all(codes, start, end, client, delay)
        listed = _registry_flags(client, codes, long_df, raw_failures)
        from_cache = False
        if use_cache:
            _write_cache(cache_path, long_df, raw_failures, listed)

    return _build(
        long_df=long_df,
        raw_failures=raw_failures,
        listed=listed,
        codes=codes,
        start=start,
        end=end,
        from_cache=from_cache,
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
    add("=" * 72)

    add("")
    add("Per fund")
    add(f"  {'code':<6} {'first':<12} {'last':<12} {'rows':>6}  name")
    for code in ds.requested_codes:
        cov = ds.fund_coverage.get(code)
        if cov is None:
            failure = ds.failed_codes.get(code)
            label = f"[{failure.kind}] {failure.reason}" if failure else "no data"
            add(f"  {code:<6} {'—':<12} {'—':<12} {0:>6}  FAILED {label}")
            continue
        add(
            f"  {code:<6} {cov.first_date.date()!s:<12} {cov.last_date.date()!s:<12} "
            f"{cov.row_count:>6}  {cov.fund_name[:34]}"
        )

    add("")
    add(_format_matrix("FULL     (all codes with data, inner join)", ds.full_coverage))
    add(_format_matrix("TRIMMED  (funds covering the whole window)", ds.trimmed_coverage))

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
        for code, reason in ds.excluded_codes.items():
            add(f"  {code:<6} {reason}")
    else:
        add("Dropped from TRIMMED: none")

    add("=" * 72)
    return "\n".join(lines)


def print_coverage_report(ds: FundDataset) -> None:
    print(format_coverage_report(ds))


# ----------------------------------------------------------------------
# Fetching
# ----------------------------------------------------------------------


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
    """
    frames: list[pd.DataFrame] = []
    raw: dict[str, dict] = {}

    for i, code in enumerate(codes, 1):
        logger.info("Fetching %s (%d/%d)", code, i, len(codes))
        df = client.get_fund_history(code, start.date(), end.date())

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
) -> FundDataset:
    fund_coverage = _per_fund_coverage(long_df, codes)
    fund_names = {c: cov.fund_name for c, cov in fund_coverage.items()}

    ok = [c for c in codes if c in fund_coverage]
    full = _matrix(long_df, ok)

    keep, excluded = _split_by_window(fund_coverage, ok, start, listed)
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

        if observed == "no_valid_prices":
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


def _per_fund_coverage(long_df: pd.DataFrame, codes: list[str]) -> dict[str, FundCoverage]:
    if long_df.empty:
        return {}

    out: dict[str, FundCoverage] = {}
    for code, grp in long_df.groupby("fund_code", sort=False):
        if code not in codes:
            continue
        names = grp["fund_name"].dropna()
        out[code] = FundCoverage(
            fund_code=code,
            fund_name=str(names.iloc[-1]) if len(names) else code,
            first_date=grp["date"].min(),
            last_date=grp["date"].max(),
            row_count=int(len(grp)),
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
    start: pd.Timestamp,
    listed: dict[str, bool],
) -> tuple[list[str], dict[str, str]]:
    """
    Keep the funds that cover the whole requested window.

    Intentionally not the longest-common-window subset search: a fund is
    either long enough on its own or it is out, so the rule stays explainable
    to whoever reads the report.
    """
    tolerance = pd.Timedelta(days=COVERAGE_TOLERANCE_DAYS)
    required_start = start + tolerance

    # The recent edge is set by the data, not the calendar: today may be a
    # weekend and TEFAS publishes with a lag.
    latest = max((c.last_date for c in fund_coverage.values()), default=None)

    keep: list[str] = []
    excluded: dict[str, str] = {}

    for code in codes:
        cov = fund_coverage[code]
        if cov.first_date > required_start:
            excluded[code] = (
                f"starts {cov.first_date.date()}, after the requested {start.date()} "
                f"(short history)"
            )
        elif latest is not None and cov.last_date < latest - tolerance:
            # This is the closure the data *can* prove: the fund traded, then
            # stopped. If the registry has also dropped it, it is delisted
            # rather than merely suspended.
            gone = listed.get(code)
            state = {True: "still listed, suspended?", False: "delisted"}.get(
                gone, "registry unverified"
            )
            excluded[code] = (
                f"last price {cov.last_date.date()}, stale against "
                f"{latest.date()} ({state})"
            )
        else:
            keep.append(code)

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
) -> Optional[tuple[pd.DataFrame, dict[str, dict], dict[str, bool]]]:
    """Return the cached frame if it was written today, else None."""
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

    logger.info("Loaded %d rows from cache %s", len(df), path.name)
    # Registry flags are cached too, so a cached run diagnoses failures
    # exactly the way the fetching run did.
    return df, meta.get("raw_failures", {}), meta.get("listed", {})


def _write_cache(
    path: Path,
    long_df: pd.DataFrame,
    raw_failures: dict[str, dict],
    listed: dict[str, bool],
) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        long_df.to_parquet(path, index=False)
        path.with_suffix(".json").write_text(
            json.dumps({"raw_failures": raw_failures, "listed": listed}, indent=2)
        )
    except Exception as exc:  # a cache we cannot write is not a fatal error
        logger.warning("Could not write cache %s: %s", path.name, exc)


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
    parser = argparse.ArgumentParser(description="Print the FonRadar coverage report.")
    parser.add_argument("codes", nargs="*", default=None, help="fund codes (default: demo basket)")
    parser.add_argument("--months", type=int, default=DEFAULT_MONTHS)
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    ds = load_price_data(
        args.codes or DEMO_BASKET,
        months=args.months,
        use_cache=not args.no_cache,
    )
    print()
    print_coverage_report(ds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
