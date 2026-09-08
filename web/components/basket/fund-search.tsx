"use client";

import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 *
 * When the registry cannot be fetched the box does not go dead. It turns
 * into a plain code field and what is typed is added as it stands. The
 * registry is only how a code is found and named; the analysis endpoint
 * never needed it, so a reader who already knows they hold GAL can still
 * get an answer. What is lost is the name next to the code and the check
 * that the code exists at all, and the note under the field says so rather
 * than letting a typo look like a fund.
 *
 * ## Why the list is in a portal
 *
 * The list used to be `position: absolute; z-index: 30` inside this
 * component, and the amount fields of the fund cards below painted straight
 * through it. A higher z-index would not have fixed it. `Reveal`, the entry
 * animation this box is wrapped in, animates `transform` with
 * `animation-fill-mode: both`; the animation never stops filling, and a
 * filled `transform: none` resolves to the identity matrix, which is still a
 * transform. So `Reveal` creates a stacking context that never goes away,
 * and every z-index inside it is only comparable with its siblings. The
 * card's `AmountInput` wraps its field in a `position: relative` box, which
 * paints in the same step as that whole stacking context and comes later in
 * the document, so it won a comparison the z-index was never part of.
 *
 * The list is therefore rendered into `document.body`, outside every
 * stacking context on the page, and positioned against the input by
 * floating-ui rather than by the box model. That also buys the two things
 * absolute positioning could not: the list flips above the field when there
 * is no room below it, and it stays anchored while the page scrolls.
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
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const reduceMotion = useReducedMotion();

  const funds = registry.phase === "ready" ? registry.funds : null;
  // No registry, no autocomplete: the field takes a code and nothing else.
  const elle = registry.phase === "error";
  const results = useMemo(
    () => (funds ? searchFunds(funds, query) : []),
    [funds, query],
  );

  const showList = open && !elle && query.trim().length > 0 && results.length > 0;
  const kod = elle ? kodaCevir(query) : "";
  const eklenebilir = kod.length > 0 && !chosen.has(kod);

  /**
   * Anchor the portalled list to the input.
   *
   * `size` copies the field's width onto the list and caps its height to
   * what is actually free on screen, so the list never runs off the bottom
   * and never has to guess how tall the viewport is. `autoUpdate` keeps the
   * two together while the page scrolls or resizes, which absolute
   * positioning gave for free and a portal does not.
   */
  const { refs, floatingStyles } = useFloating<HTMLInputElement>({
    open: showList,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    // Position through `top`/`left` rather than a transform. floating-ui
    // prefers a transform because it is cheaper to animate, but the list is
    // a `motion.ul` that animates `y` on entry, and Framer Motion writes the
    // same `transform` property. The two cannot share it: Framer Motion won,
    // the positioning transform was overwritten, and the list rendered at
    // the top left corner of the page instead of under the field.
    transform: false,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          elements.floating.style.width = `${rects.reference.width}px`;
          // Never taller than a third of a phone screen's worth of rows, and
          // never taller than the room there is.
          elements.floating.style.maxHeight = `${Math.min(availableHeight, 320)}px`;
        },
      }),
    ],
  });

  // A result set that shrank under the cursor leaves `active` pointing past
  // the end, and Enter would then select nothing. Clamped while rendering
  // rather than corrected in an effect: an effect would render the bad index
  // once first, and there is nothing to synchronise with — the valid range
  // is derivable from what we already have.
  const activeIndex = active < results.length ? active : 0;

  /**
   * Close when the press lands anywhere but the field or the list.
   *
   * This replaces a `blur` handler that closed the list on a timer. With the
   * list in a portal, a press inside it still blurs the input, and racing a
   * 120ms timeout against the click was never the reason it worked. Testing
   * the press target is what actually describes the intent: a press outside
   * both elements is the reader leaving.
   */
  useEffect(() => {
    if (!showList) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (refs.reference.current?.contains(target)) return;
      if (refs.floating.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [showList, refs.reference, refs.floating]);

  /**
   * Keep the highlighted row on screen.
   *
   * The list scrolls inside itself, so arrowing past the bottom row has to
   * bring the next one into view or the keyboard path stops at whatever
   * happened to fit. `block: "nearest"` scrolls only when it must, so the
   * list does not jump while the cursor is somewhere in the middle.
   */
  useEffect(() => {
    if (!showList) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showList]);

  function choose(fund: SearchableFund) {
    if (chosen.has(fund.code)) return;
    onChoose(fund);
    setQuery("");
    setActive(0);
    setOpen(false);
    // Straight back to an empty box, ready for the next one.
    inputRef.current?.focus();
  }

  /**
   * Add whatever was typed, as a fund with a code and no name.
   *
   * `title` is empty rather than filled with the code or a placeholder:
   * every row that shows a name reads it from here, and writing something
   * into it would put an invented name on screen. The empty string is the
   * truth, and `FundRow` says so where the name would have been.
   */
  function elleEkle() {
    if (!eklenebilir) return;
    onChoose({ code: kod, title: "", haystack: "" });
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // Stops here rather than reaching the page: Escape with a list open
      // means close the list, and nothing else on the page should also act.
      if (showList) event.stopPropagation();
      setOpen(false);
      return;
    }
    if (elle) {
      // Enter is the only way in from the keyboard here, and it must not
      // reach the form: submitting would run an analysis of the basket as
      // it stands, without the fund being typed.
      if (event.key === "Enter") {
        event.preventDefault();
        elleEkle();
      }
      return;
    }
    if (!showList) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const fund = results[activeIndex];
      if (fund) choose(fund);
    }
  }

  return (
    <div>
      <label
        htmlFor={`${listId}-input`}
        className="block text-label text-ink-muted"
      >
        {elle ? "Fon kodu" : "Fon ara"}
      </label>

      <div className="mt-2 flex items-start gap-3">
        <div className="relative min-w-0 flex-1">
          <SearchIcon />
          <input
            id={`${listId}-input`}
            ref={(node) => {
              inputRef.current = node;
              refs.setReference(node);
            }}
            type="text"
            autoComplete="off"
            // Combobox semantics only while there is a list behind the box.
            // Announcing one that cannot open would be a promise the field
            // does not keep.
            {...(elle
              ? { role: "textbox" as const }
              : {
                  role: "combobox" as const,
                  "aria-expanded": showList,
                  "aria-controls": listId,
                  "aria-autocomplete": "list" as const,
                  "aria-activedescendant":
                    showList && results[activeIndex]
                      ? `${listId}-${results[activeIndex].code}`
                      : undefined,
                })}
            value={query}
            placeholder={elle ? "GAL" : "Fon kodu veya adı yazın"}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={`w-full rounded-control border border-border bg-surface py-3.5 pr-4 text-body text-ink transition-colors placeholder:text-ink-subtle hover:border-border-strong focus:border-accent ${
              elle ? "pl-4 font-mono uppercase" : "pl-11"
            }`}
          />
        </div>

        {/* Only in the typed path. With a list, choosing from it is the way
            in and a second control would be one thing too many. */}
        {elle && (
          <button
            type="button"
            onClick={elleEkle}
            disabled={!eklenebilir}
            className="shrink-0 rounded-control border border-border-strong bg-surface px-6 py-3.5 text-body font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ekle
          </button>
        )}
      </div>

      <p className="mt-2 min-h-5 text-caption text-ink-subtle">
        {hint(registry, results.length, query, kod, chosen)}
      </p>
      {elle && (
        <p className="max-w-prose text-caption text-ink-subtle text-pretty">
          Fon adı doğrulanamıyor, kod doğruysa analiz çalışır.
        </p>
      )}

      <FloatingList
        open={showList}
        listId={listId}
        setFloating={refs.setFloating}
        floatingStyles={floatingStyles}
        listRef={listRef}
        results={results}
        active={activeIndex}
        chosen={chosen}
        reduceMotion={reduceMotion}
        onHover={setActive}
        onChoose={choose}
      />
    </div>
  );
}

