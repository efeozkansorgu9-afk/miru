/**
 * What the market page says, away from the drawing of it.
 *
 * The API returns groups and counts; this turns them into the segments of
 * the two share bars and the label each group goes by. Nothing is measured
 * here and no number is derived that the page then presents as a finding
 * the API did not return — shares are arithmetic on the API's own counts.
 */

import type { MarketCluster, MarketResponse } from "@/lib/api";

/** How many groups get a colour of their own. The rest fold into one grey. */
export const RENKLI_GRUP = 6;

export interface Dilim {
  anahtar: string;
  etiket: string;
  /** A CSS colour: a group slot, or a neutral for the folded remainder. */
  renk: string;
  fon: number;
  para: number;
}

/**
 * A group's name: TEFAS's category when most of its funds share one, and
 * "... ağırlıklı" when it is only the largest of several. Never a name made
 * up from fund titles, which would be this page's judgement wearing data.
 */
export function grupAdi(c: MarketCluster): string {
  if (!c.top_category) return "Karışık grup";
  if ((c.top_category_share ?? 0) >= 0.75) return c.top_category;
  return `${c.top_category} ağırlıklı`;
}

export function dilimler(m: MarketResponse): Dilim[] {
  const renkli = m.clusters.slice(0, RENKLI_GRUP);
  const kalan = m.clusters.slice(RENKLI_GRUP);
  const out: Dilim[] = renkli.map((c, i) => ({
    anahtar: `g${i + 1}`,
    etiket: `${i + 1}. ${grupAdi(c)}`,
    renk: `var(--group-${i + 1})`,
    fon: c.size,
    para: c.total_assets ?? 0,
  }));
  if (kalan.length > 0) {
    out.push({
      anahtar: "diger",
      etiket: `Diğer ${kalan.length} grup`,
      renk: "var(--ink-subtle)",
      fon: kalan.reduce((a, c) => a + c.size, 0),
      para: kalan.reduce((a, c) => a + (c.total_assets ?? 0), 0),
    });
  }
  const gruptakiPara = m.clusters.reduce((a, c) => a + (c.total_assets ?? 0), 0);
  out.push({
    anahtar: "tek",
    etiket: "Eşi olmayan fonlar",
    renk: "var(--border-strong)",
    fon: m.singletons.length,
    // What is not in a group, by difference: the API sizes the measured
    // funds as a whole and each group, not the singletons one by one.
    para: Math.max((m.total_assets_measured ?? 0) - gruptakiPara, 0),
  });
  return out;
}

/** Funds that sit in a multi-fund group, and the share of money they hold. */
export function gruptakiler(m: MarketResponse): { fon: number; paraPayi: number | null } {
  const fon = m.clusters.reduce((a, c) => a + c.size, 0);
  const para = m.clusters.reduce((a, c) => a + (c.total_assets ?? 0), 0);
  const toplam = m.total_assets_measured;
  return { fon, paraPayi: toplam ? para / toplam : null };
}

/** Why a fund could not be measured, as the page says it. */
export const OLCULEMEDI: Record<string, string> = {
  short_history: "karşılaştırmaya yetecek kadar geçmişi yok (52 haftadan az)",
  stale_prices: "fiyatı haftaların çoğunda hiç değişmiyor",
};
