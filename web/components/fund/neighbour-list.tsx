"use client";

/**
 * Every neighbour on record, as one list.
 *
 * One list, not two. The API keeps a high and a low set because that is how
 * the weekly job picked twenty out of fourteen hundred — the high end ranked
 * by each pair's worst case, the low end by its best — but that split is
 * about the selection, not about the funds, and putting it on screen would
 * ask a reader to hold two rankings at once to answer one question. So they
 * are merged and grouped by what each pair actually is.
 *
 * Folded, because twenty rows is the normal answer and is longer than the
 * rest of the page put together. The rule is in `lib/fund`: under eight
 * neighbours everything is open, at eight or more only the topmost group is,
 * and a group of more than five offers the rest behind a line.
 *
 * Collapsed content stays in the document. It is only given a height of
 * zero, never dropped from the tree, so the whole list is in the HTML this
 * page ships — which is what a crawler reads, and what a reader with no
 * JavaScript still gets. The same reason `Disclosure` is a native
 * `<details>`: a panel that is empty until a bundle arrives is a panel that
 * is sometimes empty.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import type { Neighbour } from "@/lib/api";
import { oran, kisalt } from "@/lib/format";
import { GRUP_ONIZLEME, KOVA_ETIKETLERI, acikGruplar, kovaGruplari } from "@/lib/fund";
import type { KovaGrubu } from "@/lib/fund";
import { NeighbourPopover } from "./neighbour-popover";

/** The one easing and duration everything on this page opens with. */
const GECIS = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

export function NeighbourList({ komsular }: { komsular: Neighbour[] }) {
  const gruplar = kovaGruplari(komsular);
  const acik = acikGruplar(gruplar);

  if (gruplar.length === 0) return null;

  return (
    <section aria-labelledby="komsular" className="scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Komşular</p>
      <h2 id="komsular" className="mt-4 text-display-sm text-balance">
        Bu fonla ölçülen {komsular.length} fon
      </h2>
      <p className="mt-3 max-w-prose text-caption text-ink-subtle text-pretty">
        Her fon haftalık getirileri üzerinden bütün fonlarla karşılaştırıldı; en
        güçlü ve en zayıf ilişkiler burada. Gruplandırma, korelasyonun kendisine
        değil güven aralığının fona karşı çıkan ucuna bakıyor — az sayıda ortak
        haftaya dayanan yüksek bir katsayı böylece öne geçemiyor.
      </p>

      <div className="mt-6 space-y-3">
        {gruplar.map((grup) => (
          <Group key={grup.kova} grup={grup} baslangictaAcik={acik.has(grup.kova)} />
        ))}
      </div>
    </section>
  );
}

function Group({
  grup,
  baslangictaAcik,
}: {
  grup: KovaGrubu;
  baslangictaAcik: boolean;
}) {
  const [acik, setAcik] = useState(baslangictaAcik);
  const [hepsi, setHepsi] = useState(false);
  const reduceMotion = useReducedMotion();

  const fazla = grup.komsular.length - GRUP_ONIZLEME;
  const gorunen = hepsi ? grup.komsular : grup.komsular.slice(0, GRUP_ONIZLEME);

  return (
    <div className="rounded-card border border-border bg-surface">
      <h3>
        <button
          type="button"
          onClick={() => setAcik((it) => !it)}
          aria-expanded={acik}
          className="flex w-full cursor-pointer items-center gap-3 rounded-card px-6 py-5 text-left"
        >
          <Chevron acik={acik} />
          <span className="text-display-sm">
            {grup.baslik}{" "}
            <span className="text-ink-subtle tabular-nums">
              ({grup.komsular.length})
            </span>
          </span>
        </button>
      </h3>

      <Fold acik={acik} baslangictaAcik={baslangictaAcik} reduceMotion={reduceMotion}>
        <div className="border-t border-border">
          <p className="px-6 pt-5 text-caption text-ink-subtle text-pretty">
            {grup.aciklama}
          </p>

          <ul className="mt-3">
            {gorunen.map((komsu) => (
              <Row key={komsu.fund.code} komsu={komsu} />
            ))}
          </ul>

          {/* The rest of a long group. Rendered whatever this says, so the
              names are in the HTML either way; what the line controls is
              whether they have a height. */}
          {fazla > 0 && (
            <>
              <Fold acik={hepsi} baslangictaAcik={false} reduceMotion={reduceMotion}>
                <ul>
                  {grup.komsular.slice(GRUP_ONIZLEME).map((komsu) => (
                    <Row key={komsu.fund.code} komsu={komsu} />
                  ))}
                </ul>
              </Fold>

              <button
                type="button"
                onClick={() => setHepsi((it) => !it)}
                aria-expanded={hepsi}
                className="w-full cursor-pointer border-t border-border px-6 py-3 text-left text-label text-accent transition-colors hover:bg-canvas-sunken"
              >
                {hepsi ? "Daha azını göster" : `${fazla} tane daha`}
              </button>
            </>
          )}
        </div>
      </Fold>
    </div>
  );
}

