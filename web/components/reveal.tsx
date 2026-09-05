/**
 * Entry animation for content, in CSS rather than JavaScript.
 *
 * Framer Motion is this project's animation library, but it is the wrong tool
 * for revealing server rendered content. A `motion.div` with
 * `initial={{ opacity: 0 }}` ships HTML that literally reads
 * `style="opacity:0"`, and it is JavaScript that later takes it away. If the
 * bundle fails, is still downloading, or was never run, the content is on the
 * page and invisible. For a page whose whole job is to show someone numbers
 * about their money, that is the wrong failure.
 *
 * A CSS keyframe with `animation-fill-mode: both` gives the same fade and
 * rise, runs without JavaScript, and cannot leave anything stuck at zero.
 * `animate-rise` is the token; the delay is what staggers a column of them.
 *
 * Framer Motion stays for what it is genuinely better at, and where nothing
 * is hidden if it does not run: interaction, gestures, layout, and exits that
 * need `AnimatePresence`. See `ThemeToggle`.
 */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  /** Milliseconds. Stagger a list by passing 0, 60, 120 and so on. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`animate-rise ${className ?? ""}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
