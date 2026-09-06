# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FonRadar tells someone which of the funds in their basket are really one holding. It fetches historical prices from the TEFAS (Turkey Electronic Fund Trading Platform) API, analyses a basket in Python (`src/`), serves that over HTTP (`api/`), and presents it in a Next.js frontend (`web/`), which is the only user interface. The notebooks in `notebooks/` are for exploration, not part of the product.

## Setup and Commands

```bash
# Dependencies live in .venv (note the dot) — not venv/, which is stale
source .venv/bin/activate
pip install -r requirements.txt

# Fetch fund data
python -m src.tefas_client

# Verify data collection still works (row counts, date coverage, gaps)
python tests/smoke_test.py
python tests/smoke_test.py GAL AFO      # specific funds

# Print the coverage report for a basket (which funds, what common window)
python -m src.data                      # demo basket
python -m src.data GAL AFO TI2 --months 36

# Run analysis notebook
jupyter notebook notebooks/01_data_collection_and_exploration.ipynb

# Print the CPI index and the inflation it implies (needs EVDS_API_KEY)
python -m src.inflation
python -m src.inflation --months 12 --no-cache

# Run the API the frontend calls
uvicorn api.main:app --reload --port 8000

# Run the frontend (needs the API above; expects it on :8000)
cd web && npm install && npm run dev
```

There is no linter or build system configured. The only test is `tests/smoke_test.py`.

## Architecture

**`src/tefas_client.py`** - Single module containing `TEFASClient`, a thin wrapper over the `tefas-crawler` package:
- `__init__()` - Creates the underlying `tefas.Crawler`. Takes no arguments.
- `get_fund_history(fund_code, start_date, end_date)` - Fetches one fund in a single request. Dates accept `DD.MM.YYYY`, `YYYY-MM-DD`, `date` or `datetime`; defaults to the last 365 days. Returns an empty DataFrame (not an exception) when a fund has no data.
- `get_multiple_funds(fund_codes, start_date, end_date, delay)` - Batch fetch with a 0.5s delay between requests. Defaults to `POPULAR_FUNDS`.
- `list_funds(refresh)` - Code to title for every fund TEFAS currently lists (~2578), across all three fund kinds. Cached for the client's lifetime; raises `RuntimeError` rather than returning a partial registry.
- `list_fund_codes(refresh)` - The same registry as a set of codes; thin wrapper over `list_funds`.
- `_fetch_fund_codes(kind, islem)` - One page of the fund registry, as code to title. Both `islem` values are needed: neither alone lists every fund.
- `_clean(df, fund_code)` - Renames crawler columns to the project schema, parses dates, deduplicates, sorts.
- `_parse_date(value)` - Module-level date coercion helper.
- `POPULAR_FUNDS` - Dict of 14 fund codes across 7 categories (Equity, Bond, Gold, Money Market, Variable, Commodity, Hedge). Titles were verified against live TEFAS data on 2026-09-04.
- `main()` - Entry point that fetches all popular funds and saves to `data/fund_data.csv`

Output schema: `date, fund_code, fund_name, price, category_rank, category_total`.

