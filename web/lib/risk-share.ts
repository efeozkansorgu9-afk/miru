/**
 * Where a basket's movement comes from, set beside where its money is.
 *
 * The API sends each fund's share of the basket's weekly variance (an Euler
 * decomposition: the shares add up to exactly 1). This file only arranges
 * them: funds that the grouping put together are read as one unit, because
 * the page has already said they are one holding, and the rest stand alone.
 * A unit's share is the sum of its members'. Nothing is recomputed here.
 *
 * The sentence names the unit whose movement share most exceeds its money
 * share, when the gap is large enough to be the point; otherwise it says
 * the two are close. Neither is a verdict: a fund carrying more of the
 * movement than of the money is not a bad fund, and the page does not say
 * it is.
 */

import type { BasketAnalysis, Grouping } from "@/lib/api";
import { kisalt, yuzde, yuzdeIsaretli } from "@/lib/format";

export interface RiskBirimi {
  anahtar: string;
  /** "1. grup" or the fund code. */
  etiket: string;
  /** The group's codes, or the fund's name. */
  alt: string;
  para: number;
  risk: number;
}

/** Below this many points of difference the two shares are called close. */
export const BELIRGIN_FARK = 0.1;

export function riskBirimleri(
  analysis: BasketAnalysis,
  grouping: Grouping,
  names: Record<string, string>,
): RiskBirimi[] | null {
  const rc = analysis.risk_contribution;
  if (analysis.is_single_fund || !rc || Object.keys(rc).length === 0) return null;

  const birimler: RiskBirimi[] = grouping.groups.map((g, i) => ({
    anahtar: `grup-${i}`,
    etiket: `${i + 1}. grup`,
    alt: g.codes.join(", "),
    para: g.weight,
    risk: g.codes.reduce((a, c) => a + (rc[c] ?? 0), 0),
  }));
  for (const s of grouping.standalone) {
    birimler.push({
      anahtar: s.code,
      etiket: s.code,
      alt: kisalt(names[s.code] ?? "", 48),
      para: s.weight,
      risk: rc[s.code] ?? 0,
    });
  }
  return birimler.sort((a, b) => b.risk - a.risk);
}

function ad(b: RiskBirimi): string {
  return b.anahtar.startsWith("grup-") ? `${b.etiket} (${b.alt})` : b.etiket;
}

/** One or two sentences: the largest excess, and any unit that offsets. */
export function riskCumleleri(birimler: RiskBirimi[]): string[] {
  const out: string[] = [];
  const enFazla = birimler.reduce((a, b) => (b.risk - b.para > a.risk - a.para ? b : a));
  if (enFazla.risk - enFazla.para >= BELIRGIN_FARK) {
    out.push(
      `${ad(enFazla)}: paradaki payı ${yuzde(enFazla.para)}, sepetin ` +
        `dalgalanmasındaki payı ${yuzde(enFazla.risk)}. Sepetin inip ` +
        `çıkmasını parasının ağırlığından fazla belirliyor.`,
    );
  } else {
    out.push(
      "Her fonun ya da grubun dalgalanmadaki payı, paradaki payına yakın: " +
        `aradaki fark hiçbirinde ${Math.round(BELIRGIN_FARK * 100)} puanı bulmuyor.`,
    );
  }
  const ters = birimler.filter((b) => b.risk < 0);
  if (ters.length > 0) {
    const adlar = ters.map(ad).join(", ");
    out.push(
      `${adlar} sepetin geri kalanına ters yönde hareket ediyor; ` +
        `dalgalanmanın bir kısmını dengelediği için payı eksi ` +
        `(${ters.map((b) => yuzdeIsaretli(b.risk)).join(", ")}).`,
    );
  }
  return out;
}
