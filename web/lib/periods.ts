/**
 * What the period comparison says, away from the drawing of it.
 *
 * Every number here arrives from `/market/periods`; this file picks which
 * ones a sentence quotes and words them. Years are written "2025 yılında"
 * rather than with a suffix on the digits, because the suffix on a number
 * depends on how it is read aloud and a wrong one reads as machine-made.
 */

import { AY_KISA } from "@/lib/date";
import { ETKEN_ADLARI } from "@/lib/market";
import type { MarketPeriod, MarketPeriodsResponse } from "@/lib/api";

export function etkenAdi(key: string): string {
  return ETKEN_ADLARI[key] ?? key;
}

function ay(iso: string): string {
  return AY_KISA[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
}

/** "2023", or "2026 (Oca–Eyl)" for a year the grid only partly covers. */
export function donemEtiketi(p: MarketPeriod): string {
  return p.partial ? `${p.key} (${ay(p.start)}–${ay(p.end)})` : p.key;
}

/** Short label for the control, where the months would not fit. */
export function donemKisa(p: MarketPeriod): string {
  return p.partial ? `${p.key}*` : p.key;
}

/** "0,49" with a real minus sign. */
export function iliski(x: number): string {
  return `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(2).replace(".", ",")}`;
}

/** The periods with a mean, lowest and highest, or null when there are too few. */
export function ucDonemler(
  d: MarketPeriodsResponse,
): { dusuk: MarketPeriod; yuksek: MarketPeriod } | null {
  const olculen = d.periods.filter((p) => typeof p.mean_correlation === "number");
  if (olculen.length < 2) return null;
  const sirali = [...olculen].sort(
    (a, b) => (a.mean_correlation ?? 0) - (b.mean_correlation ?? 0),
  );
  return { dusuk: sirali[0], yuksek: sirali[sirali.length - 1] };
}

/** The lead: how far apart the calmest and the most joined-up years were. */
export function donemGirisi(d: MarketPeriodsResponse): string | null {
  const uc = ucDonemler(d);
  if (!uc) return null;
  const { dusuk, yuksek } = uc;
  const fark = (yuksek.mean_correlation ?? 0) - (dusuk.mean_correlation ?? 0);
  const temel =
    `Sekiz varlık sınıfı arasındaki ortalama ilişki (korelasyon) ` +
    `${dusuk.key} yılında ${iliski(dusuk.mean_correlation ?? 0)}, ` +
    `${yuksek.key} yılında ise ${iliski(yuksek.mean_correlation ?? 0)}.`;
  if (fark < 0.15) return temel;
  return (
    temel +
    ` ${yuksek.key} yılında farklı varlıklar çoğu hafta aynı yöne gitti; ` +
    `birden fazla varlık sınıfı tutmanın dalgalanmayı azaltan etkisi o yıl ` +
    `diğer yıllardan zayıftı.`
  );
}

/** The sentence under the selected period's heading. */
export function donemOzeti(p: MarketPeriod): string {
  const n = p.shifts.length;
  if (n === 0) {
    return (
      "Bu dönemde hiçbir ikilinin ilişkisi diğer yıllardakinden belirgin " +
      "biçimde ayrılmıyor."
    );
  }
  return `Bu dönemde ${n} ikilinin ilişkisi diğer yıllardakinden belirgin biçimde ayrılıyor.`;
}
