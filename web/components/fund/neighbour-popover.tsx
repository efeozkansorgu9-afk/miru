"use client";

/**
 * A neighbour row: a link to that fund, and a preview of it under the cursor.
 *
 * The row *is* the link. That is the whole shape of this component, and the
 * two things that used to be wrong here both come from it not having been.
 *
 * Before, the name was a `<button>` that opened a card, and the only way to
 * reach the fund was a "Sayfasına git" link *inside* that card. So when the
 * card stopped painting, the section lost both its preview and its
 * navigation at once — twenty funds listed and no way to open any of them.
 * A row that is a link cannot fail that way: the press works whether or not
 * the preview does, and the 20 links per page that tie 1372 fund pages
 * together are now in the markup rather than inside a `visibility: hidden`
 * card.
 *
 * It also removes the reason the old wiring was so delicate. There is no
 * button inside a link (which is invalid, and which a keyboard reaches
 * twice), the card no longer has to be enterable by a mouse — so it takes
 * `pointer-events: none` and can never eat the click it sits on top of —
 * and the hover bridge, the containment test on blur and the focus/click
 * cancellation are all gone with it.
 *
 * **The card is rendered through a portal, and it has to be.** Measured on
 * 2026-09-09: the card was in the DOM, `visibility: visible`, `opacity: 1`,
 * with a real 320x246 box, and still invisible, because the row's own
 * `min-w-0 flex-1 truncate` span clips it — `overflow: hidden` on a box
 * 715x26. That span is there to shorten long fund titles and it clipped the
 * absolutely positioned card along with the text.
 *
 * Note what that is *not*: it is not the stacking-context trap in
 * `CLAUDE.md`. The `.scroll-rise` ancestor does hold a permanent stacking
 * context, and it would have bitten next, but here `z-40` was never the
 * problem — `overflow: hidden` clips regardless of z-index, so no number
 * would have fixed it. The portal is the fix for both, which is why the rule
 * is "put it in a portal" and not "raise the z-index".
 *
 * Touch gets the better half of the deal: a tap navigates instead of opening
 * a card it then has to dismiss, and everything the card says is on the page
 * it opens.
 */

import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import type { Neighbour } from "@/lib/api";
import { korelasyon, paraKisa, sayi, yuzdeIsaretli } from "@/lib/format";
import { gosterilecekGetiriler } from "@/lib/fund";
import { fundHref } from "@/lib/site";

