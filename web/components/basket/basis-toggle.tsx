"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

import type { AmountBasis } from "@/lib/basket";

const OPTIONS: { value: AmountBasis; label: string }[] = [
  { value: "current_value", label: "Bugünkü değeri" },
  { value: "paid", label: "Aldığım tutar" },
];

/**
 * What the amount means: what it is worth now, or what was paid for it.
 *
 * Two real questions, not a formatting preference. A fund bought three years
 * ago for the same lira as one bought last month is not the same holding
 * today, and which of the two numbers someone has to hand depends on whether
 * they are reading a portfolio screen or a bank statement.
 *
 * Both options are on screen rather than behind a dropdown: with two choices
 * a select hides half the question, and the answer changes what the other
 * fields in the row mean.
 *
 * Radios under the paint, so arrow keys move between them and a screen reader
 * announces a group rather than two unrelated buttons.
 */
export function BasisToggle({
  value,
  onChange,
  rowId,
}: {
  value: AmountBasis;
  onChange: (next: AmountBasis) => void;
  /** Keeps the sliding indicator from being shared between rows. */
  rowId: string;
}) {
  const name = useId();
  const reduceMotion = useReducedMotion();

  return (
    <fieldset className="min-w-0">
      <legend className="text-label text-ink-muted">Tutar tipi</legend>
      <div className="mt-2 inline-flex w-full rounded-control border border-border bg-canvas-sunken p-1">
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className="relative flex-1 cursor-pointer"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              {selected && (
                <motion.span
                  layoutId={`basis-${rowId}`}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 34 }
                  }
                  // `surface-raised`, not `surface`: in dark the card is
                  // already `surface`, so a pill painted the same colour
                  // vanishes into it. Raised is white in light and a step
                  // lighter than the card in dark, which is the direction
                  // surfaces lift in each theme.
                  className="absolute inset-0 rounded-[0.4rem] bg-surface-raised shadow-sm"
                />
              )}
              <span
                className={`relative block whitespace-nowrap px-3 py-2 text-center text-caption transition-colors peer-focus-visible:underline ${
                  selected ? "text-ink" : "text-ink-muted"
                }`}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
