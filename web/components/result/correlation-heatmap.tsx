/**
 * The correlation matrix, as a grid.
 *
 * Neither colour here is a verdict. A pair at 0.95 is not bad news and a pair
 * at 0.10 is not good news, so the ramp deliberately avoids the gain and loss
 * colours: brand purple for funds that move together, the alternate hue for
 * funds that move against each other, and strength carried by how much of the
 * colour is mixed in rather than by which colour it is.
 *
 * The tint tops out well short of solid so the number stays readable on it in
 * both themes. The number is the fact; the colour only makes the shape of the
 * matrix visible at a glance.
 */

import type { Correlation } from "@/lib/api";

const MAX_TINT = 60;

export function CorrelationHeatmap({ correlation }: { correlation: Correlation }) {
  const { codes, matrix } = correlation;

  return (
    <div className="overflow-x-auto">
      <div
        role="table"
        aria-label="Fonlar arası korelasyon"
        className="inline-grid min-w-full gap-px text-caption"
        style={{ gridTemplateColumns: `auto repeat(${codes.length}, minmax(3.25rem, 1fr))` }}
      >
        <div role="columnheader" className="px-2 py-2" />
        {codes.map((code) => (
          <div
            key={`h-${code}`}
            role="columnheader"
            className="px-1 py-2 text-center text-label text-ink-muted"
          >
            {code}
          </div>
        ))}

        {codes.map((rowCode, r) => (
          <Row key={rowCode} code={rowCode} values={matrix[r]} codes={codes} />
        ))}
      </div>
    </div>
  );
}

function Row({
  code,
  values,
  codes,
}: {
  code: string;
  values: (number | null)[];
  codes: string[];
}) {
  return (
    <>
      <div role="rowheader" className="py-2 pr-3 text-right text-label text-ink-muted">
        {code}
      </div>
      {values.map((value, c) => (
        <div
          key={codes[c]}
          role="cell"
          className="rounded-[0.3rem] px-1 py-2 text-center tabular-nums text-ink"
          style={{ backgroundColor: tint(value) }}
          title={`${code} ile ${codes[c]}`}
        >
          {value === null ? "" : value.toFixed(2).replace(".", ",")}
        </div>
      ))}
    </>
  );
}

function tint(value: number | null): string | undefined {
  if (value === null) return undefined;
  const strength = Math.round(Math.min(1, Math.abs(value)) * MAX_TINT);
  const hue = value >= 0 ? "var(--color-brand-500)" : "var(--series-alt)";
  return `color-mix(in oklab, ${hue} ${strength}%, transparent)`;
}
