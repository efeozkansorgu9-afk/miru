"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useMemo, useRef, useState } from "react";

import { searchFunds, useFundRegistry } from "@/lib/funds";
import type { SearchableFund } from "@/lib/funds";

/**
 * Search the fund registry by code or by name.
 *
 * Both, because people arrive knowing one or the other: an investor who
 * already holds AFO types AFO, and someone who only remembers it was the Ak
 * gold fund types "ak altın". The list is searched in the browser, so the
 * results keep up with typing.
 *
 * The field stays exactly where it is when something is chosen and empties
 * itself, so a basket can be built by typing without ever reaching for the
 * mouse or hunting for the box again as the list below grows.
 */
export function FundSearch({
  chosen,
  onChoose,
}: {
  /** Codes already in the basket. Still listed, but not selectable twice. */
  chosen: Set<string>;
  onChoose: (fund: SearchableFund) => void;
}) {
  const registry = useFundRegistry();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const reduceMotion = useReducedMotion();

  const funds = registry.phase === "ready" ? registry.funds : null;
  const results = useMemo(
    () => (funds ? searchFunds(funds, query) : []),
    [funds, query],
  );

  const showList = open && query.trim().length > 0;

  function choose(fund: SearchableFund) {
    if (chosen.has(fund.code)) return;
    onChoose(fund);
    setQuery("");
    setActive(0);
    setOpen(false);
    // Straight back to an empty box, ready for the next one.
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showList || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const fund = results[active];
      if (fund) choose(fund);
    }
  }

  return (
    <div className="relative">
      <label
        htmlFor={`${listId}-input`}
        className="block text-label text-ink-muted"
      >
        Fon ara
      </label>

      <div className="relative mt-2">
        <SearchIcon />
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && results[active] ? `${listId}-${results[active].code}` : undefined
          }
          value={query}
          disabled={registry.phase === "error"}
          placeholder="Fon kodu veya adı yazın"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A blur that fires before the click lands would close the list out
          // from under the pointer, so the close waits a frame.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="w-full rounded-control border border-border bg-surface py-3.5 pl-11 pr-4 text-body text-ink transition-colors placeholder:text-ink-subtle hover:border-border-strong focus:border-accent disabled:opacity-60"
        />
      </div>

      <p className="mt-2 min-h-5 text-caption text-ink-subtle">{hint(registry, results.length, query)}</p>

      <AnimatePresence>
        {showList && results.length > 0 && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Arama sonuçları"
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-card border border-border bg-surface-raised shadow-lg shadow-black/5"
          >
            {results.map((fund, index) => {
              const already = chosen.has(fund.code);
              return (
                <li key={fund.code} id={`${listId}-${fund.code}`} role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    disabled={already}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(fund)}
                    className={`flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors ${
                      index === active && !already ? "bg-accent-surface" : ""
                    } ${already ? "cursor-default opacity-45" : ""}`}
                  >
                    <span className="shrink-0 font-mono text-label text-accent">
                      {fund.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-ink" title={fund.title}>
                      {fund.title}
                    </span>
                    {already && (
                      <span className="shrink-0 text-caption text-ink-subtle">eklendi</span>
                    )}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function hint(
  registry: ReturnType<typeof useFundRegistry>,
  count: number,
  query: string,
): string {
  if (registry.phase === "loading") return "Fon listesi yükleniyor.";
  if (registry.phase === "error") {
    return registry.error.kind === "upstream"
      ? "TEFAS şu anda yanıt vermiyor, fon listesi alınamadı."
      : "Fon listesine ulaşılamadı. Sunucu çalışıyor mu?";
  }
  if (query.trim() && count === 0) return "Bu aramaya uyan fon yok.";
  if (!query.trim()) return `${registry.funds.length} fon arasında arayın.`;
  return "";
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
