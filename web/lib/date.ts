/**
 * Calendar dates, without the timezone.
 *
 * A holding bought on the fifth of September was bought on the fifth of
 * September everywhere, and `Date` is the wrong type for that: it is an
 * instant, and every operation on one drags an offset along. `new
 * Date("2025-09-05")` is midnight UTC, which in Istanbul is already the
 * fifth at 03:00 but in Los Angeles is still the fourth, so a picker built
 * on it shows the wrong day to half the world and shows it inconsistently.
 *
 * So a date here is three numbers. Arithmetic that genuinely needs a
 * calendar borrows one through `Date.UTC`, where the offset is zero by
 * construction, and comes straight back out again.
 */

export const AY_ADLARI = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/** For the month grid, where twelve full names would not fit. */
export const AY_KISA = [
  "Oca",
  "Şub",
  "Mar",
  "Nis",
  "May",
  "Haz",
  "Tem",
  "Ağu",
  "Eyl",
  "Eki",
  "Kas",
  "Ara",
];

/** Monday first: the Turkish week starts on Pazartesi, not on Pazar. */
export const GUN_KISA = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pa"];

export const GUN_ADLARI = [
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
  "Pazar",
];

/** Year, month (1 to 12) and day, as written on a calendar. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
// Turkish writes the day first. Any of . / - separates it, and a lone digit
// is accepted so "5.9.2025" works as well as "05.09.2025".
const YAZILI = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

export function parseISO(iso: string): CalendarDate | null {
  const m = ISO.exec(iso.trim());
  if (!m) return null;
  const date = { year: +m[1], month: +m[2], day: +m[3] };
  return isReal(date) ? date : null;
}

export function toISO(d: CalendarDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** "05.09.2025" as it is typed and read in Turkish. */
export function formatTurkish(d: CalendarDate): string {
  return `${pad(d.day)}.${pad(d.month)}.${d.year}`;
}

export function parseTurkish(text: string): CalendarDate | null {
  const m = YAZILI.exec(text.trim());
  if (!m) return null;
  const date = { year: +m[3], month: +m[2], day: +m[1] };
  return isReal(date) ? date : null;
}

/** A day that exists. Rejects the 31st of a month with thirty days. */
export function isReal(d: CalendarDate): boolean {
  return (
    Number.isInteger(d.year) &&
    d.year >= 1000 &&
    d.month >= 1 &&
    d.month <= 12 &&
    d.day >= 1 &&
    d.day <= daysInMonth(d.year, d.month)
  );
}

/** Negative when `a` is earlier. Lexicographic, because the fields are ordered. */
export function compare(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameDay(a: CalendarDate | null, b: CalendarDate | null): boolean {
  return a !== null && b !== null && compare(a, b) === 0;
}

/** Today where the reader is, not today in UTC. */
export function today(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function daysInMonth(year: number, month: number): number {
  // Day zero of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Which column the first of the month falls in, Monday being zero.
 *
 * `getUTCDay` counts from Sunday, so the shift is not decoration: without it
 * every month in the grid is off by one column.
 */
export function firstColumn(year: number, month: number): number {
  const sunday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sunday + 6) % 7;
}

export function addDays(d: CalendarDate, n: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/**
 * Shift by whole months, keeping the day where the month has one.
 *
 * The 31st of January plus one month is the 28th of February, not the 3rd of
 * March. Letting it roll over is how a month arrow skips a month entirely.
 */
export function addMonths(d: CalendarDate, n: number): CalendarDate {
  const total = d.year * 12 + (d.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

/**
 * The six week grid for one month, as forty two days.
 *
 * Always six rows, including the leading and trailing days of the
 * neighbouring months. A grid that grows and shrinks with the month makes
 * the popover jump every time an arrow is pressed, and the days underneath
 * move out from under the pointer.
 */
export function monthGrid(year: number, month: number): CalendarDate[] {
  const start = addDays({ year, month, day: 1 }, -firstColumn(year, month));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
