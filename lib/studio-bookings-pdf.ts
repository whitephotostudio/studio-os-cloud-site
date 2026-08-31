import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type {
  StudioBookingDetail,
  StudioBookingRecord,
} from "@/lib/studio-bookings";

export type StudioBookingPdfFilter = "confirmed" | "cancelled" | "all";

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_HEIGHT = 116;
const TABLE_HEADER_HEIGHT = 25;
const FOOTER_HEIGHT = 23;

const COLORS = {
  navy: rgb(0.075, 0.11, 0.23),
  blue: rgb(0.18, 0.32, 0.82),
  paleBlue: rgb(0.93, 0.95, 1),
  ink: rgb(0.1, 0.14, 0.23),
  muted: rgb(0.42, 0.46, 0.55),
  line: rgb(0.86, 0.88, 0.92),
  paper: rgb(0.98, 0.985, 0.995),
  green: rgb(0.05, 0.48, 0.27),
  paleGreen: rgb(0.91, 0.97, 0.93),
  red: rgb(0.66, 0.17, 0.17),
  paleRed: rgb(1, 0.93, 0.93),
  white: rgb(1, 1, 1),
};

type Column = {
  key: "time" | "status" | "student" | "class" | "parent" | "contact" | "payment";
  label: string;
  width: number;
};

