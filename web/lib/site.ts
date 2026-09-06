/**
 * Product identity, in one place.
 *
 * Two names, deliberately kept apart. `miru` is the brand and is expected to
 * sit above more than one tool; `Sepet Analizi` is this one. Anything that
 * shows either to a user or writes it into a document title reads it from
 * here, so a rename is this file and nothing else. Do not type the brand or
 * a tool name into a component.
 *
 * The brand is lower case, and it is lower case *here* rather than through a
 * `lowercase` class in the header. It is spelled that way wherever it
 * appears, including in a document title and a meta tag, and CSS does not
 * reach either of those.
 */
export const SITE = {
  /** The brand. Above the tool, and above whatever comes after it. */
  brand: "miru",
  /** Fallback language for the document and for date and number formatting. */
  locale: "tr-TR",
  lang: "tr",
} as const;

/** One thing the brand makes. */
export interface Tool {
  /** Shown beside the brand, and in the document title of every page. */
  name: string;
  /** One line, used as the meta description. */
  description: string;
  /** Where the tool lives. The brand mark links here too, while there is one. */
  href: string;
}

/**
 * Every tool under the brand, keyed by the slug it is known by.
 *
 * One entry today. It is a record rather than a bare object so the second
 * one is an entry here plus a `TOOL` pointing at it, and so a future
 * switcher in the header has something to enumerate instead of a list
 * written out a second time next to it.
 */
export const TOOLS = {
  sepet: {
    name: "Sepet Analizi",
    description:
      "Türk yatırım fonlarından kurulmuş bir sepetin gerçekte ne kadar dağıldığını gösterir.",
    href: "/",
  },
} satisfies Record<string, Tool>;

export type ToolSlug = keyof typeof TOOLS;

/**
 * The tool this deployment serves.
 *
 * A single export rather than a lookup at each call site: the header, the
 * title and the meta description all have to agree about which tool the
 * reader is in, and reading it from one constant is how they cannot drift.
 */
export const TOOL: Tool = TOOLS.sepet;

/**
 * A document title: the page, then the tool, then the brand.
 *
 * Widest thing last, which is the order a tab is read in when it is
 * truncated to a few characters: what the reader keeps is the beginning.
 * "Sepet Analizi · miru" on the home page, and a section in front of it
 * elsewhere.
 */
export function pageTitle(section?: string): string {
  const base = `${TOOL.name} · ${SITE.brand}`;
  return section ? `${section} · ${base}` : base;
}
