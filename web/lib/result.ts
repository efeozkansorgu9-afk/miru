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
  RealReturn,
  RollingCorrelation,
  RankGap,
  RollingPair,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
import {
  araligiSure,
  gunFarki,
  kodListesi,
  korelasyon,
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
   * "held" means it was described by what it is worth now, with no date on
   * it. Nobody said what was paid, so the opening figure is what this same
   * holding was worth at the start of the window, not money anyone handed
   * over.
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
  /** The window every figure above is measured over. Say it on screen. */
  start: string;
  end: string;
}

/**
 * The window the return figures cover.
 *
 * The correlation window and the return window are not the same window, and
 * conflating them is how a basket bought last September comes to be reported
 * as up 1052 percent. Correlation wants every day the funds traded together,
 * because a coefficient from a few months is not one to act on. A return
 * wants the days the money was actually in: what the holding did before it
 * was bought is not the owner's return by any reading.
 *
 * So the return window starts at the earliest day money landed, and only a
 * basket with no dates on it at all falls back to the whole matrix, which is
 * the only period such a basket can be talking about.
 */
export function returnWindow(analysis: BasketAnalysis): { start: string; end: string } {
  const plan = analysis.purchases;
  if (!plan || plan.fills.length === 0) {
    return { start: analysis.start, end: analysis.end };
  }
  // `fill_date`, not the requested date: a purchase dated on a weekend buys
  // on the next trading day, and that is the day the units started working.
  const first = plan.fills.reduce(
    (earliest, fill) => (fill.fill_date < earliest ? fill.fill_date : earliest),
    plan.fills[0].fill_date,
  );
  return { start: first < analysis.start ? analysis.start : first, end: analysis.end };
}

/** Index of `date` in a dated series, or the first day on or after it. */
function indexOfDate(dates: string[], date: string): number {
  const exact = dates.indexOf(date);
  if (exact >= 0) return exact;
  const after = dates.findIndex((d) => d >= date);
  return after >= 0 ? after : 0;
}

export function returnFigures(
  response: AnalyzeResponse,
  request: AnalyzeRequest,
): ReturnFigures | null {
  const analysis = response.analysis;
  if (!analysis) return null;

  const plan = analysis.purchases;
  const scale = basketScale(analysis, request);
  const bv = analysis.basket_value;
  const window = returnWindow(analysis);
  const from = indexOfDate(bv.dates, window.start);

  // `basket_value` is deposit free and normalised, so the ratio between any
  // two of its days is the return over exactly those days.
  const opened = bv.values[from] ?? 1;
  const last = bv.values.at(-1) ?? 1;
  const nominalTotal = opened > 0 ? last / opened - 1 : 0;
  const years = gunFarki(window.start, window.end) / 365.25;

  const real = response.real_return;
  // The deflated series carries the same dates, so the real return over a
  // sub window is its own ratio over those dates. Reading `real.total` here
  // instead would restate the whole matrix, which is the bug this fixes.
  const rv = real?.real_value.values;
  const usableReal =
    rv !== undefined && rv.length === bv.values.length && (rv[from] ?? 0) > 0;
  const realTotal = usableReal ? (rv.at(-1) ?? 1) / rv[from] - 1 : 0;

  return {
    kind: plan ? "staged" : "held",
    opening: plan ? plan.total_invested : scale * opened,
    value: plan ? plan.total_value : scale * last,
    gain: plan ? plan.absolute_gain : scale * (last - opened),
    nominalTotal,
    nominalAnnual: annualise(nominalTotal, years),
    real: usableReal
      ? {
          total: realTotal,
          annual: annualise(realTotal, years),
          // Inflation is what the gap between the two returns is made of.
          inflation: (1 + nominalTotal) / (1 + realTotal) - 1,
        }
      : null,
    xirr: plan ? plan.xirr : null,
    start: window.start,
    end: window.end,
  };
}

