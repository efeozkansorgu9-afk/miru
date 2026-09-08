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
  /**
   * Where the tool lives. The brand mark links here too, while there is one,
   * and `next.config.ts` reads it to point the root at whichever tool is
   * being served. A tool owns one path and it is written here, not in a
   * component, a config or a route folder name typed a second time.
   */
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
    href: "/sepet-analizi",
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

/* ------------------------------------------------------------------ */
/* Fund pages                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where a fund's own page lives.
 *
 * Here rather than typed into the three components that link to one, for
 * the same reason the tool's own path is: a route folder renamed without
 * this constant following it should not compile into links that 404.
 */
export const FUND_BASE = "/fon";

export function fundHref(code: string): string {
  return `${FUND_BASE}/${code}`;
}

/* ------------------------------------------------------------------ */
/* What the header calls where you are                                 */
/* ------------------------------------------------------------------ */

/**
 * One named area of the site, as the header names it.
 *
 * The brand is constant and the word beside it is not. A fund page is not
 * part of the basket tool — it does not analyse anything and it is reached
 * from a search engine rather than from the tool — so a header reading
 * "miru | Sepet Analizi" over a fund page names the wrong thing.
 *
 * A section is a label and the paths it owns, and nothing else. It has no
 * `href` of its own on purpose: the header's lockup goes on pointing at
 * `TOOL.href`, which is the way back into the app from anywhere, and `/fon`
 * is a folder of pages rather than a page.
 */
export interface Section {
  /** Shown beside the brand. */
  label: string;
  owns(pathname: string): boolean;
}

/** Matched in order, first hit wins. */
export const SECTIONS: readonly Section[] = [
  {
    label: TOOL.name,
    owns: (path) => path === TOOL.href || path.startsWith(`${TOOL.href}/`),
  },
  {
    /**
     * "Fon", not the code.
     *
     * The code is already the first thing on the page, set in the accent
     * colour directly under the header, and printing it twice within a
     * hundred pixels makes the header a breadcrumb rather than a place. The
     * word says which kind of page this is, which is what the tool's name
     * does on the other one.
     */
    label: "Fon",
    owns: (path) => path === FUND_BASE || path.startsWith(`${FUND_BASE}/`),
  },
];

/**
 * The label for a path. Falls back to the tool, which is where `/` goes.
 */
export function sectionLabel(pathname: string): string {
  return SECTIONS.find((section) => section.owns(pathname))?.label ?? TOOL.name;
}
