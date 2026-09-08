/**
 * What the fund returned over twelve and thirty six months.
 *
 * Nominal and real sit side by side at the same size, for the reason they do
 * on the basket page: Turkish inflation over three years has run high enough
 * that a fund can double in lira and still buy less, and a real figure set
 * small under a large nominal one reads as a footnote to good news rather
 * than as the news. A negative real return is printed as it is.
 *
 * The window is in the heading of each row rather than in a note underneath,
 * because "12 ay" no longer means "to today": both figures end at the last
 * month TÜİK has published an index for, so on the eighth of September the
 * twelve month figure runs to the end of August. Printing the two months is
 * how the page avoids implying otherwise, and it is also what makes the two
 * figures comparable — they are measured over exactly the same days, so the
 * gap between them is inflation and nothing else.
 *
 * A window with neither figure is not drawn at all, and nothing announces
 * its absence. A fund younger than three years has no three year return, and
 * that is a fact about the fund's age rather than a failure worth a sentence.
 */

import type { FundReturn } from "@/lib/api";
import { ayYilKisa, yuzdeIsaretli } from "@/lib/format";
import { gosterilecekGetiriler } from "@/lib/fund";
import { InfoTip } from "@/components/info-tip";

export function Returns({ returns }: { returns: FundReturn[] }) {
  const rows = gosterilecekGetiriler(returns);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="getiriler" className="scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Getiri</p>
      <h2 id="getiriler" className="mt-4 text-display-sm text-balance">
        Fonun getirisi
      </h2>

      <div className="mt-6 space-y-4">
        {rows.map((row, i) => (
          // The definition of the real return goes on the first row only.
          // The second window is the same two figures over more months, and
          // the same tooltip twice is one more thing to press, not one more
          // thing explained.
          <Row key={row.months} row={row} tanim={i === 0} />
        ))}
      </div>

      <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
        Toplam getiri, yıllığa çevrilmemiş. Her iki rakam da aynı dönem
        üzerinden ölçülüyor: dönem, TÜİK&apos;in endeks açıkladığı son ayda
        biter, bugünde değil. Aradaki fark enflasyondur. Fon giderleri fiyata
        yansımış durumda, vergi hesaba katılmamıştır.
      </p>
    </section>
  );
}

function Row({ row, tanim }: { row: FundReturn; tanim: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface px-5 py-4 sm:px-6 sm:py-5">
      <h3 className="text-label text-ink-muted">
        {row.months} ay
        {row.window_start && row.window_end && (
          <span className="text-ink-subtle">
            {" "}
            ({ayYilKisa(row.window_start)} – {ayYilKisa(row.window_end)})
          </span>
        )}
      </h3>

      {/* Equal columns, so neither figure is the headline and the other the
          asterisk. On a phone they stack and stay the same size. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Figure label="Nominal" value={row.nominal} />
        <Figure label="Enflasyondan arındırılmış" value={row.real} term={tanim} />
      </div>
    </div>
  );
}

/**
 * One figure.
 *
 * Green up, red down, and nothing else on this page gets either colour. A
 * figure that is missing while its partner exists prints a dash: the row is
 * on screen because the other half of it could be measured, and an empty
 * space there would read as a zero.
 */
function Figure({
  label,
  value,
  term,
}: {
  label: string;
  value: number | null;
  /** Adds the definition of the real return next to its label. */
  term?: boolean;
}) {
  return (
    <div>
      <p className="text-label text-ink-muted">
        {label}
        {term && <InfoTip term="reel" />}
      </p>
      <p
        className={`mt-1.5 text-display-sm tabular-nums ${
          value === null || value === 0
            ? "text-ink"
            : value > 0
              ? "text-positive"
              : "text-negative"
        }`}
      >
        {value === null ? "—" : yuzdeIsaretli(value)}
      </p>
    </div>
  );
}
