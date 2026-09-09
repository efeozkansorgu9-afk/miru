"""
Inflation Layer
===============
Monthly Turkish CPI from the TCMB EVDS service, plus the arithmetic that
restates a nominal value series in today's prices.

This module knows nothing about TEFAS, funds or the UI. It fetches one
series, caches it, and divides. Two things make it different from
`src.data`:

    it never raises on a failed fetch
        No API key, no network, a rejected key or an empty answer all come
        back as `None`. Inflation is an extra column on a screen that works
        without it, so a caller that cannot reach EVDS shows nominal
        numbers and says nothing about real ones.

    it caches for a month, not a day
        CPI is published once a month, on roughly the third day of the
        following month. Refetching daily buys nothing, so the cache stays
        valid until the next release is plausible.

Run it from the command line to see the index and the deflation it implies:

    python -m src.inflation
    python -m src.inflation --months 12

The key is read from the EVDS_API_KEY environment variable (a .env file
next to the project root is picked up if python-dotenv is installed).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional, Sequence

import pandas as pd
import requests

logger = logging.getLogger(__name__)

# EVDS moved off evds2.tcmb.gov.tr/service/evds during 2026; that host now
# answers every request with a redirect to the single page app. This is the
# path the current site itself calls.
EVDS_BASE = "https://evds3.tcmb.gov.tr/igmevdsms-dis"

API_KEY_ENV = "EVDS_API_KEY"

REQUEST_TIMEOUT = 20

# General CPI, most recent base first. Two codes because TUIK rebases the
# index every so often and freezes the old code when it does: TP.FG.J0, the
# code every older example uses, stopped in January 2026 when the 2025=100
# base arrived. Only ratios within one series are ever used, so whichever
# code answers first is as good as the other; the list is here so a future
# rebase degrades to a fallback instead of an empty screen.
CPI_SERIES: tuple[str, ...] = ("TP.TUKFIY2025.GENEL", "TP.GENENDEKS.T1")

# How many months of CPI to load when the caller does not say. Not a history
# window for prices, and not the same quantity as anything in `src.windows`:
# TEFAS gives at most 5 years of prices, so fetching a fixed CPI window a
# little longer than that means every basket, whatever its length, is served
# by one cache entry rather than one per requested period.
#
# Named for what it is. It used to be `HISTORY_MONTHS`, which was also the
# name of the basket window, the scenario check's copy of that, and the
# weekly job's fetch window — four different quantities, one identifier.
CPI_DEFAULT_MONTHS = 72

# TUIK publishes month M in the first days of month M+1. Used both to decide
# when the cache is worth refetching and which month is the latest we should
# expect to have.
RELEASE_DAY = 3

# Same mechanism and same directory as src.data, deliberately: one cache to
# delete. Kept as its own constant so this module does not import the data
# layer, and with it the TEFAS client, for a path.
CACHE_DIR = Path("data/cache")

# Bumped when the cached payload's shape changes, so old files are ignored.
_CACHE_VERSION = 1


# ----------------------------------------------------------------------
# Result types
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class CPISeries:
    """The monthly consumer price index, as published."""

    monthly: pd.Series  # index: month starts, values: index level
    series_code: str
    from_cache: bool

    @property
    def latest_month(self) -> pd.Timestamp:
        return self.monthly.index[-1]

    @property
    def first_month(self) -> pd.Timestamp:
        return self.monthly.index[0]

    def __str__(self) -> str:
        return (
            f"{self.series_code}: {_month_label(self.first_month)} to "
            f"{_month_label(self.latest_month)} ({len(self.monthly)} months)"
        )


@dataclass(frozen=True)
class RealReturn:
    """One nominal value series, restated in the prices of its last month."""

    real_value: pd.Series  # the nominal series in end of window prices
    total: float  # real total return over the window
    annual: float  # real return, annualised
    nominal_total: float
    nominal_annual: float
    inflation_total: float  # cumulative CPI change over the same window
    cpi_start: float
    cpi_end: float
    series_code: str
    latest_cpi_month: pd.Timestamp
    stale_months: int  # months at the end carrying the last published index

    @property
    def is_extrapolated(self) -> bool:
        """True when the window runs past the last published CPI month."""
        return self.stale_months > 0


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------


def load_cpi(
    months: int = CPI_DEFAULT_MONTHS,
    end: Optional[date] = None,
    *,
    api_key: Optional[str] = None,
    use_cache: bool = True,
    cache_dir: Path | str = CACHE_DIR,
    series: Sequence[str] = CPI_SERIES,
) -> Optional[CPISeries]:
    """
    Monthly CPI covering roughly the last `months` months, or None.

    Returns None, having logged the reason, when the key is missing, the
    request fails, the key is rejected or every candidate series comes back
    empty. Callers are expected to carry on without the real numbers rather
    than to handle an exception.

    Parameters
    ----------
    months : int
        How far back to ask. The window is snapped to whole months so that
        the cache key changes monthly rather than daily.
    end : date, optional
        Last month to ask for. Defaults to today.
    api_key : str, optional
        Overrides the EVDS_API_KEY environment variable.
    use_cache : bool
        Read and write the parquet cache under `cache_dir`.
    series : sequence of str
        Candidate series codes, tried in order.
    """
    end_month = _month_start(pd.Timestamp(end or date.today()))
    start_month = end_month - pd.DateOffset(months=max(int(months), 1))

    cache_path = _cache_path(cache_dir, series, start_month, end_month)
    if use_cache:
        cached = _read_cache(cache_path)
        if cached is not None:
            return cached

    key = api_key or _api_key()
    if not key:
        logger.info(
            "%s is not set, so no inflation adjustment is available", API_KEY_ENV
        )
        return None

    for code in series:
        try:
            monthly = _fetch_series(code, start_month, end_month, key)
        except Exception as exc:  # network, timeout, bad JSON, rejected key
            logger.warning("EVDS request for %s failed: %s", code, exc)
            continue

        if monthly.empty:
            logger.warning("EVDS returned no rows for %s, trying the next code", code)
            continue

        cpi = CPISeries(monthly=monthly, series_code=code, from_cache=False)
        if use_cache:
            _write_cache(cache_path, cpi)
        return cpi

    logger.warning("No CPI series returned data; inflation adjustment unavailable")
    return None


def deflate(values: pd.Series, cpi: CPISeries) -> pd.Series:
    """
    Restate a value series in the prices of its own last month.

    Each date takes the index of the month it falls in, held flat across
    that month. Nothing is interpolated between months: the published index
    is a level for the whole month, and drawing a line between two of them
    would invent daily inflation that was never measured.

    Dates past the last published month carry the last published index,
    which is the same as assuming no inflation over those weeks. That
    understates inflation slightly, and `RealReturn.stale_months` exists so
    the caller can say so out loud.
    """
    deflator = _deflator(values.index, cpi)
    return values * (float(deflator.iloc[-1]) / deflator)


def real_return(values: pd.Series, cpi: CPISeries) -> RealReturn:
    """
    Real total and annualised return for a nominal value series.

    Parameters
    ----------
    values : pd.Series
        Nominal basket value, indexed by date, first row the start of the
        window. Only the ends matter for the returns; the whole series is
        deflated for plotting.
    cpi : CPISeries
        As returned by `load_cpi`.

    Raises
    ------
    ValueError
        On an empty series, a non DatetimeIndex, non positive values, or a
        window that starts before the CPI series does. These are caller
        errors rather than the expected "EVDS is unreachable" case, which
        `load_cpi` reports by returning None.
    """
    if not isinstance(values, pd.Series) or values.empty:
        raise ValueError("values must be a non empty Series")
    if not isinstance(values.index, pd.DatetimeIndex):
        raise ValueError("values must be indexed by date (DatetimeIndex)")
    if not values.index.is_monotonic_increasing:
        values = values.sort_index()
    if (values <= 0).any():
        raise ValueError("values must be positive to compute a return")

    deflator = _deflator(values.index, cpi)
    real = values * (float(deflator.iloc[-1]) / deflator)

    nominal_total = float(values.iloc[-1] / values.iloc[0] - 1.0)
    total = float(real.iloc[-1] / real.iloc[0] - 1.0)
    inflation_total = float(deflator.iloc[-1] / deflator.iloc[0] - 1.0)

    years = (values.index[-1] - values.index[0]).days / 365.25
    latest = cpi.latest_month

    return RealReturn(
        real_value=real,
        total=total,
        annual=_annualize(total, years),
        nominal_total=nominal_total,
        nominal_annual=_annualize(nominal_total, years),
        inflation_total=inflation_total,
        cpi_start=float(deflator.iloc[0]),
        cpi_end=float(deflator.iloc[-1]),
        series_code=cpi.series_code,
        latest_cpi_month=latest,
        stale_months=int(
            len({_month_start(d) for d in values.index if _month_start(d) > latest})
        ),
    )


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _api_key() -> Optional[str]:
    """The key from the environment, loading a .env file if one is around."""
    key = os.environ.get(API_KEY_ENV)
    if key:
        return key.strip()

    try:
        from dotenv import load_dotenv
    except ImportError:
        return None

    load_dotenv(_project_root() / ".env")
    key = os.environ.get(API_KEY_ENV)
    return key.strip() if key else None


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _fetch_series(
    code: str,
    start_month: pd.Timestamp,
    end_month: pd.Timestamp,
    key: str,
) -> pd.Series:
    """
    One EVDS series as a monthly index, oldest first.

    The parameters go in the path rather than the query string, which is
    how EVDS is addressed, and the key goes in a header: it stopped being
    accepted as a URL parameter in April 2024.
    """
    url = (
        f"{EVDS_BASE}/series={code}"
        f"&startDate={start_month.strftime('%d-%m-%Y')}"
        f"&endDate={end_month.strftime('%d-%m-%Y')}"
        f"&type=json"
    )
    response = requests.get(url, headers={"key": key}, timeout=REQUEST_TIMEOUT)
    if response.status_code != 200:
        raise RuntimeError(
            f"EVDS answered {response.status_code}: {response.text[:120].strip()}"
        )

    payload = response.json()
    items = payload.get("items") or []
    field = code.replace(".", "_")

    rows: list[tuple[pd.Timestamp, float]] = []
    for item in items:
        raw = item.get(field)
        month = _parse_month(item.get("Tarih"))
        if month is None or raw in (None, "", "null"):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            rows.append((month, value))

    if not rows:
        return pd.Series(dtype="float64")

    monthly = pd.Series(dict(rows)).sort_index()
    monthly.index = pd.DatetimeIndex(monthly.index)
    monthly.name = code
    return monthly


def _parse_month(raw) -> Optional[pd.Timestamp]:
    """EVDS dates a monthly series "2026-8". Anything else is skipped."""
    if not isinstance(raw, str) or "-" not in raw:
        return None
    year, _, month = raw.partition("-")
    try:
        return pd.Timestamp(year=int(year), month=int(month), day=1)
    except (TypeError, ValueError):
        return None


def _deflator(index: pd.DatetimeIndex, cpi: CPISeries) -> pd.Series:
    """
    The CPI level that applies to each date, one step per month.

    `method="ffill"` is what holds a month's index flat across the month and
    then carries the last published one past the end of the series.
    """
    months = pd.DatetimeIndex([_month_start(d) for d in index])
    deflator = cpi.monthly.reindex(months, method="ffill")

    if deflator.isna().any():
        raise ValueError(
            f"CPI starts at {_month_label(cpi.first_month)}, after the window "
            f"begins ({_month_label(months[0])})"
        )

    deflator.index = index
    return deflator


def _annualize(total: float, years: float) -> float:
    if years <= 0 or total <= -1.0:
        return float("nan")
    return float((1.0 + total) ** (1.0 / years) - 1.0)


def _month_start(value) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    return pd.Timestamp(year=ts.year, month=ts.month, day=1)


def _month_label(month: pd.Timestamp) -> str:
    return f"{month.year}-{month.month:02d}"


# ----------------------------------------------------------------------
# Cache
# ----------------------------------------------------------------------


def _cache_path(
    cache_dir: Path | str,
    series: Sequence[str],
    start_month: pd.Timestamp,
    end_month: pd.Timestamp,
) -> Path:
    key = "|".join(
        [
            str(_CACHE_VERSION),
            ",".join(series),
            _month_label(start_month),
            _month_label(end_month),
        ]
    )
    digest = hashlib.sha1(key.encode()).hexdigest()[:12]
    return Path(cache_dir) / f"cpi_{digest}.parquet"


def _read_cache(path: Path) -> Optional[CPISeries]:
    """The cached index if it is still worth trusting, else None."""
    if not path.exists():
        return None

    try:
        df = pd.read_parquet(path)
        meta_path = path.with_suffix(".json")
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    except Exception as exc:  # corrupt or half written cache: just refetch
        logger.warning("Ignoring unreadable cache %s: %s", path.name, exc)
        return None

    if df.empty or "month" not in df or "value" not in df:
        return None

    monthly = pd.Series(df["value"].to_numpy(), index=pd.DatetimeIndex(df["month"]))
    written = date.fromtimestamp(path.stat().st_mtime)
    if not _cache_is_fresh(written, monthly.index[-1], date.today()):
        logger.info("Cache %s is stale (written %s), refetching", path.name, written)
        return None

    logger.info("Loaded %d CPI months from cache %s", len(monthly), path.name)
    return CPISeries(
        monthly=monthly,
        series_code=str(meta.get("series_code", "")),
        from_cache=True,
    )


def _write_cache(path: Path, cpi: CPISeries) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(
            {"month": cpi.monthly.index, "value": cpi.monthly.to_numpy()}
        ).to_parquet(path, index=False)
        path.with_suffix(".json").write_text(
            json.dumps({"series_code": cpi.series_code}, indent=2)
        )
    except Exception as exc:  # a cache we cannot write is not a fatal error
        logger.warning("Could not write cache %s: %s", path.name, exc)


def _cache_is_fresh(written: date, last_month: pd.Timestamp, today: date) -> bool:
    """
    Whether a cache written on `written` still holds the current CPI.

    Two rules. Normally the index is only worth refetching once a release
    could have happened, so a file written on or after the last release date
    is fresh however old it is: through most of a month that is a single
    request. But if the cached payload is already missing the month we
    should have by now, TUIK is late or the fetch was early, and the file
    goes stale the next day instead so the release is picked up promptly.
    """
    expected = _expected_latest_month(today)
    if _month_start(last_month) < expected:
        return written >= today
    return written >= _last_release_date(today)


def _expected_latest_month(today: date) -> pd.Timestamp:
    """The newest month that should already have been published."""
    this_month = pd.Timestamp(year=today.year, month=today.month, day=1)
    back = 1 if today.day >= RELEASE_DAY else 2
    return this_month - pd.DateOffset(months=back)


def _last_release_date(today: date) -> date:
    """The most recent day a release could have landed on."""
    if today.day >= RELEASE_DAY:
        return date(today.year, today.month, RELEASE_DAY)
    previous = pd.Timestamp(year=today.year, month=today.month, day=1) - pd.DateOffset(
        months=1
    )
    return date(previous.year, previous.month, RELEASE_DAY)


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Print the monthly CPI from EVDS.")
    parser.add_argument("--months", type=int, default=24)
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    cpi = load_cpi(months=args.months, use_cache=not args.no_cache)
    if cpi is None:
        print(
            f"No CPI available. Set {API_KEY_ENV} and check the network; "
            f"the log above says which step failed."
        )
        return 1

    print(cpi)
    if cpi.from_cache:
        print("(served from cache)")
    print()
    for month, value in cpi.monthly.items():
        print(f"  {_month_label(month)}  {value:12,.2f}")

    first, last = cpi.monthly.iloc[0], cpi.monthly.iloc[-1]
    months = len(cpi.monthly) - 1
    print()
    print(
        f"Prices rose {(last / first - 1) * 100:.1f}% over these {months} months, "
        f"so 100 lira then buys what {first / last * 100:.2f} lira buys now."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
