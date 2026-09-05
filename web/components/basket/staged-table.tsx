"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { BasketFund, PurchaseRow } from "@/lib/basket";
import { AmountInput } from "./amount-input";
import { DateInput } from "./date-input";

/**
 * Dated purchases: one line per time money went in.
 *
 * The same fund may appear as many times as it was bought into, which is the
 * whole point. Someone paying in every month has twelve lines for one fund,
 * and the amounts they paid are not the shares of the basket they ended up
 * with.
 *
 * The fund column is a picker over the funds already chosen above rather than
 * a second search box: search adds a fund to the basket, this decides when
 * money went into it, and keeping those two jobs apart means the search field
 * behaves the same in both modes.
 */
export function StagedTable({
  rows,
  funds,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: PurchaseRow[];
  funds: BasketFund[];
  onChange: (id: string, patch: Partial<PurchaseRow>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const reduceMotion = useReducedMotion();

  if (funds.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border px-6 py-10 text-center text-caption text-ink-muted">
        Önce yukarıdan en az bir fon arayıp seçin, sonra alımlarınızı tarih
        tarih girin.
      </p>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.id}
              // See the note in fund-row.tsx: `layout` and an animated
              // height fight each other and stall the exit.
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-card border border-border bg-surface p-5">
                <div className="grid items-start gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                  <DateInput
                    label="Alım tarihi"
                    value={row.date}
                    onChange={(date) => onChange(row.id, { date })}
                  />

                  <div className="min-w-0">
                    <label
                      htmlFor={`fund-${row.id}`}
                      className="block text-label text-ink-muted"
                    >
                      Fon
                    </label>
                    <select
                      id={`fund-${row.id}`}
                      value={row.code}
                      onChange={(event) => onChange(row.id, { code: event.target.value })}
                      className="mt-2 w-full rounded-control border border-border bg-surface px-4 py-3 text-body text-ink transition-colors hover:border-border-strong focus:border-accent"
                    >
                      <option value="">Seçin</option>
                      {funds.map((fund) => (
                        <option key={fund.code} value={fund.code}>
                          {fund.code} · {fund.title.slice(0, 44)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 min-h-4.5 text-caption text-ink-subtle" />
                  </div>

                  <AmountInput
                    value={row.amount}
                    onChange={(amount) => onChange(row.id, { amount })}
                  />

                  <div className="flex sm:pt-8">
                    <button
                      type="button"
                      onClick={() => onRemove(row.id)}
                      aria-label="Bu alımı kaldır"
                      title="Kaldır"
                      className="grid size-11 place-items-center rounded-control border border-transparent text-ink-subtle transition-colors hover:border-border hover:text-negative"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4.5" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-2 rounded-control border border-dashed border-border-strong px-5 py-3 text-label text-ink-muted transition-colors hover:border-accent hover:text-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Alım satırı ekle
      </button>
    </div>
  );
}
