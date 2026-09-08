"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  basketSignature,
  checkSimpleBasket,
  checkStagedBasket,
  koprudenGelenKodlar,
  nextId,
} from "@/lib/basket";
import type { BasketFund, PurchaseRow } from "@/lib/basket";
import { useFundRegistry } from "@/lib/funds";
import type { SearchableFund } from "@/lib/funds";
import { SAMPLE_COUNT, nextSample } from "@/lib/sample";
import type { SampleScenario } from "@/lib/sample";
import { Reveal } from "@/components/reveal";
import { FundSearch } from "./fund-search";
import { FundRow } from "./fund-row";
import { StagedTable } from "./staged-table";

/**
 * The whole input section: pick funds, say how much and since when, analyse.
 *
 * Two modes over one basket. Simple mode asks a fund what it is worth. Staged
 * mode asks when each payment went in, which is a different and longer
 * question, so it is behind a single button and off by default: most people
 * bought once, and making everyone fill a purchase ledger to find that out
 * would be the wrong default.
 *
 * There is no history length control anywhere here, on purpose. How far back
 * to look is not a judgement a user is equipped to make, and getting it wrong
 * quietly changes the answer, so the analysis uses everything there is.
 */
export function BasketForm({
  onAnalyze,
  onBasketChange,
  submitRef,
  busy = false,
}: {
  /** Hands the basket to whoever owns the result. Called only when valid. */
  onAnalyze: (
    mode: "simple" | "staged",
    funds: BasketFund[],
    purchases: PurchaseRow[],
  ) => void;
  /**
   * Fires whenever the basket changes, with a fingerprint of it.
   *
   * The form owns the basket and the section below owns the result, and the
   * one thing the result needs to know about the basket is whether it is
   * still the basket it was computed from. A signature is the whole of that:
   * it says "changed" without handing the result section a basket it would
   * then be tempted to read.
   */
  onBasketChange?: (signature: string) => void;
  /**
   * Attached to the analyse button.
   *
   * The result section's "Sepete dön" needs to put this control back in
   * front of the reader and focus it. It is handed down as a ref rather
   * than reached for by id, so the button stays the only thing that knows
   * it is the button.
   */
  submitRef?: React.Ref<HTMLButtonElement>;
  /** True while the analysis is in flight; the button says so and locks. */
  busy?: boolean;
}) {
  const [funds, setFunds] = useState<BasketFund[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [staged, setStaged] = useState(false);
  // What the last "another example" press loaded, so the line under the
  // basket describes the basket that is actually in it.
  const [scenario, setScenario] = useState<SampleScenario | null>(null);
  const reduceMotion = useReducedMotion();

  useKoprudenGelenler(setFunds);

  const chosen = useMemo(() => new Set(funds.map((f) => f.code)), [funds]);
  const mode = staged ? ("staged" as const) : ("simple" as const);
  const signature = basketSignature(mode, funds, purchases);
  const isEmpty = staged ? purchases.length === 0 : funds.length === 0;

  useEffect(() => {
    onBasketChange?.(signature);
  }, [signature, onBasketChange]);

  const check = staged ? checkStagedBasket(purchases) : checkSimpleBasket(funds);
  const canAnalyze = check.canAnalyze && !busy;

  function addFund(fund: SearchableFund) {
    // The basket is no longer the example once it has been edited, so the
    // line describing that example stops applying.
    setScenario(null);
    setFunds((current) => [
      ...current,
      {
        id: nextId("fund"),
        code: fund.code,
        title: fund.title,
        amount: "",
        basis: "current_value",
        since: "",
      },
    ]);
  }

  function removeFund(id: string) {
    setScenario(null);
    const gone = funds.find((f) => f.id === id);
    setFunds((current) => current.filter((f) => f.id !== id));
    // A purchase of a fund that is no longer in the basket has nothing to
    // refer to, so it loses its fund rather than silently pointing nowhere.
    if (gone) {
      setPurchases((current) =>
        current.map((row) => (row.code === gone.code ? { ...row, code: "" } : row)),
      );
    }
  }

  /**
   * Carry what has been typed across the switch.
   *
   * Someone who has filled in three funds and then realises they bought
   * monthly should not find an empty table. Each fund with an amount becomes
   * one purchase, which is exactly what simple mode was already saying.
   */
  function toStaged() {
    setPurchases((current) => {
      if (current.length > 0) return current;
      const seeded = funds
        .filter((fund) => fund.amount.trim())
        .map((fund) => ({
          id: nextId("buy"),
          code: fund.code,
          amount: fund.amount,
          date: fund.since,
        }));
      return seeded.length > 0 ? seeded : [{ id: nextId("buy"), code: "", amount: "", date: "" }];
    });
    setStaged(true);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canAnalyze) return;
    onAnalyze(staged ? "staged" : "simple", funds, purchases);
  }

  /**
   * Fill the form with the next example basket and analyse it in one press.
   *
   * The basket is handed to `onAnalyze` directly rather than read back from
   * state: `setFunds` has not landed yet at this point, and analysing what
   * the form held a moment ago would run the previous basket. It goes into
   * the form as well, so the reader lands on a filled in basket they can
   * edit rather than on a result with nothing behind it.
   *
   * Staged mode is turned off and the purchase rows are dropped. The
   * examples are all simple baskets, and leaving a half filled purchase
   * ledger behind an example that does not use it would make the next switch
   * to staged mode produce a basket nobody typed.
   */
  function loadSample() {
    const { funds: example, scenario: loaded } = nextSample();
    setFunds(example);
    setPurchases([]);
    setStaged(false);
    setScenario(loaded);
    onAnalyze("simple", example, []);
  }

  /**
   * Empty the basket.
   *
   * Both modes at once, and back to simple. Clearing only the mode on screen
   * would leave the other one holding funds the reader believes they have
   * just removed, and they would reappear on the next switch.
   */
  function clearBasket() {
    setFunds([]);
    setPurchases([]);
    setStaged(false);
    setScenario(null);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-section-sm">
      <Reveal>
        <FundSearch chosen={chosen} onChoose={addFund} />
      </Reveal>

      <div>
        {/* The heading and everything that acts on the basket as a whole.
            These used to be one link, and the two that joined it are the
            two ways back out of a basket that is already full: emptying it,
            and replacing it with a different example. Both were previously
            reachable only from the empty state, so trying a second example
            meant deleting five funds one at a time first. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <h2 className="text-display-sm">
            {staged ? "Alımlarınız" : "Sepetiniz"}
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            {!isEmpty && (
              <>
                <BasketAction onClick={clearBasket} disabled={busy}>
                  Sepeti temizle
                </BasketAction>
                <BasketAction onClick={loadSample} disabled={busy}>
                  Başka bir örnek dene
                </BasketAction>
              </>
            )}
            <BasketAction onClick={() => (staged ? setStaged(false) : toStaged())}>
              {staged ? "Basit girişe dön" : "Kademeli alım yaptım"}
            </BasketAction>
          </div>
        </div>

        <div className="mt-6">
          {staged ? (
            <StagedTable
              rows={purchases}
              funds={funds}
              onChange={(id, patch) =>
                setPurchases((current) =>
                  current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                )
              }
              onRemove={(id) =>
                setPurchases((current) => current.filter((row) => row.id !== id))
              }
              onAdd={() =>
                setPurchases((current) => [
                  ...current,
                  { id: nextId("buy"), code: "", amount: "", date: "" },
                ])
              }
            />
          ) : funds.length === 0 ? (
            <EmptyBasket onSample={loadSample} busy={busy} />
          ) : (
            <ul className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {funds.map((fund) => (
                  <FundRow
                    key={fund.id}
                    fund={fund}
                    onChange={(patch) =>
                      setFunds((current) =>
                        current.map((f) => (f.id === fund.id ? { ...f, ...patch } : f)),
                      )
                    }
                    onRemove={() => removeFund(fund.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* Which example is on screen, while it is still that example. It
            goes away the moment a fund is added or removed, because it
            would otherwise describe a basket the reader has changed. */}
        {scenario && !staged && funds.length > 0 && (
          <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
            Örnek sepet: {scenario.note} Tutarları ve tarihleri
            değiştirebilirsiniz.
          </p>
        )}

        <p className="mt-5 max-w-prose text-caption text-ink-subtle">
          {staged
            ? "Aynı fona farklı tarihlerde birden çok alım girebilirsiniz. Ağırlıklar ödediğiniz tutara göre değil, bugünkü değerine göre hesaplanır."
            : "Tek seferde alındığı ve sonrasında ekleme yapılmadığı varsayılır. Düzenli alım yapıyorsan kademeli alım seçeneğini kullan."}
        </p>

        {!staged && check.emptyCodes.length > 0 && (
          <p className="mt-2 max-w-prose text-caption text-caution">
            Tutarı yazılmayan fonlar incelemeye girmez:{" "}
            {check.emptyCodes.join(", ")}
          </p>
        )}

        {staged && check.incomplete > 0 && (
          <p className="mt-2 max-w-prose text-caption text-caution">
            {check.incomplete} satırda tarih, fon veya tutar eksik. Eksik
            satırlar incelemeye girmez.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          ref={submitRef}
          disabled={!canAnalyze}
          className="inline-flex items-center gap-2.5 rounded-control bg-accent px-8 py-4 text-body font-medium text-accent-ink transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.span
                key="busy"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2.5"
              >
                <Spinner />
                İnceleniyor
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                Analiz et
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <p className="text-caption text-ink-subtle" aria-live="polite">
          {buttonHint(check.hasErrors, canAnalyze, busy)}
        </p>
      </div>
    </form>
  );
}

/**
 * One of the actions beside the basket heading.
 *
 * A text button rather than a bordered one. These act on the whole basket
 * and sit next to a heading, and three bordered buttons up there would
 * outweigh the one control on this form that actually runs something.
 */
function BasketAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-label text-accent underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
    >
      {children}
    </button>
  );
}

