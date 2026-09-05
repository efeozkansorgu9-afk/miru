"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { API_BASE_URL, ApiError, getHealth } from "@/lib/api";
import type { HealthResponse } from "@/lib/api";
import { Reveal } from "./reveal";

type State =
  | { phase: "loading" }
  | { phase: "ok"; health: HealthResponse }
  | { phase: "error"; error: ApiError };

/**
 * Live check that the backend is reachable.
 *
 * Here to prove the API layer works end to end while there are no screens to
 * prove it. It is also the one place so far that turns a state code into
 * Turkish, which is the division of labour the whole product follows: the
 * backend returns `kind`, this side writes the sentence.
 */
export function ApiStatus() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    getHealth({ signal: controller.signal })
      .then((health) => setState({ phase: "ok", health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError("unexpected", "Beklenmeyen bir sorun çıktı."),
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <Reveal delay={100} className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-start gap-3">
        <Dot phase={state.phase} />
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink">{headline(state)}</p>
          <p className="mt-1 text-caption text-ink-muted text-pretty">
            {detail(state)}
          </p>
          <p className="mt-3 font-mono text-caption text-ink-subtle break-all">
            {API_BASE_URL}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

function headline(state: State): string {
  switch (state.phase) {
    case "loading":
      return "Sunucuya bağlanılıyor";
    case "ok":
      return "Sunucu bağlantısı kuruldu";
    case "error":
      return "Sunucuya ulaşılamadı";
  }
}

/** One sentence per failure kind. The backend sends a code, this writes the text. */
function detail(state: State): string {
  if (state.phase === "loading") return "Bir saniye.";
  if (state.phase === "ok") {
    return `Servis sürümü ${state.health.version}. Fon verisi ve analiz için hazır.`;
  }

  switch (state.error.kind) {
    case "network":
      return "Adres yanıt vermiyor. Arka uç çalışıyor mu? Depo kökünde uvicorn api.main:app --port 8000 komutunu çalıştırın.";
    case "timeout":
      return "Sunucu zamanında yanıt vermedi. Bir kez daha deneyin.";
    case "upstream":
      return "Arka uç ayakta ama TEFAS yanıt vermiyor. Bu geçici bir durum, biraz sonra tekrar deneyin.";
    case "server":
      return "Arka uçta bir sorun çıktı. Ayrıntı sunucu günlüğünde.";
    default:
      return "Bağlantı kurulamadı.";
  }
}

/** Amber for waiting, green for reachable, red for not. Status only. */
function Dot({ phase }: { phase: State["phase"] }) {
  const tone =
    phase === "ok"
      ? "bg-positive"
      : phase === "error"
        ? "bg-negative"
        : "bg-caution";

  return (
    <span className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center">
      {phase === "loading" && (
        <motion.span
          className={`absolute size-2.5 rounded-full ${tone}`}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className={`size-2.5 rounded-full ${tone}`} />
    </span>
  );
}
