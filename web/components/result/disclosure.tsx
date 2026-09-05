"use client";

/**
 * A panel that folds away.
 *
 * A native `<details>` with the open state mirrored into React, so it survives
 * every rerender the controls inside it cause. The content is in the document
 * whether it is open or not and whether or not any JavaScript ran: these are
 * the numbers behind the finding, and a panel that is empty until a bundle
 * arrives is a panel that is sometimes empty.
 *
 * The animation is CSS, in `globals.css`. Browsers that do not have
 * `::details-content` snap open instead, which is the right thing to lose.
 */

import { useState } from "react";

export function Disclosure({
  summary,
  hint,
  children,
}: {
  summary: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="disclosure rounded-card border border-border bg-surface"
    >
      <summary className="flex cursor-pointer items-center gap-3 rounded-card px-6 py-5">
        <Chevron open={open} />
        <span className="text-display-sm">{summary}</span>
        {hint && <span className="ml-auto hidden text-caption text-ink-subtle sm:block">{hint}</span>}
      </summary>
      <div className="border-t border-border px-6 py-8">{children}</div>
    </details>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-5 shrink-0 text-ink-subtle transition-transform duration-300 ease-out-soft motion-reduce:transition-none ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
