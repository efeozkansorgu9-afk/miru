"use client";

/**
 * What a neighbour is, one press away from its name.
 *
 * The same three ways in as `InfoTip`, for the same reason: hover for a
 * mouse, focus for a keyboard, and a press for everything, which is the one
 * that makes it work under a thumb. A hover-only card would leave every
 * touch reader with a fund name that does nothing, and a `title` attribute
 * never appears on a phone at all.
 *
 * Hover is bound to a mouse pointer specifically. A touch on the name fires
 * `pointerenter` too, and left ungated the card would open on touch down and
 * close again on the press it was already opening for.
 *
 * Four lines and no chart. This opens over a list someone is scanning, and
 * it exists to answer "what is that one" without leaving the page — the size
 * of the fund, what it returned, and how much measurement is behind the
 * coefficient in the row. Anything more and the reader has left the list
 * they were reading.
 *
 * Only one is ever open: a press anywhere outside closes this one, and a
 * press on another name is outside this one.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { Neighbour } from "@/lib/api";
import { korelasyon, paraKisa, sayi, yuzdeIsaretli } from "@/lib/format";
import { gosterilecekGetiriler } from "@/lib/fund";

/** Keep this much of the viewport clear on either side of the card. */
const EDGE = 12;

export function NeighbourPopover({
  komsu,
  children,
}: {
  komsu: Neighbour;
  /** The trigger's contents — the fund name as the row draws it. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const id = useId();

  /**
   * Slide the card back on screen when centring would hang it off an edge.
   *
   * Measured rather than guessed, and written straight onto the node rather
   * than held in state: the translate owns both the centring and the
   * correction, because composing the two with a utility class would put the
   * card half its own width to the left on exactly the screens where the
   * correction fires. Same mechanism as `InfoTip`.
   */
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    el.style.translate = "-50%";
    if (!open) return;

    const box = el.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE);
    const under = EDGE - box.left;
    const delta = over > 0 ? -over : under > 0 ? under : 0;
    if (delta !== 0) el.style.translate = `calc(-50% + ${delta}px)`;
  }, [open]);

  // Escape closes, and so does a press anywhere else. Without the second one
  // a card opened by touch has no way of being dismissed by touch.
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
    <span ref={wrap} className="relative inline-flex max-w-full">
      <button
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((it) => !it)}
        onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}
        // A focus that arrived from a press must not open it: focus fires
        // first, then the click toggles what focus just set, and the two
        // cancel out. On a touch screen, where there is no hover to fall back
        // on, that would mean the first tap on any row does nothing.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="max-w-full truncate text-left text-body text-ink underline decoration-border decoration-dotted underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
      >
        {children}
      </button>

      {/* Always in the DOM and only made invisible: `aria-describedby` then
          reads with the button whatever state it is in, and an element with a
          box can be measured, which is what the clamp above needs. It never
          takes pointer events, so moving off the name always closes it. */}
      <span
        ref={card}
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-40 w-80 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-control border border-border bg-surface-raised px-4 py-3 text-left font-sans text-caption font-normal normal-case tracking-normal shadow-lg transition-opacity duration-150 ease-out-soft motion-reduce:transition-none ${
          open ? "opacity-100" : "invisible opacity-0"
        }`}
      >
        {/* The full title, because the row truncates it and nothing a reader
            might need should exist only in the shortened form. */}
        <span className="block text-label text-ink text-pretty">
          {komsu.fund.code} · {komsu.fund.name}
        </span>

        <span className="mt-2 block space-y-1 text-caption text-ink-muted tabular-nums">
          <GetiriSatirlari komsu={komsu} />
          <span className="block">
            Yatırımcı:{" "}
            {komsu.fund.investor_count === null
              ? "—"
              : sayi(komsu.fund.investor_count)}{" "}
            · Büyüklük:{" "}
            {komsu.fund.total_assets === null
              ? "—"
              : paraKisa(komsu.fund.total_assets)}
          </span>
          <span className="block">
            Güven aralığı: {aralik(komsu)} · {komsu.n_weeks} hafta
          </span>
        </span>
      </span>
    </span>
  );
}

/**
 * One line per return window, and one line when there are none.
 *
 * A window with neither figure is dropped rather than printed as two
 * dashes; a fund with no window at all still gets a line, because a card
 * that silently loses two of its four lines reads as though it failed to
 * load.
 */
function GetiriSatirlari({ komsu }: { komsu: Neighbour }) {
  const rows = gosterilecekGetiriler(komsu.fund.returns);

  if (rows.length === 0) {
    return <span className="block">Getirisi hesaplanamadı.</span>;
  }

  return (
    <>
      {rows.map((row) => (
        <span key={row.months} className="block">
          {/* No window on these lines. Every fund's is the same one — it is
              anchored to the last published CPI month, not to the fund — so
              printing it here would repeat the returns section above four
              times over and read as though the return happened in that
              month. */}
          {row.months} ay:{" "}
          {row.nominal === null ? "—" : yuzdeIsaretli(row.nominal)} nominal ·{" "}
          {row.real === null ? "—" : yuzdeIsaretli(row.real)} reel
        </span>
      ))}
    </>
  );
}

/**
 * The 95% interval, as the two numbers it is.
 *
 * Separated by a dash rather than the comma the notation would use: the
 * decimal separator here is already a comma, and "(0,99, 1,00)" is four
 * commas in eleven characters.
 */
function aralik(komsu: Neighbour): string {
  if (komsu.ci_low === null || komsu.ci_high === null) return "hesaplanamadı";
  return `(${korelasyon(komsu.ci_low)} – ${korelasyon(komsu.ci_high)})`;
}
