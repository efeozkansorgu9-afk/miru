"""
Database
========
The Postgres connection and the schema the weekly job writes into.

Three tables, and one rule about how they are replaced. `funds` and
`fund_correlations` are a snapshot, not a log: each run supersedes the last
one entirely. Replacing a snapshot has exactly one safe shape, which is
delete-and-insert inside a single transaction, so a reader either sees all of
the previous run or all of this one and never a half-written mixture.
`job_runs` is the opposite — it is the log, one row per attempt, and it keeps
failures.

The schema is created by `ensure_schema()` at the start of every run rather
than by a migration to apply by hand. It is `CREATE TABLE IF NOT EXISTS`
throughout, so running it against a database that already has the tables is
a no-op, which is what makes the job safe to run twice in a row.

`DATABASE_URL` is read from the environment. There is no default and no
fallback to a local socket: a job that writes a correlation table should
fail loudly when nobody told it where, rather than quietly filling in a
database that happens to be running on the same machine.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Iterator, Optional, Sequence

import psycopg

logger = logging.getLogger(__name__)

DATABASE_URL_ENV_VAR = "DATABASE_URL"

#: Rows per `executemany` batch. The correlation table is ~20 rows per fund
#: over ~1400 funds, so this is a handful of round trips rather than 28,000.
#: `fund_prices` is the big one — ~214 weeks over ~1372 funds, near 300,000
#: rows — and it is batched by the same constant rather than a larger one of
#: its own, because psycopg pipelines an `executemany` and the batching here
#: is about bounding the parameter list, not about round trips.
COPY_BATCH = 5_000


class DatabaseNotConfigured(RuntimeError):
    """`DATABASE_URL` is missing. Raised before anything is fetched."""


def database_url() -> str:
    """The connection string, or a clear error naming what to set."""
    url = os.environ.get(DATABASE_URL_ENV_VAR, "").strip()
    if not url:
        raise DatabaseNotConfigured(
            f"{DATABASE_URL_ENV_VAR} is not set. Point it at the Postgres to "
            "write into, e.g. postgresql://user@localhost:5432/miru"
        )
    return url


@contextmanager
def connect(url: Optional[str] = None) -> Iterator[psycopg.Connection]:
    """One connection, one transaction.

    psycopg3 opens a transaction on the first statement and commits when the
    `with` block leaves without an exception, so the whole weekly write is
    one unit without any explicit BEGIN. Anything raised inside rolls the
    lot back, which is the entire atomicity story for this job.
    """
    conn = psycopg.connect(url or database_url())
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# ----------------------------------------------------------------------
# Schema
# ----------------------------------------------------------------------

# `funds.code` is the natural key and is used as one: `fund_correlations`
# references it on both sides, so a correlation can never name a fund the
# snapshot does not describe. ON DELETE CASCADE is what lets the swap delete
# `funds` and take the correlations with it in one statement.
SCHEMA = """
CREATE TABLE IF NOT EXISTS funds (
    code            text PRIMARY KEY,
    name            text NOT NULL,
    founder         text,
    fund_type       text NOT NULL,
    umbrella_type   text,
    category        text,
    total_assets    numeric,
    investor_count  integer,
    risk_value      smallint,
    stale_ratio     double precision,
    history_weeks   integer,
    included        boolean NOT NULL DEFAULT true,
    exclusion       text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Columns added after the table first shipped. `IF NOT EXISTS` on both the
-- table and the columns is what lets one script serve as both the create and
-- the migration, so a database from any earlier run catches up on the next
-- job rather than needing SQL run by hand.
--
-- The `return_12m_*` / `return_36m_*` columns that used to be here are gone.
-- Two periods were twelve columns, hardcoded in four places (this schema,
-- `replace_snapshot`, `_fund_row`, `_FUND_COLUMNS`) while the writer looped
-- over `RETURN_PERIODS`; four periods would have been twenty-four. They are
-- now rows in `fund_returns`, which makes `RETURN_PERIODS` the single source
-- end to end and adding a period a data change rather than a schema change
-- in four files. Old databases keep the dead columns until someone drops
-- them; nothing reads or writes them.

CREATE TABLE IF NOT EXISTS fund_correlations (
    fund_code       text NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
    neighbour_code  text NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
    correlation     double precision NOT NULL,
    ci_low          double precision,
    ci_high         double precision,
    n_weeks         integer NOT NULL,
    bucket          text NOT NULL,
    direction       text NOT NULL,
    PRIMARY KEY (fund_code, neighbour_code)
);

CREATE INDEX IF NOT EXISTS fund_correlations_fund_dir_idx
    ON fund_correlations (fund_code, direction, correlation DESC);

CREATE INDEX IF NOT EXISTS fund_correlations_bucket_idx
    ON fund_correlations (bucket);

-- One row per fund per return period, replacing twelve columns per period on
-- `funds`. `months` is the period, so the set of periods lives in
-- `src.windows.RETURN_PERIODS` and nowhere else.
--
-- Both figures and both windows sit in one row on purpose: nominal and real
-- are measured over the same days by construction, and splitting them across
-- rows would let a reader join one period's nominal to another's real.
CREATE TABLE IF NOT EXISTS fund_returns (
    fund_code           text NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
    months              integer NOT NULL,
    nominal             double precision,
    real                double precision,
    nominal_unavailable text,
    real_unavailable    text,
    window_start        date,
    window_end          date,
    PRIMARY KEY (fund_code, months)
);

-- The weekly price series, on a complete W-FRI grid.
--
-- Kept so the fund page's chart can be embedded at build time instead of
-- asking for a series at request time. `price` is nullable and the grid is
-- gap-free: a week the fund did not price is an explicit NULL rather than a
-- missing row, because the page implies its dates from a start plus a weekly
-- step, and a missing row would silently shift every later point. A gap has
-- to read as a gap.
CREATE TABLE IF NOT EXISTS fund_prices (
    fund_code   text NOT NULL REFERENCES funds(code) ON DELETE CASCADE,
    week_end    date NOT NULL,
    price       double precision,
    PRIMARY KEY (fund_code, week_end)
);

-- The monthly CPI index, so the inflation line does not need a second source
-- at build time.
--
-- Deliberately **not** part of the snapshot swap below. It describes the
-- country, not this run's fund universe: a run that fetched nothing has no
-- business deleting the index, and the series is append-mostly, so it is
-- upserted by month instead. `month` is the first day of the month, because
-- the published index is a level for the whole month and is never
-- interpolated to a day.
CREATE TABLE IF NOT EXISTS cpi_index (
    month       date PRIMARY KEY,
    index_value double precision NOT NULL,
    series      text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_runs (
    id              bigserial PRIMARY KEY,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    universe_size   integer,
    included_funds  integer,
    pair_count      integer,
    fetch_seconds   double precision,
    compute_seconds double precision,
    duration_seconds double precision,
    status          text NOT NULL,
    detail          text
);

ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS cpi_latest_month date;
"""


def ensure_schema(conn: psycopg.Connection) -> None:
    """Create anything missing. Safe on a database that is already current."""
    with conn.cursor() as cur:
        cur.execute(SCHEMA)


# ----------------------------------------------------------------------
# The weekly write
# ----------------------------------------------------------------------


def replace_snapshot(
    conn: psycopg.Connection,
    funds: Sequence[dict],
    correlations: Sequence[dict],
    returns: Sequence[dict] = (),
    prices: Sequence[dict] = (),
) -> None:
    """Swap in this run's snapshot, wholesale.

    Called inside the caller's transaction, never opening its own: the
    delete and every insert have to land together or not at all. Deleting
    `funds` cascades to the three child tables, so none of them is ever
    briefly pointing at funds that have gone — and, just as important, a
    reader never sees this week's funds beside last week's prices.

    `cpi_index` is deliberately **not** in here. It describes the country
    rather than this run's universe, so a run that fetched nothing has no
    business deleting it; see `upsert_cpi`.

    Nothing here writes `job_runs`. That row records the attempt, including
    the attempts this function never returned from, so it is written on its
    own connection by `record_run`.
    """
    with conn.cursor() as cur:
        # Truncate rather than DELETE: it is one statement, it resets nothing
        # this schema depends on, and CASCADE takes the child tables with it.
        cur.execute("TRUNCATE funds, fund_correlations, fund_returns, fund_prices")

        cur.executemany(
            """
            INSERT INTO funds (
                code, name, founder, fund_type, umbrella_type, category,
                total_assets, investor_count, risk_value, stale_ratio,
                history_weeks, included, exclusion
            ) VALUES (
                %(code)s, %(name)s, %(founder)s, %(fund_type)s,
                %(umbrella_type)s, %(category)s, %(total_assets)s,
                %(investor_count)s, %(risk_value)s, %(stale_ratio)s,
                %(history_weeks)s, %(included)s, %(exclusion)s
            )
            """,
            funds,
        )

        for start in range(0, len(correlations), COPY_BATCH):
            cur.executemany(
                """
                INSERT INTO fund_correlations (
                    fund_code, neighbour_code, correlation, ci_low, ci_high,
                    n_weeks, bucket, direction
                ) VALUES (
                    %(fund_code)s, %(neighbour_code)s, %(correlation)s,
                    %(ci_low)s, %(ci_high)s, %(n_weeks)s, %(bucket)s,
                    %(direction)s
                )
                """,
                correlations[start : start + COPY_BATCH],
            )

        for start in range(0, len(returns), COPY_BATCH):
            cur.executemany(
                """
                INSERT INTO fund_returns (
                    fund_code, months, nominal, real,
                    nominal_unavailable, real_unavailable,
                    window_start, window_end
                ) VALUES (
                    %(fund_code)s, %(months)s, %(nominal)s, %(real)s,
                    %(nominal_unavailable)s, %(real_unavailable)s,
                    %(window_start)s, %(window_end)s
                )
                """,
                returns[start : start + COPY_BATCH],
            )

        for start in range(0, len(prices), COPY_BATCH):
            cur.executemany(
                """
                INSERT INTO fund_prices (fund_code, week_end, price)
                VALUES (%(fund_code)s, %(week_end)s, %(price)s)
                """,
                prices[start : start + COPY_BATCH],
            )

    logger.info(
        "Wrote %d funds, %d neighbour rows, %d return rows, %d weekly prices",
        len(funds),
        len(correlations),
        len(returns),
        len(prices),
    )


def upsert_cpi(conn: psycopg.Connection, rows: Sequence[dict]) -> None:
    """Merge the CPI index in by month.

    Upserted rather than truncated and reinserted, because this table is not
    part of the fund snapshot: the index is a fact about the country, the
    series only ever grows at the end, and a run whose CPI fetch failed
    should leave last week's index alone rather than delete it. Re-stating a
    month is allowed — TÜİK revises — and the newer value wins.
    """
    if not rows:
        logger.info("No CPI rows to write; leaving the stored index alone")
        return

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO cpi_index (month, index_value, series)
            VALUES (%(month)s, %(index_value)s, %(series)s)
            ON CONFLICT (month) DO UPDATE
                SET index_value = EXCLUDED.index_value,
                    series      = EXCLUDED.series,
                    updated_at  = now()
            """,
            rows,
        )
    logger.info("Upserted %d CPI months", len(rows))


def record_run(url: str, **fields) -> None:
    """Append one row to `job_runs`, on its own connection.

    Its own connection on purpose. A failed run has just rolled its snapshot
    transaction back, and the point of this row is to survive that.
    """
    columns = ", ".join(fields)
    placeholders = ", ".join(f"%({k})s" for k in fields)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO job_runs ({columns}) VALUES ({placeholders})", fields
        )