const COLUMNS: Column[] = [
  { key: "time", label: "DATE / TIME", width: 88 },
  { key: "status", label: "STATUS", width: 62 },
  { key: "student", label: "STUDENT", width: 110 },
  { key: "class", label: "CLASS / GRADE", width: 88 },
  { key: "parent", label: "PARENT / GUARDIAN", width: 105 },
  { key: "contact", label: "CONTACT", width: 181 },
  { key: "payment", label: "PAYMENT", width: 90 },
];

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null, timezone: string) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatTime(value: string | null, timezone: string) {
  if (!value) return "No time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No time";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function isCancelled(booking: StudioBookingRecord) {
  return booking.status.toLowerCase() === "cancelled";
}

function filterLabel(filter: StudioBookingPdfFilter) {
  if (filter === "confirmed") return "Confirmed bookings";
  if (filter === "cancelled") return "Cancelled bookings";
  return "All booking records";
}

function wrapText(text: string, font: PDFFont, size: number, width: number, maxLines = 3) {
  const paragraphs = String(text ?? "").split(/\r?\n/).map(safeText);
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  const pushLine = (line: string) => {
    if (!line) return;
    if (lines.length < maxLines) lines.push(line);
    else truncated = true;
  };

  const fitLongWord = (word: string) => {
    let remaining = word;
    while (font.widthOfTextAtSize(remaining, size) > width) {
      let cut = remaining.length;
      while (cut > 1 && font.widthOfTextAtSize(remaining.slice(0, cut), size) > width) {
        cut -= 1;
      }
      pushLine(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
      if (lines.length >= maxLines) {
        truncated = Boolean(remaining);
        return "";
      }
    }
    return remaining;
  };

  for (const paragraph of paragraphs) {
    for (const rawWord of paragraph.split(" ").filter(Boolean)) {
      const word = font.widthOfTextAtSize(rawWord, size) > width
        ? fitLongWord(rawWord)
        : rawWord;
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      pushLine(current);
      current = word;
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
    pushLine(current);
    current = "";
    if (lines.length >= maxLines) break;
  }

  if (!lines.length) lines.push("-");
  if (truncated && lines.length === maxLines) {
    let last = lines[maxLines - 1] ?? "";
    while (last && font.widthOfTextAtSize(`${last}...`, size) > width) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}...`;
  }
  return lines;
}

function recordValues(
  booking: StudioBookingRecord,
  detail: StudioBookingDetail,
  slotStart: string | null,
) {
  const timezone = detail.event.timezone;
  const contact = [booking.parentEmail, booking.parentPhone].filter(Boolean).join("\n");
  const paymentStatus = booking.paymentStatus === "succeeded"
    ? `Paid ${money(booking.paymentAmountCents, booking.paymentCurrency)}`
    : booking.paymentStatus === "not required"
      ? "Not required"
      : safeText(booking.paymentStatus || "Not recorded");
  const bookedOn = booking.createdAt
    ? `Booked ${formatDate(booking.createdAt, timezone)}`
    : "Booked date not recorded";
  return {
    time: slotStart
      ? `${formatDate(slotStart, timezone)}\n${formatTime(slotStart, timezone)}`
      : "No scheduled time",
    status: isCancelled(booking)
      ? "Cancelled"
      : `${safeText(booking.status || "Confirmed").charAt(0).toUpperCase()}${safeText(booking.status || "Confirmed").slice(1)}`,
    student: booking.studentName,
    class: booking.className || "Not recorded",
    parent: booking.parentName || "Not recorded",
    contact: contact || "Not recorded",
    payment: `${paymentStatus}\n${bookedOn}`,
  };
}

function drawPageHeader(input: {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  detail: StudioBookingDetail;
  filter: StudioBookingPdfFilter;
  recordCount: number;
}) {
  const { page, regular, bold, detail, filter, recordCount } = input;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: COLORS.navy });
  page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 29, width: 25, height: 3, color: COLORS.blue });
  page.drawText("STUDIO OS CLOUD", { x: MARGIN + 33, y: PAGE_HEIGHT - 33, size: 9, font: bold, color: COLORS.white });
  page.drawText(filterLabel(filter).toUpperCase(), { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(filterLabel(filter).toUpperCase(), 8), y: PAGE_HEIGHT - 32, size: 8, font: bold, color: rgb(0.7, 0.77, 1) });

  const title = safeText(detail.event.name);
  const titleLines = wrapText(title, bold, 17.5, 485, 2);
  titleLines.forEach((line, index) => {
    page.drawText(line, { x: MARGIN, y: PAGE_HEIGHT - 58 - index * 19, size: 17.5, font: bold, color: COLORS.white });
  });

  const dateLine = detail.event.firstSlotAt
    ? `${formatDate(detail.event.firstSlotAt, detail.event.timezone)} | ${formatTime(detail.event.firstSlotAt, detail.event.timezone)} - ${formatTime(detail.event.lastSlotAt, detail.event.timezone)}`
    : "No shoot date scheduled";
  page.drawText(safeText(dateLine), { x: MARGIN, y: PAGE_HEIGHT - 102, size: 8.5, font: regular, color: rgb(0.75, 0.79, 0.9) });

  const summaryX = 548;
  page.drawRectangle({ x: summaryX, y: PAGE_HEIGHT - 94, width: 210, height: 52, color: rgb(0.11, 0.16, 0.32), borderColor: rgb(0.2, 0.28, 0.5), borderWidth: 1 });
  const summary = [
    [String(recordCount), "IN THIS REPORT"],
    [String(detail.event.booked), "CONFIRMED"],
    [String(detail.event.cancelled), "CANCELLED"],
    [String(detail.event.remaining), "SPACES LEFT"],
  ];
  summary.forEach(([value, label], index) => {
    const x = summaryX + 13 + index * 49;
    page.drawText(value, { x, y: PAGE_HEIGHT - 65, size: 13, font: bold, color: COLORS.white });
    page.drawText(label, { x, y: PAGE_HEIGHT - 82, size: 5.3, font: bold, color: rgb(0.62, 0.69, 0.85) });
  });
}

function drawTableHeader(page: PDFPage, bold: PDFFont, y: number) {
  page.drawRectangle({ x: MARGIN, y: y - TABLE_HEADER_HEIGHT, width: CONTENT_WIDTH, height: TABLE_HEADER_HEIGHT, color: COLORS.paleBlue });
  let x = MARGIN;
  for (const column of COLUMNS) {
    page.drawText(column.label, { x: x + 6, y: y - 16, size: 6.6, font: bold, color: rgb(0.25, 0.32, 0.48) });
    x += column.width;
  }
  return y - TABLE_HEADER_HEIGHT;
}

function drawFooter(page: PDFPage, regular: PDFFont, bold: PDFFont, pageNumber: number, totalPages: number, generatedAt: string) {
  page.drawLine({ start: { x: MARGIN, y: FOOTER_HEIGHT + 9 }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT + 9 }, thickness: 0.6, color: COLORS.line });
  page.drawText(`Generated ${generatedAt} | Private owner report`, { x: MARGIN, y: 16, size: 6.7, font: regular, color: COLORS.muted });
  const pageText = `PAGE ${pageNumber} OF ${totalPages}`;
  page.drawText(pageText, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(pageText, 6.7), y: 16, size: 6.7, font: bold, color: COLORS.muted });
}

export function safeBookingPdfFilename(name: string, filter: StudioBookingPdfFilter) {
  const slug = safeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "booking-report";
  return `${slug}-${filter}-bookings.pdf`;
}

export async function createStudioBookingsPdf(
  detail: StudioBookingDetail,
  filter: StudioBookingPdfFilter,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${detail.event.name} - ${filterLabel(filter)}`);
  pdf.setAuthor("Studio OS Cloud");
  pdf.setSubject("Private booking operations report");
  pdf.setCreator("Studio OS Cloud");
  pdf.setProducer("Studio OS Cloud");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const slotById = new Map(detail.slots.map((slot) => [slot.id, slot]));
  const records = detail.bookings
    .filter((booking) => {
      if (filter === "confirmed") return !isCancelled(booking);
      if (filter === "cancelled") return isCancelled(booking);
      return true;
    })
    .sort((a, b) => {
      const aSlot = a.slotId ? slotById.get(a.slotId)?.startAt : null;
      const bSlot = b.slotId ? slotById.get(b.slotId)?.startAt : null;
      const aTime = aSlot ? new Date(aSlot).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = bSlot ? new Date(bSlot).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return (a.studentName || "").localeCompare(b.studentName || "");
    });

  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  drawPageHeader({ page, regular, bold, detail, filter, recordCount: records.length });
  let y = drawTableHeader(page, bold, PAGE_HEIGHT - HEADER_HEIGHT - 13);

  if (records.length === 0) {
    page.drawRectangle({ x: MARGIN, y: y - 78, width: CONTENT_WIDTH, height: 78, color: COLORS.paper, borderColor: COLORS.line, borderWidth: 0.7 });
    page.drawText(`No ${filterLabel(filter).toLowerCase()} are recorded for this school or event.`, { x: MARGIN + 20, y: y - 43, size: 11, font: bold, color: COLORS.muted });
  }

  for (const [index, booking] of records.entries()) {
    const slotStart = booking.slotId ? slotById.get(booking.slotId)?.startAt ?? null : null;
    const values = recordValues(booking, detail, slotStart);
    const lineSets = COLUMNS.map((column) =>
      wrapText(
        values[column.key],
        regular,
        7.3,
        column.width - 12,
        column.key === "contact" || column.key === "payment" ? 3 : 2,
      ),
    );
    const noteLines = booking.notes
      ? wrapText(`NOTE: ${booking.notes}`, regular, 6.8, CONTENT_WIDTH - 16, 2)
      : [];
    const maxLines = Math.max(...lineSets.map((lines) => lines.length));
    const rowHeight = Math.max(31, 12 + maxLines * 10 + (noteLines.length ? 7 + noteLines.length * 8 : 0));

    if (y - rowHeight < FOOTER_HEIGHT + 18) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(page);
      drawPageHeader({ page, regular, bold, detail, filter, recordCount: records.length });
      y = drawTableHeader(page, bold, PAGE_HEIGHT - HEADER_HEIGHT - 13);
    }

    const cancelled = isCancelled(booking);
    page.drawRectangle({
      x: MARGIN,
      y: y - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: cancelled ? COLORS.paleRed : index % 2 === 0 ? COLORS.white : COLORS.paper,
    });
    let x = MARGIN;
    COLUMNS.forEach((column, columnIndex) => {
      if (column.key === "status") {
        page.drawRectangle({ x: x + 5, y: y - 21, width: column.width - 10, height: 15, color: cancelled ? COLORS.paleRed : COLORS.paleGreen });
      }
      lineSets[columnIndex]?.forEach((line, lineIndex) => {
        const isStatus = column.key === "status";
        const isStudent = column.key === "student";
        page.drawText(safeText(line), {
          x: x + 6,
          y: y - 16 - lineIndex * 10,
          size: 7.3,
          font: isStatus || isStudent ? bold : regular,
          color: isStatus ? (cancelled ? COLORS.red : COLORS.green) : COLORS.ink,
        });
      });
      x += column.width;
    });
    noteLines.forEach((line, noteIndex) => {
      page.drawText(safeText(line), {
        x: MARGIN + 7,
        y: y - 17 - maxLines * 10 - noteIndex * 8,
        size: 6.8,
        font: regular,
        color: COLORS.muted,
      });
    });
    page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight }, thickness: 0.5, color: COLORS.line });
    y -= rowHeight;
  }

  const generatedAt = new Intl.DateTimeFormat("en-CA", {
    timeZone: detail.event.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  pages.forEach((currentPage, index) => {
    drawFooter(currentPage, regular, bold, index + 1, pages.length, generatedAt);
  });

  return pdf.save();
}
