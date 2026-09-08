/**
 * Report dates are calendar dates (no time, no timezone) and are stored as
 * PostgreSQL `date`. They are handled as `YYYY-MM-DD` strings everywhere so a
 * researcher in the lab never sees their report jump a day because of UTC.
 */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today in the given IANA timezone, as YYYY-MM-DD. Defaults to Europe/London. */
export function todayIsoDate(timeZone = 'Europe/London', now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

/** Converts a Date or a pg `date` value to YYYY-MM-DD without timezone drift. */
export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') {
    return ISO_DATE_RE.test(value) ? value : value.slice(0, 10);
  }
  const y = value.getUTCFullYear();
  const m = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${value.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
