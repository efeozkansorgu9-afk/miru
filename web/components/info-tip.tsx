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
 * The bubble is portalled into `document.body` and placed by floating-ui,
 * the site's rule for every overlay (see CLAUDE.md). It used to be an
 * absolutely positioned child with `z-40`, which painted under any later
 * `Reveal` sibling and, being in the flow's box, pushed the page 77px wider
 * than a 390px phone whenever a tip sat near the right edge — invisible or
 * not, an invisible box still has a width. `shift` now keeps it on screen,
 * which the hand-written clamp used to do.
 *
 * The definition screen readers hear lives in a visually hidden span beside
 * the button, so `aria-describedby` reads with the button whatever state the
 * bubble is in; the bubble itself is `aria-hidden` and mounted only while
 * open. It never takes pointer events, so moving off the button always
 * closes it and nothing can be hovered on the way out.
 */

import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TERIMLER } from "@/lib/terms";
import type { TerimAdi } from "@/lib/terms";

/** Keep this much of the viewport clear on either side of the bubble. */
const EDGE = 12;

export function InfoTip({ term }: { term: TerimAdi }) {
  const { ad, aciklama } = TERIMLER[term];
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Elements held in state rather than read off `refs` during render, which
  // the React compiler's lint rightly refuses.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [floating, setFloating] = useState<HTMLSpanElement | null>(null);
  const { floatingStyles } = useFloating({
    placement: "bottom",
    open,
    elements: { reference: anchor, floating },
    whileElementsMounted: autoUpdate,
    transform: false,
    middleware: [offset(8), flip({ padding: EDGE }), shift({ padding: EDGE })],
  });

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
    <span ref={wrap} className="ml-1.5 inline-flex align-[-0.15em]">
      <button
        ref={setAnchor}
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
      <span id={id} className="sr-only">
        {aciklama}
      </span>

      {/* The type utilities are reset rather than inherited: the body is
          portalled, but the reset is kept explicit so the bubble never
          depends on where in the tree it happens to be mounted. The family is
          inherited from `body`, which carries the fallback stack. */}
      {open &&
        createPortal(
          <span
            ref={setFloating}
            aria-hidden="true"
            style={floatingStyles}
            className="pointer-events-none z-50 block w-72 max-w-[calc(100vw-1.5rem)] rounded-control border border-border bg-surface-raised px-4 py-3 text-left text-caption font-normal normal-case tracking-normal shadow-lg motion-safe:animate-[tip-in_150ms_ease-out]"
          >
            <span className="block text-label text-ink">{ad}</span>
            <span className="mt-1 block text-caption text-ink-muted text-pretty">
              {aciklama}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
