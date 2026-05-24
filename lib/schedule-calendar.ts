export type ScheduleKind = "event" | "school";

export type ScheduleItem = {
  id: string;
  kind: ScheduleKind;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  time: string | null;
  location: string | null;
  address: string | null;
  notes: string | null;
  clientName: string | null;
  status: string | null;
  href: string;
  gallerySlug: string | null;
  createdAt: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeScheduleDate(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "";
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function icsDate(dateOnly: string): string {
  return dateOnly.replaceAll("-", "");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

export function buildIcsCalendar(
  items: ScheduleItem[],
  options: {
    calendarName: string;
    origin: string;
  },
): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studio OS Cloud//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    "X-WR-TIMEZONE:America/Toronto",
  ];

  for (const item of items) {
    const summaryPrefix = item.kind === "school" ? "School" : "Event";
    const summary = `${summaryPrefix}: ${item.title}`;
    const status = item.status ? `Status: ${item.status}` : "";
    const client = item.clientName ? `Client: ${item.clientName}` : "";
    const time = item.startTime || item.endTime
      ? `Time: ${[item.startTime, item.endTime].filter(Boolean).join(" - ")}`
      : item.time
        ? `Time: ${item.time}`
        : "";
    const notes = item.notes ? `Notes: ${item.notes}` : "";
    const description = [summaryPrefix, client, status, time, notes].filter(Boolean).join("\\n");
    const absoluteUrl = new URL(item.href, options.origin).toString();

    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.kind}-${item.id}@studiooscloud.com`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(item.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDaysToDateOnly(item.date, 1))}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${absoluteUrl}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
