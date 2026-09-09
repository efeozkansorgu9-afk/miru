/**
 * The fund page's words and its arrangement, away from the drawing of it.
 *
 * Same split as `lib/result`: the API returns numbers and closed-set codes
 * and never a sentence, so every Turkish string on a fund page is written
 * here and every component under `components/fund` is layout. Nothing in
 * this file fetches, and nothing in it computes a statistic — the weekly job
 * decided every figure the page shows.
 *
 * The bucket vocabulary in particular lives here and nowhere else. It is the
 * one thing a fund page says about a pair, it appears in three places on the
 * screen (a group heading, a row label, a headline), and a second copy of
 * "örtüşen" typed into a component is how those three drift apart.
 */

import type {
  Bucket,
  FundIdentity,
  FundReturn,
  Neighbour,
  NeighboursUnavailable,
  ReturnUnavailable,
} from "@/lib/api";
import { korelasyon } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* The bucket vocabulary                                               */
/* ------------------------------------------------------------------ */

/**
 * One word for what a pair is, for the label on a row.
 *
 * Adjectives, because that is how the row reads: this neighbour is an
 * overlapping one. `Record<Bucket, string>` rather than a lookup with a
 * fallback, so a bucket added to the API without a word here does not
 * compile.
 *
 * None of these is a verdict. A fund that overlaps with another is not worse
 * than one that does not, and an inverse pair is not a hedge — they are
 * measurements, and the page reports them without an adjective of its own.
 */
export const KOVA_ETIKETLERI: Record<Bucket, string> = {
  overlapping: "örtüşen",
  similar: "benzer",
  moderate: "orta",
  unrelated: "ilişkisiz",
  inverse: "ters",
  uncertain: "belirsiz",
  insufficient_data: "yetersiz veri",
};

/** The same words as a heading over the funds that are them. */
export const KOVA_BASLIKLARI: Record<Bucket, string> = {
  overlapping: "Örtüşenler",
  similar: "Benzerler",
  moderate: "Orta ilişkili olanlar",
  unrelated: "İlişkisizler",
  inverse: "Ters hareket edenler",
  uncertain: "Belirsizler",
  insufficient_data: "Yetersiz veri",
};

/** One sentence saying what the group's word means, under its heading. */
export const KOVA_ACIKLAMALARI: Record<Bucket, string> = {
  overlapping:
    "Güven aralığının alt ucu bile 0,85'in üstünde. Bu fonlar aynı hareketi yapıyor.",
  similar: "Güven aralığının alt ucu 0,60'ın üstünde. Yakın hareket ediyorlar.",
  moderate: "Aralığın tamamı 0,30 ile 0,60 arasında. Ölçülmüş, ortalama bir ilişki.",
  unrelated: "Aralığın tamamı artı eksi 0,30 içinde. Ayrı hareket ediyorlar.",
  inverse: "Aralığın üst ucu bile eksi 0,60'ın altında. Ters yönde hareket ediyorlar.",
  uncertain:
    "Güven aralığı bir eşiğin iki yanına düşüyor. Ölçüm bu ikili için bir şey söylemeye yetmiyor.",
  insufficient_data:
    "Ortak hafta sayısı ölçüm için yetersiz. Buradaki sayı bir sonuç değil.",
};

/**
 * The order the groups are read in: closest first, least resolved last.
 *
 * Not the enum's order and not alphabetical. It runs down the strength of
 * the claim — a fund that overlaps with this one is the reason someone came
 * to the page — and puts `uncertain` at the bottom because it is the biggest
 * group by far (12,051 of 24,340 stored pairs) and says the least.
 */
export const KOVA_SIRASI: Bucket[] = [
  "overlapping",
  "similar",
  "moderate",
  "unrelated",
  "inverse",
  "uncertain",
  // Never stored as a neighbour: `top_neighbours` keeps these pairs out of
  // the sort entirely. Listed anyway so that if one ever arrives it lands at
  // the bottom of the page rather than being silently dropped.
  "insufficient_data",
];

/* ------------------------------------------------------------------ */
/* Why something is missing                                            */
/* ------------------------------------------------------------------ */

/** Why one return figure could not be computed. */
export const GETIRI_YOK: Record<ReturnUnavailable, string> = {
  insufficient_history: "fonun geçmişi bu dönemi kapsamıyor",
  cpi_unavailable: "TÜFE verisi alınamadı",
  cpi_window_before_series: "dönem TÜFE serisinden önce başlıyor",
};

/** Why a fund has no neighbours at all. Two different silences. */
export const KOMSU_YOK: Record<NeighboursUnavailable, string> = {
  no_measurable_pairs:
    "Bu fon diğer bütün fonlara karşı ölçüldü, ama hiçbir ikili güvenilir bir " +
    "sonuç vermedi. Ölçüm için gereken ortak hafta sayısına ulaşılamamış.",
  fund_not_priced:
    "Son çalışmada bu fonun fiyat geçmişi alınamadı, bu yüzden hiçbir fonla " +
    "karşılaştırılamadı.",
};

