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

**0. Know what deploys what.**

Railway builds both services from GitHub `efeozkansorgu9-afk/miru`, and
Vercel builds the frontend from the same repo. **One `git push` to `main`
fires all three.** Nothing below can happen until the code is pushed, and
the push is not a step you can take in the middle — so read to the end
first.

Before pushing, stop Vercel from building: set the project's **Ignored Build
Step** to "Don't build anything". The push then leaves the existing frontend
deployment live, and the commit status reads `Vercel — Canceled by Ignored
Build Step`, which is how you confirm it took. Turn it back off at step 4.

**1. Apply the migration — before the push, not after.**

There is no migration tool. `db.ensure_schema` is `CREATE TABLE IF NOT
EXISTS` plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throughout, and it
runs at the start of every job.

This file used to say that letting step 2 create the schema was "simpler and
equivalent". **It is neither.** The push that delivers the job also
redeploys the API, and the new API reads `fund_returns` in `fetch_fund`. If
that table does not exist yet, `_db` catches the `psycopg.Error` and every
fund page answers **503** until the job commits. Empty tables answer 200
with `returns: []`, which the frontend degrades through quietly. Half an
hour of empty is a missing section; half an hour of 503 is the section, the
page and the build.

Run it against the old container, which still has `DATABASE_URL` and is
still serving. The container is on the old code, so it has no new
`ensure_schema` to call — send it the DDL. `src.db.SCHEMA` is a module-level
string, so it can be lifted out without importing anything:

```bash
# Locally: pull SCHEMA out of the new src/db.py and base64 it.
python -c "
import ast, base64, pathlib
tree = ast.parse(pathlib.Path('src/db.py').read_text())
sql = next(ast.literal_eval(n.value) for n in tree.body
           if isinstance(n, ast.Assign)
           and any(getattr(t,'id',None)=='SCHEMA' for t in n.targets))
print(base64.b64encode(sql.encode()).decode())" > /tmp/schema.b64

# Then apply it inside the container. psycopg commits on a clean `with`.
railway ssh --service miru python -c "
import base64, os, psycopg
sql = base64.b64decode('$(cat /tmp/schema.b64)').decode()
with psycopg.connect(os.environ['DATABASE_URL']) as c:
    with c.cursor() as cur: cur.execute(sql)
print('schema applied')"
```

The DDL is additive and idempotent: no `DROP`, no destructive `ALTER`,
nothing touched on `funds` or `fund_correlations`. Check it landed with
`information_schema.tables` before and after — you want exactly
`cpi_index`, `fund_prices`, `fund_returns` added and the existing row counts
unchanged.

**Applying the migration commits you to the push.** The new tables carry
`REFERENCES funds(code)`, and the *old* job's `replace_snapshot` runs
`TRUNCATE funds, fund_correlations` — which Postgres refuses while a
referencing table exists. So between the migration and the deploy of the new
code, the currently-deployed job cannot write. It fails atomically and the
live snapshot survives, but do not apply the migration and then go home:
Monday's cron would fail. Migration and push are one move.

Nothing needs dropping. The old `return_12m_*` / `return_36m_*` columns on
`funds` are left in place and unread; drop them by hand whenever, or never.

**2. Push, then run the weekly job by hand, once. Do not wait for Monday.**

```bash
git push origin main          # Railway rebuilds miru + weekly; Vercel skips
```

Wait for both Railway services to go green (the commit's statuses,
`diligent-patience - miru` and `- weekly`), then run the job.

**`railway deployment redeploy --service weekly` does not run it.** A cron
service's deployment goes `SUCCESS` while the container stays at `0/1
running` and Railway waits for the next tick — you get a build, not a run,
and no `job_runs` row. There is no CLI command for "fire this cron now".

What works is starting it inside the one container that is already running,
detached so it survives the SSH session:

```bash
railway ssh --service miru python -c "
import subprocess
f = open('/tmp/weekly.log','wb')
p = subprocess.Popen(['python','-u','-m','jobs.weekly'], stdout=f, stderr=f,
                     stdin=subprocess.DEVNULL, cwd='/app', start_new_session=True)
open('/tmp/weekly.pid','w').write(str(p.pid))
print('started', p.pid)"
```

That is the API's container, which is a deviation — the `weekly` service
exists so this does not run next to the API — but it is bounded: the job
peaked at **369 MiB** against the container's 954 MiB limit, and the write
is one transaction, so killing it rolls back and production data is
untouched. Poll `/tmp/weekly.log` and `/sys/fs/cgroup/memory.current`.
When checking whether it is still alive, read `/proc/<pid>/stat` and treat
state `Z` as finished: the job is reparented to PID 1, which does not reap
it, so `os.kill(pid, 0)` keeps succeeding on a zombie long after it exits.

**Budget 35 minutes, not an hour.** Measured over three full-universe runs:
29-31 minutes for ~1375 funds, about 1.05 funds a second, steady throughout.
TEFAS does not throttle this the way `CLAUDE.md` once claimed.

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
see `src/windows.py`. On 2026-09-09 it was 845 of 1366, which is what a
healthy run looks like: the count falls off at 36 and 48 months because
younger funds cannot cover those windows.

**Then check how many funds the run actually kept.**

```sql
SELECT count(*) FILTER (WHERE included) AS included, count(*) AS universe FROM funds;
SELECT coalesce(exclusion,'(none)') AS ex, count(*) FROM funds WHERE NOT included GROUP BY ex;
```

A normal run excludes a handful. If the count is well down on the run before
it, the exclusions are probably not findings about funds at all: grep the log
for `WARNING Request for`. A short burst of `RemoteDisconnected` will take
out whatever was alphabetically under the cursor at the time, and — until the
straggler round in the phase 3 queue lands — those funds are written as
`no_weekly_returns` and **lose their pages for a week**. On 2026-09-09 an
80-second blip cost eight funds, one of them with 120,747 investors.

The exclusion reason does not distinguish these, so the log is the only place
to tell them apart. The remedy is to re-run the job before step 4; the
failures are transient and a second run picks them up. Do not loop on it —
agree a floor and a run count before starting.

**4. Let the frontend build.**

Only now. The build reads `/funds/list` and `/fund/{code}`, and both are
serving the new tables.

Put Vercel's Ignored Build Step back to its normal setting and redeploy. The
code is already on `main` from step 2, so this is a build of a commit that
has been sitting there for half an hour, not a new push. Check afterwards
that the page count matches `included` — `generateStaticParams` reads
`/funds/list`, so a fund excluded at step 3 has no prebuilt page and renders
on demand instead.

## Why not the other order

Deploying the frontend first would serve the new page against an old API
that has no `series` or `cpi` in its payload. That degrades quietly rather
than breaking — `page.series` is null, the chart is skipped — but the
returns block still needs `fund_returns`, so it lands in the same
"hesaplanamadı" state. There is no ordering that lets the frontend go first.
