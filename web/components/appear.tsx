"use client";

/**
 * A section that eases into place the first time it scrolls into view.
 *
 * Replaces `ScrollRise` on the pages that use it. That one tied opacity to
 * the scroll position, linearly, over the first 45% of a section's entry, so
 * whatever sat near the bottom of the screen was always half transparent:
 * a heading read as grey until it had been scrolled a third of the way up,
 * and a reader who stopped scrolling stopped the fade with it. This plays
 * once, on a clock, and is finished before anyone has started reading.
 *
 * ## Nothing hidden that JavaScript has to reveal
 *
 * The hidden starting state only applies under `html.motion-ok`, a class the
 * inline `motionScript` sets before first paint. The class says only that
 * JavaScript runs; the observer below is what reveals, and if its bundle
 * never arrives a CSS fallback reveals everything after a few seconds
 * anyway (`globals.css`, `appear-failsafe`). Reduced motion never hides
 * anything in the first place.
 *
 * ## No permanent stacking context
 *
 * A transition, not a filled animation. When it ends, the computed
 * transform is `none` and opacity is 1, so the section creates no stacking
 * context and an overlay inside it is not trapped under its later siblings —
 * the problem `CLAUDE.md` describes for `Reveal` and `ScrollRise`. Overlays
 * still go through a portal; this just stops adding reasons they must.
 *
 * `stagger` animates the direct children one after another instead of the
 * block as a whole, 70 ms apart.
 */

import { useEffect, useRef } from "react";

export function Appear({
  as: Tag = "div",
  stagger = false,
  className,
  children,
}: {
  as?: "div" | "section" | "ul" | "ol";
  stagger?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.shown = "";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.dataset.shown = "";
            io.disconnect();
          }
        }
      },
      // Fires a little before the section's top edge is fully in view, so
      // the movement is under way as it arrives rather than after.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-appear={stagger ? "stagger" : ""}
      className={className}
    >
      {children}
    </Tag>
  );
}