/**
 * The opening and closing itself.
 *
 * `initial` is the whole trick. A panel that starts open is mounted with no
 * inline style at all, so the server renders it at its natural height and
 * nothing moves on hydration; one that starts closed is mounted already at
 * zero, so the collapsed state is in the HTML rather than being applied a
 * moment after it arrives. Passing the same object to both would give a
 * closed panel that flashes open on every load.
 *
 * `inert` is what keeps a collapsed panel out of the tab order. Height zero
 * with hidden overflow hides content from the eye and from nothing else: a
 * keyboard would otherwise tab into fifteen fund names that are not on
 * screen.
 */
function Fold({
  acik,
  baslangictaAcik,
  reduceMotion,
  children,
}: {
  acik: boolean;
  baslangictaAcik: boolean;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  /**
   * Whether the panel has finished opening. Nothing else needs state.
   *
   * The clip is derived from it, and it has to be on for two different
   * stretches. While the panel is shut, obviously. And while it is opening,
   * because without it every row is visible from the first frame and the
   * panel merely grows underneath them — which is not a panel opening, it is
   * a box getting taller.
   *
   * It has to be off once the panel is open, because a neighbour card opens
   * downwards out of its row, and a row near the bottom of a group would
   * have its card cut in half by the group's own edge.
   *
   * Closing needs no state of its own: `acik` is already false on the frame
   * the animation starts, so the clip is back on before anything moves.
   */
  const [acildi, setAcildi] = useState(baslangictaAcik);

  return (
    <motion.div
      initial={baslangictaAcik ? false : { height: 0, opacity: 0 }}
      animate={{ height: acik ? "auto" : 0, opacity: acik ? 1 : 0 }}
      transition={reduceMotion ? { duration: 0 } : GECIS}
      onAnimationComplete={() => setAcildi(acik)}
      className={!acik || !acildi ? "overflow-hidden" : undefined}
      inert={!acik}
    >
      {children}
    </motion.div>
  );
}

/**
 * One neighbour.
 *
 * The name is the control: pressing it opens the card with that fund's size,
 * returns and the measurement behind the coefficient. The bucket label sits
 * next to it at full strength and the correlation behind it, small and
 * muted — the word is what the row is for, and the number is the evidence
 * under it rather than the finding.
 *
 * The founder is on its own line because two funds that overlap are usually
 * two houses selling the same thing, and which houses is the part a reader
 * acts on.
 */
function Row({ komsu }: { komsu: Neighbour }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-t border-border px-6 py-3 first:border-t-0">
      <div className="min-w-0">
        <NeighbourPopover komsu={komsu}>{kisalt(komsu.fund.name, 52)}</NeighbourPopover>
        <p className="mt-0.5 truncate text-caption text-ink-subtle">
          {komsu.fund.founder ?? "kurucusu belirtilmemiş"}
        </p>
      </div>

      <p className="flex items-baseline gap-3">
        <span className="rounded-control border border-border bg-canvas-sunken px-2.5 py-1 text-label text-ink">
          {KOVA_ETIKETLERI[komsu.bucket]}
        </span>
        <span className="text-caption tabular-nums text-ink-subtle">
          {oran(komsu.correlation)}
        </span>
      </p>
    </li>
  );
}

function Chevron({ acik }: { acik: boolean }) {
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
        acik ? "rotate-90" : ""
      }`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
