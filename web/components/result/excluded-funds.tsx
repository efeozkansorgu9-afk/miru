/**
 * The funds the main result left out, and what the answer looks like with
 * them back in.
 *
 * Drawn only when something was actually excluded. A basket whose funds are
 * all the same age has no section here at all, rather than a heading followed
 * by "none": an empty panel is a thing to read and dismiss on every result.
 *
 * The comparison is always labelled. Two different answers on one page, one
 * over five years and one over eleven months, are worse than one answer
 * unless it is obvious at a glance which is which, and the shorter one comes
 * with the reason it is weaker sitting next to it.
 */

import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/api";
import { kodListesi, yuzde, yuzdeEki } from "@/lib/format";
import {
  birlikteHareketCumlesi,
  exclusionText,
  fundAmounts,
  kisaVeriUyarisi,
  pencereEtiketi,
  pencereMaliyeti,
  tableRows,
} from "@/lib/result";
import { FundTable } from "./fund-table";
import { Callout } from "./callout";

export function ExcludedFunds({
  response,
  request,
}: {
  response: AnalyzeResponse;
  request: AnalyzeRequest;
}) {
  const coverage = response.coverage;
  const codes = Object.keys(coverage.excluded_codes).sort();
  if (codes.length === 0) return null;

  const cost = pencereMaliyeti(
    codes,
    coverage.trimmed_coverage.start,
    coverage.trimmed_coverage.end,
    coverage.full_coverage.start,
    coverage.full_coverage.end,
  );

  return (
    <section aria-labelledby="disarida-kalanlar" className="scroll-mt-24">
      <p className="text-overline uppercase text-ink-subtle">Dışarıda kalanlar</p>

      <h2 id="disarida-kalanlar" className="mt-4 max-w-prose text-display-sm text-balance">
        {kodListesi(codes)} bu incelemenin dışında kaldı.
      </h2>

      <div className="mt-5 max-w-prose space-y-2">
        {codes.map((code) => (
          <p key={code} className="text-body text-ink-muted">
            {exclusionText(
              code,
              coverage.excluded_codes[code].kind,
              coverage.fund_coverage[code],
            )}
          </p>
        ))}
        {cost && <p className="text-body text-ink-muted text-pretty">{cost}</p>}
      </div>

      <FullResult response={response} request={request} />
    </section>
  );
}

/** The same basket over the window every fund shares, clearly marked as such. */
function FullResult({
  response,
  request,
}: {
  response: AnalyzeResponse;
  request: AnalyzeRequest;
}) {
  const coverage = response.coverage;
  const label = pencereEtiketi(
    coverage.full_coverage.start,
    coverage.full_coverage.end,
  );

  if (response.full_analysis_status !== "ok" || !response.full_analysis) {
    return (
      <div className="mt-8">
        <Callout tone="neutral">
          {response.full_analysis_status === "out_of_window"
            ? "Alım tarihleriniz, bütün fonların birlikte işlem gördüğü dönemden " +
              "önce kaldığı için bu karşılaştırma yapılamadı."
            : "Bütün fonların birlikte işlem gördüğü, karşılaştırma yapmaya yetecek " +
              "bir dönem yok."}
        </Callout>
      </div>
    );
  }

  const analysis = response.full_analysis;
  const grouping = response.full_grouping!;
  const rows = tableRows(
    analysis,
    grouping,
    coverage.fund_names,
    fundAmounts(analysis, request),
  );
  const pay = grouping.grouped_weight;

  return (
    // `surface`, not `sunken`: the result band is already sunken, and in dark
    // a card painted the same colour as the band it sits in disappears.
    // Surfaces lift by getting lighter in dark and stay white in light.
    <div className="mt-10 rounded-card border border-border bg-surface p-6 sm:p-8">
      <h3 className="text-display-sm text-balance">
        Bütün fonlar dahil edildiğinde ({label})
      </h3>

      <div className="mt-4 max-w-prose space-y-2">
        {grouping.groups.length === 0 ? (
          <p className="text-body text-ink-muted">
            Bu dönemde birlikte hareket eden fon çifti bulunamadı.
          </p>
        ) : (
          <>
            <p className="text-body text-ink-muted">
              Paranın {yuzde(pay)}
              {yuzdeEki(pay)} birlikte hareket eden fonlarda.
            </p>
            {grouping.groups.map((group) => (
              <p key={group.codes.join()} className="text-body text-ink-muted">
                {birlikteHareketCumlesi(group.codes, group.min_correlation)}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="mt-6">
        <FundTable rows={rows} valuedToday={analysis.purchases !== null} />
      </div>

      {coverage.full_coverage.below_weekly_threshold && (
        <div className="mt-6">
          <Callout tone="attention">
            {kisaVeriUyarisi(coverage.full_coverage.weekly_observations)}
          </Callout>
        </div>
      )}
    </div>
  );
}
