/**
 * Where a basket's movement comes from, set beside where its money is.
 *
 * The API sends each fund's share of the basket's weekly variance (an Euler
 * decomposition: the shares add up to exactly 1). This file only arranges
 * them: funds that the grouping put together are read as one unit, because
 * the page has already said they are one holding, and the rest stand alone.
 * A unit's share is the sum of its members'. Nothing is recomputed here.
 *
 * The summary states the basket's volatility first, then names the unit
 * whose movement share most exceeds its money share, when the gap is large
 * enough to be the point; otherwise it says the two are close, and the
 * section folds its bars away. Neither is a verdict: a fund carrying more of the
 * movement than of the money is not a bad fund, and the page does not say
 * it is.
 */

import type { BasketAnalysis, Grouping } from "@/lib/api";
import { kisalt, yuzde, yuzdeHassas, yuzdeIsaretli } from "@/lib/format";

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

export interface RiskOzeti {
  /** Some unit's movement share exceeds its money share by the line, or offsets. */
  belirgin: boolean;
  cumleler: string[];
}

/**
 * The basket's own level of movement first, then where it comes from.
 *
 * "90% of the movement comes from this fund" read on its own sounds like an
 * alarm, and in a basket that barely moves it is not one. So the section
 * opens with the level — the basket's annual volatility, beside its most
 * volatile fund's for scale — and only then says how that movement divides.
 * Neither sentence says whether the division is good: a small holding that
 * carries most of the movement may be exactly what the reader chose.
 *
 * "%20 kadarı" rather than a suffix on the number, because the suffix
 * depends on how the figure is read aloud.
 */
export function riskOzeti(
  birimler: RiskBirimi[],
  analysis: Pick<BasketAnalysis, "basket_volatility" | "fund_volatility">,
): RiskOzeti {
  const out: string[] = [];

  const sepet = analysis.basket_volatility;
  const enOynak = Object.entries(analysis.fund_volatility ?? {}).reduce<[string, number] | null>(
    (a, b) => (Number.isFinite(b[1]) && (!a || b[1] > a[1]) ? b : a),
    null,
  );
  if (Number.isFinite(sepet)) {
    out.push(
      `Sepetin yıllık oynaklığı ${yuzdeHassas(sepet)}` +
        (enOynak && enOynak[1] > sepet
          ? `; içindeki en oynak fonun (${enOynak[0]}) oynaklığı ${yuzdeHassas(enOynak[1])}.`
          : "."),
    );
  }

  const enFazla = birimler.reduce((a, b) => (b.risk - b.para > a.risk - a.para ? b : a));
  const fazla = enFazla.risk - enFazla.para >= BELIRGIN_FARK;
  if (fazla) {
    out.push(
      `${ad(enFazla)}: paranın ${yuzde(enFazla.para)} kadarı burada, sepetin ` +
        `dalgalanmasının ise ${yuzde(enFazla.risk)} kadarı buradan geliyor. ` +
        (enFazla.para < 0.5
          ? "Az parayla çok dalgalanan bir fon, sepette ağırlığından fazla yer kaplar."
          : `Sepetin inip çıkmasını, parasının ağırlığından da fazla ${
              enFazla.anahtar.startsWith("grup-") ? "bu grup" : "bu fon"
            } belirliyor.`),
    );
  } else {
    out.push(
      "Her fonun ya da grubun bu dalgalanmadaki payı, paradaki payına yakın; " +
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
  return { belirgin: fazla || ters.length > 0, cumleler: out };
}
