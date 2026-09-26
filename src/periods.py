"""
How the asset classes moved against each other, calendar year by year.

A correlation measured over four years is an average of regimes. Turkish
equities and gold moved against each other through 2025 and together
through 2026; over the whole window the two average to "unrelated", which
describes neither year. This module splits the style factors' weekly
returns (`src.style`: one passive TEFAS fund per asset class) into calendar
years and says, for each year, which relationships were different from the
other years — not from the whole window, which contains the year itself.

## The test

For each pair of factors and each year, the correlation inside the year is
compared with the correlation over every other week, by the difference of
Fisher z values over its standard error:

    z = (atanh r_year − atanh r_rest) / sqrt(1/(n_year − 3) + 1/(n_rest − 3))

The two samples share no week, so they are independent and the test is the
standard one. With eight factors a year holds 28 pairs, so 28 tests are
read together; a Bonferroni correction within the year keeps the chance of
reporting even one change that is not there at 5%: |z| above
`z_critical(28)` = 3.12. Measured before this was written (2026-09-27, live
proxies, 218 weeks): 47 of 140 pair-years clear an uncorrected 1.96, which
is far above the ~7 chance alone would produce, and the corrected line is
what keeps those ~7 out of the page.

A year needs `MIN_PERIOD_WEEKS` weeks to be reported at all; the stored grid
starts mid-2022, so the first and last years are partial and say so.

Pure computation: no network, no database, no display text.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import NormalDist

import numpy as np
import pandas as pd

MIN_PERIOD_WEEKS = 20
#: Family-wise error rate per year.
ALPHA = 0.05
#: A year with at least this many weeks is called complete.
FULL_YEAR_WEEKS = 50
WEEKS_PER_YEAR = 52


def z_critical(tests: int, alpha: float = ALPHA) -> float:
    """Two-sided Bonferroni line for `tests` simultaneous tests."""
    return NormalDist().inv_cdf(1 - alpha / (2 * max(tests, 1)))


@dataclass(frozen=True)
class Shift:
    a: str
    b: str
    corr: float
    rest: float
    z: float


@dataclass
class Period:
    key: str
    start: pd.Timestamp
    end: pd.Timestamp
    weeks: int
    partial: bool
    corr: pd.DataFrame
    volatility: dict[str, float]
    shifts: list[Shift] = field(default_factory=list)


def _vol(frame: pd.DataFrame) -> dict[str, float]:
    return {
        str(k): float(v * np.sqrt(WEEKS_PER_YEAR))
        for k, v in frame.std(ddof=1).items()
        if np.isfinite(v)
    }


def calendar_periods(factors: pd.DataFrame) -> tuple[Period, list[Period]]:
    """The whole window, and one `Period` per calendar year with enough weeks.

    `factors` is week × factor key with complete rows (`StyleModel.factors`).
    """
    frame = factors.dropna(how="any").sort_index()
    keys = [str(c) for c in frame.columns]

    whole = Period(
        key="all",
        start=frame.index[0],
        end=frame.index[-1],
        weeks=len(frame),
        partial=False,
        corr=frame.corr(),
        volatility=_vol(frame),
    )

    years = frame.index.year
    pairs = [(i, j) for i in range(len(keys)) for j in range(i + 1, len(keys))]
    line = z_critical(len(pairs))
    out: list[Period] = []
    for year in sorted(set(years)):
        inside = frame[years == year]
        rest = frame[years != year]
        if len(inside) < MIN_PERIOD_WEEKS or len(rest) < MIN_PERIOD_WEEKS:
            continue
        c_in = inside.corr().to_numpy()
        c_out = rest.corr().to_numpy()
        n_in, n_out = len(inside), len(rest)
        se = np.sqrt(1.0 / (n_in - 3) + 1.0 / (n_out - 3))
        shifts: list[Shift] = []
        for i, j in pairs:
            r1, r2 = c_in[i, j], c_out[i, j]
            if not (np.isfinite(r1) and np.isfinite(r2)):
                continue
            # Clip away from ±1 so a perfectly collinear pair cannot give an
            # infinite z; no weekly pair of funds gets that close.
            z = (np.arctanh(np.clip(r1, -0.9999, 0.9999))
                 - np.arctanh(np.clip(r2, -0.9999, 0.9999))) / se
            if abs(z) > line:
                shifts.append(Shift(keys[i], keys[j], float(r1), float(r2), float(z)))
        shifts.sort(key=lambda s: -abs(s.z))
        out.append(
            Period(
                key=str(year),
                start=inside.index[0],
                end=inside.index[-1],
                weeks=n_in,
                partial=n_in < FULL_YEAR_WEEKS,
                corr=inside.corr(),
                volatility=_vol(inside),
                shifts=shifts,
            )
        )
    return whole, out
