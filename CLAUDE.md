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

# Print the CPI index and the inflation it implies (needs EVDS_API_KEY)
python -m src.inflation
python -m src.inflation --months 12 --no-cache

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

**`src/inflation.py`** - Inflation layer. Monthly Turkish CPI from TCMB EVDS, plus the arithmetic that restates a nominal value series in today's prices. Imports neither `tefas` nor `src.data`.
- `load_cpi(months, end, api_key, use_cache, cache_dir, series)` - Returns a `CPISeries`, or **`None`** on any expected failure (no key, no network, rejected key, empty answer). It never raises for those: the real-return section is an extra the page works without.
- `real_return(values, cpi)` - `RealReturn`: real and nominal total/annualised return, cumulative inflation, the deflated series, and `stale_months`. Raises only on caller errors (empty series, non-positive values, a window starting before the CPI series).
- `deflate(values, cpi)` - The deflated series on its own.
- `main()` - `python -m src.inflation [--months N] [--no-cache]` prints the index and the inflation it implies. This is the hand-check tool.

**`tests/smoke_test.py`** - Fetches a year of prices for a few funds and reports row count, date range, duplicate dates, null/non-positive prices, and missing business days. Exits non-zero if any fund fails. Gaps of 1-2 business days are normal (Turkish public holidays).

**`notebooks/`** - Jupyter notebooks for analysis. The notebook imports `TEFASClient` via `sys.path.append('..')` and `from src.tefas_client import TEFASClient`.

**`data/`** - Output directory for CSV/Excel files (gitignored). Key outputs: `fund_data.csv` (raw prices), `fund_metrics.csv` (calculated metrics).

**`app.py`** - Streamlit dashboard, in Turkish. Contains no maths: it calls `load_price_data`, `analyze_basket` and `find_fund_groups`, then puts the result into plain language.
- Two tiers. The top one states the result for the *trimmed* matrix in sentences a non-investor can read; everything quantitative sits under a collapsed "Teknik detay" section.
- Never calls a basket safe or well diversified. It reports what it found and, when it found nothing, says so without reassuring.
- The excluded-funds section is drawn only when `excluded_codes` is non-empty, below the main result, and carries the `full` matrix result plus the `below_weekly_threshold` warning.
- Fund picker autocompletes over `list_funds()` labels ("GAL - GARANTİ PORTFÖY ..."), so searching by code and by fund name both work. Registry and price fetches are `@st.cache_data` with a one-day TTL.
- The picker is a fixed selectbox plus an "Ekle" button; chosen funds are listed below it with their amount field and a "Kaldır" button, so the search box does not move as the list grows. Amounts start empty (`value=None`), and a fund with no amount is left out of the analysis with a message.
- How loudly a group is reported scales with its weight: over 50% leads the headline, 25-50% gets a factual headline naming the funds, under 25% stays out of the headline entirely and lives in a sentence below plus the table's group label. The information is never dropped, only de-emphasised.
- The "Sepet değeri" block (inside "Teknik detay") shows nominal and inflation-adjusted returns side by side, and the value chart draws both lines, whenever `load_cpi()` returns a series. When it returns `None` the page falls back to the plain nominal pair with no mention of inflation. A negative real return is printed as it is, with no softening. The fee/tax note sits under the block in both cases.
- The value chart has a "Normal / Logaritmik" segmented control above it, default normal: when one fund runs away from the others the linear scale flattens the early period into a straight line. On log the y axis uses `dtick="D2"` (labels at 1, 2 and 5 per decade) because Plotly's default labels every digit and they collide at the bottom of the axis. The control lives inside the "Teknik detay" expander, which therefore carries a `key` so it stays open across the rerun a widget triggers.
- The volatility column carries a small bar (`Cubuk`, drawn by `tablo_ciz` as a `::after` gradient so no column widens), scaled to the basket's most volatile fund, and the rows are sorted most volatile first. Percentages side by side do not convey size: %143 and %8 are two same-width strings.
- Tables are rendered as fixed-layout HTML (`tablo_ciz`), not `st.dataframe`: fund titles run to 60 characters, and only HTML gives a per-row `title` tooltip for the truncated name. `st.dataframe` draws to a canvas and cannot.

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
- EVDS moved during 2026: `evds2.tcmb.gov.tr/service/evds` now answers **every** request with a 302 to the single-page app, whatever the key. The working endpoint is `https://evds3.tcmb.gov.tr/igmevdsms-dis/series=<CODE>&startDate=DD-MM-YYYY&endDate=DD-MM-YYYY&type=json`, with the key in a `key` **header** (a URL `key=` parameter stopped working in April 2024). Parameters go in the path, not the query string. A bad key gives 401 `Invalid API Key`; a missing one gives 403.
- `TP.FG.J0`, the CPI code every older example uses, **stopped in January 2026** when TÜİK rebased to 2025=100. `src.inflation` asks for `TP.TUKFIY2025.GENEL` first and falls back to `TP.GENENDEKS.T1` (the continued 2003=100 general index). Only ratios inside one series are used, so either answers the same question; the two agreed to 0.01pp over a 36-month window.
- CPI is published around the **3rd of the following month**, so a basket running to today usually has a month with no index yet. That month carries the last published one, `RealReturn.stale_months` counts it, and the dashboard says so. It is never interpolated: the published index is a level for the whole month.
- The CPI cache (`data/cache/cpi_*.parquet`) is keyed on months, not exact dates, and stays valid until the next release could plausibly have landed, so a whole month is normally one request. If the cached payload is already missing the month that should exist by now, it drops to a one-day TTL instead so a late release is picked up promptly.
- `EVDS_API_KEY` comes from the environment or `.env` (gitignored). `python-dotenv` is optional: without it the environment variable still works.
- The notebook calculates: total return, annualized return, volatility (annualized using 252 trading days), Sharpe ratio (risk-free rate ~40% for Turkey), and maximum drawdown
- Python 3.10+ required
