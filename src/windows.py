"""
Time windows
============
How far back to fetch, and over which periods a return is reported. One
module, because the name `HISTORY_MONTHS` had been used for four different
quantities across two languages — the basket window (60), a copy of it in the
scenario check (60), how much CPI to load (72), and what the weekly job
fetched (36) — and the last of those quietly decided whether 850 funds had a
36-month return at all.

The values live in `web/lib/windows.json` so the frontend reads the same
list; this module is the Python half of it.

## Why the fetch window is longer than the longest period

A return window does not end today. It ends on the last day the CPI can
price, because the nominal and real figures have to be measured over the same
days or the gap between them is not inflation. TÜİK publishes a month's index
in the first days of the next, so that cap sits anywhere from a few days to
about five weeks behind today.

The prices, meanwhile, are fetched *from today* backwards. So a 36-month
return needs prices from 36 months before the **cap**, while a 36-month fetch
only reaches 36 months before **today** — short by exactly the CPI gap, every
time. `precompute.fund_returns` then finds the window's start edge uncovered
and reports `insufficient_history`.

That is not a hypothetical. Simulated against a real GAL series, the existing
36-month figure survives only when the job runs in the first days of a month:

    run date     fetch start   36m
    2026-09-03   2023-09-03    OK
    2026-09-09   2023-09-09    MISSING
    2026-09-20   2023-09-20    MISSING

The database held 850 funds with a 36-month return purely because the last
run happened on the 3rd. A run a week later would have blanked all 850.

So the fetch window is the longest period **plus a margin**, and the margin
is derived rather than picked: at run time from the CPI series actually in
hand, and from the publication calendar when there is no CPI. A hand-chosen
"two months" would be wrong on some day of some month, which is the same bug
with a longer fuse.
"""

from __future__ import annotations

import json
import math
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Optional, Sequence

import pandas as pd

#: The shared definition. Under `web/` for the reason given in the file
#: itself: a Next build cannot import from outside its own tree, and the
#: frontend needs the period list for the fund page's selector.
WINDOWS_FILE = Path(__file__).resolve().parent.parent / "web" / "lib" / "windows.json"


@lru_cache(maxsize=1)
def _config(path: Optional[str] = None) -> dict:
    return json.loads(Path(path or WINDOWS_FILE).read_text(encoding="utf-8"))


def _cfg(key: str):
    value = _config().get(key)
    if value is None:
        raise KeyError(f"{WINDOWS_FILE} has no {key!r}")
    return value


#: How far back the TEFAS price endpoint actually serves, in months. A
#: measured fact: asking for 72, 84 or 120 months returns the same first row
#: as asking for 60. Nothing can be computed over a longer window, whatever
#: is requested.
TEFAS_REACH_MONTHS: int = _cfg("tefas_reach_months")

#: The return windows the product reports, shortest first. The single source:
#: `precompute.fund_returns` computes these, the fund page's selector offers
#: these, and `fetch_months` sizes the fetch from the longest of them.
#:
#: There is deliberately no 60. Such a window would end at the last published
#: CPI month and so would need prices from before TEFAS's floor — verified
#: impossible, not merely tight: GAL, with the full five years, reports
#: `insufficient_history` at 60 months, short by 9 days against a 7-day
#: tolerance, and the shortfall grows to about five weeks later in a month.
#: 48 is the longest round window that can actually be measured.
RETURN_PERIODS: tuple[int, ...] = tuple(_cfg("return_periods_months"))

#: The day of the month by which TÜİK has normally published the previous
#: month's index. Used only for the no-CPI fallback below; when there is a
#: CPI series its own `latest_month` is used instead, which is the real
#: answer rather than an assumption about the calendar.
CPI_RELEASE_DAY: int = _cfg("cpi_release_day_of_month")

#: Slack on top of the derived margin, for the weekend or public holiday that
#: can sit on the window's start edge. Separate from
#: `precompute.RETURN_EDGE_TOLERANCE_DAYS`, which is how much lateness the
#: return itself forgives; this is how much extra history is fetched so that
#: tolerance does not have to be spent.
FETCH_SAFETY_DAYS: int = _cfg("fetch_safety_days")


def cpi_cap(cpi) -> Optional[pd.Timestamp]:
    """The last day the CPI can price, or None when there is no CPI.

    The same quantity as `precompute._cpi_cap`, needed here because the fetch
    window has to be sized before any price is fetched.
    """
    if cpi is None:
        return None
    return pd.Period(cpi.latest_month, freq="M").end_time


def worst_case_cpi_gap_days(release_day: int = CPI_RELEASE_DAY) -> int:
    """The largest gap there can be between today and the CPI cap.

    Derived from the publication calendar rather than guessed. Two cases:

    *After* the release, the newest index is last month's, so the cap is the
    end of last month and the gap is today's day of the month — at most 31.

    *Before* it, the newest index is the month before last, so the cap is the
    end of that month and the gap is the whole of last month plus today's day
    of the month — at most 31 + (release_day - 1).

    The second is larger, so it is the bound. With a release on the 5th that
    is 31 + 4 = 35 days.
    """
    return 31 + max(0, release_day - 1)


def fetch_margin_days(cpi=None, today: Optional[date] = None) -> int:
    """How much further back than the longest period to fetch, in days.

    With a CPI series this is the *actual* gap between today and the cap, so
    the margin is measured rather than assumed. Without one, the return
    window ends at the fund's last priced day and needs no CPI margin at all
    — but a run whose CPI failed should not fetch a window that becomes too
    short the moment the CPI comes back, so the worst case is used.
    """
    now = pd.Timestamp(today or date.today()).normalize()
    cap = cpi_cap(cpi)
    gap = (now - cap.normalize()).days if cap is not None else worst_case_cpi_gap_days()
    return max(0, gap) + FETCH_SAFETY_DAYS


def fetch_months(
    cpi=None,
    today: Optional[date] = None,
    periods: Sequence[int] = RETURN_PERIODS,
) -> int:
    """Months of history to fetch so every return period can be measured.

    The longest period plus the margin, rounded up to whole months at 28 days
    each — the shortest month, so the rounding can only ever over-fetch.

    Clamped to `TEFAS_REACH_MONTHS`, because asking for more returns the same
    rows and asking for less is the bug this function exists to prevent. The
    clamp is not a fallback: with a 48-month longest period and a five-week
    margin the result is 50, comfortably inside the reach.
    """
    longest = max(periods)
    extra = math.ceil(fetch_margin_days(cpi, today) / 28)
    return min(TEFAS_REACH_MONTHS, longest + extra)
