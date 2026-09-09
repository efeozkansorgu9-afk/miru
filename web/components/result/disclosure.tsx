"use client";

/**
 * A panel that folds away.
 *
 * It used to be a native `<details>` animated through `::details-content`
 * with `interpolate-size: allow-keywords`. That animation only ever ran in
 * Chrome 129 and later: everywhere else the panel snapped open, which is
 * what "there is no opening animation" turned out to mean. The fold is
 * Framer Motion now, for the same reason and in the same shape as
 * `NeighbourList`'s — one house pattern for folding rather than two, and one
 * that works in every browser instead of degrading in most.
 *
 * The content stays mounted whether the panel is open or shut, at height
 * zero and `inert`. Height zero with hidden overflow hides content from the
 * eye and from nothing else, so without `inert` a keyboard would tab through
 * a heatmap and three tables that are not on screen.
 *
 * Losing `<details>` costs less here than it would elsewhere: this panel
 * only exists underneath a result the page computed client-side, so there
 * was never a no-JavaScript reader to keep it open for.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";

/** The one easing and duration this app opens things with. */
const GECIS = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

/** The sticky header is `h-16`; a little under it so the panel is not flush. */
const HEADER_GAP = 80;

/** Breathing room under the last line when the whole panel does fit. */
const EDGE_GAP = 16;

export function Disclosure({
  summary,
  hint,
  children,
}: {
  summary: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const id = useId();

  /**
   * Bring the panel into view, but only if it is not already.
   *
   * This one is long — a heatmap and three tables — and it opens from a
   * summary that is usually near the bottom of a scrolled page, so opening
   * it used to leave the reader looking at the same screen while everything
   * they asked for unfolded below the fold.
   *
   * Run after the height animation rather than with it: while the panel is
   * still growing, every measurement is of a box that is not its final size,
   * and the scroll would be computed against a box that no longer exists.
   *
   * `scrollIntoView({ block: "nearest" })` is what this asked for and it is
   * wrong here, which was measured rather than reasoned about: this panel is
   * around 1800px against a 900px viewport, and `nearest` on a box taller
   * than the scrollport brings its *bottom* edge into view. Opening it threw
   * the page down 2458px, past everything the reader had just asked to see,
   * and left the top of the panel above the window.
   *
   * So the scroll is computed instead: move by the least that reveals the
   * last line, and never by so much that the panel's own first line leaves
   * the screen. A short panel gets the minimal nudge that was wanted all
   * along; a long one stops with its top under the header, which is where
   * a panel of tables has to start.
   */
  function revealIfNeeded() {
    const el = panel.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    // Already fully on screen: scrolling would move the page under someone
    // who can see everything they just opened.
    if (box.bottom <= window.innerHeight) return;

    const needed = box.bottom - window.innerHeight + EDGE_GAP;
    // How far the page can move before the panel's top passes under the
    // sticky header. Negative when the top is already there or above it.
    const allowed = box.top - HEADER_GAP;
    const delta = Math.min(needed, allowed);
    if (delta <= 0) return;

    window.scrollBy({
      top: delta,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  /**
   * The reduced-motion path's own trigger.
   *
   * `onAnimationComplete` is the right signal when there is an animation to
   * complete, and it does not fire at all for the zero-duration transition
   * reduced motion asks for. Measured: the panel opened to its full 1789px
   * and the page never moved, so a reader who has asked for less movement
   * got none of the movement that was the point. One frame is enough here —
   * the height is applied synchronously, and `requestAnimationFrame` only
   * has to outlast layout rather than an animation.
   */
  useEffect(() => {
    if (!open || !reduceMotion) return;
    const frame = requestAnimationFrame(revealIfNeeded);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reduceMotion]);

  return (
    <div className="rounded-card border border-border bg-surface">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((it) => !it)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full cursor-pointer items-center gap-3 rounded-card px-6 py-5 text-left"
        >
          <Chevron open={open} />
          <span className="text-display-sm">{summary}</span>
          {hint && (
            <span className="ml-auto hidden text-caption text-ink-subtle sm:block">
              {hint}
            </span>
          )}
        </button>
      </h3>

      <motion.div
        id={id}
        ref={panel}
        // Mounted closed on the first render rather than animated shut after
        // it, so the panel cannot flash open while the page is arriving.
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={reduceMotion ? { duration: 0 } : GECIS}
        onAnimationComplete={() => open && revealIfNeeded()}
        className="overflow-hidden"
        inert={!open}
      >
        <div className="border-t border-border px-6 py-8">{children}</div>
      </motion.div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-5 shrink-0 text-ink-subtle transition-transform duration-300 ease-out-soft motion-reduce:transition-none ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
