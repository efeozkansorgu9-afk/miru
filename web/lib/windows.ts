/**
 * Time windows, read from the same file the backend reads.
 *
 * `web/lib/windows.json` is the single source. It exists because the name
 * `HISTORY_MONTHS` had been used for four different quantities across two
 * languages — the basket window here (60), a copy of it in the scenario
 * check (60), how much CPI to load (72), and what the weekly job fetched
 * (36) — and nothing connected them. The last one silently decided whether
 * 850 funds had a 36-month return at all.
 *
 * Two things come out of it, and they are different quantities with
 * different justifications, so they have different names.
 */

import raw from "./windows.json";

/**
 * How much history a basket analysis asks for: all of it.
 *
 * A measured fact rather than a preference. The TEFAS price endpoint serves
 * five years back from today and truncates anything longer without saying
 * so — asking for 72, 84 or 120 months of GAL, AFO or TI2 on 2026-09-09 all
 * returned the same first row, 2021-09-08. So this is not "our chosen
 * window", it is the whole of what exists, and there is no control for it on
 * the page: how far back to look is not a judgement a reader is equipped to
 * make, and getting it wrong quietly changes the answer.
 */
export const BASKET_MONTHS: number = raw.tefas_reach_months;

/**
 * The return windows the fund page offers, shortest first.
 *
 * The same list `src.windows.RETURN_PERIODS` gives the weekly job, so the
 * selector cannot offer a period nothing was computed for.
 *
 * There is deliberately no 60. A five-year window would end at the last
 * published CPI month — both figures must be measured over the same days or
 * the gap between them is not inflation — and would therefore need prices
 * from before TEFAS's floor. Verified rather than assumed: GAL, with the
 * full five years, cannot produce a 60-month return at all. 48 is the
 * longest round window that can be measured, and calling 48 months "5 yıl"
 * would be the thing this product does not do.
 */
export const RETURN_PERIODS: readonly number[] = raw.return_periods_months;
