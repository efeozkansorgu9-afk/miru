"use client";

import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { paraKisa, sayi, yuzde, yuzdeEki } from "@/lib/format";
import type { Dilim } from "@/lib/market";

type Olcu = "fon" | "para";

/**
 * The market map's two share bars and their legend, as one interactive
 * figure.
 *
 * Pointing at a segment lifts it, dims the rest, and lights the same group
 * in the other bar and in the legend, so "4% of the funds, 21% of the
 * money" can be followed with the eye rather than read off two numbers.
 * A card with the group's composition and both shares opens beside it.
 *
 * The card is portalled into `document.body` and placed by floating-ui with
 * `transform: false` — the site's rule for every overlay (see CLAUDE.md):
 * the figure sits inside a `Reveal`, whose stacking context would otherwise
 * decide what paints over the card. Touch opens it with a tap; a tap
 * anywhere else, Escape, or leaving the bar closes it.
 *
 * The legend table stays the accessible reading of the chart. The segments
 * are focusable too, and focus opens the same card.
 */
export function PayCubugu({ dilimler }: { dilimler: Dilim[] }) {
  const toplam: Record<Olcu, number> = {
    fon: dilimler.reduce((a, d) => a + d.fon, 0),
    para: dilimler.reduce((a, d) => a + d.para, 0),
  };

  const [aktif, setAktif] = useState<{ anahtar: string; olcu: Olcu } | null>(null);
  const [capa, setCapa] = useState<HTMLElement | null>(null);
  const kartRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const { refs, floatingStyles } = useFloating({
    placement: "top",
    whileElementsMounted: autoUpdate,
    transform: false,
    middleware: [offset(12), flip({ padding: 8 }), shift({ padding: 8 })],
    elements: { reference: capa },
  });

  // Escape and a press outside both the segment and the card close it.
  useEffect(() => {
    if (!aktif) return;
    const tus = (e: KeyboardEvent) => e.key === "Escape" && setAktif(null);
    const bas = (e: PointerEvent) => {
      const t = e.target as Node;
      if (capa?.contains(t) || kartRef.current?.contains(t)) return;
      setAktif(null);
    };
    document.addEventListener("keydown", tus);
    document.addEventListener("pointerdown", bas);
    return () => {
      document.removeEventListener("keydown", tus);
      document.removeEventListener("pointerdown", bas);
    };
  }, [aktif, capa]);

  const ac = (anahtar: string, olcu: Olcu, el: HTMLElement) => {
    setCapa(el);
    setAktif({ anahtar, olcu });
  };

  const secili = aktif ? dilimler.find((d) => d.anahtar === aktif.anahtar) : null;

  const cubuk = (olcu: Olcu) => (
    <div
      className="flex h-9 w-full items-center gap-[2px]"
      onPointerLeave={(e) => e.pointerType === "mouse" && setAktif(null)}
    >
      {dilimler.map((d, i) => {
        const pay = toplam[olcu] > 0 ? d[olcu] / toplam[olcu] : 0;
        if (pay <= 0) return null;
        const bu = aktif?.anahtar === d.anahtar;
        const soluk = aktif !== null && !bu;
        return (
          <button
            key={d.anahtar}
            type="button"
            aria-label={`${d.etiket}${d.alt ? `, ${d.alt}` : ""}: ${
              olcu === "fon" ? "fonların" : "paranın"
            } ${yuzde(pay)}${yuzdeEki(pay)}`}
            className={`relative h-full min-w-[3px] cursor-pointer outline-none transition-[scale,opacity,filter,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none ${
              i === 0 ? "rounded-l-control" : ""
            } ${i === dilimler.length - 1 ? "rounded-r-control" : ""} ${
              bu ? "z-10 scale-y-[1.3] shadow-md" : ""
            } ${soluk ? "opacity-35 saturate-50" : ""}`}
            style={{ width: `${pay * 100}%`, background: d.renk }}
            onPointerEnter={(e) => e.pointerType === "mouse" && ac(d.anahtar, olcu, e.currentTarget)}
            // A tap opens it; a tap elsewhere closes it (the listener
            // above). Not a toggle: a tap also focuses the button, and a
            // toggle would open on focus and close on the click after it.
            onClick={(e) => ac(d.anahtar, olcu, e.currentTarget)}
            // Keyboard focus only; a mouse press already opened it.
            onFocus={(e) => {
              if (e.currentTarget.matches(":focus-visible")) ac(d.anahtar, olcu, e.currentTarget);
            }}
            onBlur={(e) => {
              if (e.currentTarget.matches(":focus-visible")) setAktif(null);
            }}
          />
        );
      })}
    </div>
  );

  return (
    <figure className="mt-12 rounded-card border border-border bg-surface px-5 py-6 sm:px-7">
      <figcaption className="text-lead font-semibold text-ink">
        Fonlar ve para gruplara nasıl dağılıyor
      </figcaption>
      <p className="mt-1 text-caption text-ink-subtle">
        Bir dilimin üzerine gelin ya da dokunun.
      </p>
      <div className="mt-6 grid gap-6">
        <div>
          <p className="mb-2 text-label text-ink-subtle">Fon sayısına göre</p>
          {cubuk("fon")}
        </div>
        <div>
          <p className="mb-2 text-label text-ink-subtle">Fon büyüklüğüne (paraya) göre</p>
          {cubuk("para")}
        </div>
      </div>

      <table className="mt-7 w-full table-fixed text-left">
        <thead>
          <tr className="border-b border-border text-label text-ink-subtle">
            <th scope="col" className="py-2 font-normal">Grup</th>
            <th scope="col" className="w-16 py-2 text-right font-normal sm:w-24">Fon payı</th>
            <th scope="col" className="w-16 py-2 text-right font-normal sm:w-24">Para payı</th>
          </tr>
        </thead>
        <tbody className="text-caption tabular-nums">
          {dilimler.map((d) => {
            const bu = aktif?.anahtar === d.anahtar;
            return (
              <tr
                key={d.anahtar}
                className={`border-b border-border transition-colors duration-200 last:border-b-0 ${
                  bu ? "bg-canvas-sunken" : ""
                }`}
              >
                <th scope="row" className="py-2 pr-3 pl-2 font-normal text-ink">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`size-3 shrink-0 rounded-[3px] transition-transform duration-200 ${bu ? "scale-125" : ""}`}
                      style={{ background: d.renk }}
                    />
                    <span className="min-w-0 truncate" title={d.alt ? `${d.etiket} · ${d.alt}` : d.etiket}>
                      {d.etiket}
                      {d.alt && <span className="ml-2 text-ink-subtle">{d.alt}</span>}
                    </span>
                  </span>
                </th>
                <td className="py-2 text-right text-ink-muted">
                  {toplam.fon > 0 ? yuzde(d.fon / toplam.fon) : "—"}
                </td>
                <td className="py-2 pr-2 text-right text-ink-muted">
                  {toplam.para > 0 ? yuzde(d.para / toplam.para) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-caption text-ink-subtle text-pretty">
        Yalnızca ölçülebilen fonlar. İlk altı grup en kalabalık olanlar;
        büyüklük TEFAS’ın son yayımladığı fon toplam değeri.
      </p>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {secili && aktif && (
              <motion.div
                key={secili.anahtar}
                ref={(node) => {
                  kartRef.current = node;
                  refs.setFloating(node);
                }}
                role="tooltip"
                style={floatingStyles}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none z-50 w-64 max-w-[calc(100vw-1.5rem)] font-sans"
              >
                <Kart d={secili} toplam={toplam} olcu={aktif.olcu} />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </figure>
  );
}

function Kart({
  d,
  toplam,
  olcu,
}: {
  d: Dilim;
  toplam: Record<Olcu, number>;
  olcu: Olcu;
}) {
  const fonPay = toplam.fon > 0 ? d.fon / toplam.fon : 0;
  const paraPay = toplam.para > 0 ? d.para / toplam.para : 0;

  const satir = (etiket: string, pay: number, deger: string, vurgu: boolean) => (
    <div className={`flex items-baseline justify-between gap-3 ${vurgu ? "text-ink" : "text-ink-muted"}`}>
      <span className="text-caption">{etiket}</span>
      <span className="tabular-nums">
        <span className={`text-body ${vurgu ? "font-semibold" : ""}`}>{yuzde(pay)}</span>
        <span className="ml-1.5 text-label text-ink-subtle">{deger}</span>
      </span>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-xl shadow-black/10">
      <div className="h-1" style={{ background: d.renk }} />
      <div className="px-4 pt-3 pb-3.5">
        <p className="text-label text-ink-subtle">{d.etiket}</p>
        <p className="mt-0.5 text-body font-semibold text-ink text-balance">
          {d.alt ?? d.etiket}
        </p>
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {satir("Fonların", fonPay, `${sayi(d.fon)} fon`, olcu === "fon")}
          {satir("Paranın", paraPay, paraKisa(d.para), olcu === "para")}
        </div>
      </div>
    </div>
  );
}