# ----------------------------------------------------------------------
# Reads, for the API
# ----------------------------------------------------------------------

# One connection per request rather than a pool. These endpoints back
# statically generated pages: they are hit by a build, not by traffic, and a
# pool would be a dependency and a lifecycle to get wrong for no gain at this
# volume. If that stops being true, `psycopg_pool` goes here and nothing
# above this line changes.

#: Columns a fund page shows about a fund, whether it is the subject of the
#: page or one of its neighbours. Written once so the two can never drift.
#:
#: The returns arrive as one aggregated JSON array rather than as a column
#: per period. `fund_returns` is one row per period, so a plain join would
#: multiply every fund row by its periods and `fetch_neighbours` would have
#: to regroup twenty neighbours by hand. Aggregating in the subquery keeps
#: the property that mattered: one query for a fund and all its neighbours,
#: not twenty-one.
#:
#: Ordered by `months` inside the aggregate, so the page's rows come out
#: shortest window first without the caller sorting them.
_FUND_COLUMNS = """
    f.code, f.name, f.founder, f.fund_type, f.umbrella_type, f.category,
    f.total_assets, f.investor_count, f.risk_value, f.included,
    (SELECT json_agg(json_build_object(
                'months', r.months,
                'nominal', r.nominal,
                'real', r.real,
                'nominal_unavailable', r.nominal_unavailable,
                'real_unavailable', r.real_unavailable,
                'window_start', r.window_start,
                'window_end', r.window_end
            ) ORDER BY r.months)
       FROM fund_returns r WHERE r.fund_code = f.code) AS returns
"""


