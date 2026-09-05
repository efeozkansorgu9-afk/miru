/**
 * Codes that returned nothing.
 *
 * Never skipped in silence. Someone who typed five funds and got four back
 * has to be told which one is missing and why, or they will read the result
 * as covering money it does not cover.
 */

import type { Coverage } from "@/lib/api";
import { failureText } from "@/lib/result";
import { Callout } from "./callout";

export function FailedCodes({ coverage }: { coverage: Coverage }) {
  const entries = Object.entries(coverage.failed_codes);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      {entries.map(([code, failure]) => (
        <Callout key={code} tone="attention">
          {failureText(code, failure.kind)}
        </Callout>
      ))}
    </div>
  );
}
