"use client";

/**
 * A section that settles into place as it scrolls in.
 *
 * Movement only, never a fade, and started early. The observer fires while
 * the section is still half a screen below the fold, and `settle`
 * lifts it half a line into place in half a second, so by the time it is
 * on screen it has almost always stopped. A section already on screen when
 * the page opened does not move at all (`data-shown="now"`).
 *
 * Two earlier versions felt wrong and were measured before this one.
 * `ScrollRise` tied opacity to the scroll position, so anything near the
 * bottom of the screen was always half transparent. The first `Appear`
 * faded in from nothing once the section was 8% inside the screen, so the
 * reader scrolled onto an empty band and watched it fill — which read as
 * the site struggling to keep up.
 *
 * Nothing starts hidden, so there is nothing for a missing bundle to leave
 * invisible, and reduced motion gets no animation (`globals.css`). The
 * animation fills backwards only: when it ends the element carries no
 * transform, so it creates no stacking context — the trap `CLAUDE.md`
 * describes for the old primitives. Overlays still go through a portal.
 *
 * `stagger` moves the direct children one after another, 40 ms apart.
 */

import { useEffect, useRef } from "react";

export function Appear({
  as: Tag = "div",
  stagger = false,
  id,
  labelledBy,
  className,
  children,
}: {
  as?: "div" | "section" | "ul" | "ol";
  stagger?: boolean;
  id?: string;
  labelledBy?: string;
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
            // Already on screen when the page opened (a reload half way
            // down, an anchor link): no movement at all, since there is
            // nothing to arrive. Otherwise it is still below the fold and
            // settles out of sight.
            el.dataset.shown = e.boundingClientRect.top < window.innerHeight ? "now" : "";
            io.disconnect();
          }
        }
      },
      // Fires while the section is still half a screen *below* the
      // fold, so the movement is nearly over by the time it scrolls in. The
      // first version fired only once the section was 8% inside the screen:
      // the reader scrolled onto an empty band and then watched it fill,
      // which read as the site lagging behind the scroll.
      { rootMargin: "0px 0px 50% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      id={id}
      aria-labelledby={labelledBy}
      data-appear={stagger ? "stagger" : ""}
      className={className}
    >
      {children}
    </Tag>
  );
}
