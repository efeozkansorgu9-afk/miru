/**
 * Fund by fund: what is in the basket and which funds move together.
 *
 * The group column is where a small group survives. When a group holds less
 * than a quarter of the basket the headline does not mention it, and this
 * table is then the only place the finding lives, so it may never be
 * truncated away.
 *
 * Which is why there are two layouts rather than one. Five columns on a 390
 * pixel screen leaves "1. grup, toplam %40" as "1. grup…", and the answer is
 * gone. Sideways scrolling would hide it just as well, and behind a gesture
 * nobody performs on a page they are reading. So a phone gets the same rows
 * stacked, where nothing has to be shortened at all. Only one of the two is
 * ever in the accessibility tree, because `hidden` is `display: none`.
 */

import { kisalt, para, yuzde } from "@/lib/format";
import type { TableRow } from "@/lib/result";
import { ResultTable } from "./result-table";
import type { Cell, Column } from "./result-table";

export function FundTable({
  rows,
  /** True when the amounts are today's market value rather than what was paid. */
  valuedToday,
}: {
  rows: TableRow[];
  valuedToday: boolean;
}) {
  const amountLabel = valuedToday ? "Bugünkü değeri" : "Tutar";

  const columns: Column[] = [
    { label: "Fon", width: "13%" },
    { label: "Adı", width: "35%", clip: true },
    { label: amountLabel, width: "17%", align: "right" },
    { label: "Payı", width: "11%", align: "right" },
    { label: "Durum", width: "24%", clip: true },
  ];

  const body: Cell[][] = rows.map((row) => [
    { text: row.code },
    { text: kisalt(row.name), title: row.name },
    { text: para(row.amount) },
    { text: yuzde(row.weight), bar: row.weight },
    { text: row.status, title: row.status },
  ]);

  return (
    <>
      <div className="hidden sm:block">
        <ResultTable
          columns={columns}
          rows={body}
          caption="Sepetteki fonlar, payları ve birlikte hareket eden grupları"
        />
      </div>

      <ul className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.code}
            className="rounded-control border border-border bg-surface px-4 py-3.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-label text-accent">{row.code}</span>
              <span className="text-body tabular-nums text-ink">{yuzde(row.weight)}</span>
            </div>
            <p className="mt-1 text-caption text-ink-muted">{row.name}</p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-caption">
              <div className="flex gap-2">
                <dt className="text-ink-subtle">{amountLabel}</dt>
                <dd className="tabular-nums text-ink">{para(row.amount)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-subtle">Durum</dt>
                <dd className="text-ink">{row.status}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
