/**
 * Reading an `AnalyzeResponse`.
 *
 * The backend returns numbers and state codes and never a sentence, so every
 * decision about what the result *means* is made here: which finding leads,
 * which figures are the investor's own and which describe the holding, and
 * what to say about a fund that was left out. Pure functions over the wire
 * types, with no React in them, so the wording can be read in one place and
 * checked against `api/schemas.py` without opening a component.
 *
 * Two rules run through all of it.
 *
 * The basket is never called safe, healthy or well diversified. Those are
 * judgements about someone's money that this product is not in a position to
 * make. It reports what it found, and when it found nothing it says so
 * plainly rather than reassuringly.
 *
 * How loudly a finding is reported scales with how much money it concerns.
 * A pair of funds moving together is the headline when it holds most of the
 * basket, a plain statement when it holds a quarter to a half, and a row in
 * the table when it holds less. The information is never dropped, only moved.
 */

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AnalysisStatus,
  BasketAnalysis,
  ExclusionKind,
  FailureKind,
  FundCoverage,
  Grouping,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
import {
  araligiSure,
  gunFarki,
  kodListesi,
  sayiKelime,
  sureIle,
  tarih,
  yuzde,
  yuzdeEki,
} from "@/lib/format";

/** Over this share of the basket, a group leads the headline. */
export const GROUP_DOMINANT = 0.5;
/** Under this share it stays out of the headline entirely. */
export const GROUP_NOTABLE = 0.25;

/* ------------------------------------------------------------------ */
/* Money per fund                                                      */
/* ------------------------------------------------------------------ */

/**
 * What each fund is worth, on the same basis the weights use.
 *
 * With dated purchases the weights are today's market value rather than the
 * lira paid in, and the plan already carries that per fund. A plain weights
 * basket has no plan, and there the amounts the user typed *are* the
 * composition, so they are read back from the request.
 */
export function fundAmounts(
  analysis: BasketAnalysis,
  request: AnalyzeRequest,
): Record<string, number> {
  if (analysis.purchases) return analysis.purchases.market_value;

  const out: Record<string, number> = {};
  for (const fund of request.funds ?? []) {
    if (fund.code in analysis.weights) out[fund.code] = fund.amount;
  }
  return out;
}

/**
 * The lira the deposit free value series opens at.
 *
 * `basket_value` is normalised to 1.0, so it needs a scale before it can be
 * drawn on a lira axis, and which end that scale is pinned to decides what
 * the chart claims.
 *
 * It is pinned to *today*, both ways round. A basket described as what it is
 * worth now is worth exactly that on the last priced day, so the series is
 * scaled so its last point equals the sum of the amounts and the axis runs
 * back from there. Pinning the sum to the first day instead would draw a
 * holding the user never had: someone who says they hold 75.000 lira of
 * these funds would be shown 765.000, because the server's own scaling puts
 * the stated total at the start of the window.
 *
 * `api.main._real_return` scales the *lump sum* case to the start instead,
 * so the deflated series that comes back has to be corrected by the same
 * factor before it can share an axis with this. `deflate` is linear, so one
 * multiplication does it. See `rescaleReal`.
 */
export function basketScale(
  analysis: BasketAnalysis,
  request: AnalyzeRequest,
): number {
  const last = analysis.basket_value.values.at(-1) ?? 1;
  const plan = analysis.purchases;
  const total = plan
    ? plan.total_value
    : (request.funds ?? []).reduce(
        (sum, fund) => (fund.code in analysis.weights ? sum + fund.amount : sum),
        0,
      );
  return last > 0 ? total / last : total;
}

/* ------------------------------------------------------------------ */
/* The main finding                                                    */
/* ------------------------------------------------------------------ */

export type FindingTier = "single" | "none" | "dominant" | "notable" | "minor";

export interface MainFinding {
  tier: FindingTier;
  title: string;
  /** Sentences under the headline. Never empty for a tier that has one. */
  body: string[];
}