/**
 * The basket before anything is in it.
 *
 * Two ways forward rather than one instruction. Someone who came with funds
 * in mind uses the search box above and never reads this; someone who does
 * not yet know what the page produces has no way to find out from an empty
 * form, and telling them to go and look up fund codes first is asking for
 * work before showing any reason to do it.
 *
 * What the button promises is deliberately generic now that there are four
 * examples behind it. Describing this one basket here would be wrong for the
 * other three, and the line under the filled in basket says which one
 * arrived anyway — at the point where it is true.
 */
function EmptyBasket({ onSample, busy }: { onSample: () => void; busy: boolean }) {
  return (
    <div className="rounded-card border border-dashed border-border px-6 py-10 text-center">
      <p className="text-caption text-ink-muted">
        Henüz fon seçmediniz. Yukarıdaki kutudan arayarak başlayın.
      </p>

      <button
        type="button"
        onClick={onSample}
        disabled={busy}
        className="mt-5 inline-flex items-center rounded-control border border-border-strong bg-surface px-6 py-3 text-body font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        Örnek sepetle dene
      </button>

      <p className="mx-auto mt-4 max-w-prose text-caption text-ink-subtle text-pretty">
        Hazır bir sepet yüklenir ve hemen incelenir. {SAMPLE_COUNT} farklı örnek
        var; her biri başka bir sonuç gösteriyor. Yükledikten sonra sepeti
        değiştirebilir, sıradaki örneğe geçebilirsiniz.
      </p>
    </div>
  );
}

