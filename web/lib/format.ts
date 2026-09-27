/**
 * Turkish number, money and date formatting.
 *
 * Every sentence in this product is written on the frontend, so the pieces
 * those sentences are built from live here rather than being reinvented in
 * each component. The edge cases are the Turkish ones: a percentage takes a
 * suffix that depends on how the number is *read*, and "3 yıl" and "5 hafta"
 * do not take the same one.
 */

import { AY_ADLARI, AY_KISA } from "@/lib/date";

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/** 0.38 becomes "%38". Turkish puts the sign before the number. */
export function yuzde(x: number): string {
  return `%${Math.round(x * 100)}`;
}

/**
 * A percentage that can be negative, for returns.
 *
 * The minus sign goes in front of the whole thing, not between the sign and
 * the digits: "-%12", never "%-12".
 */
export function yuzdeIsaretli(x: number): string {
  if (!Number.isFinite(x)) return "hesaplanamadı";
  const n = Math.round(Math.abs(x) * 100);
  return x < 0 ? `-%${n}` : `%${n}`;
}

/**
 * A percentage that keeps a decimal below ten: "%0,8", "%4,2", "%22".
 *
 * For volatility and drawdown, where a money market fund sits at a fraction
 * of a percent and whole numbers turned it into "%1" and "%0" — the second
 * reading as no movement at all when there was some.
 */
export function yuzdeHassas(x: number): string {
  if (!Number.isFinite(x)) return "hesaplanamadı";
  const a = Math.abs(x) * 100;
  const sign = x < 0 ? "-" : "";
  return a < 10 ? `${sign}%${a.toFixed(1).replace(".", ",")}` : `${sign}%${Math.round(a)}`;
}

/** Two decimals, for a ratio nobody reads as a percentage. */
export function oran(x: number): string {
  return x.toFixed(2).replace(".", ",");
}

/**
 * A correlation read off a chart, to three decimals: "0,996".
 *
 * Finer than `oran` on purpose, and only where a single value is being
 * reported rather than described. Two decimals print 0,9956 as "1,00", which
 * does not say "very nearly identical", it says "identical" — a value the
 * maths reserves for a fund against itself. The extra digit costs nothing on
 * a figure that is already the point of the card it sits in.
 */
export function korelasyon(x: number): string {
  return x.toFixed(3).replace(".", ",");
}

/** Lira, rounded to whole units and grouped the Turkish way: "1.250.000 TL". */
export function para(x: number): string {
  const sign = x < 0 ? "-" : "";
  const whole = Math.round(Math.abs(x));
  return `${sign}${whole.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL`;
}

