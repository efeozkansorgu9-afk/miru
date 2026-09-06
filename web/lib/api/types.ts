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
  | "no_data_unverified";

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