/**
 * Seed the basket from `?fon=AHB`, once.
 *
 * A fund page links here with its fund already chosen. The codes are read
 * from `window.location` rather than through `useSearchParams`, and that is
 * the whole design decision in this hook: `useSearchParams` inside this
 * component would make the page around it opt out of prerendering unless it
 * were wrapped in a Suspense boundary, and a boundary here means the form is
 * no longer in the HTML this page ships. The form works without JavaScript
 * having run; a prefill cannot, because it has to wait for the registry
 * anyway. So the thing that needs the bundle reads the URL from the bundle,
 * and the thing that does not stays server rendered.
 *
 * It waits for the registry so the row arrives with the fund's name on it. A
 * registry that failed is not a reason to drop the code: `FundRow` already
 * knows how to show a fund whose name could not be verified, and the
 * analysis endpoint never needed the name.
 *
 * Runs once, and never over a basket someone has started filling in.
 */
function useKoprudenGelenler(setFunds: Dispatch<SetStateAction<BasketFund[]>>) {
  const registry = useFundRegistry();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || registry.phase === "loading") return;
    done.current = true;

    const codes = koprudenGelenKodlar(window.location.search);
    if (codes.length === 0) return;

    const known = registry.phase === "ready" ? registry.funds : [];
    setFunds((current) =>
      // The registry can take a moment, and a basket someone has already
      // started is theirs. A link seeds an empty form or nothing.
      current.length > 0
        ? current
        : codes.map((code) => ({
            id: nextId("fund"),
            code,
            title: known.find((fund) => fund.code === code)?.title ?? "",
            amount: "",
            basis: "current_value" as const,
            since: "",
          })),
    );
  }, [registry, setFunds]);
}

function buttonHint(hasErrors: boolean, canAnalyze: boolean, busy: boolean): string {
  if (busy) return "Fon fiyatları getiriliyor.";
  if (hasErrors) return "Kırmızı ile işaretli alanları düzeltin.";
  if (!canAnalyze) return "En az bir fon ve tutarı girin.";
  return "";
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2.4} opacity={0.3} />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}
