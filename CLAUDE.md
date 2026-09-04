# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FonRadar is a Python data analysis tool for Turkish investment fund performance. It fetches historical data from the TEFAS (Turkey Electronic Fund Trading Platform) API and provides analysis through Jupyter notebooks.

## Setup and Commands

```bash
# Create virtual environment and install dependencies
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Fetch fund data
python src/tefas_client.py

# Run analysis notebook
jupyter notebook notebooks/01_data_collection_and_exploration.ipynb
```

There is no test suite, linter, or build system configured.

## Architecture

**`src/tefas_client.py`** - Single module containing `TEFASClient`, which uses Selenium to interact with the TEFAS web form and scrape rendered DataTable results (bypassing the F5 WAF):
- `__init__(headless=True)` - Initializes the client. Pass `headless=False` to see the browser for debugging.
- `get_fund_history(fund_code, start_date, end_date)` - Fetches historical data for one fund. Automatically chunks date ranges into ~85-day windows (TEFAS enforces a ~90-day limit per query). Uses Selenium to fill the TEFAS form, submit, and scrape the paginated DataTable.
- `get_multiple_funds(fund_codes, start_date, end_date, delay)` - Batch fetches multiple funds with 0.5s delay between requests. Closes the browser when done.
- `_create_driver()` - Configures Chrome with anti-detection flags (disables `navigator.webdriver`, automation switches)
- `_ensure_driver()` - Lazily creates the browser and loads the TEFAS page on first use
- `_select_fund(fund_code)` - Types fund code into the autocomplete input and selects it
- `_set_dates(start, end)` - Sets the date range form fields
- `_scrape_table()` - Extracts all rows from the DataTable, paginating through all pages
- `_rows_to_dataframe(rows, fund_code)` - Converts scraped rows to a cleaned DataFrame; parses Turkish number format (dot thousands, comma decimal)
- `_date_chunks(start, end)` - Splits date ranges into <=85-day chunks
- `close()` - Shuts down the browser
- `POPULAR_FUNDS` - Dict of 12 tracked fund codes across 5 categories (Equity, Bond, Gold, Mixed, Money Market)
- `main()` - Entry point that fetches all popular funds and saves to `data/fund_data.csv`

**`notebooks/`** - Jupyter notebooks for analysis. The notebook imports `TEFASClient` via `sys.path.append('..')` and `from src.tefas_client import TEFASClient`.

**`data/`** - Output directory for CSV/Excel files (gitignored). Key outputs: `fund_data.csv` (raw prices), `fund_metrics.csv` (calculated metrics).

## Key Details

- TEFAS is behind an F5 WAF that blocks direct API calls. TEFASClient uses Selenium (headless Chrome) to interact with the actual TEFAS web form, submitting searches and scraping the rendered DataTable. Requires `selenium` and `webdriver-manager` (installed via requirements.txt). Chrome must be installed on the system.
- The TEFAS form enforces a ~90-day maximum date range per query. The client automatically chunks longer ranges into ~85-day windows and deduplicates results.
- Dates use DD.MM.YYYY format; defaults to last 365 days
- Numbers in the TEFAS table use Turkish format: dot as thousand separator, comma as decimal (e.g. "213.668,656")
- The notebook calculates: total return, annualized return, volatility (annualized using 252 trading days), Sharpe ratio (risk-free rate ~40% for Turkey), and maximum drawdown
- Python 3.10+ required
