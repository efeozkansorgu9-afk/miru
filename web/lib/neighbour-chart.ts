/**
 * The neighbour card's small chart: the neighbour's last year beside the
 * subject fund's same weeks, both re-based to 100 on the first week both
 * priced. Slicing, aligning and scaling only — no figure is derived here,
 * and the card prints none off it.
 *
 * Aligned by date, not by position. The subject's series starts years
 * earlier than the neighbour's recent slice, and the two only share a step
 * (seven days), so the offset is the gap between their starts in weeks. A
 * slice that does not land on the subject's grid draws the neighbour alone
 * rather than a line shifted by some days.
 */

import type { WeeklySeries } from "@/lib/api";

export interface SparkLines {
  /** SVG path data, one per line, already in the viewBox's coordinates. */
  subject: string | null;
  neighbour: string;
  /** Where 100 sits, for the faint start line. */
  baseY: number;
  weeks: number;
}

const DAY = 86_400_000;

function days(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / DAY;
}

/** The subject's values over exactly the neighbour's weeks, or null. */
function alignedSubject(
  subject: WeeklySeries | null,
  recent: WeeklySeries,
): (number | null)[] | null {
  if (!subject || subject.step_days !== recent.step_days) return null;
  const gap = days(recent.start) - days(subject.start);
  if (gap % subject.step_days !== 0) return null;
  const offset = gap / subject.step_days;
  if (offset < 0) return null;
  const slice = subject.values.slice(offset, offset + recent.values.length);
  return slice.length === recent.values.length ? slice : null;
}

function rebase(values: (number | null)[], at: number): (number | null)[] {
  const base = values[at];
  if (base === null || base === undefined || base === 0) return values.map(() => null);
  return values.map((v) => (v === null ? null : (100 * v) / base));
}

/**
 * A path that lifts the pen over a blank week. A gap reads as a gap here
 * as everywhere else in this product: nothing is filled across it.
 */
function path(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function sparkLines(
  subject: WeeklySeries | null,
  recent: WeeklySeries | null | undefined,
  width: number,
  height: number,
  pad = 4,
): SparkLines | null {
  if (!recent || recent.values.filter((v) => v !== null).length < 2) return null;

  const own = alignedSubject(subject, recent);
  // Start both where both have a price, so they leave 100 together.
  const first = recent.values.findIndex(
    (v, i) => v !== null && (!own || own[i] !== null),
  );
  if (first < 0) return null;

  const n = rebase(recent.values, first);
  const s = own ? rebase(own, first) : null;

  const all = [...n, ...(s ?? [])].filter((v): v is number => v !== null);
  let lo = Math.min(...all, 100);
  let hi = Math.max(...all, 100);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }

  const last = recent.values.length - 1;
  const x = (i: number) => pad + ((i - first) / Math.max(last - first, 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);

  // Weeks before `first` are left out rather than drawn from an unshared base.
  const from = (vs: (number | null)[]) => vs.map((v, i) => (i < first ? null : v));

  return {
    subject: s ? path(from(s), x, y) || null : null,
    neighbour: path(from(n), x, y),
    baseY: y(100),
    weeks: recent.values.length - first,
  };
}
