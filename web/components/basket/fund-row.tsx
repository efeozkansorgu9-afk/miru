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
      <div className="rounded-card border border-border bg-surface p-4 sm:p-5">
        {/* The identity on one line: code, then title, then the way out.
            It used to be two, the title stacked under the code, which cost
            every card a line to say something that fits beside it — and with
            five funds those lines are most of the reason the form ran past
            two thousand pixels. The title gives up characters instead: it is
            the only part that can be long, `title` keeps the whole of it
            reachable, and the code beside it is what identifies the row. */}
        <div className="flex items-center gap-3">
          <span className="shrink-0 font-mono text-label text-accent">
            {fund.code}
          </span>
          {/* A fund typed in by hand when the registry was unreachable has
              no name. Saying so beats an empty line that reads as a title
              still loading, and beats inventing one. */}
          <p
            className={`min-w-0 flex-1 truncate text-caption ${
              fund.title ? "text-ink-muted" : "text-ink-subtle"
            }`}
            title={fund.title || undefined}
          >
            {fund.title || "Fon adı doğrulanamadı."}
          </p>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${fund.code} fonunu kaldır`}
            title="Kaldır"
            className="-my-1 grid size-8 shrink-0 place-items-center rounded-control border border-transparent text-ink-subtle transition-colors hover:border-border hover:text-negative"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="size-4.5" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* The three answers on the second line, all of them from `sm` up.
            They used to fold to two columns until `lg`, which put a third
            row under every card on the width most people are reading at. */}
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-3">
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