/* ------------------------------------------------------------------ */
/* Neighbours, as one list                                             */
/* ------------------------------------------------------------------ */

export interface KovaGrubu {
  kova: Bucket;
  baslik: string;
  aciklama: string;
  komsular: Neighbour[];
}

/**
 * The stored high and low lists, merged back into one.
 *
 * The API keeps them apart because the job ranked them from two ends: the
 * high list by `ci_low` descending and the low list by `ci_high` ascending.
 * That split is about how the twenty were chosen, not about what they are,
 * and showing it would ask the reader to hold two rankings at once to answer
 * one question. So the page reassembles them and sorts by what a pair *is*.
 *
 * Deduplicated by code. A fund with very few measurable pairs can be ranked
 * into both ends of the same short list, and the same fund twice on one page
 * would read as two findings.
 */
export function komsuListesi(high: Neighbour[], low: Neighbour[]): Neighbour[] {
  const seen = new Set<string>();
  const out: Neighbour[] = [];
  for (const komsu of [...high, ...low]) {
    if (seen.has(komsu.fund.code)) continue;
    seen.add(komsu.fund.code);
    out.push(komsu);
  }
  return out;
}

/**
 * Neighbours in their groups, in reading order, empty groups dropped.
 *
 * Sorted inside a group by the size of the coefficient rather than its
 * value, sign aside. The group heading has already said which way the pair
 * moves, so what orders the rows underneath it is how strongly: in
 * "Ters hareket edenler", -0,80 belongs above -0,65, and ordering by value
 * would put it last.
 */
export function kovaGruplari(komsular: Neighbour[]): KovaGrubu[] {
  return KOVA_SIRASI.map((kova) => ({
    kova,
    baslik: KOVA_BASLIKLARI[kova],
    aciklama: KOVA_ACIKLAMALARI[kova],
    komsular: komsular
      .filter((k) => k.bucket === kova)
      .sort(
        (a, b) =>
          Math.abs(b.correlation) - Math.abs(a.correlation) ||
          a.fund.code.localeCompare(b.fund.code, "tr"),
      ),
  })).filter((grup) => grup.komsular.length > 0);
}

/**
 * Above this many neighbours in total, the list arrives folded.
 *
 * Twenty rows is the normal answer and it is longer than the rest of the
 * page put together, so opening every group would bury the footer and the
 * link out of it. Under eight there is no list to get lost in and folding it
 * would only be one more thing to press.
 */
export const KATLAMA_ESIGI = 8;

/** Rows shown before a group offers the rest behind a line. */
export const GRUP_ONIZLEME = 5;

/**
 * Which groups start open.
 *
 * The topmost non-empty one, which by `KOVA_SIRASI` is the strongest claim
 * the page has about this fund and the one its headline is already about.
 * Below the threshold every group is open, because the whole list is then
 * shorter than the fold would be worth.
 */
export function acikGruplar(gruplar: KovaGrubu[]): Set<Bucket> {
  const toplam = gruplar.reduce((n, g) => n + g.komsular.length, 0);
  if (toplam < KATLAMA_ESIGI) return new Set(gruplar.map((g) => g.kova));
  return new Set(gruplar.length > 0 ? [gruplar[0].kova] : []);
}

/* ------------------------------------------------------------------ */
/* The finding                                                         */
/* ------------------------------------------------------------------ */

export type BulguTuru = "overlapping" | "similar" | "weaker" | "none";

export interface Bulgu {
  tur: BulguTuru;
  baslik: string;
  /** The pair the headline is about. Null for `weaker` and `none`. */
  komsu: Neighbour | null;
  /** Only for `none`: what stopped the measurement. */
  sebep: string | null;
}

/**
 * The closest neighbour on record.
 *
 * The head of the high list, not the largest `correlation` in it. The job
 * ranked that list on each pair's own worst case (`ci_low` descending) on
 * purpose: pairs sharing under 26 weeks put 8.7% of themselves above 0.9
 * against 2.6% at full history, so picking the point estimate here would
 * quietly undo that and let a 0.99-on-nine-weeks pair headline the page over
 * a 0.95-on-three-years one.
 */
export function enYakinKomsu(high: Neighbour[], hepsi: Neighbour[]): Neighbour | null {
  return high[0] ?? hepsi[0] ?? null;
}

/**
 * What the page leads with, decided by the closest neighbour's bucket.
 *
 * Four states and no fifth. Two of them name a fund, one offers the list
 * below, and one says the measurement did not happen — and that last one
 * offers nothing, because there is nothing under it to offer.
 */