/** How tight a group is, in a sentence rather than a coefficient. */
export function birlikteHareketCumlesi(
  codes: readonly string[],
  minCorrelation: number,
): string {
  const nasil =
    minCorrelation >= 0.95
      ? "neredeyse aynı şekilde hareket ediyor"
      : minCorrelation >= 0.9
        ? "çok benzer şekilde hareket ediyor"
        : "birlikte hareket ediyor";

  const dusus =
    codes.length === 2
      ? "Biri düştüğünde diğeri de düşüyor."
      : "Biri düştüğünde diğerleri de düşüyor.";

  return `${kodListesi(codes)} ${nasil}. ${dusus}`;
}

export function mainFinding(
  analysis: BasketAnalysis,
  grouping: Grouping,
  /** True when some funds were left out, so the money spoken of is partial. */
  partial: boolean,
): MainFinding {
  if (analysis.is_single_fund) {
    return {
      tier: "single",
      title: "Sepette tek fon var.",
      body: [
        "Fonların birlikte hareket edip etmediğini görmek için en az iki fon " +
          "gerekiyor. Tek fonun kendi oynaklığı ve geçmiş düşüşü teknik detay " +
          "bölümünde duruyor.",
      ],
    };
  }

  const pay = grouping.grouped_weight;
  const onek = partial ? "İncelemeye giren paranın" : "Paranın";

  if (grouping.groups.length === 0) {
    return {
      tier: "none",
      title: "Birlikte hareket eden fon çifti bulunamadı.",
      body: [
        "Fonlarınızın hiçbiri diğeriyle yüksek korelasyon göstermiyor. Bu, " +
          "sepetinizin risksiz olduğu anlamına gelmez. Aynı ekonomik şoka " +
          "birlikte tepki verebilirler.",
      ],
    };
  }

  if (pay > GROUP_DOMINANT) {
    return {
      tier: "dominant",
      title: `${onek} yarısından fazlası birlikte hareket eden fonlarda.`,
      body: grouping.groups.map((g) =>
        birlikteHareketCumlesi(g.codes, g.min_correlation),
      ),
    };
  }

  if (pay >= GROUP_NOTABLE) {
    // A statement, not a warning. A quarter of a basket moving together is
    // worth knowing and is not on its own a problem.
    const tek = grouping.groups.length === 1 ? grouping.groups[0] : null;
    const title = tek
      ? `${onek} ${yuzde(pay)}${yuzdeEki(pay)} birlikte hareket eden ` +
        `${sayiKelime(tek.codes.length)} fonda: ${kodListesi(tek.codes)}.`
      : `${onek} ${yuzde(pay)}${yuzdeEki(pay)} birlikte hareket eden fon gruplarında.`;

    return {
      tier: "notable",
      title,
      body: grouping.groups.map((g) =>
        birlikteHareketCumlesi(g.codes, g.min_correlation),
      ),
    };
  }

  // Under a quarter. The headline says what is true of most of the money and
  // does not name the group; the table still marks it, and one line points
  // there so the finding is findable rather than buried.
  return {
    tier: "minor",
    title: `${onek} çoğu ayrı hareket eden fonlarda.`,
    body: ["Birlikte hareket eden fonlar tabloda grup olarak işaretli."],
  };
}

/** The window every number in the result was measured on. */
export function donemCumlesi(analysis: BasketAnalysis): string {
  return (
    `${tarih(analysis.start)} ile ${tarih(analysis.end)} arası inceleniyor, ` +
    `${analysis.weekly_observations} haftalık gözlem.`
  );
}

/**
 * Why the window is not the one the user typed.
 *
 * Dates on a holding say when it was bought, and nothing else. Correlation is
 * measured on every day the funds traded together, because a coefficient from
 * a few months of shared history is not one to act on. Saying so is the
 * difference between a number the reader trusts correctly and one they
 * trust for the wrong reason.
 */
export const DONEM_NOTU =
  "Fonların birlikte hareketi, girdiğiniz tarihlerden değil, hepsinin " +
  "birlikte işlem gördüğü bütün dönemden hesaplanıyor.";

/* ------------------------------------------------------------------ */
/* The fund table                                                      */
/* ------------------------------------------------------------------ */

