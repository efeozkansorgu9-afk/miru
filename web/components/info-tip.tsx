"use client";

/**
 * A definition, one press or one hover away from the word it defines.
 *
 * It is a real `<button>`, not a `title` attribute and not a hover-only
 * bubble. A `title` never appears on a phone, takes a second to arrive on a
 * desktop and cannot be reached from the keyboard, and hover alone leaves
 * every touch reader with a decoration they cannot open. So all three ways
 * in are wired: hover for a mouse, focus for a keyboard, and a press for
 * everything, which is the one that makes it work under a thumb.
 *
 * Hover is bound to a mouse pointer specifically. A touch that lands on the
 * button fires `pointerenter` too, and left ungated the bubble would open on
 * touch down and close again on the press it was already opening for.
 *
 * The bubble is always in the DOM and only made invisible, for two reasons:
 * `aria-describedby` then reads with the button whatever state it is in, and
 * an element with a box can be measured, which is what the clamp below
 * needs. It never takes pointer events, so moving off the button always
 * closes it and nothing can be hovered on the way out.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { TERIMLER } from "@/lib/terms";
import type { TerimAdi } from "@/lib/terms";

/** Keep this much of the viewport clear on either side of the bubble. */
const EDGE = 12;

export function InfoTip({ term }: { term: TerimAdi }) {
  const { ad, aciklama } = TERIMLER[term];
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const id = useId();

  /**
   * Slide the bubble back on screen when centring would hang it off an edge.
   *
   * Measured rather than guessed: these sit in headings, in metric cards and
   * next to a control at the right edge of a chart, and where an 18rem box
   * centred on a 4.5rem icon lands depends entirely on the screen under it.
   *
   * Written straight onto the node instead of held in state, and it owns the
   * centring as well as the correction rather than sharing it with a utility
   * class. One property, set in one place: the two composing would put the
   * bubble half its own width off to the left, and only on the screens where
   * the correction fires. The bubble is invisible until this has run, so
   * there is nothing to see before it does.
   */
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    // Back to centred first, so each open measures from the same place
    // rather than from wherever the last one left it.
    el.style.translate = "-50%";
    if (!open) return;

    const box = el.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE);
    const under = EDGE - box.left;
    const delta = over > 0 ? -over : under > 0 ? under : 0;
    if (delta !== 0) el.style.translate = `calc(-50% + ${delta}px)`;
  }, [open]);

  // Escape closes, and so does a press anywhere else. Without the second one
  // a bubble opened by touch has no way of being dismissed by touch.
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span ref={wrap} className="relative ml-1.5 inline-flex align-[-0.15em]">
      <button
        type="button"
        aria-label={`${ad} nedir?`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((it) => !it)}
        onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}
        // Keyboard focus opens it. A focus that arrived from a press must not,
        // and the test is the whole reason the press works at all: focus fires
        // first and opens the bubble, then the click toggles the state focus
        // just set, and the two cancel each other out. On a mouse that only
        // costs a click; on a touch screen, where there is no hover to fall
        // back on, it means the first tap on any tip does nothing at all.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="grid size-4.5 place-items-center rounded-full text-ink-subtle transition-colors hover:text-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-full"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16.5v-5M12 8.2h.01" />
        </svg>
      </button>

      {/* The type utilities are reset rather than inherited: these sit inside
          labels and headings, which carry weight, tracking and sometimes
          upper case, and a definition set in a heading's letter spacing is a
          definition nobody finishes. */}
      <span
        ref={bubble}
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-40 w-72 max-w-[min(18rem,calc(100vw-1.5rem))] rounded-control border border-border bg-surface-raised px-4 py-3 text-left font-sans text-caption font-normal normal-case tracking-normal shadow-lg transition-opacity duration-150 ease-out-soft motion-reduce:transition-none ${
          open ? "opacity-100" : "invisible opacity-0"
        }`}
      >
        <span className="block text-label text-ink">{ad}</span>
        <span className="mt-1 block text-caption text-ink-muted text-pretty">
          {aciklama}
        </span>
      </span>
    </span>
  );
}
