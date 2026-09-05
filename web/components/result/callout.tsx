/**
 * A boxed remark.
 *
 * Two tones only. `attention` is amber and means read this before trusting
 * the number next to it; `neutral` is a plain surface and means this is
 * context. There is deliberately no success tone: nothing on this page is a
 * result to congratulate someone on.
 */
export function Callout({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "attention";
  children: React.ReactNode;
}) {
  return (
    <p
      className={`max-w-prose rounded-card border px-5 py-4 text-caption text-pretty ${
        tone === "attention"
          ? "border-caution/35 bg-caution/8 text-ink"
          : "border-border bg-canvas-sunken text-ink-muted"
      }`}
    >
      {children}
    </p>
  );
}
