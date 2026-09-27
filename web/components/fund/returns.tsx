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

import { animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { ayYilKisa, tarih, yuzdeHassas, yuzdeIsaretli } from "@/lib/format";
import type { TerimAdi } from "@/lib/terms";
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
      <section aria-labelledby="getiriler" className="scroll-mt-28 sm:scroll-mt-24">
        <Heading />
        <p className="mt-6 max-w-prose text-lead text-ink-muted text-pretty">
          Bu fonun getirisi hesaplanamadı.{" "}
          {options[0]?.reason ? `${options[0].reason}.` : ""}
        </p>
      </section>
    );
  }

  const pencere =
    active?.ret?.window_start && active.ret.window_end
      ? `${ayYilKisa(active.ret.window_start)} – ${ayYilKisa(active.ret.window_end)}`
      : null;
  const ret = active?.available ? active.ret : null;

  return (
    <section aria-labelledby="getiriler" className="scroll-mt-28 sm:scroll-mt-24">
      {/* Heading and control on one row: the control is what the section is
          about, and under the heading it pushed the numbers a line down for
          no reason. The window sits under the heading because it changes
          with the control, and a reader should see it change. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <Heading />
          <p className="mt-1.5 text-caption text-ink-subtle tabular-nums">
            {pencere ?? "Dönem seçin"} · toplam getiri, yıllığa çevrilmemiş
          </p>
        </div>
        <PeriodPicker options={options} chosen={chosen} onChoose={setChosen} />
      </div>

      {active && !active.available && (
        <p className="mt-5 max-w-prose text-body text-ink-muted text-pretty">
          {active.label} için yeterli veri yok: {active.reason}.
        </p>
      )}

      {ret && (
        <dl
          className={`mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border ${
            ret.usd != null ? "sm:grid-cols-3" : "sm:grid-cols-2"
          }`}
        >
          <Figure label="Nominal" value={ret.nominal ?? null} />
          <Figure label="Enflasyondan arındırılmış" value={ret.real ?? null} term="reel" />
          {/* Only when there was a rate for both ends of the window; a
              missing dollar figure is left out rather than shown as "—",
              which would read as a result of zero. */}
          {ret.usd != null && <Figure label="Dolar bazında" value={ret.usd} term="dolar" />}
        </dl>
      )}

      {chart && (
        <div className="mt-4 rounded-card border border-border bg-surface px-3 pt-4 pb-3 sm:px-5 sm:pt-5">
          <Chart
            key={active?.months ?? 0}
            points={chart.points}
            withInflation={chart.withInflation}
          />
          {ret && (ret.volatility != null || ret.max_drawdown != null) && (
            <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 border-t border-border px-2 pt-3 sm:px-1">
              <Olcu
                label="Yıllık oynaklık"
                term="oynaklik"
                value={ret.volatility != null ? yuzdeHassas(ret.volatility) : "—"}
              />
              <Olcu
                label="En büyük düşüş"
                term="dusus"
                value={
                  ret.max_drawdown == null
                    ? "—"
                    : ret.max_drawdown === 0
                      ? "düşüş yok"
                      : yuzdeHassas(ret.max_drawdown)
                }
              />
            </dl>
          )}
        </div>
      )}

      <p className="mt-4 max-w-prose text-caption text-ink-subtle text-pretty">
        Dönem, TÜİK&apos;in endeks açıkladığı son ayda biter, bugünde değil;
        bütün rakamlar bu aynı dönem üzerinden ölçülüyor. İki çizgi de dönem
        başında 100&apos;den başlar, aradaki fark fonun enflasyonun ne kadar
        önünde ya da gerisinde olduğudur; enflasyon çizgisi son açıklanan ayda
        biter, sonraki haftalara taşınmaz. Oynaklık ve en büyük düşüş haftalık
        fiyatlardan hesaplanıyor; hafta içindeki bir dip görünmeyebilir. Fon
        giderleri fiyata yansımış durumda, vergi hesaba katılmamıştır.
      </p>
    </section>
  );
}