export interface TableRow {
  code: string;
  name: string;
  amount: number;
  weight: number;
  /** "1. grup, toplam %40" or "Tek başına". */
  status: string;
  /** 1 based, or null when the fund stands alone. */
  group: number | null;
}

/** Grouped funds first, in the order the grouping put them: heaviest first. */
export function tableRows(
  analysis: BasketAnalysis,
  grouping: Grouping,
  names: Record<string, string>,
  amounts: Record<string, number>,
): TableRow[] {
  const rows: TableRow[] = [];

  grouping.groups.forEach((group, i) => {
    for (const code of group.codes) {
      rows.push({
        code,
        name: names[code] ?? "",
        amount: amounts[code] ?? 0,
        weight: analysis.weights[code] ?? 0,
        status: `${i + 1}. grup, toplam ${yuzde(group.weight)}`,
        group: i + 1,
      });
    }
  });

  for (const alone of grouping.standalone) {
    rows.push({
      code: alone.code,
      name: names[alone.code] ?? "",
      amount: amounts[alone.code] ?? 0,
      weight: alone.weight,
      status: "Tek başına",
      group: null,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Funds left out, and funds that returned nothing                     */
/* ------------------------------------------------------------------ */

/**
 * Why one fund is not in the main result.
 *
 * The two kinds are different things and get different sentences. A stale
 * series stopped pricing; the basket carried on without it. A window cost
 * means the fund is real and current but young, and keeping it would shorten
 * the shared history for every other fund in the basket.
 */
export function exclusionText(
  code: string,
  kind: ExclusionKind,
  coverage: FundCoverage | undefined,
): string {
  if (kind === "stale_series") {
    return coverage
      ? `${code} fonunun fiyatları ${tarih(coverage.last_date)} tarihinde durmuş. ` +
          `Sepetin geri kalanı işlem görmeye devam ediyor.`
      : `${code} fonunun fiyatları dönemin sonuna gelmeden durmuş.`;
  }
  return coverage
    ? `${code} ${tarih(coverage.first_date)} tarihinde işlem görmeye başlamış, ` +
        `diğer fonlardan çok daha genç.`
    : `${code} istenen dönemin tamamını kapsamıyor.`;
}

/** What including the excluded funds would cost the window. */
export function pencereMaliyeti(
  codes: string[],
  trimmedStart: string | null,
  trimmedEnd: string | null,
  fullStart: string | null,
  fullEnd: string | null,
): string | null {
  const uzun = araligiSure(trimmedStart, trimmedEnd);
  const kisa = araligiSure(fullStart, fullEnd);
  if (!uzun || !kisa) return null;
  return (
    `${kodListesi(codes)} dahil edilirse inceleme ${uzun} yerine sadece ` +
    `${sureIle(kisa)} sınırlı kalıyor. Karşılaştırma ancak bütün fonların ` +
    `birlikte var olduğu dönemde yapılabiliyor.`
  );
}

/** A code that returned no usable prices. Never silently dropped. */
export function failureText(code: string, kind: FailureKind): string {
  switch (kind) {
    case "unknown_code":
      return `${code}: TEFAS bu kodu listelemiyor. Kodu kontrol edin. Kapanmış bir fon da böyle görünür.`;
    case "no_prices_in_window":
      return `${code}: bu dönemde hiç fiyat vermemiş.`;
    case "no_valid_prices":
      return `${code}: dönen fiyatların hiçbiri kullanılabilir değil.`;
    default:
      return `${code}: verisi alınamadı ve fon listesi de doğrulanamadı.`;
  }
}

/** Correlation from a handful of weeks is noise, and the reader is told. */
export function kisaVeriUyarisi(weeklyObservations: number): string {
  return (
    `Bu sonuç ${weeklyObservations} haftalık veriye dayanıyor ve güvenilir ` +
    `değil. Bu kadar kısa bir dönemde rastgele iki fon bile birlikte hareket ` +
    `ediyor gibi görünebilir.`
  );
}

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

export interface ReturnFigures {
  /**
   * Which question the money figures answer.
   *
   * "staged" means the basket was described as dated deposits, so the lira
   * that went in is known and `xirr` is the investor's own return.
   *
   * "held" means it was described by what it is worth now. Nobody said what
   * was paid, so the opening figure is what this same holding was worth at
   * the start of the window, not money anyone handed over.
   */
  kind: "held" | "staged";
  /** Lira in at the start: money deposited, or the holding's opening value. */
  opening: number;
  /** What the holding is worth on the last priced day. */
  value: number;
  gain: number;
  nominalTotal: number;
  nominalAnnual: number;
  /** Null when the CPI could not be fetched. The page works without it. */
  real: { total: number; annual: number; inflation: number } | null;
  /**
   * Annual money weighted return. Only meaningful, and only present, when
   * the basket was described as dated deposits.
   */
  xirr: number | null;
  start: string;
  end: string;
}

export function returnFigures(
  response: AnalyzeResponse,
  request: AnalyzeRequest,
): ReturnFigures | null {
  const analysis = response.analysis;
  if (!analysis) return null;

  const plan = analysis.purchases;
  const scale = basketScale(analysis, request);
  const series = analysis.basket_value.values;
  const first = series[0] ?? 1;
  const last = series.at(-1) ?? 1;

  const total = first > 0 ? last / first - 1 : 0;
  const years = gunFarki(analysis.start, analysis.end) / 365.25;
  const annual = years > 0 ? (1 + total) ** (1 / years) - 1 : Number.NaN;

  const real = response.real_return;

  return {
    kind: plan ? "staged" : "held",
    opening: plan ? plan.total_invested : scale,
    value: plan ? plan.total_value : scale * last,
    gain: plan ? plan.absolute_gain : scale * last - scale,
    // The server's figures are preferred when it computed them: they come
    // from the same CPI arithmetic as the real pair, so the two agree.
    nominalTotal: real ? real.nominal_total : total,
    nominalAnnual: real ? real.nominal_annual : annual,
    real: real
      ? { total: real.total, annual: real.annual, inflation: real.inflation_total }
      : null,
    xirr: plan ? plan.xirr : null,
    start: analysis.start,
    end: analysis.end,
  };
}

export const UCRET_NOTU =
  "Yönetim ücreti fon fiyatına dahil, gösterilen getiri ücret düşülmüş " +
  "halidir. Vergi hesaba katılmamıştır.";

export const XIRR_NOTU =
  "XIRR, her ödemenin ne zaman yapıldığını hesaba katan yıllık getiridir. " +
  "Geçen ay yatırdığınız para, üç yıl önce yatırdığınızla aynı süre çalışmadı.";

/** Why the period return is not the investor's own return in staged mode. */
export function stagedGetiriNotu(start: string, end: string): string {
  return (
    `Yukarıdaki dönem getirisi, bugün elinizde olan fonların ${tarih(start)} ile ` +
    `${tarih(end)} arasında ne yaptığını gösterir. Para yatırma tarihlerinizi ` +
    `hesaba katmaz. Kendi paranızın getirisi XIRR satırındadır.`
  );
}

/** Why a basket stated at today's value still has a five year return. */
export function heldGetiriNotu(start: string): string {
  return (
    `Sepetinizi ${tarih(start)} tarihinden beri hiç değiştirmeden tuttuğunuz ` +
    `varsayılıyor. Ne zaman aldığınızı yazmadınız, o yüzden ödediğiniz tutar ` +
    `bilinmiyor. Dönem başındaki değer, bugünkü sepetin o gün ne ettiğidir.`
  );
}

/**
 * The deflated series, moved onto the same scale as the value line.
 *
 * The server pins a lump sum basket's series to the first day and this page
 * pins it to the last, so the two differ by a constant factor. Deflation is
 * linear, so correcting it is one multiplication rather than a second CPI
 * pass.
 */
export function rescaleReal(values: number[], lastBasketValue: number): number[] {
  if (!(lastBasketValue > 0)) return values;
  return values.map((v) => v / lastBasketValue);
}

/* ------------------------------------------------------------------ */
/* The value chart                                                     */
/* ------------------------------------------------------------------ */

export interface ChartPoint {
  date: string;
  market: number;
  invested: number;
  real?: number;
}

export interface ChartData {
  points: ChartPoint[];
  hasReal: boolean;
}

export function chartData(
  response: AnalyzeResponse,
  request: AnalyzeRequest,
): ChartData | null {
  const analysis = response.analysis;
  if (!analysis) return null;

  const plan = analysis.purchases;

  if (plan) {
    // Two lines, never one: market value jumps on the day money arrives, and
    // a single line would show that jump exactly as it shows a gain.
    const s = plan.value_series;
    return {
      points: s.dates.map((date, i) => ({
        date,
        market: s.market_value[i],
        invested: s.invested[i],
      })),
      // The deflated series is measured on the units held today, carried
      // across the whole window, so it does not share an x axis or a scale
      // with the staged lines. Drawing it here would put two different
      // questions on one chart.
      hasReal: false,
    };
  }

  const scale = basketScale(analysis, request);
  const bv = analysis.basket_value;
  const real =
    response.real_return && response.real_return.basis === "lump_sum"
      ? rescaleReal(response.real_return.real_value.values, bv.values.at(-1) ?? 1)
      : null;

  return {
    points: bv.dates.map((date, i) => ({
      date,
      market: bv.values[i] * scale,
      // Held unchanged across the window, so the reference line is flat at
      // what the same holding was worth on day one. The gap above it is the
      // gain.
      invested: scale,
      ...(real ? { real: real[i] } : {}),
    })),
    hasReal: real !== null,
  };
}

/* ------------------------------------------------------------------ */
/* Things that went wrong                                              */
/* ------------------------------------------------------------------ */

/** Why there is no analysis, when the request itself was fine. */
export function analysisStatusText(status: AnalysisStatus): string {
  if (status === "window_too_short") {
    return (
      "Fonların birlikte işlem gördüğü dönem, hesap yapmak için fazla kısa. " +
      "Sepetteki en genç fonu çıkarıp tekrar deneyin."
    );
  }
  return (
    "Sepetteki fonların hiçbiri için fiyat verisi alınamadı, o yüzden " +
    "inceleme yapılamadı."
  );
}

/** One sentence per failure kind, in the reader's language. */
export function errorMessage(error: unknown): { title: string; body: string } {
  if (!(error instanceof ApiError)) {
    return {
      title: "Beklenmeyen bir sorun çıktı.",
      body: "Tekrar deneyin. Sorun sürerse sayfayı yenileyin.",
    };
  }

  switch (error.kind) {
    case "network":
      return {
        title: "Sunucuya ulaşılamadı.",
        body: "İnceleme servisi çalışmıyor olabilir. İnternet bağlantınızı kontrol edip tekrar deneyin.",
      };
    case "timeout":
      return {
        title: "Yanıt zamanında gelmedi.",
        body: "TEFAS bugün yavaş yanıt veriyor olabilir. Birkaç saniye sonra tekrar deneyin.",
      };
    case "upstream":
      return {
        title: "TEFAS şu anda yanıt vermiyor.",
        body: "Fiyatlar oradan geliyor, bu yüzden inceleme yapılamıyor. Biraz sonra tekrar deneyin.",
      };
    case "validation": {
      const issues = Object.values(error.fieldIssues);
      return {
        title: "Sepet olduğu gibi incelenemedi.",
        body:
          issues.length > 0
            ? `Sunucu şunu bildirdi: ${issues[0]}`
            : "Girilen bilgilerden biri kabul edilmedi. Tutarları ve tarihleri kontrol edin.",
      };
    }
    default:
      return {
        title: "İnceleme tamamlanamadı.",
        body: "Sunucu tarafında bir sorun oldu. Tekrar deneyin.",
      };
  }
}

/** Length of a matrix window as a phrase, for a section label. */
export function pencereEtiketi(start: string | null, end: string | null): string {
  const s = araligiSure(start, end);
  return s ? `${s}lık dönem` : "ortak dönem yok";
}
