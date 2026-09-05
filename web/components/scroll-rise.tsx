/**
 * A section that lifts into place as it is scrolled to.
 *
 * The whole behaviour is one class; see `globals.css`. It is a component
 * rather than a bare `className` so the reason it is not `Reveal` stays next
 * to the thing that uses it.
 *
 * `Reveal` animates on mount, which is right for content that is on the page
 * when the page loads. A result is six sections tall and arrives all at once
 * when the analysis lands, so mount animations would all fire together and
 * most of them would play to an empty screen, several viewports below the
 * reader. This one is driven by scroll position instead: each section moves
 * when it is about to be looked at, and never while it is being read.
 *
 * Nothing here is hidden by default. The rule lives inside `@supports`, so a
 * browser without scroll-driven animations gets plain, visible content.
 */
export function ScrollRise({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`scroll-rise ${className ?? ""}`}>{children}</div>;
}
