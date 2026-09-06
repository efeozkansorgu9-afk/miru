/**
 * A basket to press the button with.
 *
 * An empty form asks the reader to already know what this page is for. They
 * have to find funds they own, type amounts and pick dates before anything
 * on screen tells them what comes out the other end, and most people leave
 * before that. So the empty state carries one basket that is already filled
 * in and runs itself.
 *
 * It is chosen to produce a finding rather than to flatter the product. AFO
 * and HBF are two companies' gold funds and their weekly returns correlate
 * at about 0,99, which is the thing this page exists to point at: two lines
 * in a portfolio that are one holding. The other three sit in categories far
 * enough from gold and from each other that they stay standalone, so the
 * result shows both halves of the answer, a group and the funds outside it.
 *
 * These are not recommendations and are not the most traded funds on TEFAS.
 * Nothing in the data behind this page says which funds are popular, so the
 * page never claims any are.
 *
 * The dates are relative rather than fixed. A date written into the source
 * quietly ages: three years back today is five years back in two years, and
 * five years is where TEFAS stops answering, which would turn the example
 * into an error message.
 */

import { nextId } from "@/lib/basket";
import type { BasketFund } from "@/lib/basket";

/** Codes, titles, lira and how long they have been held. */
const HOLDINGS = [
  { code: "AFO", title: "AK PORTFÖY ALTIN FONU", amount: "45000", years: 4 },
  { code: "HBF", title: "HSBC PORTFÖY ALTIN FONU", amount: "35000", years: 3 },
  {
    code: "TI2",
    title: "İŞ PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)",
    amount: "40000",
    years: 3,
  },
  {
    code: "YAY",
    title: "YAPI KREDİ PORTFÖY YABANCI TEKNOLOJİ SEKTÖRÜ HİSSE SENEDİ FONU",
    amount: "30000",
    years: 2,
  },
  {
    code: "GAL",
    title: "GARANTİ PORTFÖY İKİNCİ PARA PİYASASI (TL) FONU",
    amount: "25000",
    years: 2,
  },
] as const;

/**
 * The example basket, ready to drop into the form.
 *
 * Fresh objects with fresh ids on every call, because what comes back is
 * mutable form state: the reader is meant to change the amounts, remove a
 * fund and press analyse again.
 */
export function sampleBasket(): BasketFund[] {
  return HOLDINGS.map((holding) => ({
    id: nextId("fund"),
    code: holding.code,
    title: holding.title,
    amount: holding.amount,
    // What each holding is worth now, held since the date below. The same
    // shape someone reading a portfolio screen would type.
    basis: "current_value" as const,
    since: yilOnce(holding.years),
  }));
}

/** The same day of the year, `n` years back, in the reader's own timezone. */
function yilOnce(n: number): string {
  const now = new Date();
  const then = new Date(now.getFullYear() - n, now.getMonth(), now.getDate());
  const ay = String(then.getMonth() + 1).padStart(2, "0");
  const gun = String(then.getDate()).padStart(2, "0");
  return `${then.getFullYear()}-${ay}-${gun}`;
}
