"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  AY_ADLARI,
  AY_KISA,
  GUN_ADLARI,
  GUN_KISA,
  addDays,
  addMonths,
  compare,
  monthGrid,
  sameDay,
  today,
} from "@/lib/date";
import type { CalendarDate } from "@/lib/date";

/**
 * The calendar itself: a month of days, a month picker and a year picker.
 *
 * Three panels rather than one, because moving from September 2026 to March
 * 2021 through a next/previous arrow is sixty six clicks. The month and the
 * year in the header are buttons, and pressing either swaps the body for a
 * grid of the twelve months or of the years, which is one click to the panel
 * and one to the answer.
 *
 * Nothing after today can be chosen, in the grid or by keyboard. A purchase
 * dated in the future is not a typo the analysis can absorb: it would price
 * against days that have not happened.
 *
 * The day grid is one tab stop with a roving focus, which is how a grid is
 * meant to behave: arrows move within it, Tab leaves it. Forty two tab stops
 * would mean forty two presses to get past a date field.
 */

type Panel = "days" | "months" | "years";

/** Far enough back for anyone still holding a fund, and no further. */
const YEARS_BACK = 30;

export function Calendar({
  value,
  onPick,
  onClose,
}: {
  value: CalendarDate | null;
  onPick: (date: CalendarDate) => void;
  /** Escape, or a day chosen. The caller returns focus to its input. */
  onClose: () => void;
}) {
  const now = useMemo(() => today(), []);
  const [panel, setPanel] = useState<Panel>("days");
  // What the grid is showing, and which day the arrow keys are on. They
  // start together and the view follows the cursor across month boundaries.
  const [cursor, setCursor] = useState<CalendarDate>(value ?? now);
  const gridRef = useRef<HTMLDivElement>(null);
  // True on mount: opening the calendar puts focus on the day the arrow keys
  // will move from, so it can be driven from the keyboard at all. Without it
  // focus stays behind in the text field, the arrows do nothing, and Enter
  // submits the form instead of choosing a date.
  const shouldFocus = useRef(true);

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  // Focus follows the cursor, and only the cursor. Refocusing on every
  // render would fight the month and year panels for it.
  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>('[data-focused="true"]')
      ?.focus();
  }, [cursor]);

  function move(days: number) {
    const next = addDays(cursor, days);
    if (compare(next, now) > 0) return;
    shouldFocus.current = true;
    setCursor(next);
  }

  function moveMonths(months: number) {
    const next = addMonths(cursor, months);
    if (compare(next, now) > 0) return;
    shouldFocus.current = true;
    setCursor(next);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      ArrowUp: () => move(-7),
      ArrowDown: () => move(7),
      PageUp: () => moveMonths(-1),
      PageDown: () => moveMonths(1),
      Home: () => move(-((cursor.day - 1) % 7)),
      End: () => move(6 - ((cursor.day - 1) % 7)),
    };
    const handler = step[event.key];
    if (handler) {
      event.preventDefault();
      handler();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (compare(cursor, now) <= 0) onPick(cursor);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const canGoForward = compare(addMonths(cursor, 1), { ...now, day: 1 }) <= 0;

  return (
    <div
      role="dialog"
      aria-label="Tarih seç"
      onKeyDown={onKeyDown}
      className="w-[19.5rem] rounded-card border border-border bg-surface-raised p-4 shadow-xl"
    >
      <div className="flex items-center gap-1">
        <Arrow
          direction="prev"
          label="Önceki ay"
          onClick={() => setCursor(addMonths(cursor, -1))}
        />

        <div className="flex flex-1 justify-center gap-1">
          <HeaderButton
            active={panel === "months"}
            onClick={() => setPanel(panel === "months" ? "days" : "months")}
          >
            {AY_ADLARI[cursor.month - 1]}
          </HeaderButton>
          <HeaderButton
            active={panel === "years"}
            onClick={() => setPanel(panel === "years" ? "days" : "years")}
          >
            {cursor.year}
          </HeaderButton>
        </div>

        <Arrow
          direction="next"
          label="Sonraki ay"
          disabled={!canGoForward}
          onClick={() => setCursor(addMonths(cursor, 1))}
        />
      </div>

      <div className="mt-3">
        {panel === "days" && (
          <>
            <div className="grid grid-cols-7 gap-0.5">
              {GUN_KISA.map((short, i) => (
                <abbr
                  key={short}
                  title={GUN_ADLARI[i]}
                  className="py-1 text-center text-label font-medium text-ink-subtle no-underline"
                >
                  {short}
                </abbr>
              ))}
            </div>

            <div ref={gridRef} className="mt-1 grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const outside = day.month !== cursor.month;
                const future = compare(day, now) > 0;
                const selected = sameDay(day, value);
                const focused = sameDay(day, cursor);
                return (
                  <button
                    key={`${day.year}-${day.month}-${day.day}`}
                    type="button"
                    disabled={future}
                    data-focused={focused}
                    // One tab stop for the whole grid: the focused day is
                    // reachable, the other forty one are not.
                    tabIndex={focused ? 0 : -1}
                    aria-label={`${day.day} ${AY_ADLARI[day.month - 1]} ${day.year}`}
                    aria-current={sameDay(day, now) ? "date" : undefined}
                    aria-pressed={selected}
                    onClick={() => onPick(day)}
                    className={cell(selected, outside, future, sameDay(day, now))}
                  >
                    {day.day}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {panel === "months" && (
          <div className="grid grid-cols-3 gap-1">
            {AY_KISA.map((short, i) => {
              const future = compare({ ...cursor, month: i + 1, day: 1 }, now) > 0;
              return (
                <button
                  key={short}
                  type="button"
                  disabled={future}
                  aria-label={AY_ADLARI[i]}
                  onClick={() => {
                    setCursor(addMonths(cursor, i + 1 - cursor.month));
                    setPanel("days");
                  }}
                  className={chip(i + 1 === cursor.month, future)}
                >
                  {short}
                </button>
              );
            })}
          </div>
        )}

        {panel === "years" && (
          <div className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto">
            {Array.from({ length: YEARS_BACK }, (_, i) => now.year - i).map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  const month =
                    year === now.year ? Math.min(cursor.month, now.month) : cursor.month;
                  setCursor({ year, month, day: 1 });
                  setPanel("months");
                }}
                className={chip(year === cursor.year, false)}
              >
                {year}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onPick(now)}
          className="rounded-control px-3 py-1.5 text-caption text-accent transition-colors hover:bg-accent-surface"
        >
          Bugün
        </button>
      </div>
    </div>
  );
}

function cell(
  selected: boolean,
  outside: boolean,
  future: boolean,
  isToday: boolean,
): string {
  const base =
    "grid h-9 place-items-center rounded-control text-caption tabular-nums transition-colors";
  if (future) return `${base} cursor-not-allowed text-ink-subtle/40`;
  if (selected) return `${base} bg-accent font-medium text-accent-ink`;
  const tone = outside ? "text-ink-subtle" : "text-ink";
  const ring = isToday ? " ring-1 ring-inset ring-accent" : "";
  return `${base} ${tone}${ring} hover:bg-canvas-sunken`;
}

function chip(selected: boolean, disabled: boolean): string {
  const base =
    "rounded-control px-2 py-2.5 text-caption tabular-nums transition-colors";
  if (disabled) return `${base} cursor-not-allowed text-ink-subtle/40`;
  if (selected) return `${base} bg-accent font-medium text-accent-ink`;
  return `${base} text-ink hover:bg-canvas-sunken`;
}

function HeaderButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={`rounded-control px-3 py-1.5 text-body font-medium transition-colors ${
        active ? "bg-accent-surface text-accent" : "text-ink hover:bg-canvas-sunken"
      }`}
    >
      {children}
    </button>
  );
}

function Arrow({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-control text-ink-muted transition-colors hover:bg-canvas-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4"
      >
        <path d={direction === "prev" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
      </svg>
    </button>
  );
}