export function bulgu(
  komsu: Neighbour | null,
  unavailable: NeighboursUnavailable | null,
  returns: FundReturn[] = [],
): Bulgu {
  if (!komsu) {
    return {
      tur: "none",
      baslik: "Bu fonun ilişkileri ölçülemedi.",
      komsu: null,
      sebep: olcumSebebi(unavailable, returns),
    };
  }

  if (komsu.bucket === "overlapping") {
    return {
      tur: "overlapping",
      baslik: "Bu fonun bir eşi var.",
      komsu,
      sebep: null,
    };
  }

  if (komsu.bucket === "similar") {
    return {
      tur: "similar",
      baslik: "Bu fona çok benzeyen fonlar var.",
      komsu,
      sebep: null,
    };
  }

  return {
    tur: "weaker",
    baslik: "Bu fonun bir eşi bulunamadı.",
    komsu: null,
    sebep: null,
  };
}

/**
 * Why nothing could be measured, in as much detail as there is.
 *
 * The neighbour code says which of the two silences this is. When the fund
 * also has no return figure, the code behind *that* is added, because it is
 * usually the same cause seen from the other side: a fund too young to reach
 * a twelve month window is also a fund with too few weeks to correlate, and
 * saying so is more use than repeating that nothing was found.
 */
function olcumSebebi(
  unavailable: NeighboursUnavailable | null,
  returns: FundReturn[],
): string {
  const bas = unavailable
    ? KOMSU_YOK[unavailable]
    : "Bu fon için saklanmış bir ölçüm yok.";

  if (!getirisiYok(returns)) return bas;

  // Both windows fail for the same reason in practice; the first one that
  // gave a code speaks for them.
  const kod = returns.find((r) => r.nominal_unavailable)?.nominal_unavailable;
  if (!kod) return bas;

  // No period list written into the sentence. There are four of them now and
  // which ones exist is `RETURN_PERIODS`' business; naming them here would be
  // a second place to update and, when a fund has none at all, the count is
  // not the useful part anyway.
  return `${bas} Getirisi de hesaplanamadı: ${GETIRI_YOK[kod]}.`;
}

/**
 * The sentence under a headline that names a fund.
 *
 * The founder is in it because two funds that overlap are usually two houses
 * selling the same thing, and that is the part of the finding a reader acts
 * on. A fund with no founder on record says so rather than being given one:
 * TEFAS has no founder field, it is split off the head of the title, and a
 * title with neither marker in it genuinely does not carry one.
 */
export function bulguCumlesi(komsu: Neighbour): string {
  const kurum = komsu.fund.founder ?? "kurucusu belirtilmemiş bir fon";
  // Most founders are "<X> A.Ş." and already end in a full stop. A second
  // one is not a typo anybody forgives on a page about someone's money.
  const nokta = kurum.endsWith(".") ? "" : ".";
  return `${komsu.fund.code}, ${kurum}${nokta}`;
}


/* ------------------------------------------------------------------ */
/* The hero's verdict                                                  */
/* ------------------------------------------------------------------ */

export interface HeroBulgusu {
  tur: BulguTuru;
  /** The verdict on its own, naming no fund. Never empty. */
  hukum: string;
  /**
   * The pair the verdict is about, framed for one sentence.
   *
   * Split into the words before the fund's name and the words after it,
   * rather than handed over as a finished string, because the name in the
   * middle is a link to that fund's own page. A component cannot put an
   * anchor inside a sentence it was given whole, and building the sentence
   * in the component instead would put the page's wording in two files.
   */
  es: { komsu: Neighbour; oncesi: string; sonrasi: string } | null;
  /** Only for `none`: what stopped the measurement. */
  sebep: string | null;
}

/**
 * The finding, compressed to one line for the top of the page.
 *
 * It used to be a section of its own halfway down, which said the same fund
 * twice: once as "this fund has a twin, here it is" and again as the single
 * row of the "Örtüşenler (1)" group directly beneath. One of the two had to
 * go, and it is the block, because the verdict is the reason the page
 * exists and burying it under three boxes of metadata puts the filing above
 * the finding.
 *
 * Derived from `bulgu` rather than deciding anything itself, so there is
 * still exactly one place that maps a bucket to a verdict. All this adds is
 * the phrasing that fits on one line, and the correlation — which the old
 * block carried in a card of its own and which belongs in the sentence when
 * the sentence is the whole finding.
 *
 * Three decimals, as in the block it replaces: this is the one coefficient
 * the page quotes as its point, and at two decimals 0,9998 prints as "1,00",
 * a value the maths keeps for a fund against itself.
 */
