import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";

export type YearbookSettings = { enabled: boolean; deadline: string | null; revision: number };
export type YearbookSelection = { student_id: string; media_key: string; filename: string; source: "parent" | "photographer"; revision: number; updated_at: string };
export const defaultYearbookSettings: YearbookSettings = { enabled: false, deadline: null, revision: 0 };

export function yearbookIsOpen(settings: YearbookSettings, now = new Date()) {
  return settings.enabled && !hasCalendarBoundaryPassed(settings.deadline, now);
}

export function yearbookDeadline(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid deadline.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Choose a valid deadline.");
  return value;
}

export function yearbookExportFilename(student: { id: string; first_name?: string | null; last_name?: string | null }, filename: string) {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").slice(0, 80);
  const extension = filename.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ".jpg";
  return `${safe(student.last_name || "Student")}_${safe(student.first_name || "")}_${student.id}${extension}`;
}

export type YearbookExportRow = { studentId: string; firstName: string; lastName: string; className: string; filename: string; mediaKey: string; source: string; updatedAt: string; available: boolean };
export function yearbookCsv(rows: YearbookExportRow[]) {
  // Prefix spreadsheet formulas, including ones hidden behind leading whitespace.
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    ["Student ID", "First Name", "Last Name", "Class", "Export Filename", "Original Storage Key", "Selected By", "Selected At", "Photo Available"],
    ...rows.map(row => [row.studentId, row.firstName, row.lastName, row.className, row.filename, row.mediaKey, row.source, row.updatedAt, row.available ? "yes" : "no"]),
  ].map(row => row.map(cell).join(",")).join("\r\n");
}
