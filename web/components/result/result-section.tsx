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
import { Column } from "@/components/column";
import { Reveal } from "@/components/reveal";
import { ScrollRise } from "@/components/scroll-rise";
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
import { RollingCorrelation } from "./rolling-correlation";
import { TechnicalDetails } from "./technical-details";
import { ValueChart } from "./value-chart";

export type ResultState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; title: string; body: string }
  | { phase: "ready"; request: AnalyzeRequest; response: AnalyzeResponse };

export function ResultSection({
  state,
  stale = false,
  onBackToBasket,
}: {
  state: ResultState;
  /** The basket has been edited since this result was computed. */
  stale?: boolean;
  /** Takes the reader back to the form. Navigation, not a second submit. */
  onBackToBasket?: () => void;
}) {
  if (state.phase === "idle") return null;

  return (
    <div className="border-t border-border bg-canvas-sunken">
      <Column className="py-section">
        {state.phase === "loading" && <Loading />}
        {state.phase === "error" && <Failure title={state.title} body={state.body} />}
        {state.phase === "ready" && (
          <>
            {stale && <StaleNotice onBackToBasket={onBackToBasket} />}
            {/* Faded rather than hidden. What is underneath is still a real
                answer about a real basket, and someone who has just removed
                one fund of five is usually still reading the rest of it.
                Removing it would also collapse the page under the reader
                mid-scroll. Dimming says "not about what you are looking at
                any more" without taking it away, and the notice above says
                which. Pointer events stay on: the disclosure sections and
                the chart tooltips still work.

                85%, measured rather than chosen by eye. Composited over the
                section ground, the muted body text reads 2,09:1 at 45% and
                3,88:1 at 75% — both under the 4,5:1 that normal text needs,
                so at either value the dimming was damage rather than a
                signal. 85% is the lowest step that clears it in *both*
                themes (4,91:1 light, 5,14:1 dark); 80% clears dark at 4,69:1
                and fails light at 4,36:1. A light dim is enough because it
                is no longer carrying the message on its own: the sticky
                notice above says why, for as long as any of this is on
                screen. */}
            <div
              className={
                stale ? "opacity-85 transition-opacity duration-200" : undefined
              }
            >
              <Result request={state.request} response={state.response} />
            </div>
          </>
        )}
      </Column>
    </div>
  );
}

/**
 * The result no longer describes the basket in the form.
 *
 * Written here rather than fetched: the API knows nothing about what is
 * typed in a form it has not been sent, and this is a statement about the
 * page, not about any analysis.
 *
 * ## Why it is sticky
 *
 * A result runs several screens deep. Pinned to the top of the section, the
 * notice scrolled away within one flick and left a faded page with no
 * remaining explanation of why it was faded — the dimming became damage
 * rather than a signal. It now sticks under the header for as long as any
 * part of the result is on screen, so the reason is never further away than
 * the thing it explains. `top-16` is the header's own height; `z-30` sits
 * under the header's 50 and over the `ScrollRise` sections, which — like
 * `Reveal` — each hold a permanent stacking context.
 *
 * The sticky wrapper carries a **solid** background. The tint alone is 8%
 * caution over the ground, which is fine in flow and useless once result
 * content is passing behind it.
 *
 * ## Why the action does not re-run the analysis
 *
 * It navigates. The analysis is a TEFAS fetch per fund, and the control that
 * starts one lives with the basket it would be about; a second trigger down
 * here would let someone re-run a basket they cannot see. So "Sepete dön"
 * puts the form and its own button back on screen and focuses that button —
 * the next press is theirs, in front of the basket it applies to.
 */
function StaleNotice({ onBackToBasket }: { onBackToBasket?: () => void }) {
  return (
    <div className="sticky top-16 z-30 -mx-gutter mb-6 bg-canvas-sunken px-gutter pb-6 pt-4">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-caution/35 bg-caution/8 px-5 py-4"
      >
        <p className="text-body font-medium text-ink">Sepet değişti.</p>
        <p className="min-w-0 flex-1 text-caption text-ink-muted">
          Aşağıdaki sonuç sepetin önceki hâline ait. Güncel sonuç için tekrar
          analiz edin.
        </p>
        {onBackToBasket && (
          <button
            type="button"
            onClick={onBackToBasket}
            className="shrink-0 rounded-control border border-border-strong bg-surface px-4 py-2 text-label font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Sepete dön
          </button>
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

      {/* Directly under the finding, because it answers the question the
          finding provokes: the headline says a pair moves together, and the
          obvious next thought is whether it always did. Absent entirely when
          the basket has one fund or too little shared history to draw a
          history of, rather than shown empty. */}
      {response.rolling_correlation && (
        <ScrollRise>
          <RollingCorrelation rolling={response.rolling_correlation} />
        </ScrollRise>
      )}

      {(excluded || Object.keys(coverage.failed_codes).length > 0) && (
        <ScrollRise className="space-y-8">
          <ExcludedFunds response={response} request={request} />
          <FailedCodes coverage={coverage} />
        </ScrollRise>
      )}

      {figures && (
        <ScrollRise>
          <Returns figures={figures} realReturn={response.real_return} />
        </ScrollRise>
      )}

      {chart && chart.points.length > 1 && (
        <ScrollRise>
          <ValueChart data={chart} staged={analysis.purchases !== null} />
        </ScrollRise>
      )}

      <ScrollRise>
        <TechnicalDetails
          analysis={analysis}
          grouping={grouping}
          response={response}
          windowLabel={pencereEtiketi(
            coverage.trimmed_coverage.start,
            coverage.trimmed_coverage.end,
          )}
        />
      </ScrollRise>
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
