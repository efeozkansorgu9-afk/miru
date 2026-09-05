"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";

import {
  checkSimpleBasket,
  checkStagedBasket,
  nextId,
} from "@/lib/basket";
import type { BasketFund, PurchaseRow } from "@/lib/basket";
import type { SearchableFund } from "@/lib/funds";
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
  busy = false,
}: {
  /** Hands the basket to whoever owns the result. Called only when valid. */
  onAnalyze: (
    mode: "simple" | "staged",
    funds: BasketFund[],
    purchases: PurchaseRow[],
  ) => void;
  /** True while the analysis is in flight; the button says so and locks. */
  busy?: boolean;
}) {
  const [funds, setFunds] = useState<BasketFund[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [staged, setStaged] = useState(false);
  const reduceMotion = useReducedMotion();

  const chosen = useMemo(() => new Set(funds.map((f) => f.code)), [funds]);

  const check = staged ? checkStagedBasket(purchases) : checkSimpleBasket(funds);
  const canAnalyze = check.canAnalyze && !busy;

  function addFund(fund: SearchableFund) {
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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-section-sm">
      <Reveal>
        <FundSearch chosen={chosen} onChoose={addFund} />
      </Reveal>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-display-sm">
            {staged ? "Alımlarınız" : "Sepetiniz"}
          </h2>
          <button
            type="button"
            onClick={() => (staged ? setStaged(false) : toStaged())}
            className="text-label text-accent underline-offset-4 transition-colors hover:underline"
          >
            {staged ? "Basit girişe dön" : "Kademeli alım yaptım"}
          </button>
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
            <p className="rounded-card border border-dashed border-border px-6 py-10 text-center text-caption text-ink-muted">
              Henüz fon seçmediniz. Yukarıdaki kutudan arayarak başlayın.
            </p>
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
