/**
 * What the basket did, nominally and after inflation.
 *
 * The two numbers are the same size and sit next to each other, because the
 * gap between them is the message. Turkish inflation over a three year window
 * has run high enough that a basket can double in lira and still buy less
 * than it did, and a real figure printed small under a large nominal one
 * reads as a footnote to good news rather than as the news.
 *
 * Colour is money only. A return that went up is green and one that went
 * down is red, and nothing else on this page gets either.
 *
 * When the CPI could not be fetched the real column is simply not there and
 * the nominal figures stand on their own. That is a normal outcome, not a
 * degraded one, and it is never announced as a failure.
 *
 * The lira figures change their labels with `kind`, and that is the whole
 * reason `kind` exists. A basket described by dated deposits has a real
 * "toplam yatırılan" and a money weighted return to go with it. A basket
 * described by what it is worth today has neither: nobody said what was
 * paid, and calling its opening value "yatırılan" would put a number in
 * front of someone that they never spent.
 */

import { para, yuzdeIsaretli } from "@/lib/format";
import { UCRET_NOTU, XIRR_NOTU, heldGetiriNotu, stagedGetiriNotu } from "@/lib/result";
import type { ReturnFigures } from "@/lib/result";
import type { RealReturn } from "@/lib/api";

export function Returns({
  figures,
  realReturn,
}: {
  figures: ReturnFigures;
  /** Null when the CPI was unavailable. */
  realReturn: RealReturn | null;
}) {
  const real = figures.real;
  const staged = figures.kind === "staged";

  return (
    <section aria-labelledby="getiri" className="scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Getiri</p>
      <h2 id="getiri" className="mt-4 text-display-sm">
        {staged ? "Elinizdeki fonların dönem getirisi" : "Sepetin getirisi"}
      </h2>

      {/* Equal columns, so neither figure is the headline and the other the
          asterisk. On a phone they stack and stay the same size. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Metric
          label={real ? "Toplam getiri (nominal)" : "Toplam getiri"}
          value={yuzdeIsaretli(figures.nominalTotal)}
          tone={tone(figures.nominalTotal)}
        />
        {real && (
          <Metric
            label="Toplam getiri (enflasyondan arındırılmış)"
            value={yuzdeIsaretli(real.total)}
            tone={tone(real.total)}
          />
        )}
        <Metric
          label={real ? "Yıllık ortalama (nominal)" : "Yıllık ortalama getiri"}
          value={yuzdeIsaretli(figures.nominalAnnual)}
          tone={tone(figures.nominalAnnual)}
        />
        {real && (
          <Metric
            label="Yıllık ortalama (enflasyondan arındırılmış)"
            value={yuzdeIsaretli(real.annual)}
            tone={tone(real.annual)}
          />
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Metric
          label={staged ? "Toplam yatırılan" : "Dönem başındaki değeri"}
          value={para(figures.opening)}
        />
        <Metric label="Bugünkü değeri" value={para(figures.value)} />
        <Metric
          label={staged ? "Mutlak kazanç" : "Değer artışı"}
          value={para(figures.gain)}
          tone={tone(figures.gain)}
        />
      </div>

      {staged && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Metric
            label="Paranızın yıllık getirisi (XIRR)"
            value={figures.xirr === null ? "hesaplanamadı" : yuzdeIsaretli(figures.xirr)}
            tone={figures.xirr === null ? undefined : tone(figures.xirr)}
          />
          <p className="max-w-prose self-center text-caption text-ink-muted text-pretty">
            {figures.xirr === null
              ? "Alımlarınız tek bir güne düştüğü için XIRR hesaplanamadı."
              : XIRR_NOTU}
          </p>
        </div>
      )}

      <div className="mt-6 max-w-prose space-y-2 text-caption text-ink-subtle">
        <p>
          {staged
            ? stagedGetiriNotu(figures.start, figures.end)
            : heldGetiriNotu(figures.start)}
        </p>
        {realReturn && <p>{enflasyonNotu(realReturn)}</p>}
        <p>{UCRET_NOTU}</p>
      </div>
    </section>
  );
}

/** Green for a gain, red for a loss, nothing for zero or an unknown. */
function tone(x: number): "gain" | "loss" | undefined {
  if (!Number.isFinite(x) || x === 0) return undefined;
  return x > 0 ? "gain" : "loss";
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-5 py-4">
      <p className="text-label text-ink-muted">{label}</p>
      <p
        className={`mt-2 text-display-sm tabular-nums ${
          tone === "gain" ? "text-positive" : tone === "loss" ? "text-negative" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** What the real figure rests on: the period's inflation and how fresh it is. */
function enflasyonNotu(real: RealReturn): string {
  const base =
    `Aynı dönemde fiyatlar ${yuzdeIsaretli(real.inflation_total)} arttı. ` +
    `Arındırılmış tutarlar bugünün parasıyla. TÜİK tüketici fiyat endeksinin ` +
    `o ayki değeri ayın tamamına uygulanıyor, günlere dağıtılmıyor.`;

  if (!real.is_extrapolated) return base;

  const [y, m] = real.latest_cpi_month.split("-").map(Number);
  const ay = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    `${base} ${ay} sonrası için TÜFE henüz açıklanmadı, o günlere son ` +
    `açıklanan endeks uygulandı.`
  );
}
