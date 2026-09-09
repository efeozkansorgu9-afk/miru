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

# Retry policy for a price request that did not complete. Rate limiting is the
# expected cause — the requests go out back to back — and it clears in
# seconds, so a couple of spaced retries recover it. Kept small because the
# weekly job walks ~1374 funds: every second spent here is spent 1374 times.
_FETCH_ATTEMPTS = 3
_FETCH_BACKOFF = 1.0


class TEFASRequestError(RuntimeError):
    """A price request did not complete.

    Deliberately distinct from a request that completed and returned nothing.
    The two used to be one outcome — every exception became an empty frame —
    and the whole point of this class is that they are not the same claim.
    "This fund has no prices in this window" is a statement about the fund,
    and a rate-limited request does not support it.
    """


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
        self._registry: Optional[dict] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch_history(
        self,
        fund_code: str,
        start_date: Optional[DateLike] = None,
        end_date: Optional[DateLike] = None,
        *,
        attempts: int = _FETCH_ATTEMPTS,
    ) -> pd.DataFrame:
        """Fetch one fund, telling a failed request from an empty answer.

        The only way to fetch prices. There used to be a second,
        `get_fund_history`, which caught every exception and returned an
        empty frame — so a rate-limited request was indistinguishable from a
        fund with no prices, and its name said nothing about that. It was
        deleted rather than renamed: with two callers, both of which read
        better with the swallowing written out, a correctly-named lenient
        method would still have been the one somebody reached for next.

        A request that never completed raises `TEFASRequestError`. Only a
        request that *did* complete and carried no rows returns an empty
        frame.

        That distinction is the difference between "this fund has no prices"
        and "we did not manage to ask", and it is load bearing: the caller
        caches the first answer and must never cache the second. A single
        rate-limited request used to be written to disk as a fact about the
        fund and served for the rest of the day.

        Retries `attempts` times with a widening pause before giving up,
        because the expected cause is rate limiting from the request before
        this one and it clears in seconds. Pass `attempts=1` to skip that,
        which is what the batch loop does once it decides TEFAS is down.

        Raises
        ------
        TEFASRequestError
            Every attempt failed. Carries the last underlying error.
        """
        end = _parse_date(end_date) if end_date else date.today()
        start = _parse_date(start_date) if start_date else end - timedelta(days=365)

        last: Optional[Exception] = None
        for attempt in range(1, max(1, attempts) + 1):
            try:
                df = self._crawler.fetch(
                    start=start.isoformat(),
                    end=end.isoformat(),
                    name=fund_code,
                    columns=_COLUMNS,
                )
            except Exception as exc:
                last = exc
                if attempt < attempts:
                    pause = _FETCH_BACKOFF * (2 ** (attempt - 1))
                    logger.info(
                        "Fetch of %s failed (%s), retrying in %.1fs (attempt %d/%d)",
                        fund_code,
                        exc,
                        pause,
                        attempt + 1,
                        attempts,
                    )
                    time.sleep(pause)
                continue

            if df.empty:
                print(f"⚠️  No data found for {fund_code}")
                return pd.DataFrame()

            return self._clean(df, fund_code)

        raise TEFASRequestError(
            f"{fund_code}: {attempts} attempt(s) failed, last error: {last}"
        ) from last

    def list_fund_codes(self, refresh: bool = False) -> set:
        """
        Fund codes TEFAS currently lists, across all three fund kinds.

        Exists to tell an invalid code apart from a real fund that returned no
        prices: the history endpoint answers both with an empty result, so the
        registry is the only signal available.

        Note the registry holds *currently listed* funds only. A fund that has
        been closed and delisted is absent from it — and so is a typo. TEFAS
        exposes no historical registry, so those two cases cannot be
        separated here; see `fetch_history` for the case that can (a fund
        that closed recently still returns prices, ending on its last
        trading day).

        Raises
        ------
        RuntimeError
            If any part of the registry could not be fetched. A partial
            registry is worse than none: it would label live funds invalid.
        """
        return set(self.list_funds(refresh))

    def list_funds(self, refresh: bool = False) -> dict:
        """
        Code to title for every fund TEFAS currently lists.

        Same registry as `list_fund_codes`, keeping the titles the listing
        endpoint already returns. A picker needs them: nobody searching for
        a gold fund knows to type "AFO".

        Raises
        ------
        RuntimeError
            If any part of the registry could not be fetched. A partial
            registry is worse than none: it would label live funds invalid.
        """
        if self._registry is not None and not refresh:
            return self._registry

        funds: dict = {}
        for kind in _FUND_KINDS:
            for islem in _LIST_ISLEM_VALUES:
                try:
                    funds.update(self._fetch_fund_codes(kind, islem))
                except Exception as exc:
                    raise RuntimeError(
                        f"Could not list TEFAS funds (kind={kind}, islem={islem}): {exc}"
                    ) from exc

        self._registry = funds
        return funds

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
            See `fetch_history`.
        delay : float
            Delay between requests, in seconds.

        Returns
        -------
        pd.DataFrame
            Combined data for all funds that returned rows.

        Notes
        -----
        A fund whose request fails is reported and skipped: this is the
        "fetch what you can" helper, used by `main()` to fill a CSV and by
        exploration in the notebooks. The swallowing is written out here
        rather than hidden behind a method that does it silently, because
        that method is what let a rate-limited request be cached as a fact
        about a fund. Anything that stores what it gets must call
        `fetch_history` and handle `TEFASRequestError` itself.
        """
        if fund_codes is None:
            fund_codes = list(self.POPULAR_FUNDS.keys())

        all_data = []

        for i, code in enumerate(fund_codes, 1):
            fund_name = self.POPULAR_FUNDS.get(code, code)
            print(f"📥 [{i}/{len(fund_codes)}] Fetching {code} - {fund_name}...")

            try:
                df = self.fetch_history(code, start_date, end_date)
            except TEFASRequestError as exc:
                logger.warning("Skipping %s: %s", code, exc)
                print(f"   ❌ {exc}")
                df = pd.DataFrame()

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

    def _fetch_fund_codes(self, kind: str, islem: int) -> dict:
        """One page of the fund registry, as code to title.

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
        return {
            r["fonKodu"]: (r.get("fonUnvan") or "").strip()
            for r in rows
            if r.get("fonKodu")
        }

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
    print("miru - TEFAS Data Fetcher")
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
