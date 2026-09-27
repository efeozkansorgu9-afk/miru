/**
 * Typed client for the FastAPI backend.
 *
 * The one place in this app that knows a network exists. Everything above it
 * gets typed values or an `ApiError`, never a `Response` and never a `fetch`
 * that may or may not have parsed.
 *
 * Failures arrive as one class with a `kind` to switch on, because the four
 * cases need four different sentences on screen: the server is not running
 * (a developer forgot uvicorn), TEFAS is down (nothing to do but wait), the
 * request was wrong (a field to point at), or something broke (an apology).
 * The Turkish for each is written by the component, not here.
 */

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  FundListResponse,
  FundPageResponse,
  FundsResponse,
  HealthResponse,
  MarketGroupResponse,
  MarketPeriodsResponse,
  MarketResponse,
  ValidationIssue,
} from "./types";

/**
 * Where the backend lives. Override with NEXT_PUBLIC_API_URL at build time.
 * The default matches `uvicorn api.main:app --port 8000`, which is what the
 * repository's README tells you to run.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export type ApiErrorKind =
  /** The request never reached a server: wrong port, or nothing listening. */
  | "network"
  /** Gave up waiting. */
  | "timeout"
  /** 422. The request was understood and rejected; `issues` says where. */
  | "validation"
  /** 404. There is no such thing, which for a fund page is a real answer. */
  | "not_found"
  /** 503. The backend is up but TEFAS is not. */
  | "upstream"
  /** 5xx. The backend broke and told us nothing, by design. */
  | "server"
  /** Any other non 2xx, or a body that did not parse. */
  | "unexpected";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Present for `validation`. Empty for everything else. */
  readonly issues: ValidationIssue[];

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.issues = issues;
  }

  /**
   * Field name to message, for putting an error next to the input that caused
   * it. FastAPI reports `loc` as ["body", "purchases", 0, "amount"]; the
   * leading "body" is noise to a form, so it is dropped.
   */
  get fieldIssues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.issues) {
      const path = issue.loc.filter((part) => part !== "body");
      out[path.join(".") || "_"] = issue.msg;
    }
    return out;
  }
}

/** Fifteen seconds. A cold /funds does six TEFAS round trips. */
const DEFAULT_TIMEOUT_MS = 15_000;

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<T> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // The caller's own signal still has to work, so the timeout is combined
  // with it rather than replacing it.
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: combined,
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch (error) {
    // A caller who aborted deliberately gets their own abort back, not an
    // ApiError: cancelling a request is not a failure to report.
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new ApiError("timeout", `${path} did not answer in time`);
    }
    throw new ApiError(
      "network",
      `${API_BASE_URL} is not answering. Is the API running?`,
    );
  }

  const body = await readJson(response);

  if (response.ok) return body as T;

  const detail = (body as { detail?: unknown } | null)?.detail;

  if (response.status === 422 && Array.isArray(detail)) {
    return Promise.reject(
      new ApiError(
        "validation",
        "The request was rejected.",
        422,
        detail as ValidationIssue[],
      ),
    );
  }

  const message = typeof detail === "string" ? detail : response.statusText;

  // A fund page asks for a code that may not exist, and "no such fund" is
  // the page it renders rather than a failure it reports. Given its own kind
  // so a caller can switch on it instead of comparing a status number.
  if (response.status === 404) {
    throw new ApiError("not_found", message, 404);
  }
  if (response.status === 503) {
    throw new ApiError("upstream", message, 503);
  }
  if (response.status >= 500) {
    throw new ApiError("server", message, response.status);
  }
  throw new ApiError("unexpected", message, response.status);
}

/** Never throws. A body that will not parse is a failure the caller reports. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

/** Is the backend up? Says nothing about TEFAS. */
export function getHealth(options?: RequestOptions): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { method: "GET" }, options);
}

/**
 * Every fund TEFAS currently lists, for the picker.
 *
 * Around 2600 rows and roughly 220 kB. The backend caches it for a day; ask
 * for it once and keep it, rather than on every keystroke.
 */
export function getFunds(options?: RequestOptions): Promise<FundsResponse> {
  return request<FundsResponse>("/funds", { method: "GET" }, options);
}

/**
 * Analyse one basket.
 *
 * A 200 does not mean there is an analysis: a basket whose funds all returned
 * nothing answers with `analysis: null` and an `analysis_status` saying why.
 * Read the status before the analysis.
 */
export function analyze(
  body: AnalyzeRequest,
  options?: RequestOptions,
): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>(
    "/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    // A cold basket is three TEFAS fetches at half a second apart plus a CPI
    // call, so it gets longer than the default.
    { timeoutMs: 40_000, ...options },
  );
}

/**
 * Every fund that has a page, for generating them.
 *
 * Around 1370 rows. Only `included` funds are in it: a fund the weekly job
 * could not price has nothing to put on a page.
 */
export function getFundList(options?: RequestOptions): Promise<FundListResponse> {
  return request<FundListResponse>("/funds/list", { method: "GET" }, options);
}

/**
 * One fund: identity, both return windows, and its correlation neighbours.
 *
 * Reads Postgres and computes nothing, so it is fast and the default timeout
 * is generous for it. A `not_found` ApiError means the last weekly run never
 * saw the code — a typo, or a fund TEFAS no longer lists. It does NOT mean
 * the fund has no neighbours: that answers 200 with empty lists and a
 * `neighbours_unavailable` code, because the fund is real and "nothing could
 * be measured against it" is a finding.
 */
export function getFundPage(
  code: string,
  options?: RequestOptions,
): Promise<FundPageResponse> {
  return request<FundPageResponse>(
    `/fund/${encodeURIComponent(code)}`,
    { method: "GET" },
    options,
  );
}

/** The fund universe grouped by overlap. Computed server side once a week. */
export function getMarket(options?: RequestOptions): Promise<MarketResponse> {
  return request<MarketResponse>("/market/clusters", { method: "GET" }, options);
}

/** The style factors' correlations and volatility per calendar year. */
export function getMarketPeriods(options?: RequestOptions): Promise<MarketPeriodsResponse> {
  return request<MarketPeriodsResponse>("/market/periods", { method: "GET" }, options);
}

/** One market group, found by any member's code. 404 when it is in none. */
export function getMarketGroup(code: string, options?: RequestOptions): Promise<MarketGroupResponse> {
  return request<MarketGroupResponse>(
    `/market/group/${encodeURIComponent(code)}`,
    { method: "GET" },
    options,
  );
}
