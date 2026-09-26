import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * A formula typeset by KaTeX at build time.
 *
 * Rendered on the server into plain HTML (with MathML beside it for screen
 * readers), so the page ships no maths JavaScript at all. `throwOnError` is
 * on: a typo in a formula fails the build rather than printing red source
 * on a page someone is reading to judge the method.
 *
 * Decimal commas are written `1{,}96`, which is how TeX is told a comma is
 * part of the number rather than punctuation after it.
 */
function render(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: true,
    // Turkish letters inside \text{} are fine; do not warn about them.
    strict: "ignore",
    output: "htmlAndMathml",
  });
}

export function Tex({ children }: { children: string }) {
  return <span dangerouslySetInnerHTML={{ __html: render(children, false) }} />;
}

/**
 * A displayed formula, set on its own ground like a figure, with an
 * optional line under it saying what the symbols are.
 */
export function Formula({
  tex,
  children,
}: {
  tex: string;
  /** What the symbols mean, in a sentence. */
  children?: React.ReactNode;
}) {
  return (
    <figure className="rounded-card border border-border bg-surface px-5 py-4 sm:px-6">
      <div
        className="overflow-x-auto overflow-y-hidden py-1 text-[1.08rem] text-ink [&_.katex-display]:m-0"
        dangerouslySetInnerHTML={{ __html: render(tex, true) }}
      />
      {children && (
        <figcaption className="mt-3 border-t border-border pt-3 text-caption text-ink-subtle text-pretty">
          {children}
        </figcaption>
      )}
    </figure>
  );
}
