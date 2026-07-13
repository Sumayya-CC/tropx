/**
 * Date helpers for the date-only <input type="date"> boundary.
 *
 * The bug these prevent: `new Date("2026-07-12")` parses as UTC midnight, which
 * in UTC-4/-5 is the PREVIOUS day locally. And `date.toISOString().split('T')[0]`
 * converts to UTC first, drifting the other way. Both are wrong for a plain date.
 *
 * NOTE: Firestore Timestamps (serverTimestamp / ts.toDate()) are already UTC and
 * correct — do NOT route those through here. This is only for date-only picker I/O.
 */

/** "YYYY-MM-DD" from a date input → a Date at LOCAL midnight (no UTC shift). */
export function dateInputToLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d); // local midnight
}

/** A Date | Firestore Timestamp | ISO string → "YYYY-MM-DD" in LOCAL time, for a date input. */
export function toDateInputValue(value: any): string {
  if (!value) return '';
  const d: Date = value?.toDate ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's date as "YYYY-MM-DD" in LOCAL time — safe default for date inputs. */
export function todayInputValue(): string {
  return toDateInputValue(new Date());
}

/** Normalize any stored value (Timestamp | Date | string) to a local Date for display/logic. */
export function toLocalDate(value: any): Date | null {
  if (!value) return null;
  const d: Date = value?.toDate ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  return isNaN(d.getTime()) ? null : d;
}
