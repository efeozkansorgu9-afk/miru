/**
 * Turning what the form holds into what the API takes.
 *
 * The form's own rules live in `lib/basket`; this is the last step after
 * them, and it is separate for one reason: the form validates fields, and
 * this validates the *basket*. "This amount is not a number" belongs next to
 * the input. "You said what you paid but not when" is a fact about the whole
 * row that the server would otherwise reject in English.
 */

import type { AnalyzeRequest, FundAmount, PurchaseIn } from "@/lib/api";
import { checkAmount } from "@/lib/basket";
import type { BasketFund, PurchaseRow } from "@/lib/basket";
import { BASKET_MONTHS } from "@/lib/windows";


export type BuildResult =
  | { ok: true; request: AnalyzeRequest }
  | { ok: false; error: string };

/** The basket as it stands: one amount per fund, optionally dated. */
export function buildSimpleRequest(funds: BasketFund[]): BuildResult {
  const rows: FundAmount[] = [];

  for (const fund of funds) {
    const { value } = checkAmount(fund.amount);
    // A fund with no amount is left out rather than sent as zero. The form
    // already says so above the button.
    if (value === null) continue;

    if (fund.basis === "paid" && !fund.since) {
      return {
        ok: false,
        error:
          `${fund.code} için ödediğiniz tutarı yazdınız ama tarihi boş ` +
          `bıraktınız. Ödenen tutar, ödendiği gün olmadan kaç pay aldığınızı ` +
          `söylemiyor. Tarihi girin ya da bugünkü değeri seçin.`,
      };
    }

    rows.push({
      code: fund.code,
      amount: value,
      basis: fund.basis,
      date: fund.since || null,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "Tutarı girilmiş fon yok." };
  }
  return { ok: true, request: { funds: rows, months: BASKET_MONTHS } };
}

/** Dated deposits: a fund appears once for every time money went into it. */
export function buildStagedRequest(rows: PurchaseRow[]): BuildResult {
  const purchases: PurchaseIn[] = [];

  for (const row of rows) {
    const { value } = checkAmount(row.amount);
    // A half filled line is not a purchase. The form counts these out loud.
    if (!row.code || !row.date || value === null) continue;
    purchases.push({ code: row.code, date: row.date, amount: value, basis: "paid" });
  }

  if (purchases.length === 0) {
    return { ok: false, error: "Tamamlanmış alım satırı yok." };
  }
  return { ok: true, request: { purchases, months: BASKET_MONTHS } };
}
