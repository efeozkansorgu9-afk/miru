/**
 * Money share beside movement share, per group and per standalone fund.
 *
 * Two thin bars a row, on one scale: grey for the money, accent for the
 * movement. Neither is green or red — a unit carrying more of the movement
 * than of the money is a fact about the basket, not a mark against it. A
 * negative movement share draws no bar and prints its sign; there is no
 * such thing as a bar of negative length a reader can compare.
 */

import { InfoTip } from "@/components/info-tip";
import { yuzde, yuzdeIsaretli } from "@/lib/format";
import { riskCumleleri } from "@/lib/risk-share";
import type { RiskBirimi } from "@/lib/risk-share";

export function RiskShare({ birimler }: { birimler: RiskBirimi[] }) {
  const olcek = Math.max(1e-9, ...birimler.flatMap((b) => [b.para, b.risk]));
  const cumleler = riskCumleleri(birimler);

  return (
    <section aria-labelledby="risk-payi" className="scroll-mt-28 sm:scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Risk dağılımı</p>
      <h2 id="risk-payi" className="mt-4 text-display-sm text-balance">
        Sepetin dalgalanması nereden geliyor?
      </h2>
      <div className="mt-4 max-w-prose space-y-3">
        {cumleler.map((c) => (
          <p key={c} className="text-lead text-ink-muted text-pretty">
            {c}
          </p>
        ))}
      </div>

      <div className="mt-8 rounded-card border border-border bg-surface px-5 py-5 sm:px-6">
        {/* The rows label their own bars, so no swatch legend: one line
            saying what the pair of bars is, with the definition on it. */}
        <p className="text-caption text-ink-muted text-pretty">
          Her satırda üstteki çubuk paradaki payı, alttaki sepetin
          dalgalanmasındaki payı gösteriyor.
          <InfoTip term="riskPayi" />
        </p>

        <ul className="mt-5 flex flex-col divide-y divide-border">
          {birimler.map((b) => (
            <li
              key={b.anahtar}
              className="grid gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,15rem)_1fr]"
            >
              <div className="min-w-0">
                <p className="font-mono text-label text-accent">{b.etiket}</p>
                {b.alt && (
                  <p className="truncate text-caption text-ink-muted" title={b.alt}>
                    {b.alt}
                  </p>
                )}
              </div>
              <dl className="grid content-center gap-1.5">
                <Cubuk etiket="Para" deger={b.para} olcek={olcek} renk="bg-ink-subtle/45" />
                <Cubuk etiket="Dalgalanma" deger={b.risk} olcek={olcek} renk="bg-accent" />
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
        Haftalık getirilerin kovaryansından, paylar bugünkü ağırlıklarda sabit
        tutularak hesaplanır. Bir grubun payı, üyelerinin paylarının toplamıdır.
        Paylar toplamda %100 eder.
      </p>
    </section>
  );
}

function Cubuk({
  etiket,
  deger,
  olcek,
  renk,
}: {
  etiket: string;
  deger: number;
  olcek: number;
  renk: string;
}) {
  const genislik = Math.max(0, deger) / olcek;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3">
      <dt className="text-caption text-ink-subtle">{etiket}</dt>
      <dd className="h-2 rounded-full bg-canvas-sunken">
        <span
          className={`block h-full rounded-full ${renk}`}
          style={{ width: `${genislik * 100}%` }}
        />
      </dd>
      <dd className="text-right text-caption tabular-nums text-ink">
        {deger < 0 ? yuzdeIsaretli(deger) : yuzde(deger)}
      </dd>
    </div>
  );
}
