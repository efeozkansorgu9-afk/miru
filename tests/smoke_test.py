"""
Smoke test for TEFAS data collection.
=====================================
Fetches the last year of price data for a handful of funds and reports
row counts, date coverage and gaps.

Run:
    .venv/bin/python tests/smoke_test.py
    .venv/bin/python tests/smoke_test.py GAL AES IPB
"""

import os
import sys
from datetime import date, timedelta

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.tefas_client import TEFASClient, TEFASRequestError

# One fund per category from TEFASClient.POPULAR_FUNDS
DEFAULT_FUNDS = ["TI2", "AK2", "AFO", "GAL", "IPB"]

LOOKBACK_DAYS = 365

# Gaps longer than this are worth a closer look; shorter ones are almost
# always Turkish public holidays (bayram, national days).
GAP_WARN_BUSINESS_DAYS = 3


def find_gaps(dates: pd.Series) -> list[tuple[pd.Timestamp, pd.Timestamp, int]]:
    """Return (before, after, missing_business_days) for every gap in the series."""
    gaps = []
    for prev, curr in zip(dates, dates[1:]):
        # Business days strictly between the two observations
        missing = len(pd.bdate_range(prev, curr)) - 2
        if missing > 0:
            gaps.append((prev, curr, missing))
    return gaps


def check_fund(client: TEFASClient, fund_code: str, start: date, end: date) -> bool:
    """Fetch one fund and print its coverage report. Returns True if healthy."""
    print(f"\n{'=' * 60}")
    print(f"  {fund_code} - {client.POPULAR_FUNDS.get(fund_code, '?')}")
    print("=" * 60)

    # Two different failures, reported as two. `fetch_history` raises when
    # the request did not complete and returns empty only when TEFAS
    # answered with nothing, so a smoke test can finally say which happened
    # instead of printing "no rows" at a rate limit.
    try:
        df = client.fetch_history(fund_code, start, end)
    except TEFASRequestError as exc:
        print(f"  FAIL  request did not complete: {exc}")
        return False
    except Exception as exc:
        print(f"  FAIL  fetch raised {type(exc).__name__}: {exc}")
        return False

    if df.empty:
        print("  FAIL  TEFAS answered with no rows for this window")
        return False

    first, last = df["date"].iloc[0], df["date"].iloc[-1]
    expected_bdays = len(pd.bdate_range(first, last))

    print(f"  rows            : {len(df)}")
    print(f"  date range      : {first.date()} -> {last.date()} ({(last - first).days} calendar days)")
    print(f"  business days   : {expected_bdays} expected in range, {len(df)} present")

    ok = True

    # Duplicate dates
    dupes = df["date"].duplicated().sum()
    print(f"  duplicate dates : {dupes}")
    if dupes:
        ok = False

    # Empty / unusable prices
    nulls = df["price"].isna().sum()
    nonpositive = (df["price"] <= 0).sum()
    print(f"  null prices     : {nulls}")
    print(f"  non-positive    : {nonpositive}")
    if nulls or nonpositive:
        ok = False

    # Missing days inside the range
    gaps = find_gaps(df["date"])
    total_missing = sum(g[2] for g in gaps)
    print(f"  missing bdays   : {total_missing} across {len(gaps)} gap(s)")

    notable = [g for g in gaps if g[2] >= GAP_WARN_BUSINESS_DAYS]
    if notable:
        print(f"  gaps >= {GAP_WARN_BUSINESS_DAYS} bdays :")
        for prev, curr, missing in notable:
            print(f"      {prev.date()} -> {curr.date()}  ({missing} business days missing)")
    elif gaps:
        print("                    (all gaps are 1-2 days, likely public holidays)")

    # Coverage sanity: a healthy year should be somewhere near 250 trading days
    coverage = len(df) / expected_bdays if expected_bdays else 0
    print(f"  coverage        : {coverage:.1%} of business days")
    if coverage < 0.90:
        print("  FAIL  coverage below 90%")
        ok = False

    print(f"  status          : {'OK' if ok else 'FAIL'}")
    return ok


def main(argv: list[str]) -> int:
    funds = argv[1:] or DEFAULT_FUNDS

    end = date.today()
    start = end - timedelta(days=LOOKBACK_DAYS)

    print("miru - TEFAS smoke test")
    print(f"window : {start} -> {end} ({LOOKBACK_DAYS} days)")
    print(f"funds  : {', '.join(funds)}")

    client = TEFASClient()
    results = {code: check_fund(client, code, start, end) for code in funds}

    passed = [c for c, ok in results.items() if ok]
    failed = [c for c, ok in results.items() if not ok]

    print(f"\n{'=' * 60}")
    print(f"  {len(passed)}/{len(results)} funds OK")
    if failed:
        print(f"  failed: {', '.join(failed)}")
    print("=" * 60)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
