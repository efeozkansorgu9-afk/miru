/**
 * Baskets to press the button with.
 *
 * An empty form asks the reader to already know what this page is for. They
 * have to find funds they own, type amounts and pick dates before anything
 * on screen tells them what comes out the other end, and most people leave
 * before that. So the empty state carries baskets that are already filled in
 * and run themselves.
 *
 * ## Why a pool, and why it is walked in order
 *
 * One example taught one lesson. Whoever pressed the button saw two gold
 * funds flagged and had no way to find out what the page says about a basket
 * with nothing wrong with it, or about a single holding, without going and
 * finding fund codes by hand — which is the work the example exists to avoid.
 *
 * So there are four, and each is here because it produces a *different*
 * verdict: a group holding about half the money, a group holding most of it,
 * no group at all, and a basket too small to group. Between them they show
 * every shape `mainFinding` can return except the failures.
 *
 * They are handed out in order rather than at random. Random with four items
 * repeats about a quarter of the time, and a reader who presses "another
 * example" and gets the basket they are already looking at reads it as a
 * broken button. `next()` walks the list and wraps, so four presses give
 * four different baskets.
 *
 * ## These are not recommendations
 *
 * They are not the most traded funds on TEFAS and nothing here says which
 * funds are worth holding. Nothing in the data behind this page knows which
 * funds are popular, so the page never claims any are.
 *
 * ## Verified, not assumed
 *
 * Every basket below was run through the live `/analyze` on 2026-09-09, over
 * the full five years, and produced the verdict named in its `expect` field.
 * The measured pair that carries each one is in the comment beside it. If a
 * scenario stops producing its verdict — funds drift, and a pair that
 * correlated at 0,99 for five years may not for the next five — the fix is
 * to change the funds and re-measure, never to reword the note so it matches
 * whatever came out.
 *
 * The dates are relative rather than fixed. A date written into the source
 * quietly ages: three years back today is five years back in two years, and
 * five years is where TEFAS stops answering, which would turn the example
 * into an error message.
 */

import { nextId } from "@/lib/basket";
import type { BasketFund } from "@/lib/basket";

interface Holding {
  code: string;
  title: string;
  /** Lira, as what the holding is worth today. */
  amount: string;
  /** How long it has been held, in whole years back from today. */
  years: number;
}

export interface SampleScenario {
  /**
   * What this basket is here to show, in one line, under the button.
   *
   * It describes the *basket*, not the finding. Saying "two funds here move
   * together" before the analysis has run would put the answer above the
   * work, and would be a claim this file cannot keep if the correlation
   * moves. Naming what is in the basket is true either way.
   */
  note: string;
  /**
   * The `mainFinding` tier this basket produced when it was last measured.
   * Documentation, not a promise the UI reads: nothing renders from it.
   */
  expect: "notable" | "dominant" | "none" | "single";
  holdings: readonly Holding[];
}

const SCENARIOS: readonly SampleScenario[] = [
  {
    // Measured: AFO/HBF r = 0,986 over 261 weeks; grouped weight 0,46.
    note:
      "Beş fon: ikisi ayrı şirketlerin altın fonu, kalanı başka " +
      "kategorilerden.",
    expect: "notable",
    holdings: [
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
        title:
          "YAPI KREDİ PORTFÖY YABANCI TEKNOLOJİ SEKTÖRÜ HİSSE SENEDİ FONU",
        amount: "30000",
        years: 2,
      },
      {
        code: "GAL",
        title: "GARANTİ PORTFÖY İKİNCİ PARA PİYASASI (TL) FONU",
        amount: "25000",
        years: 2,
      },
    ],
  },
  {
    // Measured: AKU/TIE r = 0,998 over 261 weeks; grouped weight 0,58. Two
    // houses' funds tracking the same index, which is as close as two
    // separate products get.
    note: "Dört fon: ikisi aynı endeksi izleyen, ayrı şirketlerin fonu.",
    expect: "dominant",
    holdings: [
      {
        code: "AKU",
        title:
          "AK PORTFÖY BIST 30 ENDEKSİ HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)",
        amount: "40000",
        years: 3,
      },
      {
        code: "TIE",
        title:
          "İŞ PORTFÖY BIST 30 ENDEKSİ HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)",
        amount: "35000",
        years: 3,
      },
      {
        code: "GAL",
        title: "GARANTİ PORTFÖY İKİNCİ PARA PİYASASI (TL) FONU",
        amount: "30000",
        years: 2,
      },
      { code: "AFO", title: "AK PORTFÖY ALTIN FONU", amount: "25000", years: 2 },
    ],
  },
  {
    // Measured: strongest pair AFO/YAY r = 0,485 over 261 weeks; no group.
    // The counterexample — the page has to be able to say it found nothing.
    note: "Dört fon: para piyasası, altın, yabancı hisse ve borçlanma araçları.",
    expect: "none",
    holdings: [
      {
        code: "GAL",
        title: "GARANTİ PORTFÖY İKİNCİ PARA PİYASASI (TL) FONU",
        amount: "30000",
        years: 3,
      },
      { code: "AFO", title: "AK PORTFÖY ALTIN FONU", amount: "25000", years: 3 },
      {
        code: "YAY",
        title:
          "YAPI KREDİ PORTFÖY YABANCI TEKNOLOJİ SEKTÖRÜ HİSSE SENEDİ FONU",
        amount: "30000",
        years: 2,
      },
      {
        code: "APT",
        title: "AK PORTFÖY ORTA VADELI BORÇLANMA ARAÇLARI FONU",
        amount: "25000",
        years: 2,
      },
    ],
  },
  {
    // Measured: `is_single_fund`, so grouping never runs. Nothing to compare
    // a lone holding with, and the page says that rather than filling the
    // space with a coefficient it does not have.
    note: "Tek fon: karşılaştıracak ikinci fon olmadığında ne olduğunu gösterir.",
    expect: "single",
    holdings: [
      {
        code: "TI2",
        title: "İŞ PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)",
        amount: "50000",
        years: 3,
      },
    ],
  },
];

/** How many examples there are, for wording like "4 örnekten biri". */
export const SAMPLE_COUNT = SCENARIOS.length;

/**
 * Where the walk has got to.
 *
 * Module scope, so it survives the form unmounting and remounting but not a
 * reload. A reader who comes back tomorrow starting from the first example
 * again is fine; one who presses the button twice in a row and sees the same
 * basket is not.
 */
let cursor = 0;

/**
 * The next example basket, and the line that describes it.
 *
 * Fresh objects with fresh ids on every call, because what comes back is
 * mutable form state: the reader is meant to change the amounts, remove a
 * fund and press analyse again.
 */
export function nextSample(): { funds: BasketFund[]; scenario: SampleScenario } {
  const scenario = SCENARIOS[cursor % SCENARIOS.length];
  cursor += 1;

  return {
    scenario,
    funds: scenario.holdings.map((holding) => ({
      id: nextId("fund"),
      code: holding.code,
      title: holding.title,
      amount: holding.amount,
      // What each holding is worth now, held since the date below. The same
      // shape someone reading a portfolio screen would type.
      basis: "current_value" as const,
      since: yilOnce(holding.years),
    })),
  };
}

/** The same day of the year, `n` years back, in the reader's own timezone. */
function yilOnce(n: number): string {
  const now = new Date();
  const then = new Date(now.getFullYear() - n, now.getMonth(), now.getDate());
  const ay = String(then.getMonth() + 1).padStart(2, "0");
  const gun = String(then.getDate()).padStart(2, "0");
  return `${then.getFullYear()}-${ay}-${gun}`;
}