def _fund_row(row) -> dict:
    keys = [
        "code", "name", "founder", "fund_type", "umbrella_type", "category",
        "total_assets", "investor_count", "risk_value", "included",
        "returns",
    ]
    out = dict(zip(keys, row))
    # numeric comes back as Decimal; the wire format wants a number.
    if out["total_assets"] is not None:
        out["total_assets"] = float(out["total_assets"])
    # A fund with no stored returns aggregates to NULL, not to an empty
    # array. An empty list is what every caller downstream expects, and it is
    # also the truth: nothing was computed for it.
    out["returns"] = out["returns"] or []
    return out


def fetch_fund(conn: psycopg.Connection, code: str) -> Optional[dict]:
    """One fund's own row, or None when no such code was in the last run."""
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_FUND_COLUMNS} FROM funds f WHERE f.code = %s", (code,))
        row = cur.fetchone()
    return _fund_row(row) if row else None


def fetch_neighbours(conn: psycopg.Connection, code: str) -> list[dict]:
    """A fund's stored neighbours, each carrying its own fund row.

    One query, not one per neighbour: the join is what lets a page show a
    neighbour's size, investor count and returns in a popover without
    twenty more round trips. Ordered strongest first within each direction,
    by the same interval end the bucket is judged on.
    """
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT c.direction, c.correlation, c.ci_low, c.ci_high,
                   c.n_weeks, c.bucket, {_FUND_COLUMNS}
            FROM fund_correlations c
            JOIN funds f ON f.code = c.neighbour_code
            WHERE c.fund_code = %s
            ORDER BY c.direction,
                     CASE WHEN c.direction = 'high' THEN c.ci_low END DESC,
                     CASE WHEN c.direction = 'low'  THEN c.ci_high END ASC
            """,
            (code,),
        )
        rows = cur.fetchall()

    out = []
    for r in rows:
        out.append(
            {
                "direction": r[0],
                "correlation": r[1],
                "ci_low": r[2],
                "ci_high": r[3],
                "n_weeks": r[4],
                "bucket": r[5],
                "fund": _fund_row(r[6:]),
            }
        )
    return out


def fetch_weekly_prices(conn: psycopg.Connection, code: str) -> list[dict]:
    """One fund's weekly series, oldest first, gaps included.

    Rows with a NULL price are returned as they are. The grid is complete by
    construction, and the page implies its dates from the first week plus a
    weekly step, so dropping a blank week here would shift every later point
    and turn a gap into a silent lie about when a price was observed.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT week_end, price FROM fund_prices
            WHERE fund_code = %s ORDER BY week_end
            """,
            (code,),
        )
        return [{"week_end": r[0], "price": r[1]} for r in cur.fetchall()]


def fetch_recent_prices(
    conn: psycopg.Connection, codes: list[str], weeks: int
) -> dict[str, list[dict]]:
    """The last `weeks` weeks of several funds' series, gaps included.

    For the neighbour cards: twenty funds in one query rather than twenty.
    The window ends at the latest week any of them has, which is the run's
    last week for every fund still pricing, so the series share an end and
    the card can lay them against the subject fund's own line by date.
    Blank weeks come back as NULL rows for the same reason as
    `fetch_weekly_prices`: the dates are implied from a start and a step.
    """
    if not codes or weeks <= 0:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT fund_code, week_end, price FROM fund_prices
            WHERE fund_code = ANY(%s)
              AND week_end > (
                  SELECT max(week_end) FROM fund_prices WHERE fund_code = ANY(%s)
              ) - make_interval(weeks => %s)
            ORDER BY fund_code, week_end
            """,
            (codes, codes, weeks),
        )
        out: dict[str, list[dict]] = {}
        for code, week_end, price in cur.fetchall():
            out.setdefault(code, []).append({"week_end": week_end, "price": price})
        return out


