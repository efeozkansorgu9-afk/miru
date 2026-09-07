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
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_nominal double precision;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_real double precision;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_nominal_unavailable text;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_real_unavailable text;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_nominal double precision;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_real double precision;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_nominal_unavailable text;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_real_unavailable text;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_window_start date;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_12m_window_end date;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_window_start date;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS return_36m_window_end date;

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
) -> None:
    """Swap in this run's snapshot, wholesale.

    Called inside the caller's transaction, never opening its own: the
    delete and both inserts have to land together or not at all. Deleting
    `funds` cascades to `fund_correlations`, so the neighbour table is never
    briefly pointing at funds that have gone.

    Nothing here writes `job_runs`. That row records the attempt, including
    the attempts this function never returned from, so it is written on its
    own connection by `record_run`.
    """
    with conn.cursor() as cur:
        # Truncate rather than DELETE: it is one statement, it resets nothing
        # this schema depends on, and CASCADE takes the child table with it.
        cur.execute("TRUNCATE funds, fund_correlations")

        cur.executemany(
            """
            INSERT INTO funds (
                code, name, founder, fund_type, umbrella_type, category,
                total_assets, investor_count, risk_value, stale_ratio,
                history_weeks, included, exclusion,
                return_12m_nominal, return_12m_real,
                return_12m_nominal_unavailable, return_12m_real_unavailable,
                return_36m_nominal, return_36m_real,
                return_36m_nominal_unavailable, return_36m_real_unavailable,
                return_12m_window_start, return_12m_window_end,
                return_36m_window_start, return_36m_window_end
            ) VALUES (
                %(code)s, %(name)s, %(founder)s, %(fund_type)s,
                %(umbrella_type)s, %(category)s, %(total_assets)s,
                %(investor_count)s, %(risk_value)s, %(stale_ratio)s,
                %(history_weeks)s, %(included)s, %(exclusion)s,
                %(return_12m_nominal)s, %(return_12m_real)s,
                %(return_12m_nominal_unavailable)s, %(return_12m_real_unavailable)s,
                %(return_36m_nominal)s, %(return_36m_real)s,
                %(return_36m_nominal_unavailable)s, %(return_36m_real_unavailable)s,
                %(return_12m_window_start)s, %(return_12m_window_end)s,
                %(return_36m_window_start)s, %(return_36m_window_end)s
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

    logger.info(
        "Wrote %d funds and %d neighbour rows", len(funds), len(correlations)
    )


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
_FUND_COLUMNS = """
    f.code, f.name, f.founder, f.fund_type, f.umbrella_type, f.category,
    f.total_assets, f.investor_count, f.risk_value, f.included,
    f.return_12m_nominal, f.return_12m_real,
    f.return_12m_nominal_unavailable, f.return_12m_real_unavailable,
    f.return_36m_nominal, f.return_36m_real,
    f.return_36m_nominal_unavailable, f.return_36m_real_unavailable,
    f.return_12m_window_start, f.return_12m_window_end,
    f.return_36m_window_start, f.return_36m_window_end
"""


def _fund_row(row) -> dict:
    keys = [
        "code", "name", "founder", "fund_type", "umbrella_type", "category",
        "total_assets", "investor_count", "risk_value", "included",
        "return_12m_nominal", "return_12m_real",
        "return_12m_nominal_unavailable", "return_12m_real_unavailable",
        "return_36m_nominal", "return_36m_real",
        "return_36m_nominal_unavailable", "return_36m_real_unavailable",
        "return_12m_window_start", "return_12m_window_end",
        "return_36m_window_start", "return_36m_window_end",
    ]
    out = dict(zip(keys, row))
    # numeric comes back as Decimal; the wire format wants a number.
    if out["total_assets"] is not None:
        out["total_assets"] = float(out["total_assets"])
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
