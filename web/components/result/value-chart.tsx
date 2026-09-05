"use client";

import { useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { para, tarih } from "@/lib/format";
import type { ChartData } from "@/lib/result";

/**
 * The basket over time, against the money that was put into it.
 *
 * Two lines rather than one. A single value line makes every deposit look
 * like a gain: the money arrives, the line steps up, and nothing on the
 * chart says which of the two happened. The principal line is where the
 * deposits are, and the gap between the lines is the return.
 *
 * The scale control is not decoration. When one fund runs away from the rest
 * the linear axis flattens the first two years into a straight line at the
 * bottom, and the whole early period becomes unreadable. On a log axis an
 * equal percentage move is an equal vertical distance, which is the question
 * anyone reading a value chart is actually asking.
 */

type Scale = "normal" | "log";

const LINES = {
  market: { key: "market", label: "Sepetin piyasa değeri", color: "var(--accent)" },
  invested: { key: "invested", label: "Yatırılan anapara", color: "var(--ink-subtle)" },
  opening: { key: "invested", label: "Dönem başındaki değeri", color: "var(--ink-subtle)" },
  real: {
    key: "real",
    label: "Enflasyondan arındırılmış",
    color: "var(--series-alt)",
  },
} as const;

export function ValueChart({
  data,
  /** Staged baskets have real deposits; a held basket has an opening value. */
  staged,
}: {
  data: ChartData;
  staged: boolean;
}) {
  const [scale, setScale] = useState<Scale>("normal");
  const groupName = useId();

  const reference = staged ? LINES.invested : LINES.opening;
  const series = data.hasReal
    ? [LINES.market, LINES.real, reference]
    : [LINES.market, reference];

  // Both axes are ticked here rather than by Recharts. On a log axis
  // Recharts labels every digit and they collide at the bottom of the range;
  // on a linear one it picks a step the labels cannot resolve, so an axis
  // running to ten thousand prints "5 b" twice, once for 4.600 and once for
  // 5.400. Owning the step is what lets the formatter know how many decimals
  // the labels actually need, and owning the domain is what keeps every tick
  // inside it: a tick Recharts considers out of range is simply not drawn,
  // which is how a log axis ends up with no labels at all.
  const axis = useMemo(() => {
    const values = data.points.flatMap((p) =>
      [p.market, p.invested, p.real].filter((v): v is number => v !== undefined),
    );
    return scale === "log" ? logAxis(values) : linearAxis(values);
  }, [scale, data.points]);

  const formatTick = useMemo(() => axisFormatter(axis.ticks), [axis]);

  // The date axis is ticked here for the same reason the value axis is: two
  // Fridays in the same month both format as "02.26", and Recharts has no
  // way to know that two of the labels it picked are the same string. One
  // tick per month, thinned to what fits, so every label is a different one.
  const dateTicks = useMemo(
    () => monthTicks(data.points.map((p) => p.date)),
    [data.points],
  );

  return (
    <section aria-labelledby="deger-grafigi" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-overline uppercase text-ink-subtle">Değer</p>
          <h2 id="deger-grafigi" className="mt-4 text-display-sm">
            Sepetin değeri
          </h2>
        </div>

        <fieldset className="inline-flex rounded-control border border-border bg-canvas-sunken p-1">
          <legend className="sr-only">Ölçek</legend>
          {(["normal", "log"] as const).map((option) => (
            <label key={option} className="cursor-pointer">
              <input
                type="radio"
                name={groupName}
                value={option}
                checked={scale === option}
                onChange={() => setScale(option)}
                className="peer sr-only"
              />
              <span
                className={`block rounded-[0.4rem] px-4 py-2 text-caption transition-colors peer-focus-visible:underline ${
                  scale === option
                    ? "bg-surface-raised text-ink shadow-sm"
                    : "text-ink-muted"
                }`}
              >
                {option === "normal" ? "Normal" : "Logaritmik"}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
        {series.map((line) => (
          <li key={line.key} className="flex items-center gap-2 text-caption text-ink-muted">
            <span
              aria-hidden="true"
              className="h-0.5 w-6 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            {line.label}
          </li>
        ))}
      </ul>

      <div className="mt-4 h-80 w-full sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={dateTicks}
              tickFormatter={eksenTarihi}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            <YAxis
              scale={scale === "log" ? "log" : "linear"}
              domain={axis.domain}
              ticks={axis.ticks}
              allowDataOverflow
              width={82}
              tickFormatter={formatTick}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip />} />
            {series.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.label}
                stroke={line.color}
                strokeWidth={line.key === "invested" ? 1.5 : 2}
                strokeDasharray={line.key === "invested" ? "5 4" : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 max-w-prose text-caption text-ink-subtle text-pretty">
        {data.hasReal
          ? "Arındırılmış çizgi yukarıdan başlar, çünkü sepetin o günkü değerinin " +
            "bugünün parasıyla ne ettiğini gösterir. İki çizgi arasındaki açıklık " +
            "dönemin enflasyonudur."
          : staged
            ? "Kesikli çizgi, o güne kadar giren toplam parayı gösterir. Aradaki " +
              "açıklık kazançtır."
            : "Kesikli çizgi, sepetin dönem başındaki değerinde sabit durur. " +
              "Aradaki açıklık değer artışıdır."}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function eksenTarihi(iso: string): string {
  const [y, m] = iso.split("-");
  return `${m}.${y.slice(2)}`;
}

/**
 * One date per month, thinned until the labels fit.
 *
 * Taking the first trading day of each month rather than an even split of
 * the range is what guarantees the labels are distinct: the format carries
 * a month and a year, so two ticks inside one month would print the same
 * string whatever the spacing between them.
 */
function monthTicks(dates: string[], most = 12): string[] {
  const firsts: string[] = [];
  let seen = "";
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (month !== seen) {
      firsts.push(date);
      seen = month;
    }
  }
  const stride = Math.ceil(firsts.length / most);
  return firsts.filter((_, i) => i % stride === 0);
}

/**
 * Short money for an axis, with exactly the precision the ticks need.
 *
 * The unit comes from the *smallest* tick, not the largest. Sized from the
 * top, an axis running from five thousand to a million puts everything in
 * millions and the bottom half collapses into "0,01 mn" twice over; sized
 * from the bottom it reads "5 b" to "1.000 b", which is longer at one end
 * and legible at both. The decimals then come from the smallest gap between
 * two ticks, because rounding to whole units regardless is what turns 4.600
 * and 5.400 into "5 b" and "5 b".
 */
function axisFormatter(ticks: number[]): (value: number) => string {
  const sizes = ticks.map(Math.abs).filter((t) => t > 0);
  const smallest = sizes.length > 0 ? Math.min(...sizes) : 0;
  const gap = ticks
    .slice(1)
    .reduce((min, t, i) => Math.min(min, Math.abs(t - ticks[i])), Infinity);

  const [divisor, suffix] =
    smallest >= 1_000_000
      ? [1_000_000, " mn"]
      : smallest >= 1_000
        ? [1_000, " b"]
        : [1, ""];

  // A gap of half a unit needs one decimal to survive; two units needs none.
  const scaled = Number.isFinite(gap) ? gap / divisor : 1;
  const decimals = Math.max(0, Math.min(2, Math.ceil(-Math.log10(scaled))));

  return (value) => {
    if (!Number.isFinite(value)) return "";
    return (
      (value / divisor).toLocaleString("tr-TR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + suffix
    );
  };
}

interface Axis {
  ticks: number[];
  domain: [number, number];
}

/** Every tick that is drawn also has to be inside the domain. */
function axisFrom(ticks: number[]): Axis {
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

/**
 * Evenly spaced ticks from zero, on a step a person would have chosen.
 *
 * Zero is always the floor: this is a lira axis, and a value chart that
 * starts at the lowest point it happens to contain exaggerates every move on
 * it. The step is 1, 2, 2.5 or 5 times a power of ten, so the labels land on
 * numbers rather than on wherever the data ended.
 */
function linearAxis(values: number[], target = 6): Axis {
  const high = Math.max(...values, 0);
  if (!(high > 0)) return { ticks: [0, 1], domain: [0, 1] };
  return axisFrom(stepped(0, high, niceStep(high / target)));
}

/**
 * A log axis, ticked at 1, 2 and 5 per decade.
 *
 * Only once there is a decade to tick. Over a narrow range those three
 * values per decade can leave a single label on the whole axis, or none, and
 * an axis with no numbers on it is not an axis. Under two decades of spread
 * a log scale is barely bent anyway, so it takes even steps instead and
 * still reads correctly.
 */
function logAxis(values: number[], target = 5): Axis {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return { ticks: [1, 10], domain: [1, 10] };

  const low = Math.min(...positive);
  const high = Math.max(...positive);

  if (high / low < 10) {
    // Bounded outward from the data rather than from zero: a log axis cannot
    // reach zero, and starting one decade below the data would waste most of
    // the height on empty space. The step is capped at the lowest value so
    // the first tick lands below the data instead of on zero, which on a log
    // scale is not a place an axis can start.
    const spread = niceStep((high - low) / target);
    const step = spread > low ? niceStepAtMost(low) : spread;
    return axisFrom(stepped(Math.floor(low / step) * step, high, step));
  }

  // Thin the decade markers as the range grows: over four decades, three
  // labels each is thirteen numbers up the side of a chart nobody is reading
  // that closely.
  const decades = Math.log10(high / low);
  const marks = decades > 3 ? [1] : decades > 2 ? [1, 5] : [1, 2, 5];

  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(low)); e <= Math.ceil(Math.log10(high)); e += 1) {
    for (const m of marks) ticks.push(m * 10 ** e);
  }
  // Keep one tick beyond the data at each end so nothing is drawn outside.
  const first = Math.max(0, ticks.findLastIndex((t) => t <= low));
  const last = ticks.findIndex((t) => t >= high);
  return axisFrom(ticks.slice(first, last < 0 ? undefined : last + 1));
}

const STEPS = [1, 2, 2.5, 5, 10];

/** 1, 2, 2.5 or 5 times a power of ten, at least as big as `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return STEPS.map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
}

/** The same shapes, but no bigger than `cap`. */
function niceStepAtMost(cap: number): number {
  if (!(cap > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(cap));
  return (
    STEPS.map((m) => m * magnitude)
      .reverse()
      .find((s) => s <= cap) ?? magnitude
  );
}

/** `from` up to at least `high`, in steps of `step`. */
function stepped(from: number, high: number, step: number): number[] {
  const out: number[] = [];
  // Multiply rather than accumulate: adding 0.1 six times is not 0.6.
  for (let i = 0; from + (i - 1) * step < high; i += 1) {
    out.push(Number((from + i * step).toPrecision(12)));
  }
  return out.length > 1 ? out : [from, from + step];
}

interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
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
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-control border border-border bg-surface-raised px-4 py-3 text-caption shadow-lg">
      <p className="text-label text-ink-muted">{label ? tarih(label) : ""}</p>
      <ul className="mt-2 space-y-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-ink">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-ink-muted">{entry.name}</span>
            <span className="ml-auto tabular-nums">
              {typeof entry.value === "number" ? para(entry.value) : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
