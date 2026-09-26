/**
 * The home page's example pairs, chosen at build time from the last run.
 *
 * Nothing here is written down: every pair, coefficient and line comes out
 * of `/fund/{code}` for a handful of well-known funds, so a correlation
 * that drifts changes the examples instead of leaving the page asserting an
 * old number. The paths are computed here, on the server, so the carousel
 * ships a few strings per card rather than five weekly series.
 *
 * The mix is deliberate. Four overlapping pairs in a row would say "every
 * fund is the same fund", which is not what was measured. So the set is up
 * to three overlapping pairs, one unrelated and one inverse, each only when
 * the run actually found one. Pairs resting on at least `UZUN_GECMIS` shared
 * weeks are preferred; shorter ones (never under the job's own 52) are the
 * fallback, never the first choice.
 */

import { getFundPage } from "@/lib/api";
import type { Bucket, FundPageResponse, Neighbour } from "@/lib/api";
import { sparkLines } from "@/lib/neighbour-chart";

/** Funds most readers will recognise, across gold, equity and foreign. */
const ADAYLAR = ["AFO", "AKU", "TI2", "YAY", "HBF", "TIE", "APT", "AP5"];

const UZUN_GECMIS = 150;

export const ORNEK_W = 360;
export const ORNEK_H = 150;

export type Kurumlar = "ayni" | "ayri" | "bilinmiyor";

export interface OrnekVeri {
  anahtar: string;
  kod: string;
  komsuKod: string;
  bucket: Bucket;
  correlation: number;
  ciLow: number | null;
  ciHigh: number | null;
  nWeeks: number;
  kurumlar: Kurumlar;
  subjectPath: string | null;
  neighbourPath: string;
  baseY: number;
  weeks: number;
}

export interface Ornekler {
  ornekler: OrnekVeri[];
  /** When the run behind them finished, for the counter beside the card. */
  sonOlcum: string | null;
}

function kurumlar(a: string | null, b: string | null): Kurumlar {
  // Unknown is not "different": a founder that could not be read off the
  // title gets the sentence that claims neither.
  if (a === null || b === null) return "bilinmiyor";
  return a === b ? "ayni" : "ayri";
}

function veri(page: FundPageResponse, k: Neighbour): OrnekVeri | null {
  const lines = sparkLines(page.series, k.recent, ORNEK_W, ORNEK_H, 6);
  if (!lines) return null;
  return {
    anahtar: [page.fund.code, k.fund.code].sort().join("-"),
    kod: page.fund.code,
    komsuKod: k.fund.code,
    bucket: k.bucket,
    correlation: k.correlation,
    ciLow: k.ci_low,
    ciHigh: k.ci_high,
    nWeeks: k.n_weeks,
    kurumlar: kurumlar(page.fund.founder, k.fund.founder),
    subjectPath: lines.subject,
    neighbourPath: lines.neighbour,
    baseY: lines.baseY,
    weeks: lines.weeks,
  };
}

/** The best not-yet-used pair of one bucket from one page, or null. */
function sec(
  page: FundPageResponse,
  bucket: Bucket,
  kullanilan: Set<string>,
  minWeeks: number,
): OrnekVeri | null {
  if (!page.series) return null;
  const adaylar = [...page.high, ...page.low]
    .filter((k) => k.bucket === bucket && k.recent && k.n_weeks >= minWeeks)
    .sort((a, b) => b.n_weeks - a.n_weeks);
  for (const k of adaylar) {
    const v = veri(page, k);
    if (v && !kullanilan.has(v.anahtar)) return v;
  }
  return null;
}

function topla(
  pages: FundPageResponse[],
  bucket: Bucket,
  adet: number,
  kullanilan: Set<string>,
): OrnekVeri[] {
  const out: OrnekVeri[] = [];
  const kodlar = new Set<string>();
  for (const minWeeks of [UZUN_GECMIS, 52]) {
    for (const page of pages) {
      if (out.length >= adet) return out;
      // One example per subject fund, so the set is not five views of AFO.
      if (kodlar.has(page.fund.code)) continue;
      const v = sec(page, bucket, kullanilan, minWeeks);
      if (v) {
        out.push(v);
        kullanilan.add(v.anahtar);
        kodlar.add(page.fund.code);
      }
    }
  }
  return out;
}

export async function ornekleriBul(): Promise<Ornekler> {
  const results = await Promise.allSettled(
    ADAYLAR.map((code) => getFundPage(code, { timeoutMs: 20_000 })),
  );
  const pages = results
    .filter((r): r is PromiseFulfilledResult<FundPageResponse> => r.status === "fulfilled")
    .map((r) => r.value);

  const kullanilan = new Set<string>();
  const ortusen = topla(pages, "overlapping", 3, kullanilan);
  const iliskisiz = topla(pages, "unrelated", 1, kullanilan);
  const ters = topla(pages, "inverse", 1, kullanilan);

  // Interleaved, so the second card already shows a different finding.
  const sira = [ortusen[0], iliskisiz[0], ortusen[1], ters[0], ortusen[2]];
  const ornekler = sira.filter((o): o is OrnekVeri => o !== undefined);

  const sonOlcum =
    pages.find((p) => p.freshness.last_run_at)?.freshness.last_run_at?.slice(0, 10) ??
    null;

  return { ornekler, sonOlcum };
}
