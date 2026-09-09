"use client";

/**
 * What the fund returned, over a period the reader picks.
 *
 * This was two fixed cards, twelve months and thirty six, with the right
 * half of the section empty. It is now a segmented control over the periods
 * the weekly job computed, a chart, and the selected period's two figures
 * under it.
 *
 * Nominal and real stay side by side at the same size, for the reason they
 * did before: Turkish inflation over three years has run high enough that a
 * fund can more than quadruple in lira and still barely hold its buying
 * power — GAL over four years is 337% nominal against 3,7% real — and a real
 * figure set small under a large nominal one reads as a footnote to good
 * news rather than as the news. A negative real return is printed as it is.
 *
 * ## What the periods mean
 *
 * "6 ay" is not 180 days back from today. It is the six months the return
 * was measured over, and that window ends at the last month TÜİK has
 * published an index for, because both figures have to cover the same days
 * or the gap between them is not inflation. The months are printed under the
 * control rather than implied.
 *
 * The chart covers that same window, but it is **not** the same measurement
 * to the last decimal and is not offered as one. The figures are computed on
 * daily prices by the weekly job; the line is the weekly W-FRI series, so its
 * first and last points can sit a few days inside the window's exact edges
 * and the ratio between them can differ from the printed nominal figure by
 * that much. The numbers are the measurement and the line is the shape of
 * it — which is why the figures are printed rather than read off the chart.
 *
 * There is no "Hepsi". TEFAS serves five years and no more — measured: asking
 * for 72, 84 or 120 months returns the same first row — so "all" would mean
 * the longest option while implying something further back exists.
 *
 * ## A period the fund cannot cover
 *
 * Offered, disabled, with its reason. Not hidden: a fund with one usable
 * button and no explanation looks broken, and a young fund not having a four
 * year return is a fact about its age. What the page never does is put a
 * number under that label anyway — a return over whatever shorter stretch
 * the fund does have would be a different figure wearing this one's name.
 */

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CPISeries, FundReturn, WeeklySeries } from "@/lib/api";
import { ayYilKisa, tarih, yuzdeIsaretli } from "@/lib/format";
import {
  defaultPeriod,
  fundChartData,
  periodOptions,
} from "@/lib/fund-chart";
import type { PeriodOption } from "@/lib/fund-chart";
import { RETURN_PERIODS } from "@/lib/windows";
import { InfoTip } from "@/components/info-tip";
import { eksenTarihi, monthTicks } from "@/components/result/axis";

const LINES = {
  value: { key: "value", label: "Fonun değeri", color: "var(--accent)" },
  inflation: {
    key: "inflation",
    label: "Enflasyon",
    color: "var(--series-alt)",
  },
} as const;

