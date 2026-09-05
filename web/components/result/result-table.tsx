/**
 * A table that never scrolls sideways.
 *
 * Fund titles run to sixty characters and there are four or five columns
 * beside them, which on a phone is a table two screens wide. The fix is a
 * fixed layout with a proportional width per column: the title column takes
 * whatever is left and truncates, and the full title goes into a `title`
 * attribute so nothing is only available in the shortened form. Every other
 * cell holds a short number and never needs to wrap.
 *
 * A cell can carry a bar. Percentages side by side do not convey size: %143
 * and %8 are two strings of the same width, and the difference between them
 * is the whole point of the column. The bar is drawn under the number inside
 * the cell it belongs to, so no column widens and no row grows taller.
 */

export interface Column {
  label: string;
  /** A grid style fraction or width, applied to a `<col>`. */
  width: string;
  align?: "left" | "right";
  /** Truncate with an ellipsis and show the full text on hover. */
  clip?: boolean;
}

export interface Cell {
  text: string;
  /** Full text, when `text` is a shortened version of it. */
  title?: string;
  /** 0 to 1. Drawn as a bar along the bottom of the cell. */
  bar?: number;
  /** Money only. Never for a measurement that is neither good nor bad. */
  tone?: "gain" | "loss";
  /** Small, muted, on its own line under the value. */
  note?: string;
}

export function ResultTable({
  columns,
  rows,
  caption,
  minWidth,
}: {
  columns: Column[];
  rows: Cell[][];
  caption?: string;
  /**
   * Below this the table scrolls inside its own box rather than crushing
   * every column. For tables that carry a lot of columns and no headline
   * finding; a table someone has to read to get the answer is laid out for
   * a phone instead. See `FundTable`.
   */
  minWidth?: string;
}) {
  return (
    <div className={minWidth ? "overflow-x-auto" : undefined}>
      <table
        className="w-full table-fixed border-collapse text-caption"
        style={minWidth ? { minWidth } : undefined}
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {columns.map((column, i) => (
            <col key={i} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                className={`border-b border-border px-3 py-2 text-label font-medium text-ink-muted ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const column = columns[c];
                return (
                  <td
                    key={c}
                    title={cell.title}
                    className={`relative border-b border-border px-3 py-2.5 align-top ${
                      column?.align === "right" ? "text-right tabular-nums" : "text-left"
                    } ${column?.clip ? "truncate" : ""} ${
                      cell.tone === "gain"
                        ? "text-positive"
                        : cell.tone === "loss"
                          ? "text-negative"
                          : "text-ink"
                    }`}
                  >
                    {cell.text}
                    {cell.note && (
                      <span className="block text-label text-ink-subtle">{cell.note}</span>
                    )}
                    {cell.bar !== undefined && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-3 bottom-1.5 h-[3px] rounded-full bg-border/70"
                      >
                        <span
                          className="block h-full rounded-full bg-ink-muted"
                          style={{ width: `${Math.max(0, Math.min(1, cell.bar)) * 100}%` }}
                        />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
