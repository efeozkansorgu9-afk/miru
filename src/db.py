"""
Database
========
The Postgres connection and the schema the nightly job writes into.

Three tables, and one rule about how they are replaced. `funds` and
`fund_correlations` are a snapshot, not a log: tonight's run supersedes last
night's entirely. Replacing a snapshot has exactly one safe shape, which is
delete-and-insert inside a single transaction, so a reader either sees all of
last night or all of tonight and never a half-written mixture. `job_runs` is
the opposite — it is the log, one row per attempt, and it keeps failures.

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
    `with` block leaves without an exception, so the whole nightly write is
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
"""


def ensure_schema(conn: psycopg.Connection) -> None:
    """Create anything missing. Safe on a database that is already current."""
    with conn.cursor() as cur:
        cur.execute(SCHEMA)


# ----------------------------------------------------------------------
# The nightly write
# ----------------------------------------------------------------------


def replace_snapshot(
    conn: psycopg.Connection,
    funds: Sequence[dict],
    correlations: Sequence[dict],
) -> None:
    """Swap in tonight's snapshot, wholesale.

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
