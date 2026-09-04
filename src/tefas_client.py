"""
TEFAS Data Client
=================
Fetches investment fund data from Turkey Electronic Fund Trading Platform
using the `tefas-crawler` package.
"""

import time
import logging
from datetime import date, datetime, timedelta
from typing import Optional, Union

import pandas as pd
from tefas import Crawler

logger = logging.getLogger(__name__)

DateLike = Union[str, date, datetime]

# Columns returned by the TEFAS history endpoint
_COLUMNS = ["date", "code", "title", "price", "category_rank", "category_total"]

# The three fund kinds TEFAS keeps separate registries for: securities funds,
# pension funds, exchange-traded funds.
_FUND_KINDS = ("YAT", "EMK", "BYF")

# The fund-list endpoint answers differently depending on `islem`, and neither
# answer is complete: islem=1 carries brand-new funds but drops some
# established ones (KCR yes, GAL no), islem=0 does the reverse. Only the union
# of the two is the actual registry, so we ask for both.
_LIST_ISLEM_VALUES = (0, 1)


def _parse_date(value: DateLike) -> date:
    """Accept DD.MM.YYYY, YYYY-MM-DD, date or datetime and return a date."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {value!r} (use DD.MM.YYYY or YYYY-MM-DD)")


class TEFASClient:
    """Client for fetching historical fund data from TEFAS."""

    # Fund codes verified against TEFAS titles on 2026-09-04.
    POPULAR_FUNDS = {
        # Equity
        "TI2": "Is Portfolio Equity Fund",
        "GAE": "Garanti Portfolio BIST30 Index Equity Fund",
        "YAY": "Yapi Kredi Portfolio Foreign Tech Sector Equity Fund",
        "TZD": "Ziraat Portfolio Equity Fund",
        "YDI": "Yapi Kredi Portfolio Model Portfolio Equity Fund",

        # Bond
        "AK2": "Ak Portfolio Long Term Debt Instruments Fund",

        # Gold
        "AFO": "Ak Portfolio Gold Fund",
        "AU1": "A1 Capital Portfolio Gold Fund",

        # Money Market
        "GAL": "Garanti Portfolio Second Money Market (TL) Fund",
        "AAL": "Ata Portfolio Money Market (TL) Fund",

        # Variable / Mixed
        "IPB": "Istanbul Portfolio First Variable Fund",
        "TCD": "Tacirler Portfolio Variable Fund",

        # Commodity
        "AES": "Ak Portfolio Oil Foreign ETF Fund of Funds",

        # Hedge
        "TPP": "TEB Portfolio Pusula Hedge Fund",
    }

    def __init__(self):
        self._crawler = Crawler()
        self._registry: Optional[set] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_fund_history(
        self,
        fund_code: str,
        start_date: Optional[DateLike] = None,
        end_date: Optional[DateLike] = None,
    ) -> pd.DataFrame:
        """
        Fetch historical data for a specific fund.

        Parameters
        ----------
        fund_code : str
            Fund code (e.g., 'GAL', 'TI2')
        start_date : str | date | datetime, optional
            Start date. Defaults to one year before `end_date`.
        end_date : str | date | datetime, optional
            End date. Defaults to today.

        Returns
        -------
        pd.DataFrame
            Columns: date, fund_code, fund_name, price, category_rank,
            category_total. Empty if the fund returned no data.
        """
        end = _parse_date(end_date) if end_date else date.today()
        start = _parse_date(start_date) if start_date else end - timedelta(days=365)

        try:
            df = self._crawler.fetch(
                start=start.isoformat(),
                end=end.isoformat(),
                name=fund_code,
                columns=_COLUMNS,
            )
        except Exception as exc:
            logger.warning("Failed to fetch %s: %s", fund_code, exc)
            print(f"❌ Error fetching {fund_code}: {exc}")
            return pd.DataFrame()

        if df.empty:
            print(f"⚠️  No data found for {fund_code}")
            return pd.DataFrame()

        return self._clean(df, fund_code)

    def list_fund_codes(self, refresh: bool = False) -> set:
        """
        Fund codes TEFAS currently lists, across all three fund kinds.

        Exists to tell an invalid code apart from a real fund that returned no
        prices: the history endpoint answers both with an empty result, so the
        registry is the only signal available.

        Note the registry holds *currently listed* funds only. A fund that has
        been closed and delisted is absent from it — and so is a typo. TEFAS
        exposes no historical registry, so those two cases cannot be
        separated here; see `get_fund_history` for the case that can (a fund
        that closed recently still returns prices, ending on its last
        trading day).

        Raises
        ------
        RuntimeError
            If any part of the registry could not be fetched. A partial
            registry is worse than none: it would label live funds invalid.
        """
        if self._registry is not None and not refresh:
            return self._registry

        codes: set = set()
        for kind in _FUND_KINDS:
            for islem in _LIST_ISLEM_VALUES:
                try:
                    codes |= self._fetch_fund_codes(kind, islem)
                except Exception as exc:
                    raise RuntimeError(
                        f"Could not list TEFAS funds (kind={kind}, islem={islem}): {exc}"
                    ) from exc

        self._registry = codes
        return codes

    def get_multiple_funds(
        self,
        fund_codes: Optional[list] = None,
        start_date: Optional[DateLike] = None,
        end_date: Optional[DateLike] = None,
        delay: float = 0.5,
    ) -> pd.DataFrame:
        """
        Fetch data for multiple funds.

        Parameters
        ----------
        fund_codes : list, optional
            Fund codes. Defaults to `POPULAR_FUNDS`.
        start_date, end_date : optional
            See `get_fund_history`.
        delay : float
            Delay between requests, in seconds.

        Returns
        -------
        pd.DataFrame
            Combined data for all funds that returned rows.
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

        if not all_data:
            return pd.DataFrame()

        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n🎉 Total {len(combined)} records fetched successfully!")
        return combined

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _fetch_fund_codes(self, kind: str, islem: int) -> set:
        """One page of the fund registry.

        Goes through the crawler's own session and endpoint rather than a
        fresh `requests` call, so headers and error handling stay in one
        place. `Crawler._list_fund_codes` hardcodes islem=1, hence the
        open-coded payload here.
        """
        payload = {
            "dil": "TR",
            "fonTipi": kind,
            "kurucuKodu": None,
            "sfonTurKod": None,
            "fonTurAciklama": None,
            "islem": islem,
            "fonTurKod": None,
            "fonGrubu": None,
            "donemGetiri1a": "1",
            "donemGetiri3a": "1",
            "donemGetiri6a": "1",
            "donemGetiri1y": "1",
            "donemGetiriyb": "1",
            "donemGetiri3y": "1",
            "donemGetiri5y": "1",
            "basTarih": None,
            "bitTarih": None,
            "calismaTipi": 2,
            "getiriOrani": "1",
        }
        rows = self._crawler._do_post(self._crawler.list_endpoint, payload)
        return {r["fonKodu"] for r in rows if r.get("fonKodu")}

    @staticmethod
    def _clean(df: pd.DataFrame, fund_code: str) -> pd.DataFrame:
        """Normalise a raw crawler response into the project's schema."""
        df = df.rename(columns={"code": "fund_code", "title": "fund_name"})
        df["date"] = pd.to_datetime(df["date"])

        # The crawler echoes the requested code back, but pin it anyway so a
        # fund that changed its code mid-range stays under one identifier.
        df["fund_code"] = fund_code

        df = df.drop_duplicates(subset=["date", "fund_code"])
        df = df.sort_values("date").reset_index(drop=True)

        return df[["date", "fund_code", "fund_name", "price", "category_rank", "category_total"]]


def main():
    """Fetch all popular funds and save them to data/fund_data.csv."""

    print("=" * 50)
    print("FonRadar - TEFAS Data Fetcher")
    print("=" * 50)
    print()

    client = TEFASClient()
    df = client.get_multiple_funds()

    if df.empty:
        return None

    output_path = "data/fund_data.csv"
    df.to_csv(output_path, index=False)
    print(f"\n💾 Data saved to: {output_path}")

    print("\n📊 Data Summary:")
    print(f"   Total records: {len(df)}")
    print(f"   Number of funds: {df['fund_code'].nunique()}")
    print(f"   Date range: {df['date'].min()} to {df['date'].max()}")

    return df


if __name__ == "__main__":
    main()
