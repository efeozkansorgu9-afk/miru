/**
 * The result, in one sentence, before any number the reader has to interpret.
 *
 * Which sentence depends on how much of the basket moves together, and that
 * choice is made in `lib/result`. What this file owns is the volume: the
 * headline is set at display size, the supporting sentences are body copy,
 * and nothing here is painted green or red. A concentrated basket is not a
 * failure and a spread one is not a success, so neither gets a colour that
 * says so.
 */

import { DONEM_NOTU, donemCumlesi, mainFinding } from "@/lib/result";
import type { TableRow } from "@/lib/result";
import type { BasketAnalysis, Grouping } from "@/lib/api";
import { FundTable } from "./fund-table";

export function MainFinding({
  analysis,
  grouping,
  rows,
  partial,
  valuedToday,
}: {
  analysis: BasketAnalysis;
  grouping: Grouping;
  rows: TableRow[];
  partial: boolean;
  valuedToday: boolean;
}) {
  const finding = mainFinding(analysis, grouping, partial);

  return (
    <section aria-labelledby="ana-bulgu" className="scroll-mt-24">
      <p className="text-overline uppercase text-accent">İnceleme sonucu</p>

      <h2 id="ana-bulgu" className="mt-4 max-w-prose text-display-md text-balance">
        {finding.title}
      </h2>

      <div className="mt-5 max-w-prose space-y-3">
        {finding.body.map((sentence) => (
          <p key={sentence} className="text-lead text-ink-muted text-pretty">
            {sentence}
          </p>
        ))}
      </div>

      <p className="mt-6 max-w-prose text-caption text-ink-subtle">
        {donemCumlesi(analysis)} {DONEM_NOTU}
      </p>

      <div className="mt-10">
        <h3 className="text-display-sm">Sepetin dağılımı</h3>
        <div className="mt-5">
          <FundTable rows={rows} valuedToday={valuedToday} />
        </div>
      </div>
    </section>
  );
}
