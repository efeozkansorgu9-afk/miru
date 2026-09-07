"""
Weekly correlation job
======================
Fetch the tradeable universe, correlate every fund against every other, and
replace the stored snapshot.

    DATABASE_URL=postgresql://user@localhost:5432/miru python -m jobs.weekly

This is a command and only a command. Nothing in `api/` imports it and it
registers no startup hook: a web process that ran this on boot would spend
twenty minutes against TEFAS before serving a request, and would do it again
on every restart and every extra worker.

Order of operations is defensive in one specific way — the database is
checked before TEFAS is touched. A missing `DATABASE_URL` discovered after
a twenty minute fetch is twenty minutes wasted, so `database_url()` is
called on the first line and the run dies there instead.

What survives a failure:

  * One fund's prices failing is not a failure. It is recorded, the fund is
    written with `included = false` and a reason, and it never enters the
    correlation matrix — it is absent from the neighbour table rather than
    present and filtered out later.
  * Anything worse rolls the whole snapshot back. The previous night's
    tables are still there and still consistent, because the swap is one
    transaction.
  * Either way a `job_runs` row is written, on its own connection, so the
    log of a failed run outlives the rollback that erased its work.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from src import db
from src import inflation as inf
from src import precompute as pc
from src import universe as uni
from src.data import _fetch_all
from src.tefas_client import TEFASClient

logger = logging.getLogger("jobs.weekly")

#: Seconds between price requests. `src.data` uses the same pacing.
FETCH_DELAY = 0.5

#: Where `--reuse-prices` parks the fetched frame. A development aid for
#: re-running the write path without spending twenty minutes on TEFAS again;
#: a real scheduled run fetches fresh and never touches this.
PRICE_CACHE = Path("data/cache/weekly_prices.parquet")


def _fetch_prices(
    codes: list[str],
    months: int,
    client: TEFASClient,
    reuse: bool,
) -> tuple[pd.DataFrame, dict[str, dict]]:
    """Prices for the whole universe, tolerating funds that do not answer.

    `_fetch_all` is `src.data`'s own loop and is reused rather than
    reimplemented: it already paces the requests, logs one line per fund,
    and records a failure per code instead of raising. What this job does
    differently is downstream — it never inner-joins the result.
    """
    if reuse and PRICE_CACHE.exists():
        logger.warning("Reusing cached prices from %s (development only)", PRICE_CACHE)
        cached = pd.read_parquet(PRICE_CACHE)
        # The failures travel with the prices. Without them a re-run would
        # call a fund that returned nothing "too_few_returns" instead of
        # "no_prices", and the exclusion column would quietly differ from
        # the run that actually fetched.
        failures = (
            json.loads(PRICE_CACHE.with_suffix(".failures.json").read_text())
            if PRICE_CACHE.with_suffix(".failures.json").exists()
            else {}
        )
        return cached, failures

    end = pd.Timestamp(datetime.now().date())
    start = end - pd.DateOffset(months=months)
    logger.info(
        "Fetching %d funds, %s to %s", len(codes), start.date(), end.date()
    )
    long_df, failures = _fetch_all(codes, start, end, client, FETCH_DELAY)

    if reuse:
        PRICE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        long_df.to_parquet(PRICE_CACHE)
        PRICE_CACHE.with_suffix(".failures.json").write_text(json.dumps(failures))

    return long_df, failures


def _fund_return_table(
    long_df: pd.DataFrame, cpi
) -> dict[str, dict[int, pc.FundReturn]]:
    """Every fund's returns, from the prices already in hand.

    Runs off the same fetch the correlations use, so the windows cost no
    extra TEFAS requests — which is the whole reason this lives in the job
    and not behind the endpoint.
    """
    if long_df.empty:
        return {}
    out: dict[str, dict[int, pc.FundReturn]] = {}
    for code, group in long_df.groupby("fund_code", sort=False):
        series = group.set_index("date")["price"].sort_index()
        out[code] = pc.fund_returns(series, cpi)
    return out


def _fund_rows(
    profiles: list[uni.FundProfile],
    stats: dict[str, pc.FundSeriesStats],
    included: set[str],
    failures: dict[str, dict],
    returns: Optional[dict[str, dict[int, pc.FundReturn]]] = None,
) -> list[dict]:
    """One row per fund in the universe, included or not.

    A fund that never returned prices is still described here. Leaving it
    out would make the table disagree with the universe it claims to be a
    snapshot of, and there would be no way to tell a fund that vanished
    from a fund nobody asked about.
    """
    returns = returns or {}
    rows = []
    for profile in profiles:
        stat = stats.get(profile.code)
        fund_returns = returns.get(profile.code, {})
        row = {
            "code": profile.code,
            "name": profile.name,
            "founder": profile.founder,
            "fund_type": profile.fund_type,
            "umbrella_type": profile.umbrella_type,
            "category": profile.category,
            "total_assets": profile.total_assets,
            "investor_count": profile.investor_count,
            "risk_value": profile.risk_value,
            "stale_ratio": stat.stale_ratio if stat else None,
            "history_weeks": stat.history_weeks if stat else None,
            "included": profile.code in included,
            "exclusion": None
            if profile.code in included
            else _why_excluded(profile.code, stats, failures),
        }
        # One pair of columns per window, flattened: the table is read by
        # SQL far more often than it is written, and a fund page asking for
        # `return_12m_real` beats it unpacking a JSON blob.
        for months in pc.RETURN_PERIODS:
            r = fund_returns.get(months)
            row[f"return_{months}m_nominal"] = r.nominal if r else None
            row[f"return_{months}m_real"] = r.real if r else None
            row[f"return_{months}m_nominal_unavailable"] = (
                r.nominal_unavailable if r else pc.RETURN_NO_HISTORY
            )
            row[f"return_{months}m_real_unavailable"] = (
                r.real_unavailable if r else pc.RETURN_NO_HISTORY
            )
        rows.append(row)
    return rows


def _why_excluded(
    code: str, stats: dict[str, pc.FundSeriesStats], failures: dict[str, dict]
) -> str:
    """A short, closed-set reason. Display text is the frontend's job."""
    observed = failures.get(code, {}).get("observed")
    if observed == "no_rows":
        return "no_prices"
    if observed == "no_valid_prices":
        return "no_valid_prices"
    if code not in stats:
        return "no_weekly_returns"
    return "too_few_returns"


