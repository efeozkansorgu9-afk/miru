"use client";

import { useId, useState } from "react";

import { checkAmount } from "@/lib/basket";

/**
 * A money field that leaves what you typed alone.
 *
 * Three deliberate absences.
 *
 * No stepper. `type="number"` brings arrows that nudge a lira figure by one,
 * which nobody wants, and a scroll wheel over the field silently changes the
 * amount. It is `type="text"` with `inputMode="decimal"`, so phones still get
 * the number pad.
 *
 * No reformatting as you type. Nothing inserts thousands separators or a
 * trailing ",00" behind the caret. `lib/basket` reads "12500", "12.500" and
 * "12 500" as the same number afterwards, which is the right place for that
 * to happen.
 *
 * No error while you are still mid word. The message appears once the field
 * is left, or as soon as a character arrives that could not belong in a
 * number, so typing "1" into an empty field is never scolded.
 */
export function AmountInput({
  value,
  onChange,
  label = "Tutar",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const { error } = checkAmount(value);

  // A letter is wrong the instant it arrives; an incomplete number is not.
  const immediate = error === "Sadece rakam yazın. Harf ve simge kullanılamaz.";
  const show = error !== null && (touched || immediate);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-label text-ink-muted">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="0"
          aria-invalid={show}
          aria-describedby={show ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
          className={`w-full rounded-control border bg-surface py-3 pl-4 pr-11 text-body tabular-nums text-ink transition-colors placeholder:text-ink-subtle focus:border-accent ${
            show
              ? "border-negative focus:border-negative"
              : "border-border hover:border-border-strong"
          }`}
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-caption text-ink-subtle">
          TL
        </span>
      </div>
      {/* Reserved height, so a message appearing does not shift the row. */}
      <p
        id={`${id}-error`}
        role={show ? "alert" : undefined}
        className={`mt-1.5 min-h-4.5 text-caption ${show ? "text-negative" : "text-ink-subtle"}`}
      >
        {show ? error : ""}
      </p>
    </div>
  );
}
