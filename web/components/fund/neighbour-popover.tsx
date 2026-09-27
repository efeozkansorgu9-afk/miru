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
import { createContext, useContext, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import type { Bucket, Neighbour, WeeklySeries } from "@/lib/api";
import { korelasyon, paraKisa, sayi, yuzdeIsaretli } from "@/lib/format";
import { ucretOrani } from "@/lib/fee";
import { periodLabel } from "@/lib/fund-chart";
import { KOVA_ETIKETLERI, gosterilecekGetiriler } from "@/lib/fund";
import { sparkLines } from "@/lib/neighbour-chart";
import { fundHref } from "@/lib/site";

/**
 * The fund whose page this is, for the cards to draw it beside each
 * neighbour. A context rather than a prop threaded through the list, the
 * group and the row, none of which has any use for it.
 */
interface Subject {
  code: string;
  series: WeeklySeries | null;
}

const SubjectContext = createContext<Subject | null>(null);

export function SubjectProvider({
  code,
  series,
  children,
}: Subject & { children: React.ReactNode }) {
  return (
    <SubjectContext.Provider value={{ code, series }}>
      {children}
    </SubjectContext.Provider>
  );
}

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
  // Elements held in state rather than read off `refs` during render, which
  // the React compiler's lint refuses (the same pattern as `InfoTip`).
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null);
  const [floating, setFloatingEl] = useState<HTMLElement | null>(null);
  const { floatingStyles } = useFloating<HTMLAnchorElement>({
    open,
    elements: { reference: anchor, floating },
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
        ref={setAnchor}
        href={fundHref(komsu.fund.code)}
        aria-describedby={open ? id : undefined}
        className="flex h-12 items-center gap-3 px-5 transition-colors hover:bg-canvas-sunken/70 focus-visible:bg-canvas-sunken sm:gap-4"
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
        setFloating={setFloatingEl}
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
  const subject = useContext(SubjectContext);

  // `createPortal` needs a real `document`, which the server render has not
  // got. Tested directly rather than through a mounted flag: the closed card
  // renders nothing on either side, so there is no hydration mismatch to
  // avoid. The card is not in the server HTML at all — it never carried
  // anything a crawler needed, and the link is the row itself.
  if (typeof document === "undefined" || !open) return null;

  const ton = TONLAR[yon(komsu.bucket)];

  return createPortal(
    <div
      id={id}
      role="tooltip"
      ref={setFloating}
      style={floatingStyles}
      // `pointer-events: none` is what makes the rest of this simple. The
      // card sits over a link and has nothing to press, so it must not be
      // able to take a press, block one, or trigger a hover of its own.
      className="pointer-events-none z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] text-left font-sans text-caption font-normal normal-case tracking-normal"
    >
      <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-xl shadow-black/10">
        {/* A band of the pair's own tint across the top: purple for funds
            that move with this one, teal for the ones that move against it,
            grey for the rest. The same split as the heatmap on the basket
            page, and deliberately not green or red — a close neighbour is
            not good news and a distant one is not bad. */}
        <div className={`h-1 ${ton.serit}`} />

        <div className="px-4 pt-3.5 pb-4">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-control px-2 py-0.5 font-mono text-label font-medium ${ton.rozet}`}
            >
              {komsu.fund.code}
            </span>
            <span className="text-label text-ink-muted">
              {KOVA_ETIKETLERI[komsu.bucket]} · r {korelasyon(komsu.correlation)}
            </span>
          </div>

          {/* The full title, because the row truncates it and nothing a
              reader might need should exist only in the shortened form. */}
          <p className="mt-2 text-label font-medium text-ink text-pretty">
            {komsu.fund.name}
          </p>
          {/* The house. Two funds that overlap are usually two houses selling
              the same thing, and which houses is the part a reader acts on. */}
          <p
            className={`mt-0.5 text-caption ${
              komsu.fund.founder ? "text-ink-muted" : "text-ink-subtle"
            }`}
          >
            {komsu.fund.founder ?? "Kurucusu belirtilmemiş"}
          </p>

          <Grafik komsu={komsu} subject={subject} />

          <GetiriKutulari komsu={komsu} />

          <Olcek komsu={komsu} ton={ton} />

          <p className="mt-3 border-t border-border pt-2.5 text-caption text-ink-subtle tabular-nums">
            Yatırımcı{" "}
            <span className="text-ink-muted">
              {komsu.fund.investor_count === null
                ? "—"
                : sayi(komsu.fund.investor_count)}
            </span>{" "}
            · Büyüklük{" "}
            <span className="text-ink-muted">
              {komsu.fund.total_assets === null
                ? "—"
                : paraKisa(komsu.fund.total_assets)}
            </span>
            {komsu.fund.fee && (
              <>
                {" "}
                · {komsu.fund.fee.kind === "operating" ? "İşletim gideri" : "Ücret"}{" "}
                <span className="text-ink-muted">
                  {komsu.fund.fee.rate === 0 ? "sıfır bildirilmiş" : `${ucretOrani(komsu.fund.fee.rate)} / yıl`}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

type Yon = "birlikte" | "ters" | "notr";

/** Which way the pair leans, which is all the colour says. */
function yon(bucket: Bucket): Yon {
  if (bucket === "overlapping" || bucket === "similar") return "birlikte";
  if (bucket === "inverse") return "ters";
  return "notr";
}

const TONLAR: Record<
  Yon,
  { serit: string; rozet: string; bant: string; nokta: string }
> = {
  birlikte: {
    serit: "bg-accent",
    rozet: "bg-accent-surface text-accent",
    bant: "fill-accent/30",
    nokta: "fill-accent",
  },
  ters: {
    serit: "bg-series-alt",
    rozet: "bg-series-alt/15 text-ink",
    bant: "fill-series-alt/30",
    nokta: "fill-series-alt",
  },
  notr: {
    serit: "bg-border-strong",
    rozet: "bg-canvas-sunken text-ink",
    bant: "fill-ink-subtle/25",
    nokta: "fill-ink-muted",
  },
};

/* ------------------------------------------------------------------ */
/* The two lines                                                       */
/* ------------------------------------------------------------------ */

const W = 320;
const H = 88;

/**
 * The neighbour's last year beside this fund's, both from 100.
 *
 * This is the picture of what the coefficient claims: two lines that lie on
 * top of each other, or do not. It is a year, not the window the pair was
 * measured on, and the caption says so rather than letting one stand for
 * the other.
 *
 * This fund keeps the accent it wears in the returns chart above, so the
 * same fund is the same colour on the whole page; the neighbour takes the
 * chart pair's second hue. A key under the chart names both, so neither is
 * told apart by colour alone.
 */
function Grafik({
  komsu,
  subject,
}: {
  komsu: Neighbour;
  subject: Subject | null;
}) {
  const lines = sparkLines(subject?.series ?? null, komsu.recent, W, H);
  if (!lines) return null;

  return (
    <figure className="mt-3 rounded-control bg-canvas-sunken px-2 pt-2 pb-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[5.5rem] w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={W}
          y1={lines.baseY}
          y2={lines.baseY}
          stroke="var(--border-strong)"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        {lines.subject && (
          <path
            d={lines.subject}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={lines.neighbour}
          fill="none"
          stroke="var(--series-alt)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-label text-ink-muted">
        {lines.subject && subject && (
          <Anahtar renk="bg-accent" etiket={`${subject.code} (bu fon)`} />
        )}
        <Anahtar renk="bg-series-alt" etiket={komsu.fund.code} />
        <span className="ml-auto text-ink-subtle">
          Son {lines.weeks} hafta · 100&apos;den
        </span>
      </figcaption>
    </figure>
  );
}

function Anahtar({ renk, etiket }: { renk: string; etiket: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`h-0.5 w-3 rounded-full ${renk}`} />
      {etiket}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

/**
 * Two return windows as two tiles, and one line when there are none.
 *
 * Two, not all of them: this is a card beside a name, so it takes the
 * shortest and the longest the neighbour actually has — the recent picture
 * and the long one. The rest are one press away on that fund's own page.
 *
 * Green and red here, unlike the band above: a return is money, and the
 * rest of the site already paints money that way.
 *
 * A fund with no window at all still gets a line, because a card that
 * silently loses lines reads as though it failed to load.
 */
function GetiriKutulari({ komsu }: { komsu: Neighbour }) {
  const usable = gosterilecekGetiriler(komsu.fund.returns);
  const rows =
    usable.length > 2 ? [usable[0], usable[usable.length - 1]] : usable;

  if (rows.length === 0) {
    return (
      <p className="mt-3 text-caption text-ink-subtle">
        Getirisi hesaplanamadı.
      </p>
    );
  }

  return (
    <div className={`mt-3 grid gap-2 ${rows.length > 1 ? "grid-cols-2" : ""}`}>
      {rows.map((row) => (
        <div
          key={row.months}
          className="rounded-control border border-border px-3 py-2 tabular-nums"
        >
          <p className="text-label text-ink-subtle">{periodLabel(row.months)}</p>
          <p className={`mt-0.5 text-body font-semibold ${renkli(row.nominal)}`}>
            {row.nominal === null ? "—" : yuzdeIsaretli(row.nominal)}
          </p>
          <p className="text-label text-ink-subtle">
            reel{" "}
            <span className={`font-medium ${renkli(row.real)}`}>
              {row.real === null ? "—" : yuzdeIsaretli(row.real)}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

function renkli(x: number | null): string {
  if (x === null || x === 0) return "text-ink-muted";
  return x > 0 ? "text-positive" : "text-negative";
}

/* ------------------------------------------------------------------ */
/* Where the pair sits                                                 */
/* ------------------------------------------------------------------ */

/**
 * The coefficient on its whole range, −1 to 1, with the 95% interval as a
 * band around it. The band is the point: the grouping reads the end of it
 * that argues against the claim, and a wide band on few weeks looks wide.
 */
function Olcek({
  komsu,
  ton,
}: {
  komsu: Neighbour;
  ton: (typeof TONLAR)[Yon];
}) {
  const w = 320;
  const x = (r: number) => 6 + ((r + 1) / 2) * (w - 12);
  const hasBand = komsu.ci_low !== null && komsu.ci_high !== null;

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${w} 22`} className="block h-[22px] w-full" aria-hidden="true">
        <line x1={x(-1)} x2={x(1)} y1={11} y2={11} stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" />
        {[-1, 0, 1].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={6} y2={16} stroke="var(--border-strong)" strokeWidth={1} />
        ))}
        {hasBand && (
          <rect
            x={x(komsu.ci_low!)}
            width={Math.max(x(komsu.ci_high!) - x(komsu.ci_low!), 3)}
            y={5}
            height={12}
            rx={3}
            className={ton.bant}
          />
        )}
        <circle
          cx={x(komsu.correlation)}
          cy={11}
          r={5}
          className={ton.nokta}
          stroke="var(--surface-raised)"
          strokeWidth={2}
        />
      </svg>
      <div className="mt-0.5 flex justify-between text-label text-ink-subtle tabular-nums">
        <span>−1 ters</span>
        <span>0</span>
        <span>1 aynı</span>
      </div>
      <p className="mt-1 text-caption text-ink-muted tabular-nums">
        Güven aralığı {aralik(komsu)} · {komsu.n_weeks} hafta
      </p>
    </div>
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
  return `${korelasyon(komsu.ci_low)} – ${korelasyon(komsu.ci_high)}`;
}
