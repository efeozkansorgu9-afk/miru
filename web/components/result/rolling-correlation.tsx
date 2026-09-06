"use client";

/**
 * How one pair's similarity moved, week by week.
 *
 * It sits directly under the main finding rather than in the technical panel,
 * because it answers the question the finding provokes. "AFO and HBF move
 * together at 0.99" invites "have they always?", and a single number cannot
 * answer that: two funds averaging 0.90 for five years might have sat at 0.40
 * for three of them and 0.98 since, which is a different fact about a basket.
 *
 * One pair is drawn at a time. Every pair is already in the response, so
 * choosing another is a click and not a request, and the strongest pair is
 * chosen for the reader because it is the one the finding above was about.
 *
 * The vertical axis is pinned to the interval a correlation lives in and is
 * never fitted to the series. Fitting it would make the estimator's own
 * wander fill the chart: a pair whose true correlation never moved at all
 * still swings about a third of the scale on a 52 week window, and on a
 * fitted axis that would be drawn as a dramatic history of nothing. Pinned,
 * a flat pair reads flat, and any two pairs can be compared by eye.
 */

import { useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { korelasyon, oran, tarih } from "@/lib/format";
import { ciftAdi, rollingNotu, rollingView } from "@/lib/result";
import type { RollingCorrelation as Rolling } from "@/lib/api";
import { eksenTarihi, monthTicks } from "./axis";

/** The whole scale, always. See the note on fitting in the file comment. */
const DOMAIN: [number, number] = [-1, 1];
const TICKS = [-1, -0.5, 0, 0.5, 1];

export function RollingCorrelation({ rolling }: { rolling: Rolling }) {
  // The strongest pair, which is the one the finding above this was about.
  // `pairs` arrives sorted, so index 0 needs no comparison here.
  const [index, setIndex] = useState(0);
  const selectId = useId();

  const pair = rolling.pairs[index] ?? rolling.pairs[0];
  const view = useMemo(() => rollingView(rolling, pair), [rolling, pair]);
  const dateTicks = useMemo(() => monthTicks(rolling.dates), [rolling.dates]);

  const strongest = index === 0;

  return (
    <section aria-labelledby="benzerlik" className="scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Benzerlik</p>

      {/* The pair and what it came to over the whole period, before the
          question about it. On the default selection this is the finding's
          own pair, so it says which pair it is; on any other it simply
          names the one being drawn rather than claiming it is the top. */}
      <p className="mt-4 text-lead text-ink text-pretty">
        {strongest ? (
          <>
            <strong className="font-medium">{ciftAdi(view.codes)}</strong> en çok
            birlikte hareket eden çift. Tüm dönem korelasyonu{" "}
            <strong className="font-medium tabular-nums">
              {oran(view.fullPeriod)}
            </strong>
            .
          </>
        ) : (
          <>
            <strong className="font-medium">{ciftAdi(view.codes)}</strong>. Tüm dönem
            korelasyonu{" "}
            <strong className="font-medium tabular-nums">
              {oran(view.fullPeriod)}
            </strong>
            .
          </>
        )}
      </p>

      <h2 id="benzerlik" className="mt-3 text-display-sm text-balance">
        Bu benzerlik zaman içinde nasıl değişti?
      </h2>

      {/* Above the chart it scopes, not inside it. Only shown when there is
          something to choose: a two fund basket has one pair, and a control
          with a single option is furniture. */}
      {rolling.pairs.length > 1 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label htmlFor={selectId} className="text-label text-ink-muted">
            Fon çifti
          </label>
          <select
            id={selectId}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            className="rounded-control border border-border bg-surface px-4 py-2.5 text-caption text-ink transition-colors hover:border-border-strong focus:border-accent"
          >
            {rolling.pairs.map((p, i) => (
              <option key={p.codes.join()} value={i}>
                {ciftAdi(p.codes)} ({oran(p.full_period)})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5 h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={view.points}
            // Room on the right for the last date label, which centres on a
            // tick sitting on the plot's own edge.
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
              domain={DOMAIN}
              ticks={TICKS}
              width={44}
              // One decimal on the axis, where the label is a signpost rather
              // than a value being read: "0,5" is quicker to scan than
              // "0,50", and the figures below carry the precision.
              tickFormatter={(v: number) => v.toFixed(1).replace(".", ",")}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-subtle)", fontSize: 12 }}
            />
            {/* Dashed, where the grid is solid: a dash on this page means a
                threshold, and this is the one the finding above was cut at.
                It comes from the response rather than being written here, so
                the line and the grouping can never disagree. */}
            <ReferenceLine
              y={rolling.threshold}
              stroke="var(--ink-subtle)"
              strokeDasharray="5 4"
              label={{
                value: `Gruplama eşiği ${oran(rolling.threshold)}`,
                position: "insideTopRight",
                fill: "var(--ink-subtle)",
                fontSize: 12,
              }}
            />
            <Tooltip content={<ChartTooltip codes={view.codes} />} />
            <Line
              type="monotone"
              dataKey="value"
              name={ciftAdi(view.codes)}
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              // A degenerate window travels as null and stays a gap. Joining
              // across it would draw a line through weeks nobody measured.
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* The three values worth reading off, in text, so none of them is
          reachable only by hovering. */}
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <Figure label="Bugün" point={view.latest} />
        <Figure label="En düşük" point={view.lowest} />
        <Figure label="En yüksek" point={view.highest} />
      </dl>

      <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
        {rollingNotu(rolling.window_weeks)}
      </p>
    </section>
  );
}

function Figure({
  label,
  point,
}: {
  label: string;
  point: { date: string; value: number } | null;
}) {
  return (
    <div className="rounded-control border border-border bg-canvas-sunken px-5 py-4">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="mt-2 text-display-sm tabular-nums text-ink">
        {point ? korelasyon(point.value) : "hesaplanamadı"}
      </dd>
      {point && (
        <dd className="mt-1 text-caption text-ink-subtle">{tarih(point.date)}</dd>
      )}
    </div>
  );
}

interface TooltipEntry {
  value?: number | null;
}

function ChartTooltip({
  active,
  label,
  payload,
  codes,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
  codes: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value;

  return (
    <div className="rounded-control border border-border bg-surface-raised px-4 py-3 text-caption shadow-lg">
      <p className="text-label text-ink-muted">{label ? tarih(label) : ""}</p>
      <p className="mt-2 flex items-center gap-2 text-ink">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
        />
        <span className="text-ink-muted">{ciftAdi(codes)}</span>
        <span className="ml-auto tabular-nums">
          {typeof value === "number" ? korelasyon(value) : "yok"}
        </span>
      </p>
    </div>
  );
}
