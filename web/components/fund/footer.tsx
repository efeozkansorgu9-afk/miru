/**
 * When the numbers were computed, and what they are not.
 *
 * The date is not a formality. Every figure on this page was written by a
 * weekly job, not fetched when the page was opened, so a reader looking at a
 * correlation is looking at last week's — and the page says which week
 * rather than letting it be assumed to be today's.
 *
 * The disclaimer is plain and sits once, at the bottom. Repeating it beside
 * every number would be louder without being clearer, and this product does
 * not tell anyone what to buy anywhere on it.
 */

import Link from "next/link";

import type { DataFreshness } from "@/lib/api";
import { ayYil, tarih } from "@/lib/format";
import { TOOL } from "@/lib/site";

export function Footnote({ freshness }: { freshness: DataFreshness }) {
  return (
    <section className="border-t border-border pt-8">
      <p className="max-w-prose text-caption text-ink-subtle text-pretty">
        {veriTarihi(freshness)}
      </p>
      <p className="mt-2 max-w-prose text-caption text-ink-subtle text-pretty">
        Bu sayfa yatırım tavsiyesi değildir. Geçmiş getiriler gelecek getiriyi
        göstermez, ve birlikte hareket etmiş iki fonun bundan sonra da birlikte
        hareket edeceğinin bir güvencesi yoktur.
      </p>
    </section>
  );
}

/**
 * The run behind the page.
 *
 * The CPI month is in the same sentence because it is the other date the
 * figures depend on and it is not the same date: prices are as of the run,
 * and the real returns stop at the last index TÜİK published, which is
 * usually a month behind it.
 */
function veriTarihi(freshness: DataFreshness): string {
  if (!freshness.last_run_at) {
    return "Bu sayfadaki sayıların ne zaman hesaplandığı kayıtlı değil.";
  }

  const gun = tarih(freshness.last_run_at.slice(0, 10));
  const sayilar =
    freshness.included_funds !== null
      ? `${freshness.included_funds} fon üzerinden hesaplandı`
      : "hesaplandı";
  const tufe = freshness.cpi_latest_month
    ? ` Enflasyondan arındırılmış getiriler TÜİK'in ${ayYil(freshness.cpi_latest_month)} endeksine kadar ölçülüyor.`
    : "";

  return `Veriler ${gun} tarihinde, ${sayilar}.${tufe}`;
}

/**
 * The way out of a single fund and into a basket.
 *
 * This page answers "what else is this fund", and the question after it is
 * almost always "and what does that do to what I already hold", which is the
 * other tool. The fund arrives in the basket already chosen, because asking
 * someone to type a code they have just been reading is asking them to do
 * the page's work.
 */
export function BasketBridge({ code }: { code: string }) {
  return (
    <section className="flex flex-col gap-6 rounded-card border border-border bg-surface px-6 py-6 sm:px-8 sm:py-7 md:flex-row md:items-center md:justify-between md:gap-10">
      <div className="min-w-0">
        <h2 className="text-display-sm text-balance">
          Bu fon sizin sepetinizde ne yapıyor?
        </h2>
        <p className="mt-2 max-w-prose text-body text-ink-muted text-pretty">
          {TOOL.name}, elinizdeki fonların gerçekte kaç ayrı şeye yatırıldığını
          gösterir. {code} seçili olarak açılır, yanına kendi fonlarınızı
          ekleyebilirsiniz.
        </p>
      </div>
      <Link
        href={`${TOOL.href}?fon=${code}`}
        className="group inline-flex shrink-0 items-center gap-2 self-start rounded-control bg-accent px-5 py-3 text-body font-medium text-accent-ink shadow-sm transition-[background-color,transform] duration-200 hover:bg-accent-hover active:scale-[0.98] md:self-auto"
      >
        {code} ile sepet kur
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 transition-transform duration-300 ease-out-soft group-hover:translate-x-0.5 motion-reduce:transition-none"
        >
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </Link>
    </section>
  );
}
