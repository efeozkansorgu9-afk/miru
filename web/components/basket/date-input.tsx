"use client";

import { useId } from "react";

import { checkDate, todayISO } from "@/lib/basket";

/**
 * When the holding started.
 *
 * The native picker rather than a hand rolled calendar: it already speaks
 * Turkish, already opens with the keyboard, and on a phone it is the one the
 * user's thumb expects. `color-scheme` on the root is what makes its popup
 * and its own calendar glyph turn dark with the rest of the page.
 *
 * `max` keeps tomorrow out of the picker, and the value is checked as well,
 * because a date field can still be typed into.
 */
export function DateInput({
  value,
  onChange,
  label = "Ne zamandır elinde?",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const id = useId();
  const error = checkDate(value);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-label text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        max={todayISO()}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 w-full rounded-control border bg-surface px-4 py-3 text-body text-ink transition-colors focus:border-accent ${
          error
            ? "border-negative focus:border-negative"
            : "border-border hover:border-border-strong"
        }`}
      />
      <p
        id={`${id}-error`}
        role={error ? "alert" : undefined}
        className={`mt-1.5 min-h-4.5 text-caption ${error ? "text-negative" : "text-ink-subtle"}`}
      >
        {error ?? ""}
      </p>
    </div>
  );
}
