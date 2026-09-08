/**
 * The one thing this page has to say, before the list it is read off.
 *
 * Which sentence appears is decided in `lib/fund` by the bucket of the
 * closest neighbour, and there are four of them. Two name a fund, because
 * "there is another fund doing this" is only useful if you are told which.
 * One offers the list below without a headline, because a fund whose closest
 * relation is merely moderate has no finding worth setting at display size.
 * The fourth says the measurement did not happen, and offers nothing: there
 * is nothing under it to offer, and a link into an empty section is worse
 * than no link.
 *
 * Nothing here is coloured. A fund having a twin is not bad news and a fund
 * standing alone is not good news; both are measurements, and the page
 * reports them.
 */

import Link from "next/link";

import type { Bulgu } from "@/lib/fund";
import { KOVA_ETIKETLERI, bulguCumlesi } from "@/lib/fund";
import { korelasyon } from "@/lib/format";

export function Finding({ bulgu }: { bulgu: Bulgu }) {
  return (
    <section aria-labelledby="bulgu" className="scroll-mt-24">
      <p className="text-overline uppercase text-accent">Bulgu</p>
      <h2 id="bulgu" className="mt-4 max-w-prose text-display-md text-balance">
        {bulgu.baslik}
      </h2>

      {bulgu.komsu && (
        <div className="mt-6 max-w-prose rounded-card border border-border bg-surface px-6 py-5">
          {/* Three decimals here, two in the list. This card quotes one
              coefficient as the whole point of it, and at two decimals
              0,9998 prints as "1,00" — which does not say "very nearly
              identical", it says "identical", a value the maths reserves for
              a fund against itself. In the list the number is supporting
              evidence under a word that already carries the finding, and two
              decimals is the right coarseness to scan. */}
          <p className="text-label text-ink-muted">
            {KOVA_ETIKETLERI[bulgu.komsu.bucket]} · korelasyon{" "}
            <span className="tabular-nums">{korelasyon(bulgu.komsu.correlation)}</span>
          </p>
          {/* The named fund is a link to its own page, because the next
              question after "which fund" is always "and what is that one". */}
          <Link
            href={`/fon/${bulgu.komsu.fund.code}`}
            className="mt-3 block text-lead text-ink underline-offset-4 transition-colors hover:text-accent hover:underline text-pretty"
          >
            {bulgu.komsu.fund.name}
          </Link>
          <p className="mt-2 text-caption text-ink-subtle">
            {bulguCumlesi(bulgu.komsu)}
          </p>
        </div>
      )}

      {bulgu.tur === "weaker" && (
        <p className="mt-6 max-w-prose text-lead text-ink-muted text-pretty">
          <a
            href="#komsular"
            className="text-accent underline-offset-4 hover:underline"
          >
            Bu fonun diğer fonlarla ilişkilerini gör
          </a>
        </p>
      )}

      {bulgu.sebep && (
        <p className="mt-6 max-w-prose text-lead text-ink-muted text-pretty">
          {bulgu.sebep}
        </p>
      )}
    </section>
  );
}
