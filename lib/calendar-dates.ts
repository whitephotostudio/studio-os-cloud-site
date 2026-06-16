const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?(?:Z|\+00:00)$/;
const BUSINESS_TIME_ZONE = "America/Toronto";

export function calendarDateInputValue(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const dateOnly = trimmed.match(DATE_ONLY_RE);
  if (dateOnly) return trimmed;
  const utcMidnight = trimmed.match(UTC_MIDNIGHT_RE);
  if (utcMidnight) return utcMidnight[1];
  const leadingDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return leadingDate ? leadingDate[1] : "";
}

export function cleanCalendarDateInput(value: string | null | undefined) {
  return calendarDateInputValue(value) || null;
}

export function calendarBoundaryEnd(value: string | null | undefined): Date | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  const datePart = calendarDateInputValue(trimmed);
  if (datePart) {
    return endOfBusinessCalendarDay(datePart);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  const hour = Number(map.get("hour"));
  const minute = Number(map.get("minute"));
  const second = Number(map.get("second"));
  return Date.UTC(year, month - 1, day, hour === 24 ? 0 : hour, minute, second) - date.getTime();
}

function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

function endOfBusinessCalendarDay(datePart: string) {
  const match = datePart.match(DATE_ONLY_RE);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const nextLocalMidnight = zonedDateToUtc(
    Number(yearText),
    Number(monthText),
    Number(dayText) + 1,
    0,
    0,
    0,
    0,
    BUSINESS_TIME_ZONE,
  );
  return new Date(nextLocalMidnight.getTime() - 1);
}

export function hasCalendarBoundaryPassed(
  value: string | null | undefined,
  now: Date = new Date(),
) {
  const boundary = calendarBoundaryEnd(value);
  return Boolean(boundary && now > boundary);
}
