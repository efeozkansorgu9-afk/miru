import { Column } from "@/components/column";
import { SITE } from "@/lib/site";

/**
 * The bottom of every page: the brand and a way to reach it.
 *
 * Deliberately small. Each page already carries what it needs to say about
 * its own numbers (the fund page's `Footnote`, the method page), so this
 * does not repeat a disclaimer under content that has its own. It only
 * answers the question no page did: who is behind this, and how do I write
 * to them.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <Column className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-8 text-caption text-ink-subtle">
        <span className="font-display font-bold tracking-[-0.04em] text-ink-muted">
          {SITE.brand}
        </span>
        <p>
          İletişim:{" "}
          <a
            href={`mailto:${SITE.contactEmail}`}
            className="text-accent underline-offset-4 hover:underline"
          >
            {SITE.contactEmail}
          </a>
        </p>
      </Column>
    </footer>
  );
}