**`src/data.py`** - Data layer. Turns fund codes into aligned price matrices and a coverage report; contains no analysis or UI logic and does not import `tefas` directly.
- `load_price_data(fund_codes, months, end_date, client, use_cache, cache_dir, delay)` - The entry point. Returns a `FundDataset`.
- `FundDataset` - `full` (every code that returned data, on their common dates) and `trimmed` (the funds worth their cost to the window, on theirs). Both are always produced; choosing between them is the UI's job. Plus `fund_coverage`, `excluded_codes`, `failed_codes`, `notes`.
- `FundCoverage` - Per fund: first/last date, row count, and `coverage_ratio` (rows over business days in the fund's own range) with `is_sparse`.
- `MatrixCoverage` - Per matrix: common range, trading days, `weekly_observations`, `below_weekly_threshold`.
- `FundFailure` - `kind` + `reason` for a code that returned nothing. Kinds: `unknown_code`, `no_prices_in_window`, `no_valid_prices`, `no_data_unverified`.
- `FundExclusion` - `kind` + `reason` for a fund that returned prices but is still left out of `trimmed`. Kinds: `stale_series` (its prices stopped early) and `window_cost` (including it would shorten the window the rest share). `str()` gives the reason, so it prints like the string it replaced.
- `format_coverage_report(ds)` / `print_coverage_report(ds)` - Plain-text report.
- `main()` - CLI entry point; `python -m src.data [CODES...] [--months N] [--no-cache]`.

**`src/analysis.py`** - Analysis layer. Pure portfolio maths over a price matrix plus either a weights dict or a list of dated purchases; imports neither `tefas` nor `src.data`, prints nothing, persists nothing.
- `analyze_basket(prices, weights=None, *, purchases=None)` - Returns a `BasketAnalysis`: correlation matrix (`None` for a single fund), rank correlation matrix, diversification ratio, basket and per-fund annualised volatility, max drawdown, weekly observation count. Exactly one of `weights` (a basket bought in one go, described by what sits in it) or `purchases` (dated deposits).
- `BasketAnalysis.rank_correlation` - Spearman over the same weekly returns, alongside the Pearson `correlation`. Grouping does not use it and is not meant to: `find_fund_groups` takes `correlation`, so nothing about a group, a weight or a headline moves because this exists. It is there to be differenced against Pearson, because the two parting company on a pair means a few weeks are carrying that pair's coefficient. Computed with `DataFrame.corr(method="spearman")`; `Series.corr` would route Spearman through `scipy`, which is not a dependency.
- Measured over 406 pairs (29 funds, 260 weekly observations, five years to 2026-09-04): pairs at or above the grouping threshold agree to a **median of 0.005 and a maximum of 0.051**, so Spearman would not regroup anything. The gap lives in mid-range pairs, where Pearson sits between 0.2 and 0.6: median **0.163**, pool maximum **0.190**, and nothing anywhere exceeded 0.20. It is one-sided: Pearson reads higher than Spearman on 75% of pairs.
- The gap is an extreme-week effect, checked rather than assumed. On the four widest pairs, removing the **single** week of 2021-12-24 (the lira reversal: gold funds about -24% and equity about -20% in one week) drops Pearson from 0.26-0.27 to 0.12-0.14 and leaves Spearman within 0.01 of where it was, closing about two thirds of the gap; removing a randomly chosen week instead moves Pearson by 0.010 or less. The same mechanism runs the other way: GAL/AAL reads 0.891 Pearson against 0.942 Spearman, and dropping two odd weeks takes Pearson to 0.981.
- `build_purchase_plan(prices, purchases)` - Staged buying. Takes `Purchase` objects, `(date, fund_code, amount)` triples or `(date, fund_code, amount, basis)` quadruples, sums units per fund and marks them at the last priced day. Returns a `PurchasePlan`: `fills`, `units`, `market_value`, `total_invested`, `total_value`, `absolute_gain`, `xirr`, and `value_series`. Buys only — a non-positive amount is rejected rather than read as a sale.
- `xirr(cashflows)` - The annual rate that discounts dated flows to zero, by bisection. Returns **`None`**, never a made-up number, when the flows admit no rate (one day, one sign, one flow) or the solve leaves `XIRR_BOUNDS`.
- `held_value_series(prices, units)` - Buy-and-hold value of a fixed unit holding, normalised to 1.0. The staged-purchase counterpart to `basket_value_series`.
- `find_fund_groups(correlation, weights, threshold=GROUP_THRESHOLD)` - Sets of funds where *every* pair clears the threshold (maximal cliques, not chains). Returns a `GroupingResult` of `FundGroup`s (codes, weight, weakest pair) heaviest first, plus `standalone` funds. A fund in several cliques is reported once, in the heaviest, so weights never exceed 100%. No groups is a normal result, not an error.
- `find_rank_gaps(correlation, rank_correlation, threshold=RANK_GAP_THRESHOLD)` - Pairs the two measures disagree about, widest first, `RankGap` each (codes, both coefficients, signed `gap`). Empty is the common result. Reports only: grouping never sees the rank matrix. Grouped pairs are **not** filtered out, even though at the default threshold none has ever appeared: if one ever does disagree this much, that is the case worth seeing.
- `RANK_GAP_THRESHOLD` = 0.10, read off the distribution rather than picked. |Pearson - Spearman| over 406 pairs is two humps, not one: agreement piles up under 0.06, extreme-week pairs pile up between 0.15 and 0.18, and the trough between them is at 0.10 to 0.11 (3 pairs in a 0.01-wide bin). 0.15 would cut through the upper hump, reporting a pair at 0.151 and not one at 0.149.
- `rolling_correlation(prices, pair, *, window)` - One pair's correlation over a moving window of weeks, as a date-indexed series. No value until a window is full and nothing is filled; a degenerate window stays `NaN` rather than being dropped, so a gap reads as a gap. Returns an **empty** series, not an error, when there are fewer weekly observations than the window asks for. `window` has no default on purpose: the length is a product decision, made where the product is configured.
- `to_weekly_returns`, `basket_value_series`, `max_drawdown` - The pieces, callable on their own.
- Everything runs on weekly returns (`W-FRI`, last observed price): several Turkish funds price stalely, and daily returns would make a concentrated basket look diversified.
- A purchase's amount is read one of two ways, set by `basis` (`PURCHASE_BASES`), and the two mix freely in one basket. `paid` (the default) means the money that went in on that date, so `units = amount / price on the fill date`. `current_value` means what the holding is worth on the last priced day, so `units = amount / the last price`, and those units are then treated as bought on `date`. Both become units bought on a date before anything else runs, so weights, XIRR and returns are computed exactly one way and a mixed basket is not a special case downstream.
- For a `current_value` holding the cash flow is **derived, not given**: `Fill.amount` is `units × the price on the fill date`, which is what the money must have been for the holding to be worth what the user says it is now. Assuming the stated figure went in on that date instead would credit a fund that has since doubled with twice the money it was actually given, and every return in the answer would be wrong. `Fill.stated_amount` keeps what was said, and `PurchasePlan.converted_fills` lists the holdings this happened to.
- A `current_value` holding is worth exactly what was stated, by construction: `units × last price` returns the input. So its weight does not depend on its date, and a basket of nothing but `current_value` holdings weighs the same as the plain `weights` path — which is what lets the API route between them without the answer jumping.
- With `purchases`, the weights are **today's market value**, not the lira paid in: money that went into a fund that has since doubled occupies twice the room it was given. The `weights` path is unchanged and reads its amounts as given, so a basket sent without dates gives byte for byte what it always did. A single purchase per fund on the matrix's first day reproduces the `weights` path's value series, drawdown, correlation and volatilities to machine precision (~1e-16); only the weights, and the diversification ratio and group weights that follow from them, differ — by design.
- Volatility and max drawdown always run on a **deposit-free** series. For purchases that is the units actually held, carried across the whole window (`held_value_series`); the staged market value would read every deposit as a recovery. The staged series lives in `PurchasePlan.value_series` for charting only.
- A purchase dated on a non-trading day (weekend, holiday, a day the inner join dropped) fills on the **next** priced day, and `PurchasePlan.shifted_fills` lists every one it happened to. A purchase dated *before* the matrix starts is an error, not a shift: moving it forward would quietly answer a question about a shorter holding period. Monthly buying hits this often — 18 of 38 month-start dates shifted in a 36-month test.
- Simple percentage return is wrong for staged buying and is not reported as the headline: lira that arrived last month did not work as long as lira from three years ago. On a real 36-month monthly basket the simple figure read 136% against an XIRR of 46%/yr. `total_invested`, `total_value` and `absolute_gain` sit alongside it in lira.

**`src/inflation.py`** - Inflation layer. Monthly Turkish CPI from TCMB EVDS, plus the arithmetic that restates a nominal value series in today's prices. Imports neither `tefas` nor `src.data`.
- `load_cpi(months, end, api_key, use_cache, cache_dir, series)` - Returns a `CPISeries`, or **`None`** on any expected failure (no key, no network, rejected key, empty answer). It never raises for those: the real-return section is an extra the page works without.
- `real_return(values, cpi)` - `RealReturn`: real and nominal total/annualised return, cumulative inflation, the deflated series, and `stale_months`. Raises only on caller errors (empty series, non-positive values, a window starting before the CPI series).
- `deflate(values, cpi)` - The deflated series on its own.
- `main()` - `python -m src.inflation [--months N] [--no-cache]` prints the index and the inflation it implies. This is the hand-check tool.

**`tests/smoke_test.py`** - Fetches a year of prices for a few funds and reports row count, date range, duplicate dates, null/non-positive prices, and missing business days. Exits non-zero if any fund fails. Gaps of 1-2 business days are normal (Turkish public holidays).

**`notebooks/`** - Jupyter notebooks for analysis. The notebook imports `TEFASClient` via `sys.path.append('..')` and `from src.tefas_client import TEFASClient`.

**`data/`** - Output directory for CSV/Excel files (gitignored). Key outputs: `fund_data.csv` (raw prices), `fund_metrics.csv` (calculated metrics).

**`web/`** - Next.js frontend, in Turkish. The only user interface there is. Contains no maths, and does not import `src/` at all: it calls the API in `api/` and puts the answer into plain language. `lib/result.ts` builds the sentences, `components/` draws them.
- Two tiers. The top one states the result for the *trimmed* matrix in sentences a non-investor can read; everything quantitative sits under a collapsed "Teknik detay" section.
- Never calls a basket safe or well diversified. It reports what it found and, when it found nothing, says so without reassuring.
- The excluded-funds section is drawn only when `excluded_codes` is non-empty, below the main result, and carries the `full` matrix result plus the `below_weekly_threshold` warning.
- The whole fund registry (~2578 rows, ~220 kB) is fetched once and searched in the browser, by code and by title, so results keep up with typing. Searching folds case the Turkish way: the default lowercase turns "İŞ" into a dotted "i", and someone typing "iş bankası" would find nothing.
- When the registry cannot be fetched the search box does **not** go dead: it becomes a plain code field with an "Ekle" button, and what is typed is sent as it stands. `/analyze` never needed the registry. The code is upper cased with `toUpperCase`, deliberately *not* the Turkish locale one, which would send "tie" as "TİE"; a fund added this way carries an empty title and the row says the name could not be verified rather than inventing one.
- Chosen funds are listed below the search box with their amount field and a remove button, so the box does not move as the list grows. A fund with no amount is left out of the analysis with a message.
- The analysis always runs on the full five years (`HISTORY_MONTHS = 60`) and there is no control for it. How far back to look is not a judgement a user is equipped to make, and getting it wrong quietly changes the answer.
- How loudly a group is reported scales with its weight: over 50% leads the headline, 25-50% gets a factual headline naming the funds, under 25% stays out of the headline entirely and lives in a sentence below plus the table's group label. The information is never dropped, only de-emphasised.
- The returns block shows nominal and inflation-adjusted figures side by side, and the value chart draws both lines, whenever the API returns a real return. When it does not, the page falls back to the plain nominal pair with no mention of inflation. A negative real return is printed as it is, with no softening. The fee/tax note sits under the block in both cases.
- The value chart has a "Normal / Logaritmik" control, default normal: when one fund runs away from the others the linear scale flattens the early period into a straight line. Both axes are ticked by hand rather than by Recharts, because a log axis left to itself comes out with labels that collide or with none at all.
- The correlation heatmap is Pearson and stays that way, negative pairs tinted a different hue. Directly under it, `RankGaps` draws the pairs `find_rank_gaps` returned, with both coefficients and one sentence saying that the linear measure is moved by extreme weeks and the rank measure is not. No judgement either way: a coefficient resting on a few weeks is neither good nor bad here.
- That note's heading names *which pairs it is about* rather than what was measured, because it sits on a page whose headline is also about pairs of funds and also quotes a correlation. At a 0.10 threshold it is always the ungrouped pairs, so the heading says so; `rankGapNote` derives that from the pairs in hand rather than assuming it, since `find_rank_gaps` does not filter grouped pairs out.
- The volatility column carries a small bar scaled to the basket's most volatile fund, and the rows are sorted most volatile first. Percentages side by side do not convey size: %143 and %8 are two same-width strings.
- Tables are fixed-layout HTML (`ResultTable`) so nothing scrolls sideways: fund titles run to sixty characters, are truncated to fit, and the full title goes in a `title` attribute so it is never only available shortened.
- The empty basket carries eight ready made example baskets and loads a random one, never the same one twice in a row. Each was run against live TEFAS prices to confirm it produces the finding it is there to show; see `lib/sample.ts`.

## Key Details

- Data comes from `tefas-crawler`, which handles TEFAS's request requirements. Do not reach for Selenium or raw `requests` against `tefas.gov.tr` — a plain POST to `/api/DB/BindHistoryInfo` returns 404.
- A full year fetches in one request (~250 trading days). There is no ~90-day chunking limit to work around; the client does not chunk.
- `tefas-crawler` 0.6.0 exposes only: `date, code, title, price, category_rank, category_total`. Shares outstanding, investor count and AUM are **not** available.
- Calling `Crawler.fetch()` without `name=` fans out one HTTP request per fund and is capped at 50 funds. Always pass a fund code.
- Some funds are newer than the requested window and legitimately return fewer rows (e.g. KCR, HAI launched in 2026). This is not a bug.
- A year of data has ~252 trading days against ~262 business days; the ~10 missing days are Turkish public holidays and affect all funds identically.
- The price API reaches back **5 years from today**, and `tefas-crawler` silently snaps anything longer to that. `load_price_data` clamps the window itself (`MAX_MONTHS = 60`) and records it in `FundDataset.notes` — without that, a longer request makes every fund look newly launched and empties `trimmed`.
- Prices are never forward-filled. Missing days are holidays common to all funds and the inner join already drops them; filling would invent zero-return days and understate volatility.
- Weekly observations are reported, not enforced. Below ~100 (`MIN_WEEKLY_OBSERVATIONS`) correlation estimates have confidence intervals too wide to act on, but `data.py` never hides data or raises on it — the UI decides.
- A fund is dropped from `trimmed` on what including it *costs*, not on whether it covers the request. Including it must not shorten the common window by more than `MAX_WINDOW_LOSS` (0.20, the `max_window_loss` parameter) or push it below `MIN_WEEKLY_OBSERVATIONS` when dropping it would not. Both are counted in weekly observations, and the cost is judged one fund at a time against whichever fund currently sets the common start. So a fund starting a month into a 60-month request stays (2% shorter); one starting two months before the end of a 36-month request goes (94% shorter). Funds whose prices stop early are still dropped regardless of cost.
- A fund whose `coverage_ratio` falls below `MIN_COVERAGE_RATIO` (0.93) has gaps of its own, which narrow the common range for the whole basket. A healthy series sits near 0.96 after holidays.
- Exclusion and failure are different outcomes and both carry a `kind`: a failure returned no prices at all, an exclusion returned prices that were not worth their cost to the window. `notes` deliberately carries no `kind` — it is a free-text remark about the request, not one of a closed set of outcomes.
- A code that never existed and a fund delisted more than 5 years ago are **indistinguishable** — TEFAS answers both with an empty result and lists only currently-traded funds. Both land in `failed_codes` as `unknown_code`. A fund that closed recently still returns prices and instead shows up in `excluded_codes` as delisted.
- `data.py` caches to `data/cache/*.parquet` keyed on codes + date range, reused only within the same day. Delete the directory to force a refetch.
- EVDS moved during 2026: `evds2.tcmb.gov.tr/service/evds` now answers **every** request with a 302 to the single-page app, whatever the key. The working endpoint is `https://evds3.tcmb.gov.tr/igmevdsms-dis/series=<CODE>&startDate=DD-MM-YYYY&endDate=DD-MM-YYYY&type=json`, with the key in a `key` **header** (a URL `key=` parameter stopped working in April 2024). Parameters go in the path, not the query string. A bad key gives 401 `Invalid API Key`; a missing one gives 403.
- `TP.FG.J0`, the CPI code every older example uses, **stopped in January 2026** when TÜİK rebased to 2025=100. `src.inflation` asks for `TP.TUKFIY2025.GENEL` first and falls back to `TP.GENENDEKS.T1` (the continued 2003=100 general index). Only ratios inside one series are used, so either answers the same question; the two agreed to 0.01pp over a 36-month window.
- CPI is published around the **3rd of the following month**, so a basket running to today usually has a month with no index yet. That month carries the last published one, `RealReturn.stale_months` counts it, and the dashboard says so. It is never interpolated: the published index is a level for the whole month.
- The CPI cache (`data/cache/cpi_*.parquet`) is keyed on months, not exact dates, and stays valid until the next release could plausibly have landed, so a whole month is normally one request. If the cached payload is already missing the month that should exist by now, it drops to a one-day TTL instead so a late release is picked up promptly.
- `EVDS_API_KEY` comes from the environment or `.env` (gitignored). `python-dotenv` is optional: without it the environment variable still works.
- The notebook calculates: total return, annualized return, volatility (annualized using 252 trading days), Sharpe ratio (risk-free rate ~40% for Turkey), and maximum drawdown
- Python 3.10+ required
