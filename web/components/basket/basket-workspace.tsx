"use client";

/**
 * The input section and the result section, and the one piece of state they
 * share.
 *
 * The form stays on the page under the answer rather than being replaced by
 * it. Reading a result almost always produces the next question, and that
 * question is usually a fund added, an amount corrected or a date filled in,
 * so scrolling back up has to land on the basket exactly as it was left.
 *
 * The page moves itself down to the result once, on submit rather than on
 * arrival: a basket takes a few seconds to fetch, and a reader left staring
 * at the button they just pressed has no way to know anything is happening.
 * What they are moved to is the waiting state, which says so.
 */

import { useEffect, useRef, useState } from "react";

import { analyze } from "@/lib/api";
import { buildSimpleRequest, buildStagedRequest } from "@/lib/request";
import type { BuildResult } from "@/lib/request";
import { errorMessage } from "@/lib/result";
import { Column } from "@/components/column";
import { ResultSection } from "@/components/result/result-section";
import type { ResultState } from "@/components/result/result-section";
import { BasketForm } from "./basket-form";

export function BasketWorkspace() {
  const [state, setState] = useState<ResultState>({ phase: "idle" });
  // Counts submissions rather than watching the phase: pressing the button
  // twice for the same basket should still move the page, and the phase does
  // not change when it does.
  const [submissions, setSubmissions] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  // Only the newest request may write a result. An answer from a basket the
  // user has already changed is worse than no answer.
  const latest = useRef(0);

  useEffect(() => {
    if (submissions === 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor.current?.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "start",
    });
  }, [submissions]);

  async function run(build: BuildResult) {
    setSubmissions((n) => n + 1);

    if (!build.ok) {
      setState({ phase: "error", title: "Sepet incelenemedi.", body: build.error });
      return;
    }

    const id = latest.current + 1;
    latest.current = id;
    setState({ phase: "loading" });

    try {
      const response = await analyze(build.request);
      if (latest.current === id) {
        setState({ phase: "ready", request: build.request, response });
      }
    } catch (error) {
      if (latest.current !== id) return;
      const { title, body } = errorMessage(error);
      setState({ phase: "error", title, body });
    }
  }

  return (
    <>
      {/* The form fills the column rather than sitting in a narrower box
          inside it. Anything less lines up with the result section on the
          left and stops short of it on the right, which is exactly what
          being off centre looks like. */}
      <Column className="pt-section pb-section">
        <BasketForm
          busy={state.phase === "loading"}
          onAnalyze={(mode, funds, purchases) =>
            run(mode === "staged" ? buildStagedRequest(purchases) : buildSimpleRequest(funds))
          }
        />
      </Column>

      {/* `scroll-mt` clears the sticky header, which is 4rem tall. */}
      <div ref={anchor} className="scroll-mt-16">
        <ResultSection state={state} />
      </div>
    </>
  );
}
