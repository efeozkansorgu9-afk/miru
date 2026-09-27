/**
 * A section's heading and the one line under it, the same on every page.
 *
 * Replaces the pattern of a small grey upper-case overline over a heading
 * ("GETİRİ" over "Fonun getirisi", "KOMŞULAR" over "Bu fonla ölçülen 20
 * fon"): two labels saying one thing, set in two styles that did not match
 * from page to page. One heading, one plain sentence of what the section
 * shows, and the eye goes straight to it.
 */
export function SectionHeading({
  id,
  title,
  children,
  className,
}: {
  id?: string;
  title: React.ReactNode;
  /** One or two sentences under the heading. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 id={id} className="max-w-3xl text-display-sm text-balance">
        {title}
      </h2>
      {children && (
        <p className="mt-2 max-w-prose text-body text-ink-muted text-pretty">{children}</p>
      )}
    </div>
  );
}
