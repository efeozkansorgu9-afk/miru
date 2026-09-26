/**
 * Baskets to press the button with.
 *
 * An empty form asks the reader to already know what this page is for. They
 * have to find funds they own, type amounts and pick dates before anything
 * on screen tells them what comes out the other end, and most people leave
 * before that. So the empty state carries baskets that are already filled in
 * and run themselves.
 *
 * ## Why a pool of twenty, drawn at random
 *
 * One example taught one lesson, and four were not many more: they were
 * handed out in order, so everyone who pressed the button first saw the
 * same gold basket, and everyone who reloaded saw it again. The page looked
 * like it had one example.
 *
 * So there are twenty, across the verdicts `mainFinding` can return — six
 * where a group holds a notable share, six where one dominates, six with no
 * group, one with a small group and one single fund — and across the kinds
 * of fund a reader is likely to hold: gold, silver, BIST 30 and bank index
 * funds, eurobonds, participation funds, money markets, foreign equity.
 *
 * Each press draws one **at random, from all twenty but the basket already
 * on screen.** That exclusion is the only thing standing between "random"
 * and a button that sometimes appears to do nothing, which is what a
 * reader sees when the draw lands on what they are looking at.
 *
 * ## These are not recommendations
 *
 * They are not the most traded funds on TEFAS and nothing here says which
 * funds are worth holding. Nothing in the data behind this page knows which
 * funds are popular, so the page never claims any are.
 *
 * ## Verified, not assumed
 *
 * Every basket was run through the live `/analyze` on 2026-09-26, over the
 * full five years, and produced the verdict named in its `expect` field; the
 * measured pair that carries each one is in its `evidence`. None had a fund
 * excluded from the window, and grouped weights were kept off the 0,25 and
 * 0,50 tier lines, so a rounding step cannot flip a verdict. If a
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

import raw from "./sample-scenarios.json";

interface Holding {
  code: string;
  title: string;
  /** Lira, as what the holding is worth today. */
  amount: string;
  /** How long it has been held, in whole years back from today. */
  years: number;
}

/** The tiers `mainFinding` can return for an example basket. */
type ExpectedTier = "notable" | "dominant" | "none" | "minor" | "single";

interface RawScenario {
  id: string;
  expect: string;
  evidence: string;
  holdings: Holding[];
}

export interface SampleScenario {
  id: string;
  /**
   * What this basket is here to show, in one line, under the basket.
   *
   * It describes the *basket*, not the finding. Saying "two funds here move
   * together" before the analysis has run would put the answer above the
   * work, and would be a claim this file cannot keep if the correlation
   * moves. Naming what is in the basket is true either way.
   *
   * This is the half of a scenario that stays in TypeScript. The codes live
   * in the JSON because the weekly job re-measures them; the wording lives
   * here because the backend never handles display text.
   */
  note: string;
  /**
   * The `mainFinding` tier this basket produced when it was last measured.
   * Documentation here, and an assertion in the weekly job: `src/scenarios`
   * recomputes it against live prices and says so when it stops holding.
   */
  expect: ExpectedTier;
  holdings: readonly Holding[];
}

/**
 * The sentence under each example. Keyed by scenario id, so a scenario added
 * to the JSON without a Turkish line here does not compile.
 */
const NOTLAR: Record<string, string> = {
  "iki-altin":
    "Beş fon: ikisi ayrı şirketlerin altın fonu, kalanı başka kategorilerden.",
  "ayni-endeks":
    "Dört fon: ikisi aynı endeksi izleyen, ayrı şirketlerin fonu.",
  dagilmis:
    "Dört fon: para piyasası, altın, yabancı hisse ve borçlanma araçları.",
  "tek-fon":
    "Tek fon: karşılaştıracak ikinci fon olmadığında ne olduğunu gösterir.",
  "uc-altin":
    "Dört fon: üçü üç ayrı şirketin altın fonu, biri yabancı teknoloji hissesi.",
  "kucuk-grup":
    "Beş fon: ikisi aynı endeksi izleyen küçük tutarlı fonlar, kalanı altın, yabancı hisse ve para piyasası.",
  "eurobond-cift":
    "Dört fon: ikisi ayrı şirketlerin eurobond fonu, yanında altın ve Türk hisseleri.",
  "gumus-altin":
    "Dört fon: gümüş, altın, para piyasası ve Türk hisseleri.",
  "bist30-uclu":
    "Dört fon: üçü üç ayrı şirketin BIST 30 endeks fonu, biri altın.",
  banka:
    "Dört fon: ikisi banka endeksi fonu, biri BIST 30 endeks fonu, biri altın.",
  "dengeli-bes":
    "Beş fon, eşit tutarlarla: altın, eurobond, Türk hisseleri, borçlanma araçları ve para piyasası.",
  "yabanci-teknoloji":
    "Dört fon: üçü ayrı şirketlerin yabancı teknoloji hissesi fonu, biri para piyasası.",
  "altin-katilim":
    "Dört fon: biri katılım, biri klasik altın fonu; yanında katılım para piyasası ve kira sertifikası.",
  "fon-sepeti":
    "Dört fon: ikisi fon sepeti fonu, biri Türk hisseleri, biri para piyasası.",
  "para-piyasasi":
    "Dört fon: üçü ayrı şirketlerin para piyasası fonu, biri altın.",
  "yabanci-karma":
    "Dört fon: Amerika, Avrupa ve yabancı teknoloji hisseleri, yanında dolar eurobond.",
  "altin-eurobond":
    "Üç fon: altın, eurobond ve para piyasası.",
  "gumus-cift":
    "Üç fon: ikisi ayrı şirketlerin gümüş fonu, biri altın.",
  "bist100-disi":
    "Dört fon: ikisi ayrı şirketlerin BIST 100 dışı şirketlere yatıran fonu, yanında Türk hisseleri ve altın.",
  "amerika-avrupa":
    "Dört fon: Amerika ve Avrupa hisseleri, altın ve para piyasası.",
};

const SCENARIOS: readonly SampleScenario[] = (
  raw.scenarios as RawScenario[]
).map((s) => {
  const note = NOTLAR[s.id];
  if (!note) {
    // A scenario with no sentence would load a basket the page cannot
    // describe. Better to fail the build than to ship a blank line.
    throw new Error(
      `sample-scenarios.json has a scenario "${s.id}" with no Turkish note ` +
        `in lib/sample.ts`,
    );
  }
  return {
    id: s.id,
    note,
    expect: s.expect as ExpectedTier,
    holdings: s.holdings,
  };
});

/** How many examples there are, for wording like "4 örnekten biri". */
export const SAMPLE_COUNT = SCENARIOS.length;

/**
 * A random example basket, and the line that describes it.
 *
 * Drawn uniformly from every scenario except `current` — the one on screen,
 * if any — so a press always changes the basket. `Math.random` runs only on
 * a press, in the browser, so there is nothing for the server render to
 * disagree with.
 *
 * Fresh objects with fresh ids on every call, because what comes back is
 * mutable form state: the reader is meant to change the amounts, remove a
 * fund and press analyse again.
 */
export function randomSample(
  current?: string,
): { funds: BasketFund[]; scenario: SampleScenario } {
  const pool =
    SCENARIOS.length > 1
      ? SCENARIOS.filter((s) => s.id !== current)
      : SCENARIOS;
  const scenario = pool[Math.floor(Math.random() * pool.length)];

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
