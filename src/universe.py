"""
Universe
========
Which funds the nightly job is allowed to look at, and what it knows about
each one before a single price is fetched.

The universe is not "every fund TEFAS lists". It is the funds a reader can
actually buy through TEFAS, which is a strictly smaller set and is decided by
one thing: which half of the registry answered.

`fonGetiriBazliBilgiGetir` partitions its universe by the `islem` parameter
rather than describing each fund. Ask with `islem=1` and every row comes back
`tefasDurum=True`; ask with `islem=0` and every row comes back `False`. The
two answers share no codes at all, so the flag is not a per-fund attribute
being reported — it is the question being echoed. That makes it reliable in
exactly one way: a fund is tradeable on TEFAS if and only if the `islem=1`
call returned it. This module never reads `tefasDurum` off a row to decide;
it records which call the row came from.

`fonTipi` decides something else: which registry entirely. YAT and EMK are
the securities and pension funds. BYF (exchange-traded) answers both `islem`
values with the same 37 rows and `tefasDurum=None`, so there is no tradeable
half to take and they stay out. GYF and GSYF — real estate and venture
capital — are separate registries of qualified-investor products that this
tool does not cover, and are never requested.

The profile endpoint `fonBilgiGetir` is where fund size, investor count and
category live. None of it filters anything: the universe is already decided
by the time it is asked. It is fetched because a fund page has to say what
the fund is, and it is the only endpoint that says.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Iterable, Optional

from src.tefas_client import TEFASClient

logger = logging.getLogger(__name__)

# The registries whose tradeable half is the universe. BYF is deliberately
# absent: it has no tradeable half to take, only 37 rows with a null flag.
# GYF and GSYF are absent for a different reason — they are a different
# product, sold to qualified investors, and not what this tool analyses.
UNIVERSE_FUND_TYPES = ("YAT", "EMK")

# The half of each registry that is tradeable on TEFAS.
TRADEABLE_ISLEM = 1

# The profile endpoint. Not in `tefas-crawler`, which stops at prices, so it
# is named here and reached through the crawler's own session.
PROFILE_ENDPOINT = "/api/funds/fonBilgiGetir"

# Seconds between profile requests. One per fund, ~1400 of them, against the
# same host the price fetch is about to hammer.
PROFILE_DELAY = 0.15


@dataclass(frozen=True)
class FundProfile:
    """What is known about one fund before any price is fetched.

    Every field but `code` may be missing. The registry answers for all of
    them, the profile endpoint answers for most, and neither is a contract:
    a fund whose profile call fails is still in the universe, still gets its
    correlations computed, and simply has less to show on its page.
    """

    code: str
    name: str
    #: Registry it came from: "YAT" or "EMK".
    fund_type: str
    #: `fonTurAciklama` from the registry, e.g. "Serbest Şemsiye Fonu".
    umbrella_type: Optional[str] = None
    #: `fonKategori` from the profile endpoint, e.g. "Serbest Fon".
    category: Optional[str] = None
    #: `portBuyukluk` — portfolio size in lira.
    total_assets: Optional[float] = None
    #: `yatirimciSayi` — number of investors holding it.
    investor_count: Optional[int] = None
    #: `riskDegeri`, 1 to 7. Absent for a fifth of the registry, and absent
    #: is not zero — it is TEFAS declining to say.
    risk_value: Optional[int] = None

    #: Words that end a founder's legal name. A title runs "<founder> <what
    #: it invests in>" with no separator, so the founder is the head up to
    #: and including whichever of these comes first.
    #:
    #: Two are needed, not one. Securities houses are "<X> PORTFÖY ...", but
    #: the pension registry is mostly insurers — "AGESA HAYAT VE EMEKLİLİK
    #: A.Ş. HİSSE SENEDİ ..." — with no "PORTFÖY" anywhere. Splitting on
    #: that word alone left 300 of 311 pension funds with no founder at all,
    #: which quietly made every pair of them look like the same house.
    NAME_MARKERS = ("PORTFÖY", "A.Ş.")

    @property
    def founder(self) -> Optional[str]:
        """The company, taken off the front of the fund's name.

        TEFAS has no founder field, so this is a split and not a lookup. It
        is display text and a rough grouping key — nothing numeric keys off
        it, and a title carrying neither marker returns `None` rather than a
        guess, because "unknown" and "the same house" must not be confused.
        """
        if not self.name:
            return None
        hits = [
            (self.name.find(marker), marker)
            for marker in self.NAME_MARKERS
            if self.name.find(marker) >= 0
        ]
        if not hits:
            return None
        index, marker = min(hits)
        return self.name[: index + len(marker)].strip()


def _list_payload(fund_type: str, islem: int) -> dict:
    """The registry request. Mirrors `TEFASClient._fetch_fund_codes`."""
    return {
        "dil": "TR",
        "fonTipi": fund_type,
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


def _as_int(value) -> Optional[int]:
    """TEFAS sends risk as a string, and sometimes as "-"."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_universe(
    client: Optional[TEFASClient] = None,
    fund_types: Iterable[str] = UNIVERSE_FUND_TYPES,
    with_profiles: bool = True,
    profile_delay: float = PROFILE_DELAY,
    limit: Optional[int] = None,
) -> list[FundProfile]:
    """Every fund tradeable on TEFAS, with what TEFAS says about it.

    Raises `RuntimeError` if a registry call fails. A partial universe is
    worse than none: it would silently drop funds out of tonight's
    correlations and the table would look complete.

    Profile failures are not fatal and are logged, one line per fund, at
    most once. A fund with no profile keeps its registry fields.

    `limit` truncates the universe before the profile calls rather than
    after, so a development run costs a handful of requests instead of
    fourteen hundred. It is not a filter — the codes it keeps are simply
    the first ones alphabetically.
    """
    client = client or TEFASClient()
    crawler = client._crawler

    funds: dict[str, FundProfile] = {}
    for fund_type in fund_types:
        try:
            rows = crawler._do_post(
                crawler.list_endpoint, _list_payload(fund_type, TRADEABLE_ISLEM)
            )
        except Exception as exc:  # noqa: BLE001 - re-raised with context
            raise RuntimeError(
                f"Could not list tradeable funds (fonTipi={fund_type}): {exc}"
            ) from exc

        logger.info("Registry %s: %d tradeable funds", fund_type, len(rows))
        for row in rows:
            code = (row.get("fonKodu") or "").strip()
            if not code or code in funds:
                continue
            funds[code] = FundProfile(
                code=code,
                name=(row.get("fonUnvan") or "").strip(),
                fund_type=fund_type,
                umbrella_type=(row.get("fonTurAciklama") or None),
                risk_value=_as_int(row.get("riskDegeri")),
            )

    if not funds:
        raise RuntimeError("TEFAS listed no tradeable funds at all")

    if limit is not None:
        keep = sorted(funds)[:limit]
        funds = {code: funds[code] for code in keep}

    if with_profiles:
        _attach_profiles(client, funds, profile_delay)

    return sorted(funds.values(), key=lambda f: f.code)


