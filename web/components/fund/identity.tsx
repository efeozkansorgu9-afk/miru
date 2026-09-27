/**
 * Who the fund is and what was found about it, in one block.
 *
 * Three layers, each readable on its own: the fund's name with who runs it,
 * a strip of four facts laid out to be scanned rather than read, and the
 * finding in a card of its own — the reason the page exists, so it is the
 * one thing on the first screen with a ground and an edge.
 *
 * The facts used to be one dot-separated sentence. Seven values in a line
 * of small grey text are read left to right whether or not the reader wants
 * the fourth; four cells with a label over a value are looked at, and the
 * one that matters is found without reading the rest.
 *
 * The coefficient moved out of the finding's sentence and into a figure of
 * its own beside it, with the interval and the weeks under it. The sentence
 * says what was found; the figure is the evidence, and a reader checking it
 * should not have to find a number in the middle of a clause.
 *
 * Nothing is filled in and nothing is coloured by merit. A fifth of the
 * registry has no risk value and seven funds have no founder on record,
 * and those say so. The risk bar is a reading aid for TEFAS's 1-7 integer,
 * not a rating: a 7 is not tinted red, because this page does not grade
 * funds and colouring their filing would be its judgement wearing their data.
 *
 * `enter` staggers the four layers in on first paint, in CSS, so the first
 * screen never waits on a script to be visible.
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
import { kisalt, korelasyon, paraKisa, sayi } from "@/lib/format";
import { karsilastirilabilir, ucretAdi, ucretOrani } from "@/lib/fee";
import { fundHref } from "@/lib/site";

interface Olgu {
  anahtar: string;
  etiket: string;
  deger: string;
  eksik?: boolean;
  ek?: React.ReactNode;
}

export function Identity({
  fund,
  bulgu,
}: {
  fund: FundIdentity;
  bulgu: HeroBulgusu;
}) {
  const [kurum, kategori] = kimlikSatiri(fund);
  const segmentler = riskSegmentleri(fund.risk_value);

  const olgular: Olgu[] = [
    {
      anahtar: "risk",
      etiket: "Risk değeri",
      deger: riskDegeri(fund.risk_value),
      eksik: !segmentler,
      ek: segmentler ? <RiskBar segmentler={segmentler} risk={fund.risk_value} /> : null,
    },
    {
      anahtar: "buyukluk",
      etiket: "Büyüklük",
      deger: fund.total_assets === null ? BELIRTILMEMIS : paraKisa(fund.total_assets),
      eksik: fund.total_assets === null,
    },
    {
      anahtar: "yatirimci",
      etiket: "Yatırımcı",
      deger: fund.investor_count === null ? BELIRTILMEMIS : sayi(fund.investor_count),
      eksik: fund.investor_count === null,
    },
  ];
  // The fee is left out when the list was unreachable, rather than printed
  // as unknown on every page. A reported zero says so in words.
  if (fund.fee) {
    olgular.push({
      anahtar: "ucret",
      etiket: fund.fee.kind === "operating" ? "İşletim gideri" : "Yönetim ücreti",
      deger: fund.fee.rate === 0 ? "sıfır bildirilmiş" : `${ucretOrani(fund.fee.rate)} / yıl`,
      eksik: fund.fee.rate === 0,
    });
  }

  return (
    <header className="enter">
      {/* The code first, as a chip: it is what the reader typed to get here
          and what they will quote to someone else. The house and the
          category beside it are context, not headings. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-full bg-accent-surface px-2.5 py-1 font-mono text-label text-accent">
          {fund.code}
        </span>
        <span
          className={`text-caption ${kurum.endsWith(BELIRTILMEMIS) ? "text-ink-subtle" : "text-ink-muted"}`}
        >
          {kurum}
        </span>
        <span aria-hidden="true" className="text-ink-subtle">
          ·
        </span>
        <span
          className={`text-caption ${kategori.endsWith(BELIRTILMEMIS) ? "text-ink-subtle" : "text-ink-muted"}`}
        >
          {kategori}
        </span>
      </div>

      {/* Fund titles run past seventy upper case characters, so this sits a
          step below the display size the tool's own heading takes: at
          display-lg the same string is six lines on a phone. */}
      <h1 className="mt-4 max-w-4xl text-display-sm text-balance sm:text-display-md">
        {fund.name}
      </h1>

      <dl
        className={`mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border ${
          olgular.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
        }`}
      >
        {olgular.map((o, i) => (
          <div
            key={o.anahtar}
            className={`bg-surface px-4 py-3.5 sm:px-5 sm:py-4 ${
              olgular.length % 2 === 1 && i === olgular.length - 1 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
            <dt className="text-label text-ink-subtle">{o.etiket}</dt>
            <dd
              className={`mt-1 flex items-center gap-2.5 text-body font-semibold tabular-nums ${
                o.eksik ? "font-normal text-ink-subtle" : "text-ink"
              }`}
            >
              {o.deger}
              {o.ek}
            </dd>
          </div>
        ))}
      </dl>

      <Finding fund={fund} bulgu={bulgu} />
    </header>
  );
}

/**
 * The verdict, with the pair it is about and the evidence beside it.
 *
 * Tinted only when it names a fund. "No twin found" and "could not be
 * measured" are findings too, but they are not a pair to look at, and a
 * coloured card around them would promise something the card does not have.
 */
function Finding({ fund, bulgu }: { fund: FundIdentity; bulgu: HeroBulgusu }) {
  const es = bulgu.es;
  const komsuUcreti = es ? es.komsu.fund.fee : null;
  const ucretKarsilastir =
    es &&
    karsilastirilabilir(fund.fee) &&
    karsilastirilabilir(komsuUcreti) &&
    fund.fee.kind === komsuUcreti.kind;

  return (
    <section
      aria-labelledby="bulgu"
      className={`mt-6 rounded-card border px-5 py-6 sm:px-8 sm:py-7 ${
        es ? "border-accent/20 bg-accent-surface/70" : "border-border bg-surface"
      }`}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-10">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-overline uppercase text-accent">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            Bulgu
          </p>
          <h2 id="bulgu" className="mt-3 text-display-sm text-balance sm:text-display-md">
            {bulgu.hukum}
          </h2>

          {es && (
            <p className="mt-3 text-lead text-ink-muted text-pretty">
              {es.oncesi}{" "}
              {/* The named fund is a link, because the next question after
                  "which fund" is always "and what is that one". */}
              <Link
                href={fundHref(es.komsu.fund.code)}
                className="font-medium text-ink underline decoration-accent/35 decoration-2 underline-offset-[5px] transition-colors hover:text-accent hover:decoration-accent"
              >
                {kisalt(es.komsu.fund.name, 64)}
              </Link>
            </p>
          )}

          {/* The one thing two funds that move as one can still differ in.
              Stated for both, never as a verdict on which to hold: "için"
              rather than a case suffix, because a suffix on a fund code
              depends on how the letters are read aloud. */}
          {ucretKarsilastir && es && fund.fee && komsuUcreti && (
            <p className="mt-3 text-body text-ink-muted text-pretty tabular-nums">
              {ucretAdi(fund.fee.kind)} bu fon için {ucretOrani(fund.fee.rate)},{" "}
              {es.komsu.fund.code} için {ucretOrani(komsuUcreti.rate)}.
            </p>
          )}

          {bulgu.sebep && (
            <p className="mt-3 max-w-prose text-lead text-ink-muted text-pretty">
              {bulgu.sebep}
            </p>
          )}
        </div>

        {es && (
          <div className="md:text-right">
            <p className="text-[2.5rem] leading-none font-semibold tracking-tight text-ink tabular-nums sm:text-[2.75rem]">
              {korelasyon(es.komsu.correlation)}
            </p>
            <p className="mt-2 text-caption text-ink-muted">korelasyon</p>
            {es.komsu.ci_low !== null && es.komsu.ci_high !== null && (
              <p className="text-caption text-ink-subtle tabular-nums">
                %95 aralık {korelasyon(es.komsu.ci_low)}–{korelasyon(es.komsu.ci_high)} ·{" "}
                {sayi(es.komsu.n_weeks)} hafta
              </p>
            )}
          </div>
        )}
      </div>

      {/* Offered only when there is something under it. A fund whose
          relationships could not be measured has an empty section below,
          and a link into it is worse than no link. */}
      {bulgu.tur !== "none" && (
        <a
          href="#komsular"
          className="group mt-6 inline-flex items-center gap-1.5 text-label font-medium text-accent"
        >
          Ölçülen bütün fonları gör
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-3.5 transition-transform duration-300 ease-out-soft group-hover:translate-y-0.5 motion-reduce:transition-none"
          >
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </a>
      )}
    </section>
  );
}

/**
 * Seven segments, the first `risk` of them filled.
 *
 * `aria-hidden`, because the number it illustrates is already read out next
 * to it as "5 / 7". A screen reader announcing seven anonymous boxes after
 * that is noise, not a second reading.
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
          className={`h-3 w-1 rounded-[1px] ${dolu ? "bg-ink-muted" : "bg-border-strong"}`}
        />
      ))}
    </span>
  );
}