/** A total return spread over a period, as a yearly rate. */
function annualise(total: number, years: number): number {
  if (!(years > 0) || total <= -1) return Number.NaN;
  return (1 + total) ** (1 / years) - 1;
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

/* ------------------------------------------------------------------ */
/* The value chart                                                     */
/* ------------------------------------------------------------------ */

export interface ChartPoint {
  date: string;
  market: number;
  invested: number;
  /** Absent when the CPI could not be fetched. */
  inflation?: number;
}

export interface ChartData {
  points: ChartPoint[];
  /** False when there is no CPI. The line and its control both disappear. */
  hasInflation: boolean;
}

/**
 * The consumer price index over the chart's own dates, as a growth factor
 * from the first day.
 *
 * Recovered from the answer rather than fetched again. The server sends the
 * basket's value series and the same series deflated to today's prices, and
 * the deflated one is `k * value[i] * D_last / D_i` for a constant `k`. So
 * the ratio of the two carries the index, and dividing the first ratio by
 * the rest cancels both `k` and `D_last` and leaves `D_i / D_0`.
 *
 * Checked against the raw TÜİK series at sample dates across a five year
 * window: the two agree to about 1e-16, in both the lump sum and held units
 * cases.
 */
function cpiGrowth(analysis: BasketAnalysis, real: RealReturn | null): number[] | null {
  if (!real) return null;

  const value = analysis.basket_value.values;
  const deflated = real.real_value.values;
  if (deflated.length !== value.length || value.length === 0) return null;

  const ratio = value.map((v, i) => (v > 0 ? deflated[i] / v : Number.NaN));
  const first = ratio[0];
  if (!(first > 0)) return null;

  const growth = ratio.map((r) => (r > 0 ? first / r : Number.NaN));
  return growth.every(Number.isFinite) ? growth : null;
}

/** The same growth factors, on another series' dates and rebased to its first. */
function alignGrowth(
  from: string[],
  growth: number[],
  onto: string[],
): number[] | null {
  const byDate = new Map(from.map((date, i) => [date, growth[i]]));
  const out: number[] = [];
  for (const date of onto) {
    const g = byDate.get(date);
    if (g === undefined) return null;
    out.push(g);
  }
  const base = out[0];
  return base > 0 ? out.map((g) => g / base) : null;
}

/**
 * The money that went in, grown by inflation from the day each part of it
 * arrived.
 *
 * Not the total multiplied by the period's inflation. Money paid in last
 * month has had one month of prices to keep up with, not three years of
 * them, and treating the whole principal as though it arrived on day one
 * would overstate the line every staged basket is measured against.
 */
function inflatePrincipal(invested: number[], growth: number[]): number[] {
  const out: number[] = [];
  let carried = 0;
  let previous = 0;

  for (let i = 0; i < invested.length; i += 1) {
    // What was already in grows with prices; what arrives today does not.
    if (i > 0 && growth[i - 1] > 0) carried *= growth[i] / growth[i - 1];
    carried += invested[i] - previous;
    previous = invested[i];
    out.push(carried);
  }
  return out;
}

export function chartData(
  response: AnalyzeResponse,
  request: AnalyzeRequest,
): ChartData | null {
  const analysis = response.analysis;
  if (!analysis) return null;

  const plan = analysis.purchases;
  const matrix = analysis.basket_value;
  const growth = cpiGrowth(analysis, response.real_return);

  if (plan) {
    // Two lines, never one: market value jumps on the day money arrives, and
    // a single line would show that jump exactly as it shows a gain. The
    // third is what that same money would be worth if it had only kept pace
    // with prices, which is the line that says whether the gain was real.
    const series = plan.value_series;
    const aligned = growth ? alignGrowth(matrix.dates, growth, series.dates) : null;
    const inflated = aligned ? inflatePrincipal(series.invested, aligned) : null;

    return {
      points: series.dates.map((date, i) => ({
        date,
        market: series.market_value[i],
        invested: series.invested[i],
        ...(inflated ? { inflation: inflated[i] } : {}),
      })),
      hasInflation: inflated !== null,
    };
  }

  const scale = basketScale(analysis, request);
  // Held unchanged across the window, so the principal is flat at what the
  // same holding was worth on day one.
  const invested = matrix.dates.map(() => scale);
  const inflated = growth ? inflatePrincipal(invested, growth) : null;

  return {
    points: matrix.dates.map((date, i) => ({
      date,
      market: matrix.values[i] * scale,
      invested: scale,
      ...(inflated ? { inflation: inflated[i] } : {}),
    })),
    hasInflation: inflated !== null,
  };
}

/* ------------------------------------------------------------------ */
/* The moving window correlation                                       */
/* ------------------------------------------------------------------ */

/** One pair's series, ready to draw, with the figures worth stating. */
export interface RollingView {
  codes: string[];
  /** The pair's correlation over the whole matrix. */
  fullPeriod: number;
  points: { date: string; value: number | null }[];
  /** Latest, lowest and highest, each with the week it belongs to. */
  latest: { date: string; value: number } | null;
  lowest: { date: string; value: number } | null;
  highest: { date: string; value: number } | null;
}

/** "AFO ve HBF" for a pair, in the same voice as the rest of the page. */
export function ciftAdi(codes: readonly string[]): string {
  return kodListesi(codes);
}

export function rollingView(
  rolling: RollingCorrelation,
  pair: RollingPair,
): RollingView {
  const points = rolling.dates.map((date, i) => ({
    date,
    value: pair.values[i] ?? null,
  }));

  // A degenerate window is null and is not a candidate for any of these: the
  // lowest correlation of the period should be a correlation that was
  // measured, not the absence of one.
  const real = points.filter(
    (p): p is { date: string; value: number } => p.value !== null,
  );
  const pick = (best: (a: number, b: number) => boolean) =>
    real.length === 0
      ? null
      : real.reduce((chosen, p) => (best(p.value, chosen.value) ? p : chosen));

  return {
    codes: pair.codes,
    fullPeriod: pair.full_period,
    points,
    latest: real.length > 0 ? real[real.length - 1] : null,
    lowest: pick((a, b) => a < b),
    highest: pick((a, b) => a > b),
  };
}

/**
 * How the chart is meant to be read.
 *
 * Three things a reader cannot get from the line itself. That each point
 * summarises the year behind it rather than the day it sits on, which is the
 * one misreading that turns a lagging chart into a wrong one. That small
 * movement is mostly the measurement: on a pair whose true correlation was
 * held perfectly still, a 52 week window still wanders about a third of the
 * scale, so treating every wiggle as news would be reading noise. And where
 * to look, which is the high ground: correlations tend to rise when markets
 * are under stress, so the peaks are where a basket's funds were least able
 * to offset each other.
 *
 * The last of those is guidance for reading a chart, not a claim this page
 * is making about what will happen next.
 */
export function rollingNotu(windowWeeks: number): string {
  return (
    `Her nokta kendinden önceki ${windowWeeks} haftayı özetler, o yüzden çizgi ` +
    `bir günün değil, arkasındaki bir yılın hikâyesidir. Çizginin yükseldiği ` +
    `aralıklarda iki fon o dönem boyunca daha benzer hareket etmiş; küçük iniş ` +
    `ve çıkışlar ise çoğunlukla ölçümün kendi payıdır. Piyasa stresinin arttığı ` +
    `dönemlerde korelasyonların yükselme eğilimi görülür, o yüzden çizginin en ` +
    `yüksek olduğu aralıklara bakmak, fonların birbirinden ayrışmasının en çok ` +
    `işe yarayacağı anda ne olduğunu gösterir.`
  );
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

/* ------------------------------------------------------------------ */
/* Where the two correlation measures disagree                         */
/* ------------------------------------------------------------------ */

/**
 * The note about pairs whose Pearson and Spearman coefficients are far
 * apart, and who it is about.
 *
 * The heading has one job beyond naming the section: keeping this apart
 * from the finding at the top of the page. Both talk about pairs of funds
 * and both quote a correlation, but they are answering different questions,
 * and a reader who reads this as a second opinion on the headline has been
 * misled by the layout. So the heading says which pairs are in it rather
 * than what was measured.
 *
 * In practice that is always "the ones that did not group": grouping cuts
 * at 0,85 and pairs above that agree to about 0,005, well inside the 0,10
 * this fires at. It is not guaranteed though, and `find_rank_gaps` on the
 * server deliberately does not filter grouped pairs out, so the heading is
 * derived from the pairs in hand rather than assumed.
 */
export interface RankGapNote {
  heading: string;
  /** Who the pairs are, and what the two numbers are. */
  body: string;
  rows: { pair: string; pearson: string; spearman: string }[];
}

export function rankGapNote(
  gaps: readonly RankGap[],
  grouping: Grouping,
): RankGapNote | null {
  if (gaps.length === 0) return null;

  const grouped = new Set<string>();
  for (const group of grouping.groups) {
    for (const a of group.codes) {
      for (const b of group.codes) {
        if (a !== b) grouped.add(`${a}|${b}`);
      }
    }
  }
  const hepsiGrupDisi = gaps.every((g) => !grouped.has(g.codes.join("|")));

  const heading = hepsiGrupDisi
    ? "Gruplanmayan çiftlerde iki ölçüm ayrışıyor"
    : "İki ölçümün ayrıştığı çiftler";

  const kim = hepsiGrupDisi
    ? "Aşağıdaki çiftlerin hiçbiri gruplama eşiğini geçmiyor, yani yukarıdaki " +
      "bulgunun parçası değiller."
    : "Aşağıdaki çiftlerde iki ölçüm birbirinden uzak düşüyor.";

  return {
    heading,
    body:
      `${kim} Doğrusal ölçüm bir haftayı hareketin büyüklüğüyle tartıyor ve ` +
      `uç haftalardan etkileniyor; sıralama bazlı ölçüm yalnızca hareketin ` +
      `sırasına bakıyor, etkilenmiyor.`,
    rows: gaps.map((g) => ({
      pair: kodListesi(g.codes),
      pearson: korelasyon(g.correlation),
      spearman: korelasyon(g.rank_correlation),
    })),
  };
}
