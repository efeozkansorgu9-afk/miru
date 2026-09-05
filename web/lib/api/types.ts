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
 * Which series the real return was measured on.
 *
 * `held_units` is staged mode, and it is NOT the investor's own return: it is
 * what the units they hold today would have done over the window, with no
 * deposits in it. Their own money weighted return is `PurchasePlan.xirr`.
 */
export type ReturnBasis = "lump_sum" | "held_units";

export type Mode = "simple" | "staged";

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
}

export interface PurchaseIn {
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  code: string;
  amount: number;
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
  amount: number;
  price: number;
  units: number;
  was_shifted: boolean;
  shifted_days: number;
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
}

/** One entry of FastAPI's 422 envelope. */
export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}
