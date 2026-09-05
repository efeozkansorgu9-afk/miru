"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Calendar } from "./calendar";
import {
  compare,
  formatTurkish,
  parseISO,
  parseTurkish,
  toISO,
  today,
} from "@/lib/date";
import type { CalendarDate } from "@/lib/date";

/**
 * When the holding started: typed, or picked from a Turkish calendar.
 *
 * The native `<input type="date">` was here first and had one thing going
 * for it, which was that it existed. Everything else about it was wrong for
 * this page. Its placeholder reads "dd.mm.yyyy" in English regardless of the
 * document language, its popup is drawn by the browser in the browser's own
 * design language rather than this one, and on desktop Chrome it is a
 * three-segment spinner that will not accept a pasted date. It also cannot
 * be styled, so the one control on the page that opens something looked
 * nothing like the page it opened over.
 *
 * The field itself is still a text input, because typing a date you already
 * know is faster than any calendar: "5.9.2025", "05/09/2025" and
 * "05.09.2025" all parse. The calendar is for the dates people do not have
 * to hand, which for "when did I buy this" is most of them.
 *
 * The value crossing the boundary stays ISO, so nothing upstream changes.
 */
export function DateInput({
  value,
  onChange,
  label = "Ne zamandır elinde?",
}: {
  /** ISO, or empty. */
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  // What is in the box, which during typing is not yet a date. Held apart
  // from `value` so a half typed year does not erase what was there.
  const [text, setText] = useState(() => fromISO(value));
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = parseISO(value);

  // Follow the value when it is changed from outside, but never while the
  // field has focus: rewriting the box under someone mid-word moves the caret.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(fromISO(value));
  }, [value]);

  const error = validate(text);

  function commit(raw: string) {
    setText(raw);
    if (!raw.trim()) {
      onChange("");
      return;
    }
    const parsed = read(raw);
    // An unfinished date is not a date. Upstream holds nothing until the
    // whole thing parses, which is also what keeps "ileri tarih" honest.
    onChange(parsed && compare(parsed, today()) <= 0 ? toISO(parsed) : "");
  }

  /** On the way out, rewrite what was typed the way the field writes it. */
  function tidy() {
    setTouched(true);
    const parsed = read(text);
    if (parsed) setText(formatTurkish(parsed));
  }

  function choose(date: CalendarDate) {
    setText(formatTurkish(date));
    onChange(toISO(date));
    setTouched(true);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-label text-ink-muted">
        {label}
      </label>

      <div ref={fieldRef} className="relative mt-2">
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="gg.aa.yyyy"
          value={text}
          aria-invalid={touched && error !== null}
          aria-describedby={`${id}-error`}
          onChange={(event) => commit(event.target.value)}
          onBlur={tidy}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={`w-full rounded-control border bg-surface py-3 pl-4 pr-12 text-body tabular-nums text-ink transition-colors focus:border-accent ${
            touched && error
              ? "border-negative focus:border-negative"
              : "border-border hover:border-border-strong"
          }`}
        />

        <button
          type="button"
          aria-label="Takvimi aç"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-control text-ink-subtle transition-colors hover:bg-canvas-sunken hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            aria-hidden="true"
            className="size-4.5"
          >
            <rect x="3" y="5" width="18" height="16" rx="2.5" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>

        <Popover anchor={fieldRef} open={open} onDismiss={() => setOpen(false)}>
          <Calendar
            value={selected}
            onPick={choose}
            onClose={() => {
              setOpen(false);
              inputRef.current?.focus();
            }}
          />
        </Popover>
      </div>

      {/* Reserved height, so a message appearing does not shift the row. */}
      <p
        id={`${id}-error`}
        role={touched && error ? "alert" : undefined}
        className={`mt-1.5 min-h-4.5 text-caption ${
          touched && error ? "text-negative" : "text-ink-subtle"
        }`}
      >
        {touched && error ? error : ""}
      </p>
    </div>
  );
}

/**
 * A typed date, however it was written.
 *
 * Turkish order first, since that is what the placeholder asks for, then ISO,
 * because a date copied out of a spreadsheet or a bank export arrives that
 * way and refusing it would be pedantry.
 */
function read(text: string): CalendarDate | null {
  return parseTurkish(text) ?? parseISO(text);
}

/** Turkish for the two ways a typed date can be wrong. */
function validate(text: string): string | null {
  if (!text.trim()) return null;
  const parsed = read(text);
  if (!parsed) return "Tarihi gg.aa.yyyy olarak yazın.";
  if (compare(parsed, today()) > 0) return "İleri bir tarih seçilemez.";
  return null;
}

function fromISO(iso: string): string {
  const parsed = parseISO(iso);
  return parsed ? formatTurkish(parsed) : "";
}

/**
 * The calendar, floated over everything.
 *
 * In a portal with fixed coordinates rather than absolutely positioned in
 * place, because the rows this field sits in animate their height and
 * therefore carry `overflow: hidden`. An absolutely positioned popover
 * inside one is a popover with its bottom half cut off.
 *
 * It flips above the field when there is no room below, which on the last
 * row of a long basket there usually is not.
 */
function Popover({
  anchor,
  open,
  onDismiss,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Measuring the anchor and placing the panel before paint is what
  // `useLayoutEffect` is for; positioning in a normal effect shows the
  // calendar in the wrong place for a frame first.
  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const field = anchor.current?.getBoundingClientRect();
      if (!field) return;
      const height = panelRef.current?.offsetHeight ?? 340;
      const width = panelRef.current?.offsetWidth ?? 312;
      const below = window.innerHeight - field.bottom;
      setSpot({
        top: below < height + 16 && field.top > height + 16
          ? field.top - height - 8
          : field.bottom + 8,
        // Kept on screen at either edge, which matters on a phone where the
        // field can be almost as wide as the viewport.
        left: Math.min(Math.max(8, field.left), window.innerWidth - width - 8),
      });
    }

    place();
    // Capture, so a scroll inside any ancestor moves it too.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onDismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onDismiss, anchor]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            top: spot?.top ?? -9999,
            left: spot?.left ?? -9999,
            zIndex: 60,
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
