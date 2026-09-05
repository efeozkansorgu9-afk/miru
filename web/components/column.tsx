/**
 * The column everything on the page sits in.
 *
 * One component rather than the same three utilities repeated, because the
 * moment two sections declare their own width they drift, and drift here is
 * visible: the input section used to be 56rem inside a 64rem page, which
 * left it short on the right only, and the whole thing read as pushed to the
 * left of the screen. Nothing looks centred next to something wider that is.
 *
 * The column is centred. The text inside it is not: a paragraph set centred
 * starts every line in a different place, and the reader has to find the
 * beginning of each one. Centring is for the container.
 */
export function Column({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full max-w-page px-gutter ${className ?? ""}`}>
      {children}
    </div>
  );
}
