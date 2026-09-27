/**
 * What the basket's funds charge, in lira and in percent.
 *
 * The rows keep the fund table's order — groups first, then the funds that
 * stand alone — and are never sorted by fee: a list ordered by price is a
 * shortlist, and this page does not make shortlists. Where a group's funds
 * differ in fee, one sentence states the spread and stops there.
 */

import { InfoTip } from "@/components/info-tip";
import { kisalt, para } from "@/lib/format";
import { UCRET_NOTU, ucretOrani } from "@/lib/fee";
import type { SepetUcreti } from "@/lib/fee";

export function Fees({ ucret }: { ucret: SepetUcreti }) {
  return (
    <section aria-labelledby="ucretler" className="scroll-mt-28 sm:scroll-mt-24">
      <h2 id="ucretler" className="text-display-sm text-balance">
        Bu fonlar yılda ne kadar ücret alıyor?
      </h2>

      <div className="mt-4 max-w-prose space-y-3">
        <p className="text-lead text-ink-muted text-pretty">
          Bugünkü tutarlarla sepetteki fonların yıllık ücreti yaklaşık{" "}
          <strong className="font-medium text-ink tabular-nums">{para(ucret.toplam)}</strong>
          {ucret.ortalama !== null && (
            <>
              ; paraya göre ağırlıklı ortalama oran{" "}
              <strong className="font-medium text-ink tabular-nums">
                {ucretOrani(ucret.ortalama)}
              </strong>
            </>
          )}
          .
          <InfoTip term="ucret" />
        </p>
        {ucret.grupCumleleri.map((c) => (
          <p key={c} className="text-lead text-ink-muted text-pretty">
            {c}
          </p>
        ))}
        {ucret.bilinmeyen.length > 0 && (
          <p className="text-body text-ink-subtle text-pretty">
            TEFAS’ın ücret listesinde bulunmayan {ucret.bilinmeyen.join(", ")} bu
            hesaba katılmadı.
          </p>
        )}
      </div>

      <div className="mt-8 overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">Sepetteki fonların yıllık ücretleri</caption>
          <thead>
            <tr className="border-b border-border text-label text-ink-subtle">
              <th scope="col" className="w-20 px-4 py-2.5 font-normal sm:w-28 sm:px-5">Fon</th>
              <th scope="col" className="hidden py-2.5 font-normal sm:table-cell">Adı</th>
              <th scope="col" className="w-20 py-2.5 text-right font-normal sm:w-28">Oran</th>
              <th scope="col" className="w-28 px-4 py-2.5 text-right font-normal sm:w-36 sm:px-5">
                Yıllık tutar
              </th>
            </tr>
          </thead>
          <tbody className="text-caption tabular-nums">
            {ucret.satirlar.map((s) => (
              <tr key={s.code} className="border-b border-border last:border-b-0">
                <th scope="row" className="px-4 py-2.5 font-normal sm:px-5">
                  <span className="block font-mono text-label text-accent">{s.code}</span>
                  {s.grup && <span className="block whitespace-nowrap text-ink-subtle">{s.grup}</span>}
                </th>
                <td className="hidden truncate py-2.5 pr-3 text-ink-muted sm:table-cell" title={s.name}>
                  {kisalt(s.name, 56)}
                </td>
                <td className="py-2.5 text-right text-ink">
                  {s.fee === null
                    ? "—"
                    : s.fee.rate === 0
                      ? "sıfır bildirilmiş"
                      : ucretOrani(s.fee.rate)}
                  {s.fee?.kind === "operating" && (
                    <span className="block text-ink-subtle">işletim gideri</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-ink sm:px-5">
                  {s.yillik === null ? "—" : `≈ ${para(s.yillik)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 max-w-prose text-caption text-ink-subtle text-pretty">
        {UCRET_NOTU} Yıllık tutar, bugünkü tutar ile oranın çarpımıdır; fonun
        değeri yıl içinde değiştikçe gerçekte ödenen de değişir.
      </p>
    </section>
  );
}
