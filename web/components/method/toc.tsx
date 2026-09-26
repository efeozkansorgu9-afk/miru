"use client";

import { useEffect, useState } from "react";

import { Numara } from "./numara";

export interface TocItem {
  id: string;
  baslik: string;
  ozet: string;
}

/**
 * The page's contents, twice: a card of the sections at the top for small
 * screens, and a sticky rail beside the text from `lg` up that follows the
 * reader down the page.
 *
 * Both are in the server HTML. The rail's highlight is the only thing that
 * needs the browser, and without it the rail is still a working list.
 */
export function TocCard({ items }: { items: readonly TocItem[] }) {
  return (
    <nav
      aria-label="Bu sayfada"
      className="rounded-card border border-border bg-surface p-2 lg:hidden"
    >
      <p className="px-4 pt-3 pb-2 text-overline uppercase text-ink-subtle">
        Bu sayfada
      </p>
      <ol className="grid sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="group flex gap-3.5 rounded-control px-4 py-3 transition-colors hover:bg-canvas-sunken"
            >
              <Numara n={i + 1} />
              <span className="min-w-0">
                <span className="block text-body font-medium text-ink transition-colors group-hover:text-accent">
                  {item.baslik}
                </span>
                <span className="mt-0.5 block text-caption text-ink-subtle text-pretty">
                  {item.ozet}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TocRail({ items }: { items: readonly TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // A section is "current" once its top has passed a line a third of the
    // way down the screen, which is roughly where a reader's eyes are.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -65% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="Bu sayfada" className="sticky top-28 hidden lg:block">
      <p className="text-overline uppercase text-ink-subtle">Bu sayfada</p>
      <ol className="mt-4 border-l border-border">
        {items.map((item, i) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={`-ml-px flex items-baseline gap-2.5 border-l-2 py-1.5 pl-4 text-caption transition-colors ${
                  current
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-subtle hover:text-ink"
                }`}
              >
                <span
                  className={`font-display text-label font-semibold tabular-nums ${
                    current ? "text-accent" : ""
                  }`}
                >
                  {i + 1}
                </span>
                {item.baslik}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
