/**
 * Product identity, in one place.
 *
 * The name is expected to change. Everything that shows it to a user or
 * writes it into a document title reads it from here, so a rename is this
 * file and nothing else. Do not type the product name into a component.
 */
export const SITE = {
  /** Shown in the navigation bar and at the end of every page title. */
  name: "Miru",
  /** One line, used as the meta description. */
  description:
    "Türk yatırım fonlarından kurulmuş bir sepetin gerçekte ne kadar dağıldığını gösterir.",
  /** Fallback language for the document and for date and number formatting. */
  locale: "tr-TR",
  lang: "tr",
} as const;

/** "Sepet" becomes "Sepet · Miru". Pass nothing on the home page. */
export function pageTitle(section?: string): string {
  return section ? `${section} · ${SITE.name}` : SITE.name;
}
