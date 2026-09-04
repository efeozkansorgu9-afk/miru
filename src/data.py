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

DEFAULT_MONTHS = 36

CACHE_DIR = Path("data/cache")

# Bumped when the cached payload's shape changes, so old files are ignored
# instead of misread.
_CACHE_VERSION = 1


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
    failed_codes: dict[str, str]
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
    long_df, failed, from_cache = _read_cache(cache_path) if use_cache else (None, None, False)

    if long_df is None:
        long_df, failed = _fetch_all(codes, start, end, client or TEFASClient(), delay)
        if use_cache:
            _write_cache(cache_path, long_df, failed)

    return _build(
        long_df=long_df,
        failed_codes=failed,
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
            reason = ds.failed_codes.get(code, "no data")
            add(f"  {code:<6} {'—':<12} {'—':<12} {0:>6}  FAILED: {reason}")
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
        for code, reason in ds.failed_codes.items():
            add(f"  {code:<6} {reason}")
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
) -> tuple[pd.DataFrame, dict[str, str]]:
    """Fetch every code, keeping the ones that fail instead of dropping them."""
    frames: list[pd.DataFrame] = []
    failed: dict[str, str] = {}

    for i, code in enumerate(codes, 1):
        logger.info("Fetching %s (%d/%d)", code, i, len(codes))
        df = client.get_fund_history(code, start.date(), end.date())

        if df.empty:
            # TEFASClient returns an empty frame both for a transport error
            # and for a code TEFAS does not know; we cannot tell them apart
            # from here, so say what we observed rather than guess a cause.
            failed[code] = "no rows returned (closed fund, invalid code, or fetch error)"
        else:
            usable = df[df["price"].notna() & (df["price"] > 0)]
            if usable.empty:
                failed[code] = f"{len(df)} rows returned but no valid prices"
            else:
                frames.append(usable)

        if i < len(codes):
            time.sleep(delay)

    if not frames:
        return _empty_long(), failed

    return pd.concat(frames, ignore_index=True), failed


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
    failed_codes: dict[str, str],
    codes: list[str],
    start: pd.Timestamp,
    end: pd.Timestamp,
    from_cache: bool,
) -> FundDataset:
    fund_coverage = _per_fund_coverage(long_df, codes)
    fund_names = {c: cov.fund_name for c, cov in fund_coverage.items()}

    ok = [c for c in codes if c in fund_coverage]
    full = _matrix(long_df, ok)

    keep, excluded = _split_by_window(fund_coverage, ok, start)
    trimmed = _matrix(long_df, keep)

    return FundDataset(
        full=full,
        trimmed=trimmed,
        full_coverage=_matrix_coverage(full),
        trimmed_coverage=_matrix_coverage(trimmed),
        fund_coverage=fund_coverage,
        excluded_codes=excluded,
        failed_codes={c: failed_codes.get(c, "no data") for c in codes if c not in fund_coverage},
        requested_codes=codes,
        requested_start=start,
        requested_end=end,
        from_cache=from_cache,
        fund_names=fund_names,
    )


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
            excluded[code] = (
                f"last price {cov.last_date.date()}, stale against {latest.date()}"
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


def _read_cache(path: Path) -> tuple[Optional[pd.DataFrame], Optional[dict[str, str]], bool]:
    """Return the cached frame if it was written today, else nothing."""
    meta_path = path.with_suffix(".json")
    if not path.exists():
        return None, None, False

    written = date.fromtimestamp(path.stat().st_mtime)
    if written != date.today():
        logger.info("Cache %s is from %s, refetching", path.name, written)
        return None, None, False

    try:
        df = pd.read_parquet(path)
        failed = json.loads(meta_path.read_text())["failed_codes"] if meta_path.exists() else {}
    except Exception as exc:  # corrupt or half-written cache: just refetch
        logger.warning("Ignoring unreadable cache %s: %s", path.name, exc)
        return None, None, False

    logger.info("Loaded %d rows from cache %s", len(df), path.name)
    return df, failed, True


def _write_cache(path: Path, long_df: pd.DataFrame, failed: dict[str, str]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        long_df.to_parquet(path, index=False)
        path.with_suffix(".json").write_text(json.dumps({"failed_codes": failed}, indent=2))
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

# Three long-running funds, one 2026 launch, one code TEFAS does not know.
DEMO_BASKET = ["GAL", "AFO", "TI2", "KCR", "ZZZZ"]


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
