/**
 * How a fund's fee is said on the page.
 *
 * Two rules, both from what the number is. The fee is already inside every
 * return this site prints — TEFAS prices are net of it — so nothing is
 * subtracted from anything, and the notes say so. And a fee is printed as a
 * fact beside others, never as a ranking: no "en ucuz", no sorting by fee,
 * no suggestion to move money. Which fund someone holds is theirs to
 * decide; this site shows what is in the basket, not what to buy.
 */

import type { Fee } from "@/lib/api";

/** "%2,04". Two decimals, because fees are quoted to the hundredth. */
export function ucretOrani(rate: number): string {
  return `%${(rate * 100).toFixed(2).replace(".", ",")}`;
}

/** The name of the charge, which differs for pension funds. */
export function ucretAdi(kind: Fee["kind"]): string {
  return kind === "operating" ? "Yıllık fon işletim gideri" : "Yıllık yönetim ücreti";
}

/** Short form for a line of facts: "Yönetim ücreti %2,04 / yıl". */
export function ucretKisa(fee: Fee): string {
  const ad = fee.kind === "operating" ? "İşletim gideri" : "Yönetim ücreti";
  return fee.rate === 0 ? `${ad} sıfır bildirilmiş` : `${ad} ${ucretOrani(fee.rate)} / yıl`;
}

/** A fee usable in a comparison: known and not a reported zero. */
export function karsilastirilabilir(fee: Fee | null | undefined): fee is Fee {
  return !!fee && fee.rate > 0;
}

export const UCRET_NOTU =
  "Oranlar TEFAS’ın yayımladığı, fonun uyguladığı yıllık ücrettir ve fon " +
  "fiyatına günlük olarak yansır: bu sitedeki bütün getiriler ücret " +
  "düşüldükten sonraki getirilerdir. Fonun saklama, denetim gibi diğer " +
  "giderleri de fiyattan düşülür ama bu orana dahil değildir; varsa giriş " +
  "ve çıkış komisyonları ayrıca alınır.";

/* ------------------------------------------------------------------ */
/* The basket                                                          */
/* ------------------------------------------------------------------ */

export interface UcretSatiri {
  code: string;
  name: string;
  /** Today's amount: what was entered, or today's value in staged mode. */
  amount: number;
  fee: Fee | null;
  /** Roughly a year of the fee on today's amount; null when the fee is unknown. */
  yillik: number | null;
  /** "1. grup" or null for a fund standing alone. */
  grup: string | null;
}

export interface SepetUcreti {
  satirlar: UcretSatiri[];
  /** Sum of `yillik` over funds with a known fee. */
  toplam: number;
  /** Money-weighted average rate over funds with a known fee. */
  ortalama: number | null;
  /** Funds TEFAS's list did not carry. */
  bilinmeyen: string[];
  /** One sentence per group whose members' fees differ. */
  grupCumleleri: string[];
}

/**
 * The basket's fees, in the table's own order (groups first, then the rest),
 * so a fee is never the thing the rows are sorted by.
 */
export function sepetUcreti(
  gruplar: { codes: string[] }[],
  tekler: string[],
  fees: Record<string, Fee>,
  amounts: Record<string, number>,
  names: Record<string, string>,
): SepetUcreti | null {
  const siralama: { code: string; grup: string | null }[] = [
    ...gruplar.flatMap((g, i) => g.codes.map((code) => ({ code, grup: `${i + 1}. grup` }))),
    ...tekler.map((code) => ({ code, grup: null })),
  ];
  const satirlar: UcretSatiri[] = siralama.map(({ code, grup }) => {
    const fee = fees[code] ?? null;
    const amount = amounts[code] ?? 0;
    return { code, name: names[code] ?? "", amount, fee, yillik: fee ? amount * fee.rate : null, grup };
  });
  if (!satirlar.some((s) => s.fee)) return null;

  const bilinen = satirlar.filter((s) => s.fee);
  const toplam = bilinen.reduce((a, s) => a + (s.yillik ?? 0), 0);
  const para = bilinen.reduce((a, s) => a + s.amount, 0);

  const grupCumleleri: string[] = [];
  gruplar.forEach((g, i) => {
    const oranlar = g.codes.map((c) => fees[c]).filter(karsilastirilabilir).map((f) => f.rate);
    if (oranlar.length < 2) return;
    const lo = Math.min(...oranlar);
    const hi = Math.max(...oranlar);
    if (hi - lo < 0.0005) return;
    grupCumleleri.push(
      `${i + 1}. grup (${g.codes.join(", ")}) birlikte hareket ediyor; bu fonların ` +
        `yıllık ücretleri ${ucretOrani(lo)} ile ${ucretOrani(hi)} arasında.`,
    );
  });

  return {
    satirlar,
    toplam,
    ortalama: para > 0 ? toplam / para : null,
    bilinmeyen: satirlar.filter((s) => !s.fee).map((s) => s.code),
    grupCumleleri,
  };
}