/**
 * The result list, rendered into `document.body`.
 *
 * Portalled on mount rather than on the server: `document` does not exist
 * during the server render, and the list is never part of the first paint
 * anyway — nothing can be in it until someone has typed.
 *
 * `onMouseDown` is prevented on the whole list so a press never takes focus
 * off the input. Without it the field loses focus on the way to the click,
 * and the caret is gone by the time the fund is added, which breaks typing
 * the next code straight after choosing one.
 */
function FloatingList({
  open,
  listId,
  setFloating,
  floatingStyles,
  listRef,
  results,
  active,
  chosen,
  reduceMotion,
  onHover,
  onChoose,
}: {
  open: boolean;
  listId: string;
  setFloating: (node: HTMLUListElement | null) => void;
  floatingStyles: React.CSSProperties;
  listRef: React.RefObject<HTMLUListElement | null>;
  results: SearchableFund[];
  active: number;
  chosen: Set<string>;
  reduceMotion: boolean | null;
  onHover: (index: number) => void;
  onChoose: (fund: SearchableFund) => void;
}) {
  // `createPortal` needs a real `document`, which the server render has not
  // got. Testing for it directly rather than flipping a "mounted" flag in an
  // effect: the closed list renders nothing on either side, so there is no
  // hydration mismatch to avoid and no second render to pay for.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.ul
          id={listId}
          role="listbox"
          aria-label="Arama sonuçları"
          ref={(node) => {
            setFloating(node);
            listRef.current = node;
          }}
          style={floatingStyles}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          onMouseDown={(event) => event.preventDefault()}
          // z-index is belt and braces here. In the body there is nothing
          // above it to lose to, but a future sticky header with one would
          // otherwise win on document order alone.
          className="z-50 overflow-y-auto overscroll-contain rounded-card border border-border bg-surface-raised shadow-lg shadow-black/5"
        >
          {results.map((fund, index) => {
            const already = chosen.has(fund.code);
            return (
              <li
                key={fund.code}
                id={`${listId}-${fund.code}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active ? "true" : undefined}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={already}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onChoose(fund)}
                  className={`flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors ${
                    index === active && !already ? "bg-accent-surface" : ""
                  } ${already ? "cursor-default opacity-45" : ""}`}
                >
                  <span className="shrink-0 font-mono text-label text-accent">
                    {fund.code}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-caption text-ink"
                    title={fund.title}
                  >
                    {fund.title}
                  </span>
                  {already && (
                    <span className="shrink-0 text-caption text-ink-subtle">
                      eklendi
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * A code as the analysis will read it: trimmed and upper case.
 *
 * `toUpperCase`, not the Turkish locale one. Fund codes are ASCII, and the
 * Turkish mapping sends "i" to the dotted "İ", so a typed "tie" would be
 * added as "TİE" and would match nothing on TEFAS. The rest of the page
 * lowercases the Turkish way on purpose, for searching titles; this is the
 * one place that must not.
 */
function kodaCevir(query: string): string {
  return query.trim().toUpperCase();
}

function hint(
  registry: ReturnType<typeof useFundRegistry>,
  count: number,
  query: string,
  kod: string,
  chosen: Set<string>,
): string {
  if (registry.phase === "loading") return "Fon listesi yükleniyor.";
  if (registry.phase === "error") {
    if (kod && chosen.has(kod)) return `${kod} sepetinizde zaten var.`;
    const neden =
      registry.error.kind === "upstream"
        ? "TEFAS şu anda yanıt vermiyor, fon listesi alınamadı."
        : "Fon listesine ulaşılamadı. Sunucu çalışıyor mu?";
    return `${neden} Fon kodunu elle yazıp ekleyebilirsiniz.`;
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
