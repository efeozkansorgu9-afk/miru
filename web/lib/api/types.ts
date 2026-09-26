/**
 * Wire types for the FastAPI backend.
 *
 * These mirror `api/schemas.py` one for one, and the field names are the
 * Python ones on purpose: `diversification_ratio`, not `diversificationRatio`.
 * A camelCase translation layer would mean the person reading the Python and
 * the person reading the TypeScript are talking about different names for the
 * same number, and the mapping would be one more thing to keep in step.
 *
 * The backend returns numbers and state codes and never display text. Every
 * Turkish sentence in this product is written on this side, from these
 * fields.
 */

/* ------------------------------------------------------------------ */
/* State codes                                                         */
/* ------------------------------------------------------------------ */

/** Why `analysis` is null, when it is. */
export type AnalysisStatus = "ok" | "no_funds" | "window_too_short";

/** Why `full_analysis` is null. `not_needed` is the ordinary case. */
export type FullAnalysisStatus =
  | "ok"
  | "not_needed"
  | "no_funds"
  | "window_too_short"
  | "out_of_window";

/** Why `real_return` is null. `unavailable` covers every expected CPI failure. */
export type RealReturnStatus = "ok" | "unavailable" | "not_applicable";

/**
 * Why there is no moving window correlation.
 *
 * Neither value is a failure. `single_fund` is a basket with no pair to
 * correlate, and `not_enough_weeks` is a shared history too short to draw a
 * history of, which is what a young basket looks like.
 */
export type RollingStatus = "ok" | "single_fund" | "not_enough_weeks";

/**
 * Which series the real return was measured on.
 *
 * `held_units` is staged mode, and it is NOT the investor's own return: it is
 * what the units they hold today would have done over the window, with no
 * deposits in it. Their own money weighted return is `PurchasePlan.xirr`.
 */
export type ReturnBasis = "lump_sum" | "held_units";

export type Mode = "simple" | "staged";

/**
 * How to read the lira figure on a holding.
 *
 * "current_value": what it is worth today, held since `date`.
 * "paid": the money that went in on `date`.
 *
 * Both may be mixed across one basket. The server turns either into units
 * bought on a date, so everything downstream is computed one way.
 */
export type AmountBasis = "paid" | "current_value";

/** Why a code returned nothing usable. */
export type FailureKind =
  | "unknown_code"
  | "no_prices_in_window"
  | "no_valid_prices"
  | "no_data_unverified"
  /**
   * The price request never completed, so nothing was observed about the
   * fund at all. Apart from the others because they are findings and this
   * is the absence of one: it is the only kind where trying again is the
   * right advice, and the only one that must never be read as a fact about
   * the fund.
   */
  | "request_failed";

/** Why a fund with prices was still left out of the trimmed matrix. */
export type ExclusionKind = "stale_series" | "window_cost";

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

export interface FundAmount {
  code: string;
  amount: number;
  /** Defaults to "current_value" server side. */
  basis?: AmountBasis;
  /**
   * ISO date. Required when `basis` is "paid": an amount paid says nothing
   * without the day it was paid. Optional for "current_value", which falls
   * back to the start of the available window.
   */
  date?: string | null;
}

export interface PurchaseIn {
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  code: string;
  amount: number;
  /** Defaults to "paid", which is what a dated purchase normally means. */
  basis?: AmountBasis;
}

/** Send `funds` or `purchases`, never both and never neither. */
export interface AnalyzeRequest {
  funds?: FundAmount[];
  purchases?: PurchaseIn[];
  months?: number;
  group_threshold?: number;
}

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** A dated value series as two parallel arrays of equal length. */
export interface Series {
  dates: string[];
  values: number[];
}

