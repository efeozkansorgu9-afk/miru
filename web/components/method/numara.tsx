/** A section number as a small disc, in the heading face rather than code. */
export function Numara({ n, size = "sm" }: { n: number; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-surface font-display font-semibold text-accent tabular-nums ${
        size === "md" ? "size-8 text-body" : "mt-0.5 size-6 text-label"
      }`}
    >
      {n}
    </span>
  );
}
