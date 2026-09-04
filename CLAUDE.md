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

# Run analysis notebook
jupyter notebook notebooks/01_data_collection_and_exploration.ipynb
```

There is no linter or build system configured. The only test is `tests/smoke_test.py`.

## Architecture

**`src/tefas_client.py`** - Single module containing `TEFASClient`, a thin wrapper over the `tefas-crawler` package:
- `__init__()` - Creates the underlying `tefas.Crawler`. Takes no arguments.
- `get_fund_history(fund_code, start_date, end_date)` - Fetches one fund in a single request. Dates accept `DD.MM.YYYY`, `YYYY-MM-DD`, `date` or `datetime`; defaults to the last 365 days. Returns an empty DataFrame (not an exception) when a fund has no data.
- `get_multiple_funds(fund_codes, start_date, end_date, delay)` - Batch fetch with a 0.5s delay between requests. Defaults to `POPULAR_FUNDS`.
- `_clean(df, fund_code)` - Renames crawler columns to the project schema, parses dates, deduplicates, sorts.
- `_parse_date(value)` - Module-level date coercion helper.
- `POPULAR_FUNDS` - Dict of 14 fund codes across 7 categories (Equity, Bond, Gold, Money Market, Variable, Commodity, Hedge). Titles were verified against live TEFAS data on 2026-09-04.
- `main()` - Entry point that fetches all popular funds and saves to `data/fund_data.csv`

Output schema: `date, fund_code, fund_name, price, category_rank, category_total`.

**`tests/smoke_test.py`** - Fetches a year of prices for a few funds and reports row count, date range, duplicate dates, null/non-positive prices, and missing business days. Exits non-zero if any fund fails. Gaps of 1-2 business days are normal (Turkish public holidays).

**`notebooks/`** - Jupyter notebooks for analysis. The notebook imports `TEFASClient` via `sys.path.append('..')` and `from src.tefas_client import TEFASClient`.

**`data/`** - Output directory for CSV/Excel files (gitignored). Key outputs: `fund_data.csv` (raw prices), `fund_metrics.csv` (calculated metrics).

**Empty stubs not yet written:** `app.py` (Streamlit dashboard), `src/data.py`, `src/analysis.py`.

## Key Details

- Data comes from `tefas-crawler`, which handles TEFAS's request requirements. Do not reach for Selenium or raw `requests` against `tefas.gov.tr` — a plain POST to `/api/DB/BindHistoryInfo` returns 404.
- A full year fetches in one request (~250 trading days). There is no ~90-day chunking limit to work around; the client does not chunk.
- `tefas-crawler` 0.6.0 exposes only: `date, code, title, price, category_rank, category_total`. Shares outstanding, investor count and AUM are **not** available.
- Calling `Crawler.fetch()` without `name=` fans out one HTTP request per fund and is capped at 50 funds. Always pass a fund code.
- Some funds are newer than the requested window and legitimately return fewer rows (e.g. KCR, HAI launched in 2026). This is not a bug.
- A year of data has ~252 trading days against ~262 business days; the ~10 missing days are Turkish public holidays and affect all funds identically.
- The notebook calculates: total return, annualized return, volatility (annualized using 252 trading days), Sharpe ratio (risk-free rate ~40% for Turkey), and maximum drawdown
- Python 3.10+ required
