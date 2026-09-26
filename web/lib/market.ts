/**
 * What the market page says, away from the drawing of it.
 *
 * The API returns groups and counts; this turns them into the segments of
 * the two share bars and the label each group goes by. Nothing is measured
 * here and no number is derived that the page then presents as a finding
 * the API did not return — shares are arithmetic on the API's own counts.
 */

import type { MarketCluster, MarketResponse, Style } from "@/lib/api";

/** How many groups get a colour of their own. The rest fold into one grey. */
export const RENKLI_GRUP = 6;

export interface Dilim {
  anahtar: string;
  etiket: string;
  /** What the group is made of, shown muted beside the label. */
  alt?: string;
  /** A CSS colour: a group slot, or a neutral for the folded remainder. */
  renk: string;
  fon: number;
  para: number;
}

/** The factors, in Turkish. Keys are the API's; a new key shows as itself. */
export const ETKEN_ADLARI: Record<string, string> = {
  tr_equity: "Türk hisse",
  gold: "Altın",
  silver: "Gümüş",
  usd: "Dolar",
  eur: "Avro",
  tl_rate: "TL faiz",
  tl_bond: "TL tahvil",
  foreign_equity: "Yabancı hisse",
};

/** What each factor's fund is, for the method note. */
export const ETKEN_ACIKLAMALARI: Record<string, string> = {
  tr_equity: "BIST endeks fonu",
  gold: "altın fonu",
  silver: "gümüş fonu",
  usd: "dolar eurobond fonu",
  eur: "avro döviz fonu",
  tl_rate: "TL para piyasası fonu",
  tl_bond: "TL borçlanma araçları fonu",
  foreign_equity: "yabancı hisse fonu",
};

/** Components worth naming: 10% or more, largest first, at most three. */
export const BILESEN_ESIGI = 0.1;

export interface Bilesen {
  anahtar: string;
  ad: string;
  pay: number;
}

export function bilesim(style: Style | null | undefined): Bilesen[] | null {
  if (!style || !style.reportable) return null;
  return Object.entries(style.weights)
    .filter(([, w]) => w >= BILESEN_ESIGI)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, w]) => ({ anahtar: k, ad: ETKEN_ADLARI[k] ?? k, pay: w }));
}

/**
 * A group's name, from what its returns are made of: "Altın %89",
 * "Dolar %72 · TL faiz %28". When the style analysis could not explain the
 * group well enough, TEFAS's category is used instead and says so, because
 * a category names the legal wrapper, not the contents.
 */
export function grupAdi(c: MarketCluster): string {
  const b = bilesim(c.style);
  if (b && b.length > 0) {
    return b.map((x) => `${x.ad} %${Math.round(x.pay * 100)}`).join(" · ");
  }
  return `${c.top_category ?? "Karışık"} · bileşimi belirlenemedi`;
}

/** TEFAS's own category, as a secondary line under the composition. */
export function kategoriSatiri(c: MarketCluster): string | null {
  if (!c.top_category) return null;
  const pay = c.top_category_share ?? 0;
  return pay >= 0.75
    ? `TEFAS kategorisi: ${c.top_category}`
    : `TEFAS kategorisi: çoğunlukla ${c.top_category}`;
}

export function dilimler(m: MarketResponse): Dilim[] {
  const renkli = m.clusters.slice(0, RENKLI_GRUP);
  const kalan = m.clusters.slice(RENKLI_GRUP);
  const out: Dilim[] = renkli.map((c, i) => ({
    anahtar: `g${i + 1}`,
    etiket: `${i + 1}. grup`,
    alt: grupAdi(c),
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
