"""
TEFAS Data Client
=================
Fetches investment fund data from Turkey Electronic Fund Trading Platform.
Uses Selenium to bypass F5 WAF protection by interacting with the TEFAS web
form directly and scraping the rendered DataTable results.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
import time
import logging

logger = logging.getLogger(__name__)

# Maximum days per query (TEFAS form enforces ~90-day limit)
_MAX_CHUNK_DAYS = 85


class TEFASClient:
    """Client for fetching data from TEFAS via Selenium form interaction."""

    TEFAS_URL = "https://www.tefas.gov.tr/TarihselVeriler.aspx"

    # Popular fund codes for initial analysis
    POPULAR_FUNDS = {
        # Equity Funds
        "IPB": "Is Portfolio BIST Bank Index Equity Fund",
        "TI2": "TEB Portfolio Equity Fund",
        "YAY": "Yapi Kredi Portfolio Foreign Tech Sector Equity Fund",

        # Bond Funds
        "AK2": "Ak Portfolio Short Term Bond Fund",
        "TZD": "Ziraat Portfolio Short Term Bond Fund",
        "GAE": "Garanti Portfolio Euro Bond Fund",

        # Gold Funds
        "GAL": "Garanti Portfolio Gold Fund",
        "IAL": "Is Portfolio Gold Fund",

        # Mixed Funds
        "YDI": "Yapi Kredi Portfolio Variable Fund",
        "AK6": "Ak Portfolio Oil Foreign ETF Fund of Funds",

        # Money Market
        "AES": "Ak Portfolio Money Market Fund",
        "TPP": "TEB Portfolio Money Market Fund",
    }

    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )

    def __init__(self, headless: bool = True):
        """Initialize the client.

        Parameters
        ----------
        headless : bool
            Run Selenium in headless mode (default True).
            Set to False for debugging the browser session.
        """
        self.headless = headless
        self._driver = None
        self._page_loaded = False

    # ------------------------------------------------------------------
    # Selenium lifecycle
    # ------------------------------------------------------------------

    def _create_driver(self):
        """Create a Chrome WebDriver with anti-detection flags."""
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from webdriver_manager.chrome import ChromeDriverManager

        options = webdriver.ChromeOptions()
        if self.headless:
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument(f"--user-agent={self.USER_AGENT}")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)

        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"},
        )
        return driver

    def _ensure_driver(self):
        """Ensure a browser is open and the TEFAS page is loaded."""
        if self._driver is None:
            self._driver = self._create_driver()
            self._page_loaded = False

        if not self._page_loaded:
            self._driver.get(self.TEFAS_URL)
            time.sleep(5)
            self._page_loaded = True

    def close(self):
        """Shut down the browser."""
        if self._driver is not None:
            self._driver.quit()
            self._driver = None
            self._page_loaded = False

    def __del__(self):
        self.close()

    # ------------------------------------------------------------------
    # Form interaction helpers
    # ------------------------------------------------------------------

    def _select_fund(self, fund_code: str):
        """Type a fund code into the autocomplete input and select it."""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys

        fund_input = self._driver.find_element(By.ID, "TextBoxOtherFund")
        fund_input.click()
        fund_input.clear()
        fund_input.send_keys(fund_code)
        time.sleep(2)

        # Select the first autocomplete suggestion
        fund_input.send_keys(Keys.ARROW_DOWN)
        time.sleep(0.5)
        fund_input.send_keys(Keys.ENTER)
        time.sleep(1)

    def _set_dates(self, start_date: str, end_date: str):
        """Set the start and end date fields (DD.MM.YYYY format)."""
        from selenium.webdriver.common.by import By

        start_input = self._driver.find_element(By.ID, "TextBoxStartDate")
        self._driver.execute_script('arguments[0].value = "";', start_input)
        start_input.send_keys(start_date)

        end_input = self._driver.find_element(By.ID, "TextBoxEndDate")
        self._driver.execute_script('arguments[0].value = "";', end_input)
        end_input.send_keys(end_date)
        time.sleep(0.5)

    def _click_search(self):
        """Click the search button and wait for results."""
        from selenium.webdriver.common.by import By

        btn = self._driver.find_element(By.ID, "ButtonSearchDates")
        btn.click()
        time.sleep(8)

    def _scrape_table(self) -> list[list[str]]:
        """Scrape all rows from the results DataTable, paginating as needed."""
        from selenium.webdriver.common.by import By

        all_rows: list[list[str]] = []

        while True:
            page_rows = self._driver.execute_script("""
                var rows = [];
                var trs = document.querySelectorAll('#table_general_info tbody tr');
                for (var i = 0; i < trs.length; i++) {
                    var cells = trs[i].querySelectorAll('td');
                    if (cells.length > 1) {
                        rows.push(Array.from(cells).map(function(c) { return c.textContent.trim(); }));
                    }
                }
                return rows;
            """)
            all_rows.extend(page_rows)

            # Check if there is a next page
            try:
                next_btn = self._driver.find_element(By.CSS_SELECTOR, "#table_general_info_next")
                if "disabled" in (next_btn.get_attribute("class") or ""):
                    break
                next_btn.click()
                time.sleep(1)
            except Exception:
                break

        return all_rows

    # ------------------------------------------------------------------
    # Date chunking
    # ------------------------------------------------------------------

    @staticmethod
    def _date_chunks(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
        """Split a date range into chunks of at most _MAX_CHUNK_DAYS days."""
        chunks = []
        current = start
        while current < end:
            chunk_end = min(current + timedelta(days=_MAX_CHUNK_DAYS), end)
            chunks.append((current, chunk_end))
            current = chunk_end + timedelta(days=1)
        return chunks

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_fund_history(
        self,
        fund_code: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Fetch historical data for a specific fund.

        Parameters
        ----------
        fund_code : str
            Fund code (e.g., 'GAL', 'IPB')
        start_date : str, optional
            Start date (DD.MM.YYYY format)
        end_date : str, optional
            End date (DD.MM.YYYY format)

        Returns
        -------
        pd.DataFrame
            Historical fund data
        """
        if end_date is None:
            end_date = datetime.now().strftime("%d.%m.%Y")
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=365)).strftime("%d.%m.%Y")

        start_dt = datetime.strptime(start_date, "%d.%m.%Y")
        end_dt = datetime.strptime(end_date, "%d.%m.%Y")

        try:
            self._ensure_driver()
        except Exception as e:
            print(f"❌ Selenium error: {e}")
            return pd.DataFrame()

        chunks = self._date_chunks(start_dt, end_dt)
        all_rows: list[list[str]] = []

        for chunk_start, chunk_end in chunks:
            s = chunk_start.strftime("%d.%m.%Y")
            e = chunk_end.strftime("%d.%m.%Y")

            try:
                self._select_fund(fund_code)
                self._set_dates(s, e)
                self._click_search()
                rows = self._scrape_table()
                all_rows.extend(rows)
            except Exception as exc:
                print(f"❌ Error fetching {fund_code} ({s}-{e}): {exc}")
                # Try reloading the page for the next chunk
                self._page_loaded = False
                try:
                    self._ensure_driver()
                except Exception:
                    pass

        if not all_rows:
            print(f"⚠️  No data found for {fund_code}")
            return pd.DataFrame()

        df = self._rows_to_dataframe(all_rows, fund_code)
        return df

    def _rows_to_dataframe(self, rows: list[list[str]], fund_code: str) -> pd.DataFrame:
        """Convert scraped table rows into a cleaned DataFrame."""
        columns = ["date", "fund_code_raw", "fund_name", "price", "shares_outstanding", "investor_count", "aum"]
        df = pd.DataFrame(rows, columns=columns[:len(rows[0])] if rows else columns)

        # Overwrite fund_code with the canonical code
        df["fund_code"] = fund_code

        # Parse dates
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], format="%d.%m.%Y", errors="coerce")

        # Parse Turkish number format: "213.668,656" -> 213668.656
        def parse_turkish_number(val):
            if not isinstance(val, str):
                return val
            val = val.strip()
            if not val:
                return None
            # Remove thousand separator (.), replace decimal comma with dot
            val = val.replace(".", "").replace(",", ".")
            try:
                return float(val)
            except ValueError:
                return None

        for col in ["price", "shares_outstanding", "investor_count", "aum"]:
            if col in df.columns:
                df[col] = df[col].apply(parse_turkish_number)

        # Drop helper columns, keep only the standard set
        df = df[["date", "fund_code", "price", "shares_outstanding", "investor_count", "aum"]]

        # Deduplicate (overlapping chunks may produce duplicate dates)
        df = df.drop_duplicates(subset=["date", "fund_code"])
        df = df.sort_values("date").reset_index(drop=True)

        return df

    def get_multiple_funds(
        self,
        fund_codes: Optional[list] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        delay: float = 0.5,
    ) -> pd.DataFrame:
        """
        Fetch data for multiple funds.

        Parameters
        ----------
        fund_codes : list, optional
            List of fund codes. If None, uses popular funds.
        start_date : str, optional
            Start date
        end_date : str, optional
            End date
        delay : float
            Delay between requests (seconds)

        Returns
        -------
        pd.DataFrame
            Combined data for all funds
        """
        if fund_codes is None:
            fund_codes = list(self.POPULAR_FUNDS.keys())

        all_data = []

        for i, code in enumerate(fund_codes, 1):
            fund_name = self.POPULAR_FUNDS.get(code, code)
            print(f"📥 [{i}/{len(fund_codes)}] Fetching {code} - {fund_name}...")

            df = self.get_fund_history(code, start_date, end_date)

            if not df.empty:
                all_data.append(df)
                print(f"   ✅ {len(df)} records retrieved")

            if i < len(fund_codes):
                time.sleep(delay)

        self.close()

        if all_data:
            combined_df = pd.concat(all_data, ignore_index=True)
            print(f"\n🎉 Total {len(combined_df)} records fetched successfully!")
            return combined_df

        return pd.DataFrame()


def main():
    """Main function for testing."""

    print("=" * 50)
    print("FonRadar - TEFAS Data Fetcher")
    print("=" * 50)
    print()

    client = TEFASClient()

    df = client.get_multiple_funds()

    if not df.empty:
        output_path = "data/fund_data.csv"
        df.to_csv(output_path, index=False)
        print(f"\n💾 Data saved to: {output_path}")

        print("\n📊 Data Summary:")
        print(f"   Total records: {len(df)}")
        print(f"   Number of funds: {df['fund_code'].nunique()}")
        print(f"   Date range: {df['date'].min()} to {df['date'].max()}")

        return df

    return None


if __name__ == "__main__":
    main()
