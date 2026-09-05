/**
 * Basket form state and the checks that run on it.
 *
 * Pure functions and plain data: no React, no fetching. Everything the form
 * shows in red comes from here, so the rules can be read in one place rather
 * than being scattered across inputs.
 */

/** What the number in the amount field means. */
export type AmountBasis =
  /** What the holding is worth today. The default. */
  | "current_value"
  /** What was paid for it, on the date given. */
  | "paid";

/** One fund in the basket, in simple mode. */
export interface BasketFund {
  /** Stable across reorders and re renders. Not the fund code. */
  id: string;
  code: string;
  title: string;
  /** Exactly what the user typed. Never reformatted under them. */
  amount: string;
  basis: AmountBasis;
  /** ISO date, or empty when not given. */
  since: string;
}

/** One dated purchase, in staged mode. */
export interface PurchaseRow {
  id: string;
  /** Empty until a fund is chosen. */
  code: string;
  amount: string;
  date: string;
}

let counter = 0;
/** Ids are local to one session and never leave the browser. */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Today as an ISO date, in the browser's own timezone rather than UTC. */
export function todayISO(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Amounts                                                             */
/* ------------------------------------------------------------------ */

export interface AmountCheck {
  /** Parsed lira, or null when the field is empty or unreadable. */
  value: number | null;
  /** Turkish, ready to show. Null when there is nothing wrong. */
  error: string | null;
}

// Digits, the two separators, and spaces. Everything else is a typo.
const ALLOWED = /^[\d.,\s ]*$/;
// 1.234.567 and 12.345: dots used as thousands separators, Turkish style.
const THOUSANDS_ONLY = /^\d{1,3}(\.\d{3})+$/;

/**
 * Read a typed amount.
 *
 * Deliberately forgiving about how it is written, because people type money
 * in the shape their bank shows it: "12500", "12.500", "12500,50" and
 * "12 500" are the same number. What it does not do is rewrite the field
 * while they are still in it. An input that inserts separators or a trailing
 * ",00" as you type moves the caret under your hands, and the moment you
 * reach the end of "1250" to add a zero you find you have "1.250,00" and
 * have to start again.
 */
export function checkAmount(raw: string): AmountCheck {
  const text = raw.trim();
  if (!text) return { value: null, error: null };

  if (!ALLOWED.test(text)) {
    return {
      value: null,
      error: "Sadece rakam yazın. Harf ve simge kullanılamaz.",
    };
  }

  const compact = text.replace(/[\s ]/g, "");
  let normalised: string;

  if (compact.includes(",")) {
    // A comma means the decimal separator, so dots are thousands.
    normalised = compact.replace(/\./g, "").replace(",", ".");
  } else if (THOUSANDS_ONLY.test(compact)) {
    // "1.500" with no comma: thousands, the way it is written on a receipt.
    normalised = compact.replace(/\./g, "");
  } else {
    // A lone dot with anything other than three digits after it is a
    // decimal point: "1.5" is one and a half, not fifteen hundred.
    normalised = compact;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    return { value: null, error: "Bu tutar okunamadı." };
  }
  if (value <= 0) {
    return { value: null, error: "Tutar sıfırdan büyük olmalı." };
  }
  return { value, error: null };
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * A date the user could actually have bought on.
 *
 * The input's `max` already keeps the picker out of the future, but a date
 * field can still be typed into, so the rule is enforced rather than merely
 * suggested.
 */
export function checkDate(raw: string): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Tarih okunamadı.";
  if (raw > todayISO()) return "İleri bir tarih seçilemez.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Whether the basket can be analysed                                  */
/* ------------------------------------------------------------------ */

export interface BasketCheck {
  /** True when "Analiz et" should be pressable. */
  canAnalyze: boolean;
  /** Any field is red. */
  hasErrors: boolean;
  /** Funds with no amount typed. Not an error, but they cannot be analysed. */
  emptyCodes: string[];
  /** Purchase rows missing a fund, a date or an amount. Same idea. */
  incomplete: number;
}

export function checkSimpleBasket(funds: BasketFund[]): BasketCheck {
  let hasErrors = false;
  let filled = 0;
  const emptyCodes: string[] = [];

  for (const fund of funds) {
    const amount = checkAmount(fund.amount);
    if (amount.error || checkDate(fund.since)) hasErrors = true;
    if (amount.value === null && !amount.error) emptyCodes.push(fund.code);
    if (amount.value !== null) filled += 1;
  }

  return { canAnalyze: !hasErrors && filled > 0, hasErrors, emptyCodes, incomplete: 0 };
}

export function checkStagedBasket(rows: PurchaseRow[]): BasketCheck {
  let hasErrors = false;
  let complete = 0;

  for (const row of rows) {
    const amount = checkAmount(row.amount);
    if (amount.error || checkDate(row.date)) hasErrors = true;
    if (row.code && row.date && amount.value !== null) complete += 1;
  }

  return {
    canAnalyze: !hasErrors && complete > 0,
    hasErrors,
    emptyCodes: [],
    // A half filled row is not an error, but it is not a purchase either,
    // and dropping it without saying so would misreport the basket.
    incomplete: rows.length - complete,
  };
}
