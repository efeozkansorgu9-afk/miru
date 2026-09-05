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

  // Labels at 1, 2 and 5 per decade. Recharts left to itself labels every
  // digit on a log axis, and at the bottom of the range they collide.
  const ticks = useMemo(
    () => (scale === "log" ? logTicks(data.points.map((p) => p.market)) : undefined),
    [scale, data.points],
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
              tickFormatter={eksenTarihi}
              minTickGap={48}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            <YAxis
              scale={scale === "log" ? "log" : "linear"}
              domain={scale === "log" ? ["dataMin", "dataMax"] : ["auto", "auto"]}
              ticks={ticks}
              allowDataOverflow={scale === "log"}
              width={78}
              tickFormatter={eksenTutari}
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

/** Short money for an axis: thousands and millions, not fifteen digits. */
function eksenTutari(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mn`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000).toLocaleString("tr-TR")} b`;
  }
  return Math.round(value).toLocaleString("tr-TR");
}

function logTicks(values: number[]): number[] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [];
  const low = Math.min(...positive);
  const high = Math.max(...positive);

  const out: number[] = [];
  for (let e = Math.floor(Math.log10(low)); e <= Math.ceil(Math.log10(high)); e += 1) {
    for (const m of [1, 2, 5]) {
      const tick = m * 10 ** e;
      if (tick >= low * 0.95 && tick <= high * 1.05) out.push(tick);
    }
  }
  return out;
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
