# Deployment

## The ordering problem

The fund page reads three tables that did not exist before phase 2.3:
`fund_returns`, `fund_prices` and `cpi_index`. They are filled by
`jobs.weekly`, which runs on a cron at 03:00 on Mondays. Vercel regenerates
the fund pages statically once a day.

So the schema arriving is not the same event as the data arriving. If a
frontend build happens in between — and one happens within a day of any
deploy, whether or not anybody asks for it — every fund page renders with
`fund_returns` empty. `FundIdentity.from_row` gets `returns: []`,
`periodOptions` marks all four periods unavailable, and the whole Getiri
section says "Bu fonun getirisi hesaplanamadı." on all 1372 pages until the
next Monday.

That is a visible regression with a week-long tail, produced by deploying in
the obvious order. The steps below are the order that avoids it.

## Steps, in order

**1. Apply the migration.**

There is no migration tool. `db.ensure_schema` is `CREATE TABLE IF NOT
EXISTS` plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throughout, and it
runs at the start of every job, so the schema arrives with step 2 and needs
no separate action. If you want it applied on its own first:

```bash
DATABASE_URL=... python -c "from src import db; \
  conn = db.connect.__wrapped__(db.database_url()).__enter__(); \
  db.ensure_schema(conn); conn.commit()"
```

Simpler and equivalent: let step 2 create it.

Nothing needs dropping. The old `return_12m_*` / `return_36m_*` columns on
`funds` are left in place and unread; drop them by hand whenever, or never.

**2. Run the weekly job by hand, once. Do not wait for Monday.**

On Railway, against the production database:

```bash
python -m jobs.weekly
```

This is the step the whole ordering exists for. It creates the schema, writes
the snapshot and fills all three new tables in one transaction. Budget an
hour: it is ~1374 TEFAS requests, and TEFAS throttles.

**Do not run this locally.** See the rule in `CLAUDE.md`.

**3. Verify all three tables are filled — before touching the frontend.**

```sql
SELECT 'funds',         count(*) FROM funds
UNION ALL SELECT 'fund_returns', count(*) FROM fund_returns
UNION ALL SELECT 'fund_prices',  count(*) FROM fund_prices
UNION ALL SELECT 'cpi_index',    count(*) FROM cpi_index;

-- Every fund should have one row per period, and most of them a figure.
SELECT months, count(*) AS rows, count(nominal) AS with_figure
FROM fund_returns GROUP BY months ORDER BY months;
```

Expect roughly: `funds` ~1374, `fund_returns` = included funds × 4,
`fund_prices` = included funds × ~214, `cpi_index` ~72. The per-period counts
should show every period with a row for every fund and a figure for most —
`with_figure` falls off at 36 and 48 months because younger funds legitimately
cannot cover those windows.

If `fund_returns` is empty, **stop**. Deploying the frontend now is the
regression this document exists to prevent.

Also worth one check, because it is the failure this release fixed:

```sql
SELECT count(*) FROM fund_returns WHERE months = 36 AND nominal IS NOT NULL;
```

If that is zero while `funds` is full, the fetch window is too short again —
see `src/windows.py`.

**4. Deploy the frontend and regenerate the pages.**

Only now. The build reads `/funds/list` and `/fund/{code}`, and both are
serving the new tables.

## Why not the other order

Deploying the frontend first would serve the new page against an old API
that has no `series` or `cpi` in its payload. That degrades quietly rather
than breaking — `page.series` is null, the chart is skipped — but the
returns block still needs `fund_returns`, so it lands in the same
"hesaplanamadı" state. There is no ordering that lets the frontend go first.
