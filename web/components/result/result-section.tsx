"use client";

/**
 * The result screen.
 *
 * Six blocks in a fixed order, from the sentence anyone can read down to the
 * numbers only some people want. Nothing here computes anything: the wording
 * lives in `lib/result` and the arithmetic lives in the Python behind the
 * API, so this file is layout, order and which blocks exist for this answer.
 *
 * Every block is a real section with its own heading, and none of them are
 * hidden behind an animation. Motion is used to soften the arrival of the
 * whole panel and nothing depends on it having run.
 */

import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/api";
import { Reveal } from "@/components/reveal";
import {
  analysisStatusText,
  chartData,
  fundAmounts,
  pencereEtiketi,
  returnFigures,
  tableRows,
} from "@/lib/result";
import { Callout } from "./callout";
import { ExcludedFunds } from "./excluded-funds";
import { FailedCodes } from "./failed-codes";
import { MainFinding } from "./main-finding";
import { Returns } from "./returns";
import { TechnicalDetails } from "./technical-details";
import { ValueChart } from "./value-chart";

export type ResultState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; title: string; body: string }
  | { phase: "ready"; request: AnalyzeRequest; response: AnalyzeResponse };

export function ResultSection({ state }: { state: ResultState }) {
  if (state.phase === "idle") return null;

  return (
    <div className="border-t border-border bg-canvas-sunken">
      <div className="mx-auto w-full max-w-page px-gutter py-section">
        {state.phase === "loading" && <Loading />}
        {state.phase === "error" && <Failure title={state.title} body={state.body} />}
        {state.phase === "ready" && (
          <Result request={state.request} response={state.response} />
        )}
      </div>
    </div>
  );
}

function Result({
  request,
  response,
}: {
  request: AnalyzeRequest;
  response: AnalyzeResponse;
}) {
  const coverage = response.coverage;
  const analysis = response.analysis;
  const grouping = response.grouping;

  if (!analysis || !grouping) {
    return (
      <div className="space-y-6">
        <h2 className="max-w-prose text-display-sm text-balance">
          Bu sepet incelenemedi.
        </h2>
        <Callout tone="attention">{analysisStatusText(response.analysis_status)}</Callout>
        <FailedCodes coverage={coverage} />
      </div>
    );
  }

  const figures = returnFigures(response, request);
  const chart = chartData(response, request);
  const excluded = Object.keys(coverage.excluded_codes).length > 0;

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <MainFinding
          analysis={analysis}
          grouping={grouping}
          rows={tableRows(
            analysis,
            grouping,
            coverage.fund_names,
            fundAmounts(analysis, request),
          )}
          partial={excluded}
          valuedToday={analysis.purchases !== null}
        />
      </Reveal>

      {(excluded || Object.keys(coverage.failed_codes).length > 0) && (
        <Reveal delay={60} className="space-y-8">
          <ExcludedFunds response={response} request={request} />
          <FailedCodes coverage={coverage} />
        </Reveal>
      )}

      {figures && (
        <Reveal delay={90}>
          <Returns figures={figures} realReturn={response.real_return} />
        </Reveal>
      )}

      {chart && chart.points.length > 1 && (
        <Reveal delay={120}>
          <ValueChart data={chart} staged={analysis.purchases !== null} />
        </Reveal>
      )}

      <Reveal delay={150}>
        <TechnicalDetails
          analysis={analysis}
          grouping={grouping}
          response={response}
          windowLabel={pencereEtiketi(
            coverage.trimmed_coverage.start,
            coverage.trimmed_coverage.end,
          )}
        />
      </Reveal>
    </div>
  );
}

/**
 * The wait.
 *
 * A cold basket is one TEFAS request per fund at half a second apart plus a
 * CPI call, so this is on screen for a few seconds and has to say what is
 * happening rather than spin. The shapes below stand where the result will
 * be, so the page does not jump when it arrives.
 */
function Loading() {
  return (
    <div aria-live="polite" aria-busy="true">
      <p className="text-overline uppercase text-accent">İnceleme sürüyor</p>
      <h2 className="mt-4 max-w-prose text-display-md text-balance">
        Fon fiyatları TEFAS&apos;tan alınıyor.
      </h2>
      <p className="mt-5 max-w-prose text-lead text-ink-muted">
        Her fon için beş yıllık fiyat geçmişi çekiliyor. Bu birkaç saniye sürebilir.
      </p>

      <div className="mt-12 space-y-4" aria-hidden="true">
        <Skeleton className="h-12 w-full max-w-xl" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="mt-10 h-56 w-full" />
      </div>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-control bg-border motion-reduce:animate-none ${className ?? ""}`}
    />
  );
}

function Failure({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert">
      <p className="text-overline uppercase text-caution">Sonuç alınamadı</p>
      <h2 className="mt-4 max-w-prose text-display-md text-balance">{title}</h2>
      <p className="mt-5 max-w-prose text-lead text-ink-muted text-pretty">{body}</p>
      <p className="mt-6 max-w-prose text-caption text-ink-subtle">
        Sepetiniz olduğu gibi duruyor. Yukarıdaki bilgileri değiştirmeden tekrar
        deneyebilirsiniz.
      </p>
    </div>
  );
}
