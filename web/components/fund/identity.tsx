/**
 * Who the fund is and what was found about it, in one block.
 *
 * This used to be four facts in three bordered cards, with the finding — the
 * reason the page exists — in a section of its own halfway down. Two things
 * were wrong with that. The metadata took the full width and most of the
 * first screen to say three short strings, so the fund's name and its
 * verdict were never on screen together. And the finding then said the same
 * fund twice: once as "this fund has a twin, here it is", and again as the
 * only row of the "Örtüşenler (1)" group directly beneath it.
 *
 * So the three cards are one line of text, and the verdict has come up here.
 * What is below is now only what the verdict is read off: the neighbour
 * list, grouped.
 *
 * Nothing is filled in and nothing is coloured. A fifth of the registry has
 * no risk value and seven funds have no founder on record, and those say so.
 * The risk bar is a reading aid for TEFAS's 1-7 integer, not a rating: a 7
 * is not tinted red, because this page does not grade funds and colouring
 * their filing would be its judgement wearing their data.
 */

import Link from "next/link";

import type { FundIdentity } from "@/lib/api";
import {
  BELIRTILMEMIS,
  RISK_SEGMENTS,
  kimlikSatiri,
  riskDegeri,
  riskSegmentleri,
} from "@/lib/fund";
import type { HeroBulgusu } from "@/lib/fund";
import { kisalt, paraKisa, sayi } from "@/lib/format";
import { fundHref } from "@/lib/site";

export function Identity({
  fund,
  bulgu,
}: {
  fund: FundIdentity;
  bulgu: HeroBulgusu;
}) {
  const meta = kimlikSatiri(fund);
  const segmentler = riskSegmentleri(fund.risk_value);

  return (
    <header>
      {/* The code, not the word "fon". It is what the reader typed to get
          here and what they will quote to someone else. */}
      <p className="text-overline uppercase text-accent">{fund.code}</p>

      {/* Fund titles run past seventy upper case characters, so this sits a
          step below the display size the tool's own heading takes: at
          display-lg the same string is six lines on a phone. */}
      <h1 className="mt-3 max-w-prose text-display-sm text-balance sm:text-display-md">
        {fund.name}
      </h1>

      {/* One row, wrapping. Dot separators rather than borders: these are
          three short facts read left to right, and every rule drawn round
          them is a rule the eye has to cross to get to the finding. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-caption text-ink-muted">
        {meta.map((parca) => (
          <span key={parca} className="flex items-center gap-2.5">
            <span className={parca.endsWith(BELIRTILMEMIS) ? "text-ink-subtle" : ""}>
              {parca}
            </span>
            <Ayirac />
          </span>
        ))}
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-2">
            <span className={segmentler ? "" : "text-ink-subtle"}>
              Risk {riskDegeri(fund.risk_value)}
            </span>
            {segmentler && <RiskBar segmentler={segmentler} risk={fund.risk_value} />}
          </span>
          <Ayirac />
        </span>
        {/* Size and investors, TEFAS's latest published figures. Same rule
            as the rest of the line: a missing value says so. Separators
            trail, as above, so a wrapped line never starts with a dot. */}
        <span className="flex items-center gap-2.5">
          <span className={fund.total_assets === null ? "text-ink-subtle" : "tabular-nums"}>
            Büyüklük{" "}
            {fund.total_assets === null ? BELIRTILMEMIS : paraKisa(fund.total_assets)}
          </span>
          {fund.investor_count !== null && <Ayirac />}
        </span>
        {fund.investor_count !== null && (
          <span className="tabular-nums">{sayi(fund.investor_count)} yatırımcı</span>
        )}
      </div>

      {/* The verdict, on the same screen as the name for the first time. The
          rule above it is the page changing register: everything over it
          describes the fund on its own, everything from here on is measured
          against other funds. */}
      <div className="mt-8 border-t border-border pt-8">
        <p className="text-overline uppercase text-accent">Bulgu</p>
        <h2 className="mt-3 max-w-prose text-display-sm text-balance sm:text-display-md">
          {bulgu.hukum}
        </h2>

        {bulgu.es && (
          <p className="mt-4 max-w-prose text-lead text-ink-muted text-pretty">
            {bulgu.es.oncesi}{" "}
            {/* The named fund is a link, because the next question after
                "which fund" is always "and what is that one". */}
            <Link
              href={fundHref(bulgu.es.komsu.fund.code)}
              className="text-ink underline decoration-border decoration-1 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
            >
              {kisalt(bulgu.es.komsu.fund.name, 64)}
            </Link>
            {" — "}
            <span className="tabular-nums">{bulgu.es.sonrasi}</span>
          </p>
        )}

        {bulgu.sebep && (
          <p className="mt-4 max-w-prose text-lead text-ink-muted text-pretty">
            {bulgu.sebep}
          </p>
        )}

        {/* Offered only when there is something under it. A fund whose
            relationships could not be measured has an empty section below,
            and a link into it is worse than no link. */}
        {bulgu.tur !== "none" && (
          <p className="mt-5">
            <a
              href="#komsular"
              className="text-label text-accent underline-offset-4 hover:underline"
            >
              Ölçülen bütün fonları gör
            </a>
          </p>
        )}
      </div>
    </header>
  );
}

function Ayirac() {
  return (
    <span aria-hidden="true" className="text-ink-subtle">
      ·
    </span>
  );
}

/**
 * Seven segments, the first `risk` of them filled.
 *
 * `aria-hidden`, because the number it illustrates is already read out next
 * to it as "Risk 6 / 7". A screen reader announcing seven anonymous boxes
 * after that is noise, not a second reading.
 */
function RiskBar({
  segmentler,
  risk,
}: {
  segmentler: boolean[];
  risk: number | null;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex items-center gap-0.5"
      title={`TEFAS risk değeri: ${risk} / ${RISK_SEGMENTS}`}
    >
      {segmentler.map((dolu, i) => (
        <span
          key={i}
          className={`h-3 w-1 rounded-[1px] ${dolu ? "bg-ink-muted" : "bg-border"}`}
        />
      ))}
    </span>
  );
}