def _attach_profiles(
    client: TEFASClient, funds: dict[str, FundProfile], delay: float
) -> None:
    """Fill in size, investor count and category, in place.

    One request per fund. Everything here is display material, so a failure
    costs a fund page some rows and nothing else; the loop keeps going.
    """
    crawler = client._crawler
    total = len(funds)
    failed = 0

    for i, code in enumerate(sorted(funds), 1):
        if i % 200 == 0 or i == total:
            logger.info("Profiles %d/%d (%d unavailable)", i, total, failed)
        try:
            rows = crawler._do_post(
                PROFILE_ENDPOINT, {"fonKodu": code, "dil": "TR"}
            )
        except Exception as exc:  # noqa: BLE001 - display data, never fatal
            logger.debug("No profile for %s: %s", code, exc)
            failed += 1
            continue

        if not rows:
            failed += 1
            continue

        row = rows[0]
        current = funds[code]
        funds[code] = FundProfile(
            code=current.code,
            # The profile's title is the same string as the registry's, so
            # the registry's is kept rather than trusted twice.
            name=current.name,
            fund_type=current.fund_type,
            umbrella_type=current.umbrella_type,
            category=(row.get("fonKategori") or None),
            total_assets=_as_float(row.get("portBuyukluk")),
            investor_count=_as_int(row.get("yatirimciSayi")),
            risk_value=current.risk_value,
        )
        if i < total:
            time.sleep(delay)

    if failed:
        logger.info("%d of %d funds have no profile row", failed, total)
