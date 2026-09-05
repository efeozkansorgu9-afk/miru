/**
 * Everything quantitative, one fold down.
 *
 * The top of the page states the finding in sentences someone with no
 * interest in finance can read. This is where the numbers behind it live, for
 * the reader who wants to check the claim rather than take it: the matrix the
 * grouping came from, the threshold it was cut at, the volatilities, the
 * drawdown with its dates, and what each fund actually delivered.
 *
 * Nothing in here is coloured. A volatility of 29 percent is not a bad number
 * and a diversification ratio of 1.02 is not a good one; they are
 * measurements, and painting them would be the page making a judgement it has
 * no business making.
 */

import type { AnalyzeResponse, BasketAnalysis, Grouping } from "@/lib/api";
import { kisalt, oran, tarih, yuzde } from "@/lib/format";
import { CorrelationHeatmap } from "./correlation-heatmap";
import { Disclosure } from "./disclosure";
import { ResultTable } from "./result-table";
import type { Cell, Column } from "./result-table";

export function TechnicalDetails({
  analysis,
  grouping,
  response,
  /** The window this analysis ran on, already phrased. */
  windowLabel,
}: {
  analysis: BasketAnalysis;
  grouping: Grouping;
  response: AnalyzeResponse;
  windowLabel: string;
}) {
  const coverage = response.coverage;
  const drawdown = analysis.max_drawdown;
  // Sparse funds are the ones whose own gaps narrowed the shared window.
  const sparse = coverage.sparse_codes.filter((code) => code in analysis.weights);

  return (
    <Disclosure summary="Teknik detay" hint={windowLabel}>
      <p className="max-w-prose text-caption text-ink-subtle text-pretty">
        {tarih(analysis.start)} ile {tarih(analysis.end)} arası,{" "}
        {analysis.weekly_observations} haftalık gözlem. Bütün ölçüler haftalık
        getirilerden hesaplanıyor: bazı Türk fonları fiyatını her gün
        güncellemiyor, günlük getiriler yoğun bir sepeti dağılmış gösterirdi.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Figure
          label="Çeşitlendirme oranı"
          value={
            analysis.diversification_ratio === null
              ? "hesaplanamadı"
              : oran(analysis.diversification_ratio)
          }
        />
        <Figure label="Sepet oynaklığı (yıllık)" value={yuzde(analysis.basket_volatility)} />
        <Figure label="En büyük düşüş" value={yuzde(Math.abs(drawdown.depth))} />
      </div>

      <div className="mt-4 max-w-prose space-y-2 text-caption text-ink-subtle">
        <p>
          Çeşitlendirme oranı 1,00 ise fonlar tek fon gibi hareket ediyor demektir.
          Ağırlıklı fon oynaklığı {yuzde(analysis.weighted_fund_volatility)}, sepetin
          kendi oynaklığı {yuzde(analysis.basket_volatility)}.
        </p>
        <p>
          En büyük düşüş {tarih(drawdown.peak_date)} zirvesinden{" "}
          {tarih(drawdown.trough_date)} dibine, {drawdown.duration_days} günde yaşandı.
        </p>
      </div>

      {analysis.correlation && (
        <div className="mt-10">
          <h4 className="text-label text-ink">Korelasyon ısı haritası</h4>
          <div className="mt-4">
            <CorrelationHeatmap correlation={analysis.correlation} />
          </div>
          <p className="mt-4 max-w-prose text-caption text-ink-subtle">
            Gruplama eşiği {oran(grouping.threshold)}. Bir grubun içindeki her ikili
            bu eşiği geçiyor, yalnız zincirin uçları değil.
          </p>
        </div>
      )}

      <div className="mt-10">
        <h4 className="text-label text-ink">Fon oynaklıkları (yıllık)</h4>
        <div className="mt-4">
          <VolatilityTable analysis={analysis} names={coverage.fund_names} />
        </div>
        <p className="mt-3 text-caption text-ink-subtle">
          En oynak fon en üstte. Çubuklar sepetin en oynak fonuna göre ölçekli.
        </p>
      </div>

      <div className="mt-10">
        <h4 className="text-label text-ink">Fonların veri aralıkları</h4>
        <div className="mt-4">
          <CoverageTable analysis={analysis} response={response} />
        </div>
        <p className="mt-3 max-w-prose text-caption text-ink-subtle">
          Kapsama oranı, fonun kendi döneminde beklenen işlem günlerinin ne kadarında
          fiyat verdiğidir. Sağlıklı bir seri resmi tatiller düşüldükten sonra %96
          civarında durur. Eksik günler bütün sepetin ortak dönemini kısaltır.
        </p>

        {sparse.length > 0 && (
          <div className="mt-4 max-w-prose space-y-1">
            {sparse.map((code) => {
              const cov = coverage.fund_coverage[code];
              return (
                <p key={code} className="text-caption text-caution">
                  {code}: kendi döneminde beklenen işlem günlerinin{" "}
                  {yuzde(cov.coverage_ratio)} kadarında fiyat vermiş ({cov.row_count} gün).
                </p>
              );
            })}
          </div>
        )}
      </div>
    </Disclosure>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border bg-canvas-sunken px-5 py-4">
      <p className="text-label text-ink-muted">{label}</p>
      <p className="mt-2 text-display-sm tabular-nums text-ink">{value}</p>
    </div>
  );
}

function VolatilityTable({
  analysis,
  names,
}: {
  analysis: BasketAnalysis;
  names: Record<string, string>;
}) {
  const sorted = Object.entries(analysis.fund_volatility).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"),
  );
  const worst = sorted[0]?.[1] ?? 0;

  const columns: Column[] = [
    { label: "Fon", width: "14%" },
    { label: "Adı", width: "46%", clip: true },
    { label: "Payı", width: "16%", align: "right" },
    { label: "Oynaklık", width: "24%", align: "right" },
  ];

  const rows: Cell[][] = sorted.map(([code, volatility]) => [
    { text: code },
    { text: kisalt(names[code] ?? ""), title: names[code] ?? "" },
    { text: yuzde(analysis.weights[code] ?? 0) },
    { text: yuzde(volatility), bar: worst > 0 ? volatility / worst : 0 },
  ]);

  return (
    <ResultTable
      columns={columns}
      rows={rows}
      caption="Fon bazında yıllık oynaklık"
      minWidth="30rem"
    />
  );
}

function CoverageTable({
  analysis,
  response,
}: {
  analysis: BasketAnalysis;
  response: AnalyzeResponse;
}) {
  const codes = Object.keys(analysis.weights);
  const columns: Column[] = [
    { label: "Fon", width: "16%" },
    { label: "İlk fiyat", width: "24%" },
    { label: "Son fiyat", width: "24%" },
    { label: "Gün", width: "14%", align: "right" },
    { label: "Kapsama", width: "22%", align: "right" },
  ];

  const rows: Cell[][] = codes.map((code) => {
    const cov = response.coverage.fund_coverage[code];
    if (!cov) {
      return [{ text: code }, { text: "" }, { text: "" }, { text: "" }, { text: "" }];
    }
    return [
      { text: code },
      { text: tarih(cov.first_date) },
      { text: tarih(cov.last_date) },
      { text: String(cov.row_count) },
      {
        text: yuzde(cov.coverage_ratio),
        note: cov.is_sparse ? "seyrek" : undefined,
      },
    ];
  });

  return (
    <ResultTable
      columns={columns}
      rows={rows}
      caption="Fonların veri aralıkları"
      minWidth="34rem"
    />
  );
}