function Heading() {
  return (
    <h2 id="getiriler" className="text-display-sm text-balance">
      Getiri
    </h2>
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
  const pill = useId();
  const reduceMotion = useReducedMotion();

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
      className="inline-flex rounded-control border border-border bg-surface p-1"
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
            className={`relative rounded-[calc(var(--radius-control)-3px)] px-3.5 py-1.5 text-label transition-colors duration-200 sm:px-4 ${
              on
                ? "text-accent-ink"
                : option.available
                  ? "text-ink-muted hover:text-ink"
                  : "cursor-not-allowed text-ink-subtle/50 line-through decoration-ink-subtle/40"
            }`}
          >
            {/* The selection is one pill that slides between periods rather
                than four backgrounds switching on and off: the eye follows
                it, which is what tells a reader the numbers below changed
                because of this. */}
            {on && (
              <motion.span
                layoutId={pill}
                aria-hidden="true"
                className="absolute inset-0 rounded-[calc(var(--radius-control)-3px)] bg-accent"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{option.label}</span>
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
  // As many date labels as fit: "10.22" is about 36px at 12px, so one per
  // 60px keeps them apart. A fixed eight ran together on a phone.
  const [genislik, setGenislik] = useState(0);
  const ticks = useMemo(
    () =>
      monthTicks(
        points.map((p) => p.date),
        genislik > 0 ? Math.max(3, Math.min(8, Math.floor(genislik / 60))) : 8,
      ),
    [points, genislik],
  );
  const lines = withInflation ? [LINES.value, LINES.inflation] : [LINES.value];
  const reduceMotion = useReducedMotion();

  return (
    <>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 px-2 sm:px-1">
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
        <ResponsiveContainer
          width="100%"
          height="100%"
          onResize={(w) => setGenislik((eski) => (Math.abs(eski - w) < 1 ? eski : w))}
        >
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
              domain={[(min: number) => Math.floor((min * 0.95) / 10) * 10, "auto"]}
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
                // Drawn left to right when the period changes (the chart is
                // keyed on it), so the new window visibly replaces the old
                // one instead of the lines jumping.
                isAnimationActive={!reduceMotion}
                animationDuration={900}
                animationEasing="ease-out"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

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
 * A risk figure: set smaller than the returns and in plain ink. Volatility
 * is not good or bad news, and a drawdown, though always a fall, is a
 * measurement of the past rather than a warning; neither is painted red.
 */
function Olcu({ label, value, term }: { label: string; value: string; term: TerimAdi }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-caption text-ink-muted">
        {label}
        <InfoTip term={term} />
      </dt>
      <dd className="text-body font-semibold tabular-nums text-ink">{value}</dd>
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
 *
 * The number rolls from the old period's value to the new one's when the
 * period changes. It never counts up from zero on arrival: the server
 * renders the real figure, and a number that starts at 0 and climbs would
 * spend its first half second saying something false.
 */
function Figure({
  label,
  value,
  term,
}: {
  label: string;
  value: number | null;
  term?: TerimAdi;
}) {
  return (
    <div className="bg-surface px-5 py-4 sm:py-5">
      <dt className="text-label text-ink-muted">
        {label}
        {term && <InfoTip term={term} />}
      </dt>
      <dd
        className={`mt-1.5 text-[1.75rem] leading-tight font-semibold tracking-tight tabular-nums transition-colors duration-300 ${
          value === null || value === 0
            ? "text-ink"
            : value > 0
              ? "text-positive"
              : "text-negative"
        }`}
      >
        {value === null ? "—" : <Yuvarlanan value={value} />}
      </dd>
    </div>
  );
}

/** A percentage that tweens between the values it is given. */
function Yuvarlanan({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduceMotion]);

  return <>{yuzdeIsaretli(shown)}</>;
}
