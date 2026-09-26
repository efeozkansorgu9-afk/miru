"""
USD/TRY from TCMB EVDS, for dollar-based returns.

The same endpoint, header and failure contract as `src.inflation`: anything
expected — no key, no network, a rejected key, an empty answer — returns
None with the reason logged, and the page shows the TL figures without a
dollar one. A dollar return is an extra, never a reason a page fails.

The rate is TCMB's indicative buying rate (döviz alış), the published
reference most readers mean by "the dollar rate". Two codes, tried in
order, so a renamed series degrades to its sibling rather than to nothing.
"""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional, Sequence

import pandas as pd
import requests

from src.inflation import API_KEY_ENV, EVDS_BASE, REQUEST_TIMEOUT

logger = logging.getLogger(__name__)

USD_SERIES: tuple[str, ...] = ("TP.DK.USD.A.YTL", "TP.DK.USD.S.YTL")


def _parse_day(raw) -> Optional[pd.Timestamp]:
    """EVDS dates a daily series "25-09-2026"."""
    if not isinstance(raw, str):
        return None
    try:
        return pd.Timestamp(pd.to_datetime(raw, format="%d-%m-%Y"))
    except (TypeError, ValueError):
        return None


def _fetch(code: str, start: date, end: date, key: str) -> pd.Series:
    url = (
        f"{EVDS_BASE}/series={code}"
        f"&startDate={start.strftime('%d-%m-%Y')}"
        f"&endDate={end.strftime('%d-%m-%Y')}"
        f"&type=json"
    )
    response = requests.get(url, headers={"key": key}, timeout=REQUEST_TIMEOUT)
    if response.status_code != 200:
        raise RuntimeError(f"EVDS answered {response.status_code}: {response.text[:120].strip()}")
    items = response.json().get("items") or []
    field = code.replace(".", "_")
    rows = {}
    for item in items:
        day = _parse_day(item.get("Tarih"))
        raw = item.get(field)
        if day is None or raw in (None, "", "null"):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            rows[day] = value
    return pd.Series(rows, dtype="float64").sort_index()


#: One request per this many days. A single six-year request came back
#: covering only the recent end (live, 2026-09-27: 6 and 12 month dollar
#: returns present, 36 and 48 missing), so the span is asked for a year at
#: a time and stitched; the pieces do not overlap.
CHUNK_DAYS = 365


def _fetch_chunked(code: str, start: date, end: date, key: str) -> pd.Series:
    parts = []
    lo = pd.Timestamp(start)
    hi = pd.Timestamp(end)
    while lo <= hi:
        top = min(lo + pd.Timedelta(days=CHUNK_DAYS - 1), hi)
        parts.append(_fetch(code, lo.date(), top.date(), key))
        lo = top + pd.Timedelta(days=1)
    parts = [p for p in parts if not p.empty]
    if not parts:
        return pd.Series(dtype="float64")
    out = pd.concat(parts).sort_index()
    return out[~out.index.duplicated(keep="last")]


def load_usdtry(
    start: date,
    end: date,
    *,
    api_key: Optional[str] = None,
    series: Sequence[str] = USD_SERIES,
) -> Optional[pd.Series]:
    """Daily USD/TRY between two dates (business days only), or None."""
    key = api_key or os.environ.get(API_KEY_ENV)
    if not key:
        logger.info("USD/TRY skipped: %s is not set", API_KEY_ENV)
        return None
    for code in series:
        try:
            s = _fetch_chunked(code, start, end, key)
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            logger.warning("USD/TRY series %s failed: %s", code, exc)
            continue
        if not s.empty:
            s.name = code
            return s
        logger.warning("USD/TRY series %s answered empty", code)
    return None
