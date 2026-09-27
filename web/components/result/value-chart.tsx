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
import { InfoTip } from "@/components/info-tip";
import type { ChartData } from "@/lib/result";
import { eksenTarihi, monthTicks } from "./axis";

/**
 * The basket over time, against the money that was put into it and against
 * what that money would be worth if it had only kept up with prices.
 *
 * How many lines depends on how the basket was bought, and the rule is that
 * a line has to answer a question the others cannot.
 *
 * The inflation line always does, and it is the one the chart exists for: in
 * a country running Turkish inflation a gain is not yet good news, and below
 * that line the basket has lost buying power in lira that grew. The claim is
 * the gap between it and the market value, and nothing else on the plot.
 *
 * The principal line earns its place only when it is a staircase. A staged
 * basket needs it — a single value line makes every deposit look like a
 * gain, the money arrives, the line steps up, and nothing says which of the
 * two happened. A basket bought in one go has no deposits to mark, so its
 * principal is a flat line at the opening value, and drawing it offers the
 * eye a second and easier gap to read: the wrong one, since a basket can sit
 * far above what was paid for it and still be under inflation. It is left
 * off the plot and reported in the tooltip instead.
 *
 * The inflation line can be switched off, and is on by default, because it
 * is the comparison most people came for. Without a CPI it is not drawn and
 * the control is not there either, rather than sitting on screen disabled.
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
  inflation: {
    key: "inflation",
    label: "Enflasyonla artan anapara",
    color: "var(--series-alt)",
  },
  openingInflation: {
    key: "inflation",
    label: "Enflasyonla artan değeri",
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
  // On by default: this is the comparison the page exists to make.
  const [showInflation, setShowInflation] = useState(true);
  const groupName = useId();
  const inflationId = useId();

  const withInflation = data.hasInflation && showInflation;
  const reference = staged ? LINES.invested : LINES.opening;
  const inflationLine = staged ? LINES.inflation : LINES.openingInflation;

  /**
   * The reference line is drawn for a staged basket and not for a held one.
   *
   * What this chart claims is whether the basket kept its purchasing power,
   * and that is read in one place: the gap between the market line and the
   * inflation line. For a basket bought in one go the reference is a flat
   * line at the opening value — nominal money, held still — and it does not
   * belong to that question. It only gives the eye a second, easier gap to
   * measure, which is the wrong one: a basket can sit far above its opening
   * value and still be below inflation.
   *
   * A staged basket's reference is not flat. It is a staircase, one step per
   * deposit, so it carries something the other lines do not — when money
   * went in, and how much. That is worth a line, so it keeps one.
   *
   * The value is in the tooltip either way. Taking a line off the chart is
   * not the same as withholding the number, and the tooltip is where a
   * reader goes for a figure rather than a shape.
   */
  const series = [
    LINES.market,
    ...(withInflation ? [inflationLine] : []),
    ...(staged ? [reference] : []),
  ];

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
      [p.market, p.invested, withInflation ? p.inflation : undefined].filter(
        (v): v is number => v !== undefined,
      ),
    );
    return scale === "log" ? logAxis(values) : linearAxis(values);
  }, [scale, data.points, withInflation]);

  const formatTick = useMemo(() => axisFormatter(axis.ticks), [axis]);

  // The date axis is ticked by `./axis` for the same reason the value axis
  // is ticked here: left to Recharts, two Fridays in one month both format
  // as "02.26" and the axis repeats itself.
  // As many date labels as fit, one per 60px, 3 to 10.
  const [genislik, setGenislik] = useState(0);
  const dateTicks = useMemo(
    () =>
      monthTicks(
        data.points.map((p) => p.date),
        genislik > 0 ? Math.max(3, Math.min(10, Math.floor(genislik / 60))) : 10,
      ),
    [data.points, genislik],
  );

  return (
    <section aria-labelledby="deger-grafigi" className="scroll-mt-28 sm:scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="deger-grafigi" className="text-display-sm">
            Sepetin değeri
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data.hasInflation && (
            <label
              htmlFor={inflationId}
              className="inline-flex cursor-pointer items-center gap-2.5 rounded-control border border-border px-3.5 py-2.5 text-caption text-ink-muted transition-colors hover:border-border-strong has-checked:text-ink"
            >
              <input
                id={inflationId}
                type="checkbox"
                checked={showInflation}
                onChange={(event) => setShowInflation(event.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="grid size-4 shrink-0 place-items-center rounded-[0.3rem] border border-border-strong text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-3">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              </span>
              Enflasyon çizgisi
            </label>
          )}

          <div className="inline-flex items-center">
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
            {/* Outside the fieldset rather than beside the option it explains:
                inside, the icon becomes a button in the middle of a radio
                group, and arrowing through the group would land on it. */}
            <InfoTip term="logaritmik" />
          </div>
        </div>
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
        <ResponsiveContainer
          width="100%"
          height="100%"
          onResize={(w) => setGenislik((eski) => (Math.abs(eski - w) < 1 ? eski : w))}
        >
          <LineChart
            data={data.points}
            // Room on the right for the last date label. The final tick sits
            // on the plot's right edge and the label centres on it, so half
            // of "09.26" hangs outside the drawing area and is clipped.
            margin={{ top: 8, right: 28, bottom: 0, left: 0 }}
          >
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
            {/* Pinned to the top left of the plot rather than following the
                pointer. A tooltip that tracks the cursor sits on top of the
                lines it is describing, and on a chart whose whole point is
                the gap between two of them, covering that gap to read it is
                the wrong trade. The corner is chosen for the shape these
                charts actually have: a value series over Turkish inflation
                rises left to right, so the top left is the emptiest part of
                the plot. `x` clears the 82px value axis. */}
            <Tooltip
              content={
                <ChartTooltip
                  extra={staged ? undefined : reference}
                  scale={scale}
                />
              }
              position={{ x: 92, y: 8 }}
              isAnimationActive={false}
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            />
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
        {caption(staged, withInflation)}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What the lines are, in as few words as they can be said in.
 *
 * The third sentence is the one that matters and is written as a test rather
 * than as a definition: a reader who has just seen a large green number
 * needs to know which side of that line to look for it on.
 */
/**
 * What the lines are, naming only the ones that are on the plot.
 *
 * A held basket no longer has a dashed line, so its caption no longer
 * mentions one; the opening value is in the tooltip and the sentence says
 * where to find it rather than describing something the reader cannot see.
 */
function caption(staged: boolean, withInflation: boolean): string {
  if (staged) {
    const principal = "kesikli çizgi o güne kadar yatırdığınız para";
    if (!withInflation) {
      return `Renkli çizgi sepetin piyasa değeri, ${principal}. Aradaki açıklık kazancınız.`;
    }
    return (
      `Renkli çizgi sepetin piyasa değeri, ${principal}, üçüncü çizgi aynı paranın ` +
      `yalnız enflasyon kadar artmış hali. Piyasa değeri enflasyon çizgisinin ` +
      `üstündeyse sepet alım gücünü korumuş, altındaysa korumamış.`
    );
  }

  if (!withInflation) {
    return (
      "Renkli çizgi sepetin piyasa değeri. Dönem başındaki değeri, grafiğin " +
      "üzerine gelince kutuda yazıyor."
    );
  }

  return (
    "Renkli çizgi sepetin piyasa değeri, ikinci çizgi aynı paranın yalnız " +
    "enflasyon kadar artmış hali. Piyasa değeri enflasyon çizgisinin üstündeyse " +
    "sepet alım gücünü korumuş, altındaysa korumamış. Dönem başındaki değeri, " +
    "grafiğin üzerine gelince kutuda yazıyor."
  );
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
  /** Recharts hands the whole row along with each series' own value. */
  payload?: Record<string, number | string | undefined>;
}

/**
 * The figures at the hovered week.
 *
 * `extra` is a series that is deliberately not drawn but still reported —
 * the held basket's opening value. Recharts only puts rendered `<Line>`s in
 * `payload`, so its value is read off the row that comes attached to the
 * first entry instead. That is the whole reason the prop exists: a line
 * removed from the plot should not take its number off the page with it.
 */
function ChartTooltip({
  active,
  label,
  payload,
  extra,
  scale,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
  extra?: { key: string; label: string; color: string };
  scale?: Scale;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0]?.payload;
  const extraValue = extra ? row?.[extra.key] : undefined;

  return (
    // A fixed corner means the box no longer moves out of a pointer's way,
    // so it must never be in one: `pointer-events-none` keeps it from
    // swallowing a hover over the plot underneath it.
    <div className="pointer-events-none w-72 rounded-control border border-border bg-surface-raised px-4 py-3 text-caption shadow-lg">
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
            <span className="ml-auto whitespace-nowrap tabular-nums">
              {typeof entry.value === "number" ? para(entry.value) : ""}
            </span>
          </li>
        ))}

        {extra && typeof extraValue === "number" && (
          // No colour dot: there is no line on the plot for it to match, and
          // a swatch beside a figure nothing draws would send the reader
          // looking for a line that is not there.
          <li className="flex items-center gap-2 border-t border-border pt-1 text-ink">
            <span className="text-ink-muted">{extra.label}</span>
            <span className="ml-auto whitespace-nowrap tabular-nums">{para(extraValue)}</span>
          </li>
        )}
      </ul>
      {scale === "log" && (
        <p className="mt-2 text-ink-subtle">Logaritmik ölçek</p>
      )}
    </div>
  );
}
