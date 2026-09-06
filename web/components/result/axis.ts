/**
 * Date ticks shared by the charts on this page.
 *
 * Recharts picks its own ticks by spacing, which on a date axis formatted to
 * month and year produces duplicates: two Fridays inside one month both print
 * "02.26", and nothing in Recharts knows that two of the labels it chose are
 * the same string. Taking the first trading day of each month instead makes
 * every label distinct by construction, whatever the spacing works out to.
 *
 * It lives here rather than inside one chart because the second chart needs
 * exactly the same behaviour, and a copy is how the two stop matching.
 */

/** "2026-02-13" becomes "02.26". Numeric, so it needs no month names. */
export function eksenTarihi(iso: string): string {
  const [y, m] = iso.split("-");
  return `${m}.${y.slice(2)}`;
}

/**
 * One date per month, thinned until the labels fit.
 *
 * `most` is a count of labels, not a spacing: the stride is derived from how
 * many months the data actually spans, so a five year series and a one year
 * series both come back with a readable axis rather than the same step.
 */
export function monthTicks(dates: string[], most = 12): string[] {
  const firsts: string[] = [];
  let seen = "";
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (month !== seen) {
      firsts.push(date);
      seen = month;
    }
  }
  const stride = Math.ceil(firsts.length / most);
  return firsts.filter((_, i) => i % stride === 0);
}