export interface Correlation {
  codes: string[];
  /** Square, indexed by `codes`. Null where a pair cannot be correlated. */
  matrix: (number | null)[][];
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

export interface FundCoverage {
  fund_code: string;
  fund_name: string;
  first_date: string;
  last_date: string;
  row_count: number;
  expected_business_days: number;
  span_days: number;
  /** Rows delivered over business days. A healthy fund sits near 0.96. */
  coverage_ratio: number;
  is_sparse: boolean;
}

export interface MatrixCoverage {
  fund_codes: string[];
  start: string | null;
  end: string | null;
  trading_days: number;
  weekly_observations: number;
  is_empty: boolean;
  /** Below this, correlation estimates are too wide to act on. */
  below_weekly_threshold: boolean;
}

/** `reason` is an English diagnostic for logs. Branch on `kind`. */
export interface FundFailure {
  fund_code: string;
  kind: FailureKind;
  reason: string;
}

/** Same contract as `FundFailure`: branch on `kind`, never show `reason`. */
export interface FundExclusion {
  fund_code: string;
  kind: ExclusionKind;
  reason: string;
}

export interface Coverage {
  requested_codes: string[];
  requested_start: string;
  requested_end: string;
  ok_codes: string[];
  sparse_codes: string[];
  full_coverage: MatrixCoverage;
  trimmed_coverage: MatrixCoverage;
  fund_coverage: Record<string, FundCoverage>;
  excluded_codes: Record<string, FundExclusion>;
  failed_codes: Record<string, FundFailure>;
  fund_names: Record<string, string>;
  /** English, diagnostic. Things the request asked for and did not get. */
  notes: string[];
  from_cache: boolean;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export interface Drawdown {
  /** Negative fraction: -0.23 is a fall of 23 percent. */
  depth: number;
  peak_date: string;
  trough_date: string;
  peak_value: number;
  trough_value: number;
  duration_days: number;
}

export interface Fill {
  code: string;
  /** The date asked for. */
  date: string;
  /** The trading day it actually bought on. */
  fill_date: string;
  /** The lira that went in. Derived when the holding was stated at today's value. */
  amount: number;
  price: number;
  units: number;
  was_shifted: boolean;
  shifted_days: number;
  basis: AmountBasis;
  /** What the request said, before conversion. Equals `amount` when paid. */
  stated_amount: number;
  was_converted: boolean;
}

/** Two lines, never one: a deposit makes `market_value` jump on its own. */
export interface StagedValueSeries {
  dates: string[];
  market_value: number[];
  invested: number[];
}

export interface PurchasePlan {
  fills: Fill[];
  units: Record<string, number>;
  market_value: Record<string, number>;
  total_invested: number;
  total_value: number;
  absolute_gain: number;
  /** Annualised money weighted return. Null when the solve did not converge. */
  xirr: number | null;
  valued_on: string;
  first_purchase: string;
  is_single_dated: boolean;
  shifted_fills: Fill[];
  /** Holdings whose cost was worked back from what they are worth today. */
  converted_fills: Fill[];
  value_series: StagedValueSeries;
}

export interface BasketAnalysis {
  /** Fractions summing to 1. In staged mode these are today's market value. */
  weights: Record<string, number>;
  /** Null for a single fund basket. */
  correlation: Correlation | null;
  /** Null when the basket has no variance at all. */
  diversification_ratio: number | null;
  basket_volatility: number;
  fund_volatility: Record<string, number>;
  weighted_fund_volatility: number;
  /**
   * Each fund's share of the basket's weekly variance, summing to 1. A fund
   * moving against the rest comes out negative. Empty when the basket has
   * no variance; absent from a response made before the field existed.
   */
  risk_contribution?: Record<string, number>;
  max_drawdown: Drawdown;
  weekly_observations: number;
  start: string;
  end: string;
  is_single_fund: boolean;
  is_staged: boolean;
  /** Deposit free, normalised to 1.0 at `start`. */
  basket_value: Series;
  /** Null in simple mode. */
  purchases: PurchasePlan | null;
  /**
   * Pairs whose linear and rank correlations are far apart. Reporting only:
   * grouping never sees the rank matrix, so nothing in the headline depends
   * on this. Usually empty, and empty is a normal answer.
   */
  rank_gaps: RankGap[];
}

/**
 * One pair the two ways of measuring correlation disagree about.
 *
 * `correlation` is Pearson, the number the heatmap and the grouping both
 * use. `rank_correlation` is Spearman over the same weekly returns: it
 * scores a week by where the move came in the order rather than by how big
 * it was, so the two parting company means a few weeks are carrying the
 * pair.
 */
export interface RankGap {
  codes: string[];
  correlation: number;
  rank_correlation: number;
  /** Signed, positive when Pearson reads higher than Spearman. */
  gap: number;
}

export interface FundGroup {
  codes: string[];
  /** Share of the basket, 0 to 1. */
  weight: number;
  /** The weakest pair inside the group. */
  min_correlation: number;
  size: number;
}

export interface Standalone {
  code: string;
  weight: number;
}

export interface Grouping {
  /** Heaviest first. Empty is a normal, and good, result. */
  groups: FundGroup[];
  standalone: Standalone[];
  threshold: number;
  grouped_weight: number;
}

/* ------------------------------------------------------------------ */
/* Real return                                                         */
/* ------------------------------------------------------------------ */

export interface RealReturn {
  basis: ReturnBasis;
  total: number;
  annual: number;
  nominal_total: number;
  nominal_annual: number;
  inflation_total: number;
  cpi_start: number;
  cpi_end: number;
  series_code: string;
  /** YYYY-MM. */
  latest_cpi_month: string;
  stale_months: number;
  is_extrapolated: boolean;
  real_value: Series;
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export interface Fund {
  code: string;
  title: string;
}

export interface FundsResponse {
  count: number;
  funds: Fund[];
}

export interface HealthResponse {
  status: "ok";
  version: string;
}

export interface AnalyzeResponse {
  mode: Mode;
  months: number;
  requested_codes: string[];
  coverage: Coverage;
  analysis_status: AnalysisStatus;
  analysis: BasketAnalysis | null;
  grouping: Grouping | null;
  full_analysis_status: FullAnalysisStatus;
  full_analysis: BasketAnalysis | null;
  full_grouping: Grouping | null;
  real_return_status: RealReturnStatus;
  real_return: RealReturn | null;