export function heroBulgusu(b: Bulgu): HeroBulgusu {
  const r = (komsu: Neighbour) => korelasyon(komsu.correlation);

  if (b.tur === "overlapping" && b.komsu) {
    return {
      tur: b.tur,
      hukum: "Bu fonun bir eşi var.",
      es: {
        komsu: b.komsu,
        oncesi: "Neredeyse aynı hareket ettiği fon:",
        sonrasi: `${r(b.komsu)} korelasyon.`,
      },
      sebep: null,
    };
  }

  if (b.tur === "similar" && b.komsu) {
    return {
      tur: b.tur,
      hukum: "Bu fona çok benzeyen fonlar var.",
      es: {
        komsu: b.komsu,
        oncesi: "En yakını:",
        sonrasi: `${r(b.komsu)} korelasyon.`,
      },
      sebep: null,
    };
  }

  // Not "no relationships": the fund has neighbours and they are listed
  // below, they are simply not close enough for the page to name one. The
  // sentence says what was looked for and not found, and the list stays the
  // place that says what *was* found.
  if (b.tur === "weaker") {
    return {
      tur: b.tur,
      hukum: "Bu fonun bir eşi bulunamadı.",
      es: null,
      sebep:
        "Ölçülen fonların hiçbiri bu fonla örtüşecek kadar benzer hareket " +
        "etmiyor. Bu, fonun risksiz olduğu anlamına gelmez.",
    };
  }

  return {
    tur: "none",
    hukum: b.baslik,
    es: null,
    sebep: b.sebep,
  };
}

/**
 * The seven-step risk scale as a bar, plus the number.
 *
 * TEFAS publishes a 1-7 integer and nothing else, so the bar is a reading
 * aid and not a second measurement: seven segments, the first `risk` of them
 * filled. It is not coloured by level. A 7 is not a warning — this page does
 * not rate funds, and turning TEFAS's filing into a red bar would be this
 * page's judgement dressed as their data.
 *
 * A fifth of the registry has no risk value. That returns null segments and
 * the caller prints "belirtilmemiş" instead of drawing an empty bar, which
 * would read as a risk of zero.
 */
export const RISK_SEGMENTS = 7;

export function riskSegmentleri(risk: number | null): boolean[] | null {
  if (risk === null) return null;
  const dolu = Math.max(0, Math.min(RISK_SEGMENTS, Math.round(risk)));
  return Array.from({ length: RISK_SEGMENTS }, (_, i) => i < dolu);
}

/**
 * The one line of metadata under the fund's name.
 *
 * House, category, risk — three facts that used to be three bordered cards
 * across the full width, which is a lot of furniture for three short
 * strings and pushed the actual finding below the fold. Missing ones say so
 * rather than being dropped, because a line with two entries does not
 * announce which of the three is absent.
 */
export function kimlikSatiri(fund: FundIdentity): string[] {
  return [
    fund.founder ?? `Kurum ${BELIRTILMEMIS}`,
    fund.category ?? `Kategori ${BELIRTILMEMIS}`,
  ];
}

/* ------------------------------------------------------------------ */
/* Identity and returns                                                */
/* ------------------------------------------------------------------ */

/** What TEFAS did not say is said to be unsaid, never filled in. */
export const BELIRTILMEMIS = "belirtilmemiş";

/** The 1 to 7 scale printed with its top, so "6" is not read as "6 out of 10". */
export function riskDegeri(risk: number | null): string {
  return risk === null ? BELIRTILMEMIS : `${risk} / 7`;
}

/** A return row worth drawing: one of the two figures actually exists. */
export function gosterilecekGetiriler(returns: FundReturn[]): FundReturn[] {
  return returns.filter((r) => r.nominal !== null || r.real !== null);
}

/**
 * Whether the fund has no return figure at all.
 *
 * Used only to add a clause to the "could not be measured" case: a fund with
 * neither a neighbour nor a return is one the window never reached, and
 * saying so is more use than repeating that nothing was found.
 */
export function getirisiYok(returns: FundReturn[]): boolean {
  return gosterilecekGetiriler(returns).length === 0;
}

/* ------------------------------------------------------------------ */
/* Document metadata                                                   */
/* ------------------------------------------------------------------ */

/**
 * The description a search result shows.
 *
 * Founder and category first, because those are what someone typing a fund
 * code into a search engine is trying to confirm, and both are dropped
 * rather than padded when TEFAS did not give them.
 */
export function fonAciklamasi(fund: FundIdentity): string {
  const parcalar: string[] = [];
  if (fund.founder) parcalar.push(`${fund.founder} kurucusu`);
  if (fund.category) parcalar.push(`${fund.category} kategorisi`);

  const kunye =
    parcalar.length > 0 ? `${fund.code}: ${parcalar.join(", ")}.` : `${fund.code}.`;

  return (
    `${kunye} 12 ve 36 aylık nominal ve enflasyondan arındırılmış getirisi, ` +
    `ve bu fonla birlikte hareket eden fonlar.`
  );
}
