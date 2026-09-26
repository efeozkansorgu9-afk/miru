"""
What each fund charges, as TEFAS publishes it.

The source is the "Yönetim ücreti" listing of TEFAS's fund comparison page,
`/api/funds/fonYonetimBazliBilgiGetir`, which answers for every fund of one
kind in a single request: two requests (securities and pension funds) cover
the whole universe. Found on the site itself on 2026-09-27; `tefas-crawler`
does not expose it, so it is reached through the crawler's own session, like
the profile endpoint in `src.universe`.

## What is used, and what is not

- `uygulananYu1Y` — the fee the fund **actually applies**, annual percent.
  For securities funds it is the management fee
  ("uygulananYonetimUcretiOranYillikYuzde"); for pension funds the same
  field carries the fund operating expense ("uygulananFonIsletimGideriOranı").
  The kind travels with the rate, because the two are not the same charge
  and the page names them differently. Present for all 1,380 tradeable funds
  on the day it was checked.
- `fonIcTuzukYu1G`, the fee the bylaws allow, is **not** used: its header is
  null for 315 funds, and a ceiling is not what anyone is charged.
- `fonTopGiderKesoran`, the "azami toplam gider oranı", is **not** used: it is
  the regulatory cap for the fund's type, not the fund's expenses, and it
  arrives as "2,", "1585", "0,002986" and null.

A rate of exactly zero is kept as reported (13 securities funds on the day
checked). It may be a waived fee or a gap in TEFAS's data, and nothing here
can tell which, so it is passed on as `0.0` and the page says "sıfır
bildirilmiş" rather than presenting it as a finding.

Anything unparseable, negative or above `MAX_RATE` is dropped rather than
guessed at: the fee is an extra on a page that works without it.

The fee is already inside every return this site prints — TEFAS prices are
net of it — so it is never subtracted from anything.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

FEES_ENDPOINT = "/api/funds/fonYonetimBazliBilgiGetir"
FUND_TYPES = ("YAT", "EMK")
#: Annual percent above which a value is taken to be malformed, not a fee.
MAX_RATE = 10.0

#: `altbaslik1` values seen on the day checked, mapped to the API's code.
_KINDS = {
    "uygulananyonetimucretioranyillikyuzde": "management",
    "uygulananfonisletimgiderioraniyillik": "operating",
}


@dataclass(frozen=True)
class Fee:
    #: Annual rate as a fraction: 0.0204 for "2,04".
    rate: float
    #: "management" (securities funds) or "operating" (pension funds).
    kind: str


def parse_rate(raw) -> Optional[float]:
    """"2,04" -> 0.0204. None for anything that is not a plausible fee."""
    if raw is None:
        return None
    text = str(raw).strip().replace(" ", "")
    if not text:
        return None
    text = text.rstrip(",.").replace(".", "").replace(",", ".") if "," in text else text
    try:
        value = float(text)
    except ValueError:
        return None
    if not (0.0 <= value <= MAX_RATE):
        return None
    return value / 100.0


def _kind(row: dict, fund_type: str) -> str:
    header = str(row.get("altbaslik1") or "").lower()
    for key, kind in _KINDS.items():
        if key in header:
            return kind
    return "operating" if fund_type == "EMK" else "management"


def parse_rows(rows: list[dict], fund_type: str) -> dict[str, Fee]:
    out: dict[str, Fee] = {}
    for row in rows:
        code = str(row.get("fonKodu") or "").strip().upper()
        rate = parse_rate(row.get("uygulananYu1Y"))
        if code and rate is not None:
            out[code] = Fee(rate=rate, kind=_kind(row, fund_type))
    return out


def load_fees(crawler) -> dict[str, Fee]:
    """Every fund's applied fee, keyed by code. Raises if a request fails.

    `crawler` is a `tefas.Crawler` (`TEFASClient()._crawler`). All funds of
    each kind, tradeable or not: a basket can hold a fund with no page, and
    two requests cost the same either way.
    """
    fees: dict[str, Fee] = {}
    for fund_type in FUND_TYPES:
        rows = crawler._do_post(
            FEES_ENDPOINT,
            {
                "dil": "TR",
                "fonTipi": fund_type,
                "kurucuKodu": None,
                "fonTurKod": None,
                "fonGrubu": None,
                "fonTurAciklama": None,
                "islem": None,
                "sfonTurKod": None,
            },
        )
        parsed = parse_rows(rows, fund_type)
        logger.info("Fees: %d of %d %s rows usable", len(parsed), len(rows), fund_type)
        fees.update(parsed)
    if not fees:
        raise RuntimeError("TEFAS returned no usable fee rows")
    return fees
