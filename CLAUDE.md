# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FonRadar is a Python data analysis tool for Turkish investment fund performance. It fetches historical data from the TEFAS (Turkey Electronic Fund Trading Platform) API and provides analysis through Jupyter notebooks.

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

# Run the dashboard
streamlit run app.py
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
- `format_coverage_report(ds)` / `print_coverage_report(ds)` - Plain-text report.
- `main()` - CLI entry point; `python -m src.data [CODES...] [--months N] [--no-cache]`.

**`src/analysis.py`** - Analysis layer. Pure portfolio maths over a price matrix plus a weights dict; imports neither `tefas` nor `src.data`, prints nothing, persists nothing.
- `analyze_basket(prices, weights)` - Returns a `BasketAnalysis`: correlation matrix (`None` for a single fund), diversification ratio, basket and per-fund annualised volatility, max drawdown, weekly observation count.
- `find_fund_groups(correlation, weights, threshold=GROUP_THRESHOLD)` - Sets of funds where *every* pair clears the threshold (maximal cliques, not chains). Returns a `GroupingResult` of `FundGroup`s (codes, weight, weakest pair) heaviest first, plus `standalone` funds. A fund in several cliques is reported once, in the heaviest, so weights never exceed 100%. No groups is a normal result, not an error.
- `to_weekly_returns`, `basket_value_series`, `max_drawdown` - The pieces, callable on their own.
- Everything runs on weekly returns (`W-FRI`, last observed price): several Turkish funds price stalely, and daily returns would make a concentrated basket look diversified.

**`tests/smoke_test.py`** - Fetches a year of prices for a few funds and reports row count, date range, duplicate dates, null/non-positive prices, and missing business days. Exits non-zero if any fund fails. Gaps of 1-2 business days are normal (Turkish public holidays).

**`notebooks/`** - Jupyter notebooks for analysis. The notebook imports `TEFASClient` via `sys.path.append('..')` and `from src.tefas_client import TEFASClient`.

**`data/`** - Output directory for CSV/Excel files (gitignored). Key outputs: `fund_data.csv` (raw prices), `fund_metrics.csv` (calculated metrics).

**`app.py`** - Streamlit dashboard, in Turkish. Contains no maths: it calls `load_price_data`, `analyze_basket` and `find_fund_groups`, then puts the result into plain language.
- Two tiers. The top one states the result for the *trimmed* matrix in sentences a non-investor can read; everything quantitative sits under a collapsed "Teknik detay" section.
- Never calls a basket safe or well diversified. It reports what it found and, when it found nothing, says so without reassuring.
- The excluded-funds section is drawn only when `excluded_codes` is non-empty, below the main result, and carries the `full` matrix result plus the `below_weekly_threshold` warning.
- Fund picker autocompletes over `list_funds()` labels ("GAL - GARANTİ PORTFÖY ..."), so searching by code and by fund name both work. Registry and price fetches are `@st.cache_data` with a one-day TTL.

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
- A code that never existed and a fund delisted more than 5 years ago are **indistinguishable** — TEFAS answers both with an empty result and lists only currently-traded funds. Both land in `failed_codes` as `unknown_code`. A fund that closed recently still returns prices and instead shows up in `excluded_codes` as delisted.
- `data.py` caches to `data/cache/*.parquet` keyed on codes + date range, reused only within the same day. Delete the directory to force a refetch.
- The notebook calculates: total return, annualized return, volatility (annualized using 252 trading days), Sharpe ratio (risk-free rate ~40% for Turkey), and maximum drawdown
- Python 3.10+ required
