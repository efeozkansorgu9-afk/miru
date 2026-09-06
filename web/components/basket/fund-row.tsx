"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { BasketFund } from "@/lib/basket";
import { AmountInput } from "./amount-input";
import { BasisToggle } from "./basis-toggle";
import { DateInput } from "./date-input";

/**
 * One fund in the basket.
 *
 * Laid out as a card with the identity on top and the three answers below,
 * rather than as a table row. A table would force the fund title into a
 * column the width of the narrowest screen, and these titles run to sixty
 * characters. The grid collapses to one column on a phone, and every width
 * in it is relative, so nothing is pinned to a pixel count that stops being
 * true on the next screen size.
 */
export function FundRow({
  fund,
  onChange,
  onRemove,
}: {
  fund: BasketFund;
  onChange: (patch: Partial<BasketFund>) => void;
  onRemove: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.li
      // No `layout` prop here on purpose. Combining a layout animation with
      // an animated `height` makes the two fight: framer-motion's layout
      // spring and the height tween each try to own the same box, and an
      // exit that should take a quarter of a second was measured taking
      // several. Collapsing the height is enough on its own, because the
      // siblings reflow normally as it shrinks.
      // Safe to start hidden: a row only ever exists because someone added
      // it, so this never runs on server rendered content the way an entry
      // animation on a static section would.
      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-card border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-label text-accent">{fund.code}</span>
            {/* A fund typed in by hand when the registry was unreachable has
                no name. Saying so beats an empty line that reads as a title
                still loading, and beats inventing one. */}
            <p
              className={`mt-1 text-caption ${
                fund.title ? "text-ink-muted" : "text-ink-subtle"
              }`}
              title={fund.title || undefined}
            >
              {fund.title || "Fon adı doğrulanamadı."}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${fund.code} fonunu kaldır`}
            title="Kaldır"
            className="grid size-9 shrink-0 place-items-center rounded-control border border-transparent text-ink-subtle transition-colors hover:border-border hover:text-negative"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4.5" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-5 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <AmountInput
            value={fund.amount}
            onChange={(amount) => onChange({ amount })}
          />
          <BasisToggle
            rowId={fund.id}
            value={fund.basis}
            onChange={(basis) => onChange({ basis })}
          />
          <DateInput
            value={fund.since}
            onChange={(since) => onChange({ since })}
          />
        </div>
      </div>
    </motion.li>
  );
}
