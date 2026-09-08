/**
 * Who the fund is, before anything is claimed about it.
 *
 * Four facts and no more: the name, the house that runs it, what TEFAS files
 * it under, and the risk number TEFAS publishes. Size and investor count are
 * deliberately not here — they belong to comparing one fund against another,
 * which is what the neighbour popovers are for, and putting them at the top
 * would make the page open on a scorecard.
 *
 * Nothing is filled in. A fifth of the registry has no risk value and seven
 * funds have no founder on record, and those say so.
 */

import type { FundIdentity } from "@/lib/api";
import { BELIRTILMEMIS, riskDegeri } from "@/lib/fund";

export function Identity({ fund }: { fund: FundIdentity }) {
  return (
    <header>
      {/* The code, not the word "fon". It is what the reader typed to get
          here and what they will quote to someone else. */}
      <p className="text-overline uppercase text-accent">{fund.code}</p>

      {/* Fund titles run past seventy upper case characters, so this sits a
          step below the display size the tool's own heading takes: at
          display-lg the same string is six lines on a phone. */}
      <h1 className="mt-4 max-w-prose text-display-sm text-balance sm:text-display-md">
        {fund.name}
      </h1>

      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <Fact label="Kurum" value={fund.founder ?? BELIRTILMEMIS} />
        <Fact label="Kategori" value={fund.category ?? BELIRTILMEMIS} />
        <Fact label="Risk değeri" value={riskDegeri(fund.risk_value)} />
      </dl>
    </header>
  );
}

/**
 * One fact.
 *
 * A missing one is set in the muted ink rather than the page's own, which is
 * the only thing separating "belirtilmemiş" from a value that happens to be
 * a word. Nothing is coloured beyond that: a risk value of 7 is not a
 * warning, it is what TEFAS filed.
 */
function Fact({ label, value }: { label: string; value: string }) {
  const eksik = value === BELIRTILMEMIS;
  return (
    <div className="rounded-card border border-border bg-surface px-5 py-4">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd
        className={`mt-2 text-body text-pretty ${eksik ? "text-ink-subtle" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
