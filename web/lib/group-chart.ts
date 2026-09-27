/**
 * A market group's members over the last year, as SVG paths.
 *
 * Presentation only: each member's stored weekly line is laid on one date
 * axis and re-based to 100 at the first week every member priced, so all
 * the lines leave the same point and the picture shows whether they then
 * stay together — which is the group's whole claim. Paths are computed on
 * the server; the page ships strings, not series.
 */

import type { GroupMember } from "@/lib/api";
import { path, rebase } from "@/lib/neighbour-chart";

const WEEK = 7 * 86_400_000;

export interface GrupCizgileri {
  paths: { code: string; d: string }[];
  baseY: number;
  lo: number;
  hi: number;
  start: string;
  end: string;
  weeks: number;
}

export function grupCizgileri(
  members: GroupMember[],
  width: number,
  height: number,
  pad = 6,
): GrupCizgileri | null {
  const series = members
    .filter((m) => m.recent && m.recent.values.length > 1)
    .map((m) => ({ code: m.fund.code, s: m.recent! }));
  if (series.length === 0) return null;

  const t0 = Math.min(...series.map((x) => Date.parse(x.s.start)));
  const t1 = Math.max(
    ...series.map((x) => Date.parse(x.s.start) + (x.s.values.length - 1) * WEEK),
  );
  const n = Math.round((t1 - t0) / WEEK) + 1;

  // Every member on the shared axis, blank where it has no week.
  const aligned = series.map(({ code, s }) => {
    const off = Math.round((Date.parse(s.start) - t0) / WEEK);
    const vs: (number | null)[] = Array(n).fill(null);
    s.values.forEach((v, i) => {
      if (off + i >= 0 && off + i < n) vs[off + i] = v;
    });
    return { code, vs };
  });

  // The first week all of them priced; failing that, the first any did.
  let first = [...Array(n).keys()].find((i) => aligned.every((a) => a.vs[i] !== null));
  if (first === undefined) first = 0;
  const based = aligned.map((a) => ({ code: a.code, vs: rebase(a.vs, first!).map((v, i) => (i < first! ? null : v)) }));

  const all = based.flatMap((b) => b.vs).filter((v): v is number => v !== null);
  if (all.length < 2) return null;
  let lo = Math.min(...all, 100);
  let hi = Math.max(...all, 100);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number) => pad + ((i - first!) / Math.max(n - 1 - first!, 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);

  return {
    paths: based.map((b) => ({ code: b.code, d: path(b.vs, x, y) })).filter((p) => p.d),
    baseY: y(100),
    lo,
    hi,
    start: new Date(t0 + first * WEEK).toISOString().slice(0, 10),
    end: new Date(t1).toISOString().slice(0, 10),
    weeks: n - first,
  };
}
