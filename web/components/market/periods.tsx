"use client";

/**
 * The asset classes, one calendar year at a time.
 *
 * A control over the years; under it, the pairs whose relationship that
 * year stood apart from the other years (`shifts`, already tested by the
 * API), each drawn as two dots on a −1..1 line — grey for the other years,
 * accent for this one — then the year's full matrix and each class's
 * volatility against the whole window.
 *
 * Colours follow the site's heatmap: purple for moving together, the
 * alternate hue for moving apart, strength by how much colour is mixed in.
 * Neither is a verdict, so neither is green or red.
 */

import { useRef, useState } from "react";

import { yuzde } from "@/lib/format";
import {
  donemEtiketi,
  donemKisa,
  donemOzeti,
  etkenAdi,
  iliski,
} from "@/lib/periods";
import type { MarketPeriod, MarketPeriodsResponse } from "@/lib/api";

const MAX_TINT = 60;

function tint(value: number | null): string | undefined {
  if (value === null) return undefined;
  const strength = Math.round(Math.min(1, Math.abs(value)) * MAX_TINT);
  const hue = value >= 0 ? "var(--color-brand-500)" : "var(--series-alt)";
  return `color-mix(in oklab, ${hue} ${strength}%, transparent)`;
}

export function Donemler({ data }: { data: MarketPeriodsResponse }) {
  const periods = data.periods;
  const [secili, setSecili] = useState(periods[periods.length - 1]?.key ?? "");
  const p = periods.find((x) => x.key === secili) ?? periods[periods.length - 1];
  if (!p) return null;

  // One scale for every year, so switching years shows the change in the
  // bar lengths rather than a re-fitted axis.
  const volMax = Math.max(
    1e-9,
    ...periods.flatMap((x) => Object.values(x.volatility)),
    ...Object.values(data.whole?.volatility ?? {}),
  );

  return (
    <div className="mt-8">
      <DonemSecici periods={periods} secili={p.key} onSec={setSecili} />
      {periods.some((x) => x.partial) && (
        <p className="mt-2 text-caption text-ink-subtle">
          * Yılın yalnızca bir kısmı: verimiz{" "}
          {periods.filter((x) => x.partial).map(donemEtiketi).join(" ve ")} arasını kapsıyor.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0">
          <h3 className="text-lead font-semibold text-ink">
            {donemEtiketi(p)}
            <span className="ml-2 text-body font-normal text-ink-subtle tabular-nums">
              {p.weeks} hafta
              {typeof p.mean_correlation === "number" &&
                ` · ortalama ilişki ${iliski(p.mean_correlation)}`}
            </span>
          </h3>
          <p className="mt-2 text-body text-ink-muted text-pretty">{donemOzeti(p)}</p>
          {p.shifts.length > 0 && <Kaymalar p={p} />}
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Matris p={p} />
          <Oynaklik p={p} whole={data.whole} max={volMax} />
        </div>
      </div>
    </div>
  );
}

function DonemSecici({
  periods,
  secili,
  onSec,
}: {
  periods: MarketPeriod[];
  secili: string;
  onSec: (key: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const index = periods.findIndex((x) => x.key === secili);

  function git(i: number) {
    const to = periods[(i + periods.length) % periods.length];
    onSec(to.key);
    refs.current.get(to.key)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Dönem"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          git(index + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          git(index - 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          git(0);
        } else if (e.key === "End") {
          e.preventDefault();
          git(periods.length - 1);
        }
      }}
      className="inline-flex max-w-full flex-wrap rounded-control border border-border bg-surface p-0.5"
    >
      {periods.map((x) => {
        const on = x.key === secili;
        return (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={donemEtiketi(x)}
            tabIndex={on ? 0 : -1}
            ref={(node) => {
              if (node) refs.current.set(x.key, node);
              else refs.current.delete(x.key);
            }}
            onClick={() => onSec(x.key)}
            className={`rounded-[calc(var(--radius-control)-2px)] px-3.5 py-2 text-label tabular-nums transition-colors sm:px-4 ${
              on ? "bg-accent-surface text-accent" : "text-ink-muted hover:text-ink"
            }`}
          >
            {donemKisa(x)}
          </button>
        );
      })}
    </div>
  );
}

/** Each shifted pair as two dots on one −1..1 line. */
function Kaymalar({ p }: { p: MarketPeriod }) {
  const x = (v: number) => `${((v + 1) / 2) * 100}%`;
  return (
    <ul className="mt-6 flex flex-col gap-5">
      {p.shifts.map((s) => {
        const lo = Math.min(s.corr, s.rest);
        const hi = Math.max(s.corr, s.rest);
        return (
          <li key={`${s.a}-${s.b}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-body font-medium text-ink">
                {etkenAdi(s.a)} – {etkenAdi(s.b)}
              </span>
              <span className="text-caption text-ink-muted tabular-nums">
                diğer yıllar {iliski(s.rest)} → <span className="text-accent">{p.key}: {iliski(s.corr)}</span>
              </span>
            </div>
            <div className="relative mt-2 h-4" aria-hidden="true">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span className="absolute top-0 h-4 w-px bg-border-strong" style={{ left: "50%" }} />
              <span
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                style={{
                  left: x(lo),
                  width: `calc(${x(hi)} - ${x(lo)})`,
                  background: "color-mix(in oklab, var(--accent) 45%, transparent)",
                }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-subtle"
                style={{ left: x(s.rest) }}
              />
              <span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
                style={{ left: x(s.corr) }}
              />
            </div>
          </li>
        );
      })}
      <li className="flex justify-between text-label text-ink-subtle tabular-nums" aria-hidden="true">
        <span>−1 ters</span>
        <span>0</span>
        <span>1 birlikte</span>
      </li>
    </ul>
  );
}

/** The year's matrix, lower triangle; shifted pairs outlined. */
function Matris({ p }: { p: MarketPeriod }) {
  const { codes, matrix } = p.correlation;
  const kayan = new Set(p.shifts.flatMap((s) => [`${s.a}|${s.b}`, `${s.b}|${s.a}`]));
  return (
    <figure>
      <figcaption className="text-label text-ink-subtle">
        {donemEtiketi(p)} ilişki tablosu; çerçeveli hücreler yukarıdaki ikililer
      </figcaption>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[26rem] table-fixed border-separate border-spacing-px text-caption tabular-nums">
          <thead>
            <tr>
              <th className="w-20" />
              {codes.slice(0, -1).map((c) => (
                <th key={c} scope="col" className="px-0.5 pb-1 text-center align-bottom text-label leading-tight font-normal text-ink-subtle">
                  {etkenAdi(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.slice(1).map((row, ri) => {
              const r = ri + 1;
              return (
                <tr key={row}>
                  <th scope="row" className="pr-2 text-right text-label font-normal text-ink-muted">
                    {etkenAdi(row)}
                  </th>
                  {codes.slice(0, -1).map((col, c) => {
                    if (c >= r) return <td key={col} />;
                    const v = matrix[r][c];
                    const on = kayan.has(`${row}|${col}`);
                    return (
                      <td
                        key={col}
                        title={`${etkenAdi(row)} ile ${etkenAdi(col)}`}
                        className={`rounded-[0.3rem] px-0.5 py-2 text-center text-ink ${
                          on ? "outline outline-2 -outline-offset-2 outline-accent" : ""
                        }`}
                        style={{ backgroundColor: tint(v) }}
                      >
                        {v === null ? "" : iliski(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Each class's volatility this year, with a tick at the whole window's. */
function Oynaklik({
  p,
  whole,
  max,
}: {
  p: MarketPeriod;
  whole: MarketPeriod | null;
  max: number;
}) {
  const keys = p.correlation.codes;
  return (
    <figure>
      <figcaption className="text-label text-ink-subtle">
        Yıllık oynaklık · çizgi: bütün dönem
      </figcaption>
      <dl className="mt-3 flex flex-col gap-2">
        {keys.map((k) => {
          const v = p.volatility[k];
          const w = whole?.volatility[k];
          if (typeof v !== "number") return null;
          return (
            <div key={k} className="grid grid-cols-[6rem_1fr_6.5rem] items-center gap-3">
              <dt className="truncate text-caption text-ink-muted">{etkenAdi(k)}</dt>
              <dd className="relative h-2 rounded-full bg-canvas-sunken" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-accent/70"
                  style={{ width: `${(v / max) * 100}%` }}
                />
                {typeof w === "number" && (
                  <span
                    className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink"
                    style={{ left: `calc(${(w / max) * 100}% - 1px)` }}
                  />
                )}
              </dd>
              <dd className="text-right text-caption text-ink tabular-nums">
                {yuzde(v)}
                {typeof w === "number" && (
                  <span className="text-ink-subtle"> / {yuzde(w)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </figure>
  );
}
