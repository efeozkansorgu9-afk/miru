"""
Example-basket drift check
==========================
The four example baskets the frontend loads are claims about live data. Each
one exists to produce a particular verdict — a group holding about half the
money, a group holding most of it, no group at all, a lone holding — and the
sentence printed beside it says what is in the basket on the strength of
that.

Correlations are recomputed every week. So the claim can go stale on its own,
without anyone touching the code: two gold funds that ran at 0,986 for five
years may drift below the grouping threshold, and the example that exists to
show a group would quietly stop showing one. Nothing on the page would say
so, and the pool's own comments would still assert the old verdict. That is
the product's rule about not claiming what it has not measured, broken from
the inside.

This module re-measures. It reads the same JSON the frontend builds its
baskets from — `web/lib/sample-scenarios.json`, the only place those fund
codes are written — runs each basket through the live path, and reports
which scenarios no longer produce the verdict they promise.

It reports. It does not fix: choosing a replacement fund is a judgement about
what the example is for, and a job that silently swapped one would leave the
pool asserting something nobody chose.

**The live path, not the job's own matrix.** The weekly job has a 36-month
union matrix in hand and it would be cheaper to reuse it, but that is not
what the page computes: `/analyze` inner-joins a 60-month window for the
basket alone, and a tier measured on a different window and a different join
is a different number. Fourteen holdings across four baskets are ten unique
codes, so this costs ten TEFAS requests and answers the question actually
being asked.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from src import analysis as an
from src import data as dl

logger = logging.getLogger(__name__)

#: The shared definition, relative to the repository root. Under `web/`
#: because the frontend imports it directly and a build cannot reach outside
#: its own tree; read from here because duplicating the codes is the one
#: failure this module exists to prevent.
SCENARIO_FILE = Path("web/lib/sample-scenarios.json")

#: The thresholds `web/lib/result.ts` splits the tiers on. Mirrored rather
#: than imported, because they live in TypeScript; the assertion below is
#: that they still agree, and if they stop the check reports the wrong tier
#: rather than the wrong verdict, which is why they are named here in full.
GROUP_DOMINANT = 0.5
GROUP_NOTABLE = 0.25

#: How much history the frontend asks for. `web/lib/request.ts` sends 60.
HISTORY_MONTHS = 60


@dataclass(frozen=True)
class ScenarioResult:
    """One example basket, re-measured."""

    id: str
    expected: str
    #: What it produces now, or None when the basket could not be analysed
    #: at all — which is itself a drift worth reporting.
    actual: Optional[str]
    #: The measurement behind `actual`, for the log line.
    detail: str

    @property
    def holds(self) -> bool:
        return self.actual == self.expected

    def __str__(self) -> str:
        mark = "ok" if self.holds else "DRIFTED"
        return (
            f"[{mark}] {self.id}: expected {self.expected}, "
            f"got {self.actual or 'no analysis'} — {self.detail}"
        )


def load_scenarios(path: Path | str = SCENARIO_FILE) -> list[dict]:
    """The scenarios as the frontend has them.

    Raises rather than returning an empty list. A missing or unreadable file
    means the check cannot run, and a check that silently passes because it
    found nothing to check is worse than no check.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scenarios = payload.get("scenarios") or []
    if not scenarios:
        raise ValueError(f"{path} carries no scenarios")
    return scenarios


def tier(analysis, grouping) -> str:
    """The `mainFinding` tier for one analysed basket.

    The same four-way split `web/lib/result.ts` makes, in the same order.
    Kept to the tiers a *pool* basket can produce: the frontend also has a
    `minor` tier for a group under a quarter of the money, and a scenario
    landing there would be reported as drift, correctly, because none of the
    four is meant to.
    """
    if analysis.is_single_fund:
        return "single"
    if not grouping.groups:
        return "none"
    if grouping.grouped_weight > GROUP_DOMINANT:
        return "dominant"
    if grouping.grouped_weight >= GROUP_NOTABLE:
        return "notable"
    return "minor"


def check_scenario(scenario: dict, months: int = HISTORY_MONTHS) -> ScenarioResult:
    """Re-measure one example basket down the live path.

    Never raises for a data problem. A basket that cannot be fetched or
    analysed comes back with `actual=None`, which reads as drift and gets
    reported like any other — the point is to say something is wrong, not to
    take the weekly job down with it.
    """
    sid = scenario.get("id", "?")
    expected = scenario.get("expect", "?")
    holdings = scenario.get("holdings") or []
    codes = [h["code"] for h in holdings]

    try:
        ds = dl.load_price_data(codes, months=months)
        prices = ds.trimmed
        if prices.empty:
            return ScenarioResult(
                sid, expected, None,
                f"no common window for {', '.join(codes)}"
                + (f"; failed: {', '.join(sorted(ds.failed_codes))}"
                   if ds.failed_codes else ""),
            )

        # Weights as the page sends them: the amount typed against each fund,
        # for the funds that actually made it into the matrix.
        weights = {
            h["code"]: float(h["amount"])
            for h in holdings
            if h["code"] in prices.columns
        }
        analysis = an.analyze_basket(prices, weights)
        grouping = an.find_fund_groups(analysis.correlation, analysis.weights)
        got = tier(analysis, grouping)

        pairs = ""
        if analysis.correlation is not None:
            m = analysis.correlation
            worst = [
                (float(m.iloc[i, j]), m.columns[i], m.columns[j])
                for i in range(len(m.columns))
                for j in range(i + 1, len(m.columns))
            ]
            if worst:
                r, a, b = max(worst, key=lambda p: abs(p[0]))
                pairs = f", strongest pair {a}/{b}={r:.3f}"

        detail = (
            f"grouped weight {grouping.grouped_weight:.3f} over "
            f"{analysis.weekly_observations} weeks{pairs}"
        )
        if ds.excluded_codes:
            detail += f"; excluded: {', '.join(sorted(ds.excluded_codes))}"
        return ScenarioResult(sid, expected, got, detail)

    except Exception as exc:  # noqa: BLE001 - reported, never fatal
        return ScenarioResult(sid, expected, None, f"{type(exc).__name__}: {exc}")


def check_all(
    path: Path | str = SCENARIO_FILE, months: int = HISTORY_MONTHS
) -> list[ScenarioResult]:
    """Every scenario, in the order the pool hands them out."""
    results = [check_scenario(s, months) for s in load_scenarios(path)]
    for result in results:
        if result.holds:
            logger.info("Scenario %s", result)
        else:
            logger.warning("Scenario %s", result)
    return results


def report(results: list[ScenarioResult]) -> str:
    """A block for the job's own output, and for `job_runs.detail`.

    Deliberately loud and deliberately not an exception. The scenarios are a
    frontend concern and a run that wrote 1374 funds correctly has not failed
    because an example basket moved — but a warning nobody sees is the same
    as no check, so this goes to stdout as a block with a rule round it and
    into the run's stored detail.
    """
    drifted = [r for r in results if not r.holds]
    if not drifted:
        return f"scenario check: all {len(results)} example baskets hold"

    lines = [
        f"scenario check: {len(drifted)} of {len(results)} example baskets "
        f"no longer produce the verdict they promise"
    ]
    lines += [f"  {r}" for r in drifted]
    lines.append(
        "  fix by choosing different funds in web/lib/sample-scenarios.json "
        "and re-measuring; do not reword the note to fit"
    )
    return "\n".join(lines)
