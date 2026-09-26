"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { korelasyon } from "@/lib/format";
import { KOVA_ETIKETLERI } from "@/lib/fund";
import type { OrnekVeri } from "@/lib/home-examples";
import { ORNEK_H, ORNEK_W } from "@/lib/home-examples";
import { fundHref } from "@/lib/site";

/** How long each card stays up. */
const SURE_MS = 5000;

/**
 * The home page's example pairs, one at a time, changing every five seconds.
 *
 * Every card is in the server HTML, stacked in one grid cell so the box is
 * as tall as the tallest card and nothing below it jumps when they change.
 * Only the current one is visible; the rest are `inert` and hidden from
 * assistive technology.
 *
 * Auto-advancing content has to be stoppable (WCAG 2.2.2), so it:
 * - pauses while the pointer is over the card or focus is inside it,
 * - pauses while the tab is hidden,
 * - never starts for a reader who asked for reduced motion,
 * - has a pause button and a dot per card to go straight to one.
 */
export function OrnekCarousel({ ornekler }: { ornekler: OrnekVeri[] }) {
  const [aktif, setAktif] = useState(0);
  const [durduruldu, setDurduruldu] = useState(false);
  const [uzerinde, setUzerinde] = useState(false);
  const [azHareket, setAzHareket] = useState(false);
  const [gorunur, setGorunur] = useState(true);
  const kutu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const guncelle = () => setAzHareket(mq.matches);
    guncelle();
    mq.addEventListener("change", guncelle);
    const gorunurluk = () => setGorunur(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", gorunurluk);
    return () => {
      mq.removeEventListener("change", guncelle);
      document.removeEventListener("visibilitychange", gorunurluk);
    };
  }, []);

  const donuyor =
    ornekler.length > 1 && !durduruldu && !uzerinde && !azHareket && gorunur;

  useEffect(() => {
    if (!donuyor) return;
    const t = window.setTimeout(
      () => setAktif((i) => (i + 1) % ornekler.length),
      SURE_MS,
    );
    return () => window.clearTimeout(t);
  }, [donuyor, aktif, ornekler.length]);

  if (ornekler.length === 0) return null;

  return (
    <div
      ref={kutu}
      role="region"
      aria-roledescription="döngü"
      aria-label="Son ölçümden örnekler"
      onPointerEnter={(e) => e.pointerType === "mouse" && setUzerinde(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setUzerinde(false)}
      onFocus={() => setUzerinde(true)}
      onBlur={(e) => {
        if (!kutu.current?.contains(e.relatedTarget as Node | null)) setUzerinde(false);
      }}
    >
      <div className="grid">
        {ornekler.map((o, i) => {
          const acik = i === aktif;
          return (
            <div
              key={o.anahtar}
              aria-hidden={!acik}
              inert={!acik}
              aria-roledescription="örnek"
              aria-label={`${i + 1} / ${ornekler.length}`}
              className={`col-start-1 row-start-1 transition-opacity duration-500 ease-out motion-reduce:transition-none ${
                acik ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <Kart o={o} />
            </div>
          );
        })}
      </div>

      {ornekler.length > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-1.5">
            {ornekler.map((o, i) => (
              <button
                key={o.anahtar}
                type="button"
                onClick={() => setAktif(i)}
                aria-label={`Örnek ${i + 1}: ${o.kod} ile ${o.komsuKod}`}
                aria-current={i === aktif ? "true" : undefined}
                className="group flex h-6 items-center"
              >
                <span
                  className={`relative block h-1.5 overflow-hidden rounded-full bg-border-strong transition-all duration-300 ${
                    i === aktif ? "w-8" : "w-1.5 group-hover:bg-ink-subtle"
                  }`}
                >
                  {i === aktif && (
                    <span
                      // Restarted by the key whenever the card or the
                      // running state changes, so the bar is the timer.
                      key={`${aktif}-${donuyor}`}
                      className="absolute inset-y-0 left-0 bg-accent"
                      style={
                        donuyor
                          ? { animation: `ornek-ilerle ${SURE_MS}ms linear forwards` }
                          : { width: "100%" }
                      }
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          {!azHareket && (
            <button
              type="button"
              onClick={() => setDurduruldu((d) => !d)}
              aria-label={durduruldu ? "Örnekleri oynat" : "Örnekleri duraklat"}
              className="flex size-8 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-canvas-sunken hover:text-ink"
            >
              {durduruldu ? <Oynat /> : <Duraklat />}
            </button>
          )}
        </div>
      )}
      <style>{`@keyframes ornek-ilerle { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  );
}

const CUMLE: Partial<Record<OrnekVeri["bucket"], string>> = {
  overlapping: "İkisini birden tutmak, aynı şeyi iki kez almak demek.",
  similar: "Yakın hareket ediyorlar, ama tıpatıp aynı değiller.",
  unrelated: "Biri ne yaparsa yapsın, diğeri hakkında pek bir şey söylemiyor.",
  inverse: "Biri yükselirken diğeri düşme eğiliminde.",
};

function giris(o: OrnekVeri): string {
  const kim =
    o.kurumlar === "ayni"
      ? "Aynı kurumun iki fonu"
      : o.kurumlar === "ayri"
        ? "İki ayrı kurumun iki fonu"
        : "Bu iki fon";
  switch (o.bucket) {
    case "overlapping":
      return o.kurumlar === "ayri"
        ? `${kim}, ama haftalık getirileri neredeyse aynı.`
        : `${kim}; haftalık getirileri neredeyse aynı.`;
    case "unrelated":
      return `${kim}; birbirlerinden bağımsız hareket ediyorlar.`;
    case "inverse":
      return `${kim}; çoğu hafta ters yönde hareket ediyorlar.`;
    default:
      return `${kim}.`;
  }
}

/** Direction, never merit: the same tints as the neighbour card. */
function serit(bucket: OrnekVeri["bucket"]): string {
  if (bucket === "overlapping" || bucket === "similar") return "bg-accent";
  if (bucket === "inverse") return "bg-series-alt";
  return "bg-border-strong";
}

function Kart({ o }: { o: OrnekVeri }) {
  return (
    <Link
      href={fundHref(o.kod)}
      className="group block overflow-hidden rounded-card border border-border bg-surface shadow-lg shadow-black/5 transition-colors hover:border-accent"
    >
      <div className={`h-1 ${serit(o.bucket)}`} />
      <div className="px-5 pt-4 pb-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-overline uppercase text-ink-subtle">
            Son ölçümden bir örnek
          </p>
          <span className="rounded-control bg-canvas-sunken px-2 py-0.5 text-label text-ink-muted">
            {KOVA_ETIKETLERI[o.bucket]}
          </span>
        </div>
        <p className="mt-3 text-display-sm">
          <span className="text-accent">{o.kod}</span>
          <span className="text-ink-subtle"> ile </span>
          <span className="text-series-alt">{o.komsuKod}</span>
        </p>
        <p className="mt-1 text-caption text-ink-muted text-pretty">
          {giris(o)} {CUMLE[o.bucket] ?? ""}
        </p>

        <figure className="mt-4 rounded-control bg-canvas-sunken px-2 pt-2 pb-2">
          <svg
            viewBox={`0 0 ${ORNEK_W} ${ORNEK_H}`}
            className="block h-36 w-full"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1={0}
              x2={ORNEK_W}
              y1={o.baseY}
              y2={o.baseY}
              stroke="var(--border-strong)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            {o.subjectPath && (
              <path
                d={o.subjectPath}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={o.neighbourPath}
              fill="none"
              stroke="var(--series-alt)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-label text-ink-muted">
            {o.subjectPath && <Anahtar renk="bg-accent" etiket={o.kod} />}
            <Anahtar renk="bg-series-alt" etiket={o.komsuKod} />
            <span className="ml-auto text-ink-subtle">
              Son {o.weeks} hafta · 100&apos;den
            </span>
          </figcaption>
        </figure>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-caption tabular-nums">
          <div>
            <dt className="text-label text-ink-subtle">Korelasyon</dt>
            <dd className="mt-0.5 text-body font-semibold text-ink">
              {korelasyon(o.correlation)}
            </dd>
          </div>
          <div>
            <dt className="text-label text-ink-subtle">%95 güven aralığı</dt>
            <dd className="mt-0.5 text-body font-semibold text-ink">
              {o.ciLow !== null && o.ciHigh !== null
                ? `${korelasyon(o.ciLow)} – ${korelasyon(o.ciHigh)}`
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-caption text-ink-subtle">
          {o.nWeeks} haftalık ortak geçmiş üzerinden.{" "}
          <span className="text-accent group-hover:underline">
            {o.kod} sayfasına git
          </span>
        </p>
      </div>
    </Link>
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

function Duraklat() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="size-4">
      <rect x="5" y="4" width="3.5" height="12" rx="1" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
    </svg>
  );
}

function Oynat() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="size-4">
      <path d="M6 4.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 6 4.5Z" />
    </svg>
  );
}