/** A whole count, grouped the Turkish way: "307.603". */
export function sayi(n: number): string {
  return Math.round(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

/**
 * Lira at the scale a fund is sized in: "984 mn TL", "29,4 mr TL".
 *
 * `para` is right for a basket, where the reader put the number in and wants
 * it back unchanged. A fund's assets run to eleven digits, and eleven digits
 * inside a four line popover is a string nobody reads and a box that wraps.
 * The step is chosen from the magnitude, and a value under a million is
 * printed in full rather than as "0,4 mn", which says less than the digits do.
 */
export function paraKisa(x: number): string {
  const sign = x < 0 ? "-" : "";
  const n = Math.abs(x);
  // A whole market is sized in trillions; "6079 mr TL" is four digits and
  // a unit nobody converts in their head.
  if (n >= 1e12) return `${sign}${birBasamak(n / 1e12)} trn TL`;
  if (n >= 1e9) return `${sign}${birBasamak(n / 1e9)} mr TL`;
  if (n >= 1e6) return `${sign}${birBasamak(n / 1e6)} mn TL`;
  return para(x);
}

/** One decimal, dropped when it is a zero: "29,4" and "984", never "984,0". */
function birBasamak(x: number): string {
  const rounded = Math.round(x * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
}

/**
 * The suffix a percentage takes when it becomes the subject of a sentence.
 *
 * "%26" plus a suffix is "%26'sı", because it is read "yüzde yirmi altı".
 * The suffix follows the last spoken syllable, so it is chosen from the last
 * digit, and from the tens when the number ends in zero. Getting this wrong
 * is the difference between a sentence a Turkish speaker reads without
 * noticing and one that reads like a machine wrote it.
 */
const EKI_BIRLER: Record<number, string> = {
  0: "'ı",
  1: "'i",
  2: "'si",
  3: "'ü",
  4: "'ü",
  5: "'i",
  6: "'sı",
  7: "'si",
  8: "'i",
  9: "'u",
};

const EKI_ONLAR: Record<number, string> = {
  0: "'ı",
  1: "'u",
  2: "'si",
  3: "'u",
  4: "'ı",
  5: "'si",
  6: "'ı",
  7: "'i",
  8: "'i",
  9: "'ı",
  10: "'ü",
};

export function yuzdeEki(x: number): string {
  const n = Math.round(x * 100);
  if (n === 100) return "'ü";
  if (n % 10 === 0) return EKI_ONLAR[n / 10] ?? "'ı";
  return EKI_BIRLER[n % 10];
}

const SAYI_KELIME: Record<number, string> = {
  2: "iki",
  3: "üç",
  4: "dört",
  5: "beş",
  6: "altı",
  7: "yedi",
  8: "sekiz",
  9: "dokuz",
  10: "on",
};

/** "iki fonda" reads better than "2 fonda" for the small counts we get. */
export function sayiKelime(n: number): string {
  return SAYI_KELIME[n] ?? String(n);
}

/* ------------------------------------------------------------------ */
/* Dates and spans                                                     */
/* ------------------------------------------------------------------ */

/** "2026-09-04" becomes "4 Eylül 2026". Parsed as a plain calendar date. */
export function tarih(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${AY_ADLARI[m - 1]} ${y}`;
}

/** "2026-08" becomes "Ağustos 2026". */
export function ayYil(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return `${AY_ADLARI[m - 1]} ${y}`;
}

/**
 * "2026-08-01" becomes "Ağu 2026".
 *
 * For a window printed beside its own length — "36 ay (Eyl 2023 – Ağu 2026)"
 * — where the full month names make a line that wraps and says no more.
 */
export function ayYilKisa(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return `${AY_KISA[m - 1]} ${y}`;
}

/** Whole days between two ISO dates. */
export function gunFarki(baslangic: string, bitis: string): number {
  const a = Date.parse(`${baslangic}T00:00:00Z`);
  const b = Date.parse(`${bitis}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** A day count as something a person would say: "3 yıl", "2 ay", "5 hafta". */
export function sure(gunSayisi: number): string {
  if (gunSayisi >= 350) return `${Math.round(gunSayisi / 365)} yıl`;
  if (gunSayisi >= 25) return `${Math.round(gunSayisi / 30)} ay`;
  return `${Math.max(1, Math.round(gunSayisi / 7))} hafta`;
}

/**
 * "2 ay" becomes "2 ayla".
 *
 * The instrumental suffix fuses with a word ending in a consonant and takes a
 * buffer after a vowel, which is why this cannot be a single appended string.
 */
export function sureIle(metin: string): string {
  if (metin.endsWith("hafta")) return `${metin}yla`;
  if (metin.endsWith("yıl") || metin.endsWith("ay")) return `${metin}la`;
  return `${metin} ile`;
}

/** Length of a matrix window, or null when it has none. */
export function araligiSure(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return sure(gunFarki(start, end));
}

/* ------------------------------------------------------------------ */
/* Lists and text                                                      */
/* ------------------------------------------------------------------ */

/** ["A", "B", "C"] becomes "A, B ve C". */
export function kodListesi(kodlar: readonly string[]): string {
  const list = [...kodlar];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} ve ${list[list.length - 1]}`;
}

/**
 * Shorten a fund title so a fixed width column stays readable.
 *
 * The full title always goes into a `title` attribute next to it: shortening
 * is a layout decision, and nothing the user might need should only exist in
 * the truncated form.
 */
export function kisalt(metin: string, n = 44): string {
  return metin.length <= n ? metin : `${metin.slice(0, n - 1).trimEnd()}…`;
}