def fetch_cpi(conn: psycopg.Connection) -> list[dict]:
    """The stored CPI index, oldest month first.

    One table for the whole site rather than per fund: every fund page draws
    the same inflation line, and it is sixty numbers.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT month, index_value FROM cpi_index ORDER BY month")
        return [{"month": r[0], "index_value": r[1]} for r in cur.fetchall()]


def fetch_last_run(conn: psycopg.Connection) -> Optional[dict]:
    """The most recent successful run, for the freshness line on a page."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT started_at, finished_at, status, universe_size,
                   included_funds, cpi_latest_month
            FROM job_runs WHERE status = 'ok'
            ORDER BY id DESC LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "started_at": row[0],
        "finished_at": row[1],
        "status": row[2],
        "universe_size": row[3],
        "included_funds": row[4],
        "cpi_latest_month": row[5],
    }


def fetch_fund_list(conn: psycopg.Connection) -> list[dict]:
    """Every fund that has a page: code, name, founder.

    Only funds that made it into the correlation matrix. A fund the last run
    could not price has nothing to put on a page, so generating one would
    produce an empty URL that has to 404 later anyway.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT code, name, founder FROM funds
            WHERE included ORDER BY code
            """
        )
        rows = cur.fetchall()
    return [{"code": r[0], "name": r[1], "founder": r[2]} for r in rows]
