/**
 * The fund page's return chart, and which periods it can offer.
 *
 * Slicing and re-basing only. Every figure the page prints — nominal, real,
 * and the window each was measured over — was computed by the weekly job and
 * arrives ready; nothing here derives a return. What it does is pick the
 * weeks a period covers and re-base two lines to 100 so they can share an
 * axis, which is the same job `lib/result.ts` does for the basket chart.
 *
 * ## The window comes from the data, not from the calendar
 *
 * "6 ay" does not mean 180 days back from today. It means the six months the
 * return was actually measured over, and that window **ends at the last
 * month TÜİK has published an index for** — because the nominal and real
 * figures have to cover the same days or the gap between them is not
 * inflation, it is partly the extra weeks. So the chart reads
 * `window_start` and `window_end` off the period's own `FundReturn` and draws
 * that window, with the axis labels saying which months.
 *
 * Same window, not the same number. The figures are computed on daily prices
 * by the weekly job; this line is the weekly W-FRI series, so its endpoints
 * can sit a few days inside the window's exact edges and the ratio between
 * them can differ from the printed nominal by that much. The figures are the
 * measurement, the line is its shape, and neither is derived from the other.
 *
 * A consequence worth stating: the chart does not run to today. It stops
 * where the figures stop, which is a few days to five weeks back. Drawing
 * the value line further would put the two out of step and make the last
 * stretch of it inflation-free.
 *
 * ## The inflation line is a step
 *
 * The CPI is published monthly and is a level for the whole month. It is
 * never interpolated between months and never carried past the last
 * published one, so every week inside a month takes that month's index
 * unchanged. Drawn, that is a staircase, and it is drawn as one — a smooth
 * curve through monthly points would be a claim about weeks nobody measured.
 */

import type { CPISeries, FundReturn, WeeklySeries } from "@/lib/api";
import { GETIRI_YOK } from "@/lib/fund";

export interface FundChartPoint {
  /** ISO date of the week's Friday. */
  date: string;
  /** The fund, base 100 at the window's first priced week. */
  value: number | null;
  /** Prices, base 100 at the same week. Null after the last CPI month. */
  inflation: number | null;
}

export interface PeriodOption {
  months: number;
  /** "6 ay", "1 yıl", "3 yıl", "4 yıl". */
  label: string;
  /** False when the fund's history does not cover the window. */
  available: boolean;
  /** Why not, when it is not. Null when available. */
  reason: string | null;
  /** The measurement, present whether or not it is complete. */
  ret: FundReturn | null;
}

/**
 * Whole years get "yıl", the rest get "ay".
 *
 * 48 reads "4 yıl" rather than "48 ay" because a reader thinks in years at
 * that length; 6 stays in months for the same reason. There is deliberately
 * no "Hepsi": TEFAS serves five years and no more, so "all" would mean the
 * same thing as the longest option while implying there is more behind it.
 */
export function periodLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} yıl` : `${months} ay`;
}

/**
 * The selector's options, in the order the periods are defined.
 *
 * A period the fund cannot cover is offered **disabled with its reason**
 * rather than hidden. Hiding it would leave a fund with a single button and
 * no explanation of why; and a young fund not having a four year return is a
 * fact about its age, which the page can say. What it must never do is put a
 * number under that label anyway: a return over whatever shorter stretch the
 * fund does have would be a different figure wearing this one's name.
 */
export function periodOptions(
  periods: readonly number[],
  returns: FundReturn[],
): PeriodOption[] {
  return periods.map((months) => {
    const ret = returns.find((r) => r.months === months) ?? null;
    const available = Boolean(
      ret && ret.nominal !== null && ret.window_start && ret.window_end,
    );
    const code = ret?.nominal_unavailable ?? null;
    return {
      months,
      label: periodLabel(months),
      available,
      reason: available ? null : code ? GETIRI_YOK[code] : "ölçüm yok",
      ret,
    };
  });
}

/** The first available period, or the first one at all when none is. */
export function defaultPeriod(options: PeriodOption[]): number | null {
  const usable = options.filter((o) => o.available);
  if (usable.length === 0) return null;
  // The longest available one. It is the window with the most in it, and a
  // reader who wants a shorter view can say so; opening on six months would
  // hide four years of history behind a control they have to find.
  return usable[usable.length - 1].months;
}

/** `values[i]` belongs to this date. */
function weekDate(series: WeeklySeries, i: number): string {
  const start = new Date(`${series.start}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + i * series.step_days);
  return start.toISOString().slice(0, 10);
}

/** How many whole months from `start_month` to the month `iso` falls in. */
function monthOffset(startMonth: string, iso: string): number {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [y, m] = iso.split("-").map(Number);
  return (y - sy) * 12 + (m - sm);
}

/**
 * The points for one period, both lines re-based to the window's start.
 *
 * Returns null when there is nothing honest to draw: no stored series, or a
 * period whose window was never measured. A chart is not produced from an
 * approximate window.
 */
export function fundChartData(
  series: WeeklySeries | null,
  cpi: CPISeries | null,
  ret: FundReturn | null,
): { points: FundChartPoint[]; withInflation: boolean } | null {
  if (!series || !ret || !ret.window_start || !ret.window_end) return null;

  // `window_start` and `window_end` are month starts, so the window runs to
  // the end of `window_end`'s month — that is the month whose index closes
  // it, and the last priced week inside it is the last point to draw.
  const from = ret.window_start;
  const toExclusive = addMonths(ret.window_end, 1);

  const rows: { date: string; raw: number | null }[] = [];
  for (let i = 0; i < series.values.length; i += 1) {
    const date = weekDate(series, i);
    if (date < from) continue;
    if (date >= toExclusive) break;
    rows.push({ date, raw: series.values[i] });
  }
  if (rows.length < 2) return null;

  const base = rows.find((r) => r.raw !== null)?.raw ?? null;
  if (!base) return null;

  // The CPI level for the window's first month, which is what the inflation
  // line is re-based on. Without it there is no line, and the chart draws
  // the value alone rather than a wrong comparison.
  const cpiAt = (iso: string): number | null => {
    if (!cpi) return null;
    if (iso.slice(0, 7) > cpi.latest_month.slice(0, 7)) return null;
    const i = monthOffset(cpi.start_month.slice(0, 7), iso.slice(0, 7));
    return i >= 0 && i < cpi.values.length ? cpi.values[i] : null;
  };
  const cpiBase = cpiAt(from);

  const points = rows.map(({ date, raw }) => {
    const level = cpiBase === null ? null : cpiAt(date);
    return {
      date,
      value: raw === null ? null : round2((100 * raw) / base),
      // Every week in a month carries that month's published index
      // unchanged, and a week past the last published month carries nothing.
      // That is the staircase, and the null is the line stopping.
      inflation:
        level === null || cpiBase === null ? null : round2((100 * level) / cpiBase),
    };
  });

  return { points, withInflation: points.some((p) => p.inflation !== null) };
}

/** "2026-08-01" plus n months, as a month start. */
function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const year = Math.floor(total / 12);
  const month = String((total % 12) + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