export function Returns({
  returns,
  series,
  cpi,
}: {
  returns: FundReturn[];
  series: WeeklySeries | null;
  cpi: CPISeries | null;
}) {
  const options = useMemo(
    () => periodOptions(RETURN_PERIODS, returns),
    [returns],
  );
  const [chosen, setChosen] = useState<number | null>(() =>
    defaultPeriod(options),
  );

  const active = options.find((o) => o.months === chosen) ?? null;
  const chart = useMemo(
    () => fundChartData(series, cpi, active?.ret ?? null),
    [series, cpi, active],
  );

  // Nothing measurable at all. Said once, plainly, rather than drawn as an
  // empty chart with four dead buttons over it.
  if (options.every((o) => !o.available)) {
    return (
      <section aria-labelledby="getiriler" className="scroll-mt-24">
        <Heading />
        <p className="mt-6 max-w-prose text-lead text-ink-muted text-pretty">
          Bu fonun getirisi hesaplanamadı.{" "}
          {options[0]?.reason ? `${options[0].reason}.` : ""}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="getiriler" className="scroll-mt-24">
      <Heading />

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <PeriodPicker
          options={options}
          chosen={chosen}
          onChoose={setChosen}
        />
        {active?.ret?.window_start && active.ret.window_end && (
          <p className="text-caption text-ink-subtle tabular-nums">
            {ayYilKisa(active.ret.window_start)} –{" "}
            {ayYilKisa(active.ret.window_end)}
          </p>
        )}
      </div>

      {active && !active.available && (
        <p className="mt-5 max-w-prose text-body text-ink-muted text-pretty">
          {active.label} için yeterli veri yok: {active.reason}.
        </p>
      )}

      {chart && <Chart points={chart.points} withInflation={chart.withInflation} />}

      {active?.available && (
        <div className="mt-6 grid gap-4 rounded-card border border-border bg-surface px-5 py-4 sm:grid-cols-2 sm:px-6 sm:py-5">
          <Figure label="Nominal" value={active.ret?.nominal ?? null} />
          <Figure
            label="Enflasyondan arındırılmış"
            value={active.ret?.real ?? null}
            term
          />
        </div>
      )}

      <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
        Toplam getiri, yıllığa çevrilmemiş. Her iki rakam da aynı dönem
        üzerinden ölçülüyor: dönem, TÜİK&apos;in endeks açıkladığı son ayda
        biter, bugünde değil. Aradaki fark enflasyondur. Fon giderleri fiyata
        yansımış durumda, vergi hesaba katılmamıştır.
      </p>
    </section>
  );
}

function Heading() {
  return (
    <>
      <p className="text-overline uppercase text-ink-subtle">Getiri</p>
      <h2 id="getiriler" className="mt-4 text-display-sm text-balance">
        Fonun getirisi
      </h2>
    </>
  );
}

/**
 * The period control.
 *
 * A real `radiogroup` with roving tabindex, not four buttons wearing radio
 * roles. `role="radio"` gets none of the keyboard behaviour on its own, so
 * it is implemented: one tab stop for the whole group, arrows move between
 * the periods, Home and End jump to the ends, and selection follows focus
 * the way it does for radios everywhere. Without that, a keyboard reader
 * tabs through four separate stops and a screen reader announces four
 * unrelated presses instead of "3 of 4".
 *
 * Arrow keys **skip** the periods the fund cannot cover: moving onto one
 * would select it, and selecting a period with no measurement is the one
 * thing this control must not do. They stay in the group as visible,
 * disabled labels, because the reason is printed underneath and a control
 * that vanished would take the explanation with it.
 */
function PeriodPicker({
  options,
  chosen,
  onChoose,
}: {
  options: PeriodOption[];
  chosen: number | null;
  onChoose: (months: number) => void;
}) {
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const usable = options.filter((o) => o.available);

  function move(delta: number) {
    if (usable.length === 0) return;
    const at = usable.findIndex((o) => o.months === chosen);
    const next =
      usable[(at + delta + usable.length) % usable.length] ?? usable[0];
    onChoose(next.months);
    refs.current.get(next.months)?.focus();
  }

  function jump(to: PeriodOption | undefined) {
    if (!to) return;
    onChoose(to.months);
    refs.current.get(to.months)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        jump(usable[0]);
        break;
      case "End":
        event.preventDefault();
        jump(usable[usable.length - 1]);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Getiri dönemi"
      onKeyDown={onKeyDown}
      className="inline-flex rounded-control border border-border bg-surface p-0.5"
    >
      {options.map((option) => {
        const on = option.months === chosen;
        return (
          <button
            key={option.months}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={!option.available}
            // Roving: the group is one tab stop, and it lands on the
            // selected period rather than on the first one.
            tabIndex={on ? 0 : -1}
            ref={(node) => {
              if (node) refs.current.set(option.months, node);
              else refs.current.delete(option.months);
            }}
            onClick={() => option.available && onChoose(option.months)}
            title={option.available ? undefined : option.reason ?? undefined}
            className={`rounded-[calc(var(--radius-control)-2px)] px-3.5 py-2 text-label transition-colors sm:px-4 ${
              on
                ? "bg-accent-surface text-accent"
                : option.available
                  ? "text-ink-muted hover:text-ink"
                  : "cursor-not-allowed text-ink-subtle/60"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The two lines.
 *
 * The value line is `monotone` and the inflation line is a **step**. That is
 * not a style choice: the CPI is published monthly and is a level for the
 * whole month, so every week inside a month carries the same index. Drawing
 * a smooth curve between monthly points would invent weekly inflation
 * nobody measured. `stepAfter` puts the change at the month boundary, which
 * is where it was published.
 *
 * The inflation line also stops rather than flattening. Weeks past the last
 * published month carry `null`, and `connectNulls` is off, so the line ends
 * where the data does instead of running on at its final level.
 *
 * Both lines start at 100, so the gap between them at any point is how much
 * the fund is ahead of or behind prices — which is the whole question, and
 * is why they share one axis in percent rather than sitting in lira.
 */
function Chart({
  points,
  withInflation,
}: {
  points: { date: string; value: number | null; inflation: number | null }[];
  withInflation: boolean;
}) {
  const ticks = useMemo(
    () => monthTicks(points.map((p) => p.date), 8),
    [points],
  );
  const lines = withInflation ? [LINES.value, LINES.inflation] : [LINES.value];

  return (
    <>
      <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
        {lines.map((line) => (
          <li
            key={line.key}
            className="flex items-center gap-2 text-caption text-ink-muted"
          >
            <span
              aria-hidden="true"
              className="h-0.5 w-5 rounded-full"
              style={{ background: line.color }}
            />
            {line.label}
          </li>
        ))}
      </ul>

      <div className="mt-3 h-64 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            // Room on the right for the last date label, which centres on a
            // tick sitting on the plot's edge.
            margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={eksenTarihi}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            <YAxis
              // Fitted to the data, not anchored at zero. Both lines start
              // at 100 and a fund that moved between 75 and 115 was being
              // drawn in the top third of a plot whose axis ran from 0 —
              // half the height spent on values nothing reaches. An index
              // is read by the distance between the two lines, and a zero
              // baseline adds nothing to that.
              domain={["auto", "auto"]}
              width={52}
              tickFormatter={(v: number) => `${Math.round(v)}`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip />} />
            {lines.map((line) => (
              <Line
                key={line.key}
                type={line.key === "inflation" ? "stepAfter" : "monotone"}
                dataKey={line.key}
                name={line.label}
                stroke={line.color}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 max-w-prose text-caption text-ink-subtle text-pretty">
        Her iki çizgi dönem başında 100&apos;den başlıyor, aradaki fark fonun
        enflasyona göre nerede olduğunu gösterir. Enflasyon çizgisi TÜİK
        endeksinin açıklandığı son ayda biter; sonraki haftalara taşınmaz.
      </p>
    </>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | null;
  color?: string;
  dataKey?: string;
}

function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-control border border-border bg-surface-raised px-3.5 py-2.5 text-caption shadow-lg">
      {/* The full date, not the month. Two adjacent weekly points fall in
          the same month, and a tooltip that labelled both "Ağu 2026" would
          be indistinguishable between them. */}
      <p className="text-ink-subtle tabular-nums">
        {typeof label === "string" ? tarih(label) : ""}
      </p>
      <ul className="mt-1.5 space-y-1">
        {payload
          .filter((e) => e.value !== null && e.value !== undefined)
          .map((entry) => (
            <li key={entry.dataKey} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="text-ink-muted">{entry.name}</span>
              <span className="ml-auto pl-3 text-ink tabular-nums">
                {typeof entry.value === "number" ? entry.value.toFixed(1) : "—"}
              </span>
            </li>
          ))}
      </ul>
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
