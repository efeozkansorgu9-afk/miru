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
  /** Share of the market's movement, or null when the API did not send it. */
  risk: number | null;
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
  const kelimeler = ayirtKelimeler(c);
  const govde = bilesimAdi(c);
  // The words lead: they are what differs between groups whose make-up
  // reads the same, and 26 groups read "Türk hisse · TL faiz" on the
  // style analysis alone.
  return kelimeler.length > 0 ? `${kelimeler.map((k) => k.ad).join(" · ")} — ${govde}` : govde;
}

/** The composition half of a group's name. */
export function bilesimAdi(c: MarketCluster): string {
  const b = bilesim(c.style);
  return b && b.length > 0
    ? b.map((x) => `${x.ad} %${Math.round(x.pay * 100)}`).join(" · ")
    : `${c.top_category ?? "Karışık"} · bileşimi belirlenemedi`;
}

/**
 * The title words the API may single out, named and with the word the
 * reader will find in the funds' titles. The name leads a group's heading;
 * the evidence goes under it with its count, so the heading can be checked
 * against the list.
 */
export const KELIMELER: Record<string, { ad: string; kanit: string }> = {
  participation: { ad: "Katılım", kanit: "katılım" },
  dividend: { ad: "Temettü", kanit: "temettü / kâr payı" },
  bank: { ad: "Banka", kanit: "banka" },
  tech: { ad: "Teknoloji", kanit: "teknoloji" },
  bist30: { ad: "BIST 30", kanit: "BIST 30" },
  bist100: { ad: "BIST 100", kanit: "BIST 100" },
  sustainability: { ad: "Sürdürülebilirlik", kanit: "sürdürülebilir" },
  energy: { ad: "Enerji", kanit: "enerji" },
  health: { ad: "Sağlık", kanit: "sağlık" },
  industry: { ad: "Sanayi", kanit: "sanayi" },
  export: { ad: "İhracat", kanit: "ihracat" },
  sme: { ad: "Halka arz", kanit: "halka arz / KOBİ" },
  real_estate: { ad: "Gayrimenkul", kanit: "gayrimenkul" },
  foreign: { ad: "Yabancı", kanit: "yabancı" },
  eurobond: { ad: "Eurobond", kanit: "eurobond" },
  fund_of_funds: { ad: "Fon sepeti", kanit: "fon sepeti" },
  short_term: { ad: "Kısa vadeli", kanit: "kısa vadeli" },
  money_market: { ad: "Para piyasası", kanit: "para piyasası" },
  gold: { ad: "Altın", kanit: "altın" },
  silver: { ad: "Gümüş", kanit: "gümüş" },
  usd: { ad: "Dolar", kanit: "dolar" },
  eur: { ad: "Avro", kanit: "avro / euro" },
  hedge: { ad: "Serbest", kanit: "serbest" },
  oks: { ad: "OKS", kanit: "OKS" },
  pension: { ad: "Emeklilik", kanit: "emeklilik" },
  variable: { ad: "Değişken", kanit: "değişken" },
  index: { ad: "Endeks", kanit: "endeks" },
};

/** The group's distinguishing title words, named, theme first. */
export function ayirtKelimeler(
  c: MarketCluster,
): { ad: string; kanit: string; count: number; of: number }[] {
  return (c.qualifiers ?? [])
    .filter((x) => x.kind === "word")
    .map((q) => ({ ...(KELIMELER[q.key] ?? { ad: q.key, kanit: q.key }), count: q.count, of: q.of }));
}

/** Evidence lines under a heading: which word, which house, how many of how many. */
export function ayirtSatirlari(c: MarketCluster): string[] {
  const out: string[] = [];
  for (const k of ayirtKelimeler(c)) {
    out.push(`Adında “${k.kanit}” geçen: ${k.count} / ${k.of} fon`);
  }
  const f = c.qualifiers?.find((x) => x.kind === "founder");
  if (f) out.push(`Kurucusu ${f.key}: ${f.count} / ${f.of} fon`);
  return out;
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
  // The movement shares are drawn only when every group has one: a bar
  // missing a slice would put the rest at the wrong widths.
  const riskVar = m.clusters.length > 0 && m.clusters.every((c) => typeof c.risk_share === "number");
  const risk = (cs: typeof m.clusters) =>
    riskVar ? cs.reduce((a, c) => a + (c.risk_share ?? 0), 0) : null;
  const renkli = m.clusters.slice(0, RENKLI_GRUP);
  const kalan = m.clusters.slice(RENKLI_GRUP);
  const out: Dilim[] = renkli.map((c, i) => ({
    anahtar: `g${i + 1}`,
    etiket: `${i + 1}. grup`,
    alt: grupAdi(c),
    renk: `var(--group-${i + 1})`,
    fon: c.size,
    para: c.total_assets ?? 0,
    risk: risk([c]),
  }));
  if (kalan.length > 0) {
    out.push({
      anahtar: "diger",
      etiket: `Diğer ${kalan.length} grup`,
      renk: "var(--ink-subtle)",
      fon: kalan.reduce((a, c) => a + c.size, 0),
      para: kalan.reduce((a, c) => a + (c.total_assets ?? 0), 0),
      risk: risk(kalan),
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
    // By difference too: the shares sum to 1 over every sized fund, and
    // what the groups do not carry, the funds with no twin do. It can come
    // out slightly negative on a pairwise covariance; floored for drawing,
    // since a sliver below zero is not a slice.
    risk: riskVar ? Math.max(1 - (risk(m.clusters) ?? 0), 0) : null,
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
