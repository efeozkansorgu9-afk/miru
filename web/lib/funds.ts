"use client";

import { useEffect, useState } from "react";

import { ApiError, getFunds } from "@/lib/api";
import type { Fund } from "@/lib/api";

/**
 * The fund registry, fetched once per page load and searched in the browser.
 *
 * All 2578 of them, around 220 kB. That is a lot to hold, and still far less
 * than asking the server on every keystroke: the list changes at most daily,
 * the backend already caches it for a day, and a search that runs locally
 * answers while the key is still going down.
 */

export interface SearchableFund extends Fund {
  /** Precomputed so the filter is not lowercasing 2578 titles per keystroke. */
  haystack: string;
}

export type RegistryState =
  | { phase: "loading" }
  | { phase: "ready"; funds: SearchableFund[] }
  | { phase: "error"; error: ApiError };

// Kept outside React so a remount does not refetch.
let cache: SearchableFund[] | null = null;
let inflight: Promise<SearchableFund[]> | null = null;

/**
 * Lowercase the Turkish way.
 *
 * The default lowercase turns "İŞ" into "i̇ş" with a combining dot, so
 * someone typing "iş bankası" would not find "İŞ BANKASI". The Turkish
 * locale maps the dotted capital to a plain "i", which is what a person
 * typing on a Turkish keyboard produces.
 */
function fold(text: string): string {
  return text.toLocaleLowerCase("tr");
}

function load(): Promise<SearchableFund[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= getFunds().then((response) => {
    cache = response.funds.map((fund) => ({
      ...fund,
      haystack: fold(`${fund.code} ${fund.title}`),
    }));
    inflight = null;
    return cache;
  });
  return inflight;
}

export function useFundRegistry(): RegistryState {
  const [state, setState] = useState<RegistryState>(() =>
    cache ? { phase: "ready", funds: cache } : { phase: "loading" },
  );

  useEffect(() => {
    if (cache) return;
    let live = true;
    load()
      .then((funds) => live && setState({ phase: "ready", funds }))
      .catch((error: unknown) => {
        if (!live) return;
        setState({
          phase: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError("unexpected", "Fon listesi alınamadı."),
        });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/**
 * Rank matches so the obvious one is first.
 *
 * Someone typing "GAL" means the fund whose code is GAL, not the forty funds
 * with "gal" somewhere in a company name. So an exact code wins, then a code
 * that starts that way, then a title that starts that way, then anything
 * containing it.
 */
export function searchFunds(
  funds: SearchableFund[],
  query: string,
  limit = 8,
): SearchableFund[] {
  const needle = fold(query.trim());
  if (!needle) return [];

  const scored: { fund: SearchableFund; score: number }[] = [];

  for (const fund of funds) {
    if (!fund.haystack.includes(needle)) continue;

    const code = fold(fund.code);
    const title = fold(fund.title);
    let score = 4;
    if (code === needle) score = 0;
    else if (code.startsWith(needle)) score = 1;
    else if (title.startsWith(needle)) score = 2;
    else if (title.includes(` ${needle}`)) score = 3;

    scored.push({ fund, score });
  }

  scored.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.fund.code.localeCompare(b.fund.code, "tr"),
  );
  return scored.slice(0, limit).map((entry) => entry.fund);
}
