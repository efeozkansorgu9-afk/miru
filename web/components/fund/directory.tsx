"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";

import type { FundListItem } from "@/lib/api";
import { fold } from "@/lib/funds";
import { fundHref } from "@/lib/site";

/**
 * Every fund with a page, searchable, each row a link to that page.
 *
 * The way into the fund pages from inside the site. Before this the pages
 * were reachable only from a search engine or from another fund page's
 * neighbour list, so someone already on miru had no route to them at all.
 *
 * The list is `/funds/list`, not the search registry the basket uses: that
 * one carries ~2578 codes and only ~1372 have a page. Listing a code here
 * that 404s on press would be a link that lies.
 *
 * **Every row is in the markup**, filtered or not. With an empty query the
 * whole list renders, so the HTML a crawler reads carries a link to every
 * fund page — the section's internal link graph starts here rather than at
 * whichever fund a search engine happened to index first. A query hides rows
 * by not rendering them; it never fetches anything.
 *
 * No dropdown, so no portal: the results are the page, in normal flow.
 */
export function FundDirectory({ funds }: { funds: FundListItem[] }) {
  const [query, setQuery] = useState("");
  // Filtering 1372 rows is cheap; re-rendering 1372 links on every key is
  // what costs, so the list trails the field rather than blocking it.
  const deferred = useDeferredValue(query);
  const inputId = useId();

  const indexed = useMemo(
    () =>
      funds.map((fund) => ({
        fund,
        code: fold(fund.code),
        name: fold(fund.name),
        haystack: fold(`${fund.code} ${fund.name} ${fund.founder ?? ""}`),
      })),
    [funds],
  );

  const shown = useMemo(() => filter(indexed, deferred), [indexed, deferred]);
  const trimmed = query.trim();

  return (
    <div>
      <label htmlFor={inputId} className="block text-label text-ink-muted">
        Fon ara
      </label>
      <div className="relative mt-2">
        <SearchIcon />
        <input
          id={inputId}
          type="text"
          role="searchbox"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          placeholder="Fon kodu, adı veya kurucusu"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-control border border-border bg-surface py-3.5 pl-11 pr-4 text-body text-ink transition-colors placeholder:text-ink-subtle hover:border-border-strong focus:border-accent"
        />
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-caption text-ink-subtle">
        {trimmed
          ? shown.length > 0
            ? `${shown.length} fon bulundu.`
            : `"${trimmed}" ile eşleşen fon yok.`
          : `${funds.length} fonun sayfası var.`}
      </p>

      {shown.length > 0 && (
        <ul className="mt-4 overflow-hidden rounded-card border border-border bg-surface">
          {shown.map((fund) => (
            <li key={fund.code} className="border-t border-border first:border-t-0">
              <Link
                href={fundHref(fund.code)}
                className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas-sunken sm:px-6"
              >
                <span className="w-12 shrink-0 font-mono text-label text-accent">
                  {fund.code}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-body text-ink"
                  title={fund.name}
                >
                  {fund.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Indexed {
  fund: FundListItem;
  code: string;
  name: string;
  haystack: string;
}

/**
 * Same ranking as the basket's search box: an exact code first, then a code
 * that starts that way, then a name that starts that way, then a word in the
 * name, then anything containing it. Someone typing "AFO" means AFO, not
 * every fund with "afo" inside a company name. Ties stay alphabetical.
 */
function filter(rows: Indexed[], query: string): FundListItem[] {
  const needle = fold(query.trim());
  if (!needle) return rows.map((row) => row.fund);

  const scored: { fund: FundListItem; score: number }[] = [];
  for (const row of rows) {
    if (!row.haystack.includes(needle)) continue;
    let score = 4;
    if (row.code === needle) score = 0;
    else if (row.code.startsWith(needle)) score = 1;
    else if (row.name.startsWith(needle)) score = 2;
    else if (row.name.includes(` ${needle}`)) score = 3;
    scored.push({ fund: row.fund, score });
  }

  scored.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.fund.code.localeCompare(b.fund.code, "tr"),
  );
  return scored.map((entry) => entry.fund);
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-ink-subtle"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}