export function NeighbourRow({
  komsu,
  children,
}: {
  komsu: Neighbour;
  /** The row's contents — code, name, bucket and coefficient. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  /**
   * Anchored by floating-ui rather than by `position: absolute`, because in
   * the body the card has no clipping ancestor to escape from and nothing to
   * be painted behind. `autoUpdate` keeps it under the row while the page
   * scrolls, which absolute positioning gave for free and a portal does not.
   *
   * `transform: false` for the same reason the search list uses it: the card
   * animates its own opacity and a transform here would be one more writer
   * of the same property. Positioning through `top`/`left` keeps them apart.
   */
  const { refs, floatingStyles } = useFloating<HTMLAnchorElement>({
    open,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    transform: false,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  // Escape closes it. There is no outside-press handler and no need for one:
  // the card cannot be pressed, and anything that takes the pointer or the
  // focus away from the row closes it already.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Link
        ref={refs.setReference}
        href={fundHref(komsu.fund.code)}
        aria-describedby={open ? id : undefined}
        className="flex h-12 items-center gap-3 px-6 transition-colors hover:bg-canvas-sunken focus-visible:bg-canvas-sunken sm:gap-4"
        // Hover is bound to a mouse. A touch fires `pointerenter` too, and
        // opening a card on the way to a navigation nobody cancelled is a
        // flash of something the reader did not ask for.
        onPointerEnter={(event) =>
          event.pointerType === "mouse" && setOpen(true)
        }
        onPointerLeave={(event) =>
          event.pointerType === "mouse" && setOpen(false)
        }
        // `:focus-visible` so a press does not also open it. A mouse press
        // focuses the link, and a card appearing under a pointer that is
        // already leaving for another page is noise.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </Link>

      <Preview
        id={id}
        komsu={komsu}
        open={open}
        setFloating={refs.setFloating}
        floatingStyles={floatingStyles}
      />
    </>
  );
}

function Preview({
  id,
  komsu,
  open,
  setFloating,
  floatingStyles,
}: {
  id: string;
  komsu: Neighbour;
  open: boolean;
  setFloating: (node: HTMLElement | null) => void;
  floatingStyles: React.CSSProperties;
}) {
  // `createPortal` needs a real `document`, which the server render has not
  // got. Tested directly rather than through a mounted flag: the closed card
  // renders nothing on either side, so there is no hydration mismatch to
  // avoid. The card is not in the server HTML at all now — it never carried
  // anything a crawler needed, and what it used to carry (the link) is the
  // row itself.
  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      id={id}
      role="tooltip"
      ref={setFloating}
      style={floatingStyles}
      // `pointer-events: none` is what makes the rest of this simple. The
      // card sits over a link and has nothing to press, so it must not be
      // able to take a press, block one, or trigger a hover of its own.
      className="pointer-events-none z-50 w-80 max-w-[calc(100vw-1.5rem)] text-left font-sans text-caption font-normal normal-case tracking-normal"
    >
      <div className="rounded-control border border-border bg-surface-raised px-4 py-3 shadow-lg">
        {/* The full title, because the row truncates it and nothing a reader
            might need should exist only in the shortened form. */}
        <p className="text-label text-ink text-pretty">
          {komsu.fund.code} · {komsu.fund.name}
        </p>

        {/* The house. Two funds that overlap are usually two houses selling
            the same thing, and which houses is the part a reader acts on. */}
        <p
          className={`mt-1.5 text-caption ${
            komsu.fund.founder ? "text-ink-muted" : "text-ink-subtle"
          }`}
        >
          {komsu.fund.founder ?? "Kurucusu belirtilmemiş"}
        </p>

        <div className="mt-2 space-y-1 text-caption text-ink-muted tabular-nums">
          <GetiriSatirlari komsu={komsu} />
          <p>
            Yatırımcı:{" "}
            {komsu.fund.investor_count === null
              ? "—"
              : sayi(komsu.fund.investor_count)}{" "}
            · Büyüklük:{" "}
            {komsu.fund.total_assets === null
              ? "—"
              : paraKisa(komsu.fund.total_assets)}
          </p>
          <p>
            Güven aralığı: {aralik(komsu)} · {komsu.n_weeks} hafta
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Two return windows, and one line when there are none.
 *
 * Two, not all of them. There are four periods now and this is a card beside
 * a name, so it takes the shortest and the longest the neighbour actually
 * has — the recent picture and the long one, which is the pair that answers
 * "is this fund like the one I am reading about". The rest are one press
 * away on that fund's own page, where the selector is.
 *
 * A fund with no window at all still gets a line, because a card that
 * silently loses lines reads as though it failed to load.
 */
function GetiriSatirlari({ komsu }: { komsu: Neighbour }) {
  const usable = gosterilecekGetiriler(komsu.fund.returns);
  const rows =
    usable.length > 2 ? [usable[0], usable[usable.length - 1]] : usable;

  if (rows.length === 0) {
    return <p>Getirisi hesaplanamadı.</p>;
  }

  return (
    <>
      {rows.map((row) => (
        <p key={row.months}>
          {/* No window on these lines. Every fund's is the same one — it is
              anchored to the last published CPI month, not to the fund — so
              printing it here would repeat the returns section above four
              times over and read as though the return happened in that
              month. */}
          {row.months} ay:{" "}
          {row.nominal === null ? "—" : yuzdeIsaretli(row.nominal)} nominal ·{" "}
          {row.real === null ? "—" : yuzdeIsaretli(row.real)} reel
        </p>
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