def run(
    months: int = pc.HISTORY_MONTHS,
    limit: Optional[int] = None,
    reuse_prices: bool = False,
    dry_run: bool = False,
) -> int:
    """One end-to-end run. Returns a process exit code."""
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()

    # Before TEFAS, so a misconfigured job fails in a second, not in an hour.
    url = db.database_url()
    thresholds = pc.Thresholds.from_env()
    logger.info("Thresholds: %s", thresholds)

    status, detail = "failed", None
    universe_size = included_count = pair_count = 0
    fetch_seconds = compute_seconds = 0.0
    cpi_latest = None

    try:
        client = TEFASClient()

        logger.info("Loading universe...")
        if limit:
            logger.warning("--limit %d: development run, not a full universe", limit)
        profiles = uni.load_universe(client=client, limit=limit)
        universe_size = len(profiles)
        codes = [p.code for p in profiles]
        logger.info("Universe: %d tradeable funds", universe_size)

        long_df, failures = _fetch_prices(codes, months, client, reuse_prices)
        if reuse_prices:
            long_df = long_df[long_df["fund_code"].isin(set(codes))]
        fetch_seconds = time.perf_counter() - t0
        logger.info(
            "Fetched %d price rows for %d funds in %.1fs",
            len(long_df),
            long_df["fund_code"].nunique() if not long_df.empty else 0,
            fetch_seconds,
        )

        t_compute = time.perf_counter()
        matrix = pc.weekly_return_matrix(long_df)
        if matrix.empty:
            raise RuntimeError("No fund produced weekly returns; refusing to write")

        stats = pc.series_stats(matrix)
        included = set(matrix.columns)

        # The CPI is loaded once for all 1374 funds, not per fund. It never
        # raises: no key, no network or a rejected key all come back None,
        # and every real return then reports `cpi_unavailable` while the
        # nominal ones carry on.
        cpi = inf.load_cpi(months=months + 3)
        if cpi is None:
            logger.warning("No CPI series; real returns will be unavailable")
        else:
            logger.info("CPI: %s", cpi)
            cpi_latest = cpi.latest_month.date()

        returns = _fund_return_table(long_df, cpi)
        included_count = len(included)
        logger.info(
            "Weekly matrix: %d weeks × %d funds (%d of %d funds unusable)",
            len(matrix),
            included_count,
            universe_size - included_count,
            universe_size,
        )

        corr, n, mcodes = pc.pairwise_pearson(matrix)
        ci_low, ci_high = pc.fisher_interval(corr, n)
        stale = np.array([stats[c].stale_ratio for c in mcodes])
        buckets = pc.bucket_matrix(corr, n, ci_low, ci_high, stale, thresholds)
        neighbours = pc.top_neighbours(
            corr, n, ci_low, ci_high, buckets, mcodes, pc.TOP_N
        )
        pair_count = len(neighbours)
        compute_seconds = time.perf_counter() - t_compute
        logger.info(
            "Computed %d pairs, kept %d neighbour rows, in %.2fs",
            included_count * (included_count - 1) // 2,
            pair_count,
            compute_seconds,
        )

        fund_rows = _fund_rows(profiles, stats, included, failures, returns)
        correlation_rows = [vars(row) for row in neighbours]

        if dry_run:
            logger.warning("--dry-run: computed everything, wrote nothing")
            status = "dry_run"
        else:
            with db.connect(url) as conn:
                db.ensure_schema(conn)
                db.replace_snapshot(conn, fund_rows, correlation_rows)
            status = "ok"

    except Exception as exc:  # noqa: BLE001 - recorded, then re-raised as a code
        detail = f"{type(exc).__name__}: {exc}"
        logger.exception("Run failed: %s", detail)

    duration = time.perf_counter() - t0
    try:
        db.record_run(
            url,
            started_at=started,
            finished_at=datetime.now(timezone.utc),
            universe_size=universe_size,
            included_funds=included_count,
            pair_count=pair_count,
            fetch_seconds=round(fetch_seconds, 3),
            compute_seconds=round(compute_seconds, 3),
            duration_seconds=round(duration, 3),
            status=status,
            detail=detail,
            cpi_latest_month=cpi_latest,
        )
    except Exception as exc:  # noqa: BLE001 - the run's own status matters more
        logger.error("Could not record the run: %s", exc)

    logger.info(
        "%s in %.1fs (fetch %.1fs, compute %.2fs)",
        status,
        duration,
        fetch_seconds,
        compute_seconds,
    )
    return 0 if status in ("ok", "dry_run") else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m jobs.weekly",
        description="Precompute fund correlation neighbours into Postgres.",
    )
    parser.add_argument(
        "--months",
        type=int,
        default=pc.HISTORY_MONTHS,
        help=f"History to correlate over (default {pc.HISTORY_MONTHS}).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Development only: take the first N funds of the universe.",
    )
    parser.add_argument(
        "--reuse-prices",
        action="store_true",
        help=f"Development only: cache prices to {PRICE_CACHE} and reuse them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute everything, write nothing but the job_runs row.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    try:
        return run(
            months=args.months,
            limit=args.limit,
            reuse_prices=args.reuse_prices,
            dry_run=args.dry_run,
        )
    except db.DatabaseNotConfigured as exc:
        # A missing variable is a configuration mistake, not a crash. One
        # line naming what to set beats a traceback through psycopg.
        logger.error("%s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