  rolling_status: RollingStatus;
  rolling_correlation: RollingCorrelation | null;
  /** Applied fee per requested code TEFAS's list carries. A missing code is unknown, not free. */
  fees?: Record<string, Fee>;
}

/** One pair's correlation over the moving window, plus its flat average. */
export interface RollingPair {
  /** Exactly two codes. */
  codes: string[];
  /** Null where a window was degenerate, so a gap stays a gap. */
  values: (number | null)[];
  /** The same number the correlation matrix carries for this pair. */
  full_period: number;
}

export interface RollingCorrelation {
  window_weeks: number;
  /** The grouping line, so the chart draws the threshold the finding used. */
  threshold: number;
  /** Shared by every pair: one matrix, one weekly index. */
  dates: string[];
  /** Sorted by `full_period`, strongest first. */
  pairs: RollingPair[];
}

/** One entry of FastAPI's 422 envelope. */
export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/* ------------------------------------------------------------------ */
/* Fund pages                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a correlation pair was judged to be.
 *
 * English on the wire, the same strings `src.precompute` writes into
 * Postgres. The Turkish lives in `lib/fund`, in one map, and nowhere else.
 * A value added here without a Turkish label there is a compile error,
 * which is the point of writing this as a union rather than `string`.
 */
export type Bucket =
  | "overlapping"
  | "inverse"
  | "similar"
  | "moderate"
  | "unrelated"
  | "uncertain"
  | "insufficient_data";

/** Why a fund return is missing. Codes, never sentences. */
export type ReturnUnavailable =
  | "insufficient_history"
  | "cpi_unavailable"
  | "cpi_window_before_series";

/**
 * Why a fund has no neighbours at all.
 *
 * Two different silences. `no_measurable_pairs` is a priced fund that was
 * measured against every other one and cleared the bar against none;
 * `fund_not_priced` never entered the matrix. Neither is an error, and
 * neither is a 404.
 */
export type NeighboursUnavailable = "no_measurable_pairs" | "fund_not_priced";

/**
 * One fund over one window. Total return, not annualised.
 *
 * `window_start` and `window_end` are not decoration. The window ends at the
 * last month TÜİK has published an index for, not at today, so a "12 month"
 * figure read on the 20th runs to the end of last month. The page prints the
 * two months rather than implying otherwise. Both figures are measured over
 * exactly this window, so the difference between them is inflation.
 */
export interface FundReturn {
  months: number;
  nominal: number | null;
  real: number | null;
  nominal_unavailable: ReturnUnavailable | null;
  real_unavailable: ReturnUnavailable | null;
  /** Month starts. Null together, when there was no window to measure. */
  window_start: string | null;
  window_end: string | null;
  /** Annualised weekly volatility over the same window; own fund only. */
  volatility?: number | null;
  /** Largest peak-to-trough fall inside the window, ≤ 0; own fund only. */
  max_drawdown?: number | null;
  /** The TL return in dollars at TCMB's rate; null without a rate. */
  usd?: number | null;
}

/** What a fund is. Every field but the code and the name may be absent. */
/**
 * The fee a fund applies, as TEFAS publishes it. `rate` is annual, as a
 * fraction. Securities funds report a management fee, pension funds the
 * fund operating expense; the page names them differently. Zero is passed
 * on as reported and may be a gap in TEFAS's data.
 */
export interface Fee {
  rate: number;
  kind: "management" | "operating";
}

export interface FundIdentity {
  code: string;
  name: string;
  founder: string | null;
  fund_type: string | null;
  umbrella_type: string | null;
  category: string | null;
  total_assets: number | null;
  investor_count: number | null;
  /** 1 to 7 on TEFAS's own scale. Null means TEFAS did not say, not zero. */
  risk_value: number | null;
  /** Absent on pages built before the API sent it; null when TEFAS did not say. */
  fee?: Fee | null;
  returns: FundReturn[];
}

/**
 * One stored pair, from the subject fund's side.
 *
 * The neighbour's whole identity travels with it, returns included, because
 * the popover opens the moment a row is pressed and a request per neighbour
 * would be twenty round trips for one screen.
 */
export interface Neighbour {
  correlation: number;
  ci_low: number | null;
  ci_high: number | null;
  n_weeks: number;
  bucket: Bucket;
  fund: FundIdentity;
  /**
   * The neighbour's last year of weeks, base 100, for the chart in its card.
   * Optional: a page built against an API that predates it draws no chart.
   */
  recent?: WeeklySeries | null;
}

/** When the numbers on the page were computed. */
export interface DataFreshness {
  last_run_at: string | null;
  universe_size: number | null;
  included_funds: number | null;
  /** Last month TÜİK has published. Real returns never run past it. */
  cpi_latest_month: string | null;
}

/**
 * One fund's weekly value line, as an index rather than as lira.
 *
 * `values[i]` is the week ending `start` plus `step_days * i`. The dates are
 * implied because sending 214 ISO strings beside 214 numbers would roughly
 * triple the payload of all 1372 pages to say something countable.
 *
 * That is only safe because the grid is complete: a week the fund did not
 * price is `null` in `values`, never a missing entry. A dropped week would
 * shift every later point by seven days and misdate the series. A null is
 * not filled in either — a gap reads as a gap.
 */
export interface WeeklySeries {
  /** The Friday `values[0]` belongs to. */
  start: string;
  /** Always 7, stated rather than assumed. */
  step_days: number;
  /** Base 100 at the first priced week. */
  values: (number | null)[];
}

/**
 * The published CPI, for the inflation line.
 *
 * Monthly, because that is how it exists. `values[i]` is the month starting
 * `start_month` plus `i` months, as published and not rebased. The index is
 * a level for a whole month: it is never interpolated to a day, and never
 * carried past `latest_month`, which is where the inflation line stops.
 */
export interface CPISeries {
  start_month: string;
  latest_month: string;
  values: number[];
}

export interface FundPageResponse {
  fund: FundIdentity;
  high: Neighbour[];
  low: Neighbour[];
  neighbours_unavailable: NeighboursUnavailable | null;
  /** The chart's two lines. Null when the run stored no series for the fund. */
  series: WeeklySeries | null;
  cpi: CPISeries | null;
  freshness: DataFreshness;
}

export interface FundListItem {
  code: string;
  name: string;
  founder: string | null;
}

/** Every fund with a page. For static generation, not for search. */
export interface FundListResponse {
  count: number;
  funds: FundListItem[];
}

/* ------------------------------------------------------------------ */
/* The market grouping                                                 */
/* ------------------------------------------------------------------ */

/** Funds of which every pair overlaps. */
export interface MarketCluster {
  codes: string[];
  size: number;
  weakest_ci_low: number;
  median_correlation: number;
  founders: number;
  /** TEFAS's own category string, passed through as data. */
  top_category: string | null;
  top_category_share: number | null;
  total_assets: number | null;
  /**
   * Share of the asset-weighted market's weekly variance, all shares summing
   * to 1. Null when no sizes were known; absent before the field existed.
   */
  risk_share?: number | null;
  /** Lowest and highest applied fee among members with a non-zero one. */
  fee_low?: number | null;
  fee_high?: number | null;
  /** What the group's equal-weight return is made of. */
  style: Style | null;
}

/**
 * Returns-based style: non-negative weights over the factors, summing to 1.
 * `reportable` is false when the mix explains too little (`r2` under the
 * model's minimum); nothing is then printed about composition.
 */
export interface Style {
  weights: Record<string, number>;
  r2: number;
  weeks: number;
  reportable: boolean;
}

export interface StyleFactor {
  key: string;
  /** The fund standing for this factor in this snapshot. */
  proxy: string;
}

export type UnmeasuredReason = "short_history" | "stale_prices";

export interface MarketResponse {
  listed: number;
  measured: number;
  groups_total: number;
  clusters: MarketCluster[];
  singletons: string[];
  unmeasured: Partial<Record<UnmeasuredReason, string[]>>;
  overlapping_threshold: number;
  min_weeks: number;
  window_start: string | null;
  window_end: string | null;
  total_assets_measured: number | null;
  last_run_at: string | null;
  style_factors: StyleFactor[];
  style_min_r2: number | null;
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

/** A pair whose correlation in one year differs from the other years'. */
export interface PeriodShift {
  a: string;
  b: string;
  /** Inside the year. */
  corr: number;
  /** Over every week outside it. */
  rest: number;
  /** Fisher z difference over its standard error. */
  z: number;
}

/** The style factors over one calendar year, or the whole window ("all"). */
export interface MarketPeriod {
  key: string;
  start: string;
  end: string;
  weeks: number;
  partial: boolean;
  mean_correlation?: number | null;
  /** Factor keys as codes. */
  correlation: Correlation;
  volatility: Record<string, number>;
  shifts: PeriodShift[];
}

export interface MarketPeriodsResponse {
  factors: StyleFactor[];
  whole: MarketPeriod | null;
  periods: MarketPeriod[];
  alpha: number;
  z_critical: number | null;
}
