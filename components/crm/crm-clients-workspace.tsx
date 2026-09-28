"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Building2,
  Camera,
  CalendarClock,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileSignature,
  GraduationCap,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  Navigation,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";
import styles from "./crm-clients-workspace.module.css";

type CrmClientKind =
  | "school"
  | "college"
  | "university"
  | "daycare"
  | "montessori"
  | "corporate"
  | "wedding"
  | "event"
  | "sports"
  | "family"
  | "person"
  | "nonprofit"
  | "other";
type AutomationMode = "off" | "remind" | "approve" | "autopilot";

const MAX_LOCATION_PHOTOS = 12;
const MAX_LOCATION_PHOTO_SOURCE_BYTES = 6 * 1024 * 1024;
const LOCATION_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type CrmClient = {
  id: string;
  kind: CrmClientKind;
  displayName: string;
  legalName: string | null;
  website: string | null;
  currentStudentCount: number | null;
  defaultBookingMonth: number | null;
  defaultTimezone: string | null;
  notes: string | null;
  tags: string[] | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  yearsBooked: number | null;
  lastBookedYear: number | null;
  currentCycleStatus: string | null;
  primaryContactId: string | null;
};

type CrmLocation = {
  id: string;
  clientId: string;
  label: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  timezone: string | null;
  phone: string | null;
  arrivalInstructions: string | null;
  parkingInstructions: string | null;
  setupInstructions: string | null;
  internalNotes: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmLocationPhoto = {
  id: string;
  clientId: string;
  locationId: string;
  audience: "client" | "staff";
  category: "exterior" | "entrance" | "parking" | "loading" | "room" | "setup" | "other";
  caption: string | null;
  altText: string | null;
  sortOrder: number;
  contentType: "image/jpeg";
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
  filename: string;
};

type CrmLocationPhotoSearch = Pick<CrmLocationPhoto, "id" | "clientId" | "category" | "caption" | "altText">;

type CrmContact = {
  id: string;
  clientId: string;
  locationId: string | null;
  fullName: string;
  jobTitle: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  preferredChannel: string | null;
  isPrimary: boolean;
  marketingConsent: string | null;
  consentRecordedAt: string | null;
  consentSource: string | null;
  doNotContact: boolean;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmAgreement = {
  id: string;
  clientId: string;
  title: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  signedAt: string | null;
  amountCents: number | null;
  currency: string | null;
  studentCommitment: number | null;
  renewalNoticeDays: number | null;
  documentKey: string | null;
  termsSummary: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmBookingCycle = {
  id: string;
  clientId: string;
  agreementId: string | null;
  gallerySchoolId: string | null;
  projectId: string | null;
  seasonYear: number;
  cycleKey: string;
  label: string | null;
  status: string;
  targetContactOn: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  bookedAt: string | null;
  shootStartAt: string | null;
  shootEndAt: string | null;
  studentCountEstimate: number | null;
  studentCountActual: number | null;
  quotedAmountCents: number | null;
  bookedAmountCents: number | null;
  currency: string | null;
  lostReason: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmBookingJob = {
  id: string;
  clientId: string;
  locationId: string | null;
  bookingCycleId: string;
  gallerySchoolId: string;
  bookingEventId: string | null;
  role: "primary" | "retake" | "makeup" | "other";
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmBookingCurrencyTotal = {
  currency: string;
  activeCashCents: number;
  retainedCancellationCashCents: number;
  grossCollectedCents: number;
  creditRedeemedCents: number;
};

type CrmBookingHistory = {
  jobId: string;
  clientId: string;
  locationId: string | null;
  locationLabel: string | null;
  bookingCycleId: string;
  seasonYear: number | null;
  gallerySchoolId: string;
  schoolName: string;
  schoolStatus: string | null;
  shootDate: string | null;
  role: "primary" | "retake" | "makeup" | "other";
  bookingEventId: string | null;
  bookingEnabled: boolean;
  publicUrl: string | null;
  currency: string | null;
  capacity: number;
  booked: number;
  cancelled: number;
  paidBookings: number;
  activeCashCents: number;
  retainedCancellationCashCents: number;
  grossCollectedCents: number;
  creditRedeemedCents: number;
  paymentTotalsByCurrency: CrmBookingCurrencyTotal[];
  firstSlotAt: string | null;
  lastSlotAt: string | null;
  lastBookingAt: string | null;
};

type CrmTask = {
  id: string;
  clientId: string;
  contactId: string | null;
  bookingCycleId: string | null;
  automationRuleId: string | null;
  kind: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  remindAt: string | null;
  status: string;
  priority: number;
  assignedUserId: string | null;
  dedupeKey: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmTemplate = {
  id: string;
  templateKey: string;
  version: number;
  name: string;
  purpose: string | null;
  messageClass: string | null;
  subjectTemplate: string;
  htmlTemplate: string | null;
  textTemplate: string | null;
  allowedVariables: string[] | null;
  status: string;
  aiInstruction: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmAutomationRule = {
  id: string;
  clientId: string | null;
  templateId: string | null;
  name: string;
  triggerType: string;
  actionType: string;
  mode: AutomationMode;
  daysOffset: number;
  maxRunsPerCycle: number;
  sendLocalTime: string | null;
  timezone: string | null;
  conditions: Record<string, unknown> | null;
  enabled: boolean;
  autopilotApprovedAt: string | null;
  autopilotApprovedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmSummary = {
  totalClients: number;
  bookedThisYear: number;
  notBookedThisYear: number;
  followUpsDue: number;
  openTasks: number;
  pendingApprovals: number;
};

type CrmPayload = {
  ok: boolean;
  clients: CrmClient[];
  locations: CrmLocation[];
  locationPhotos: CrmLocationPhoto[];
  locationPhotoSearch: CrmLocationPhotoSearch[];
  contacts: CrmContact[];
  agreements: CrmAgreement[];
  bookingCycles: CrmBookingCycle[];
  bookingJobs: CrmBookingJob[];
  bookingHistory: CrmBookingHistory[];
  tasks: CrmTask[];
  emails: CrmEmailResult[];
  activities: CrmActivity[];
  templates: CrmTemplate[];
  automationRules: CrmAutomationRule[];
  summary: CrmSummary;
};

type CrmEmailResult = {
  id: string;
  clientId: string;
  contactId: string | null;
  bookingCycleId: string | null;
  automationRuleId: string | null;
  templateId: string | null;
  status: string;
  toName: string | null;
  toEmail: string | null;
  messageClass: string | null;
  deliveryMode: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  contentSource: string | null;
  scheduledFor: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CrmActivity = {
  id: string;
  clientId: string;
  contactId: string | null;
  bookingCycleId: string | null;
  activityType: string;
  summary: string;
  details: Record<string, unknown> | null;
  occurredAt: string;
  source: string | null;
  createdAt: string | null;
};

type CrmClientBundleResult = {
  clientId: string;
  locationId: string | null;
  contactId: string | null;
  bookingCycleId: string | null;
};

type CrmPostResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  email?: CrmEmailResult;
  bundle?: CrmClientBundleResult;
  id?: string;
  record?: Record<string, unknown>;
  item?: Record<string, unknown>;
  photo?: CrmLocationPhoto;
  disposition?: "deleted" | "archived";
  client?: Record<string, unknown>;
  queued?: number;
  skipped?: Array<{ contactId: string; code: string }>;
  emails?: CrmEmailResult[];
};

type TimelineEntry = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
};

type EmailComposerState = {
  contactId: string;
  templateId: string;
  subject: string;
  message: string;
  outboxId: string;
  contentSource: string;
};

type RecordEditorKind = "client" | "contact" | "location" | "bookingCycle" | "task" | "agreement";

type RecordEditorState = {
  kind: RecordEditorKind;
  mode: "create" | "edit";
  recordId: string;
  contactId: string;
  locationId: string;
  values: Record<string, string>;
};

type BookingRepairState = {
  jobId: string;
  schoolName: string;
  clientId: string;
  locationId: string;
};

const EMPTY_SUMMARY: CrmSummary = {
  totalClients: 0,
  bookedThisYear: 0,
  notBookedThisYear: 0,
  followUpsDue: 0,
  openTasks: 0,
  pendingApprovals: 0,
};

const EMPTY_PAYLOAD: CrmPayload = {
  ok: true,
  clients: [],
  locations: [],
  locationPhotos: [],
  locationPhotoSearch: [],
  contacts: [],
  agreements: [],
  bookingCycles: [],
  bookingJobs: [],
  bookingHistory: [],
  tasks: [],
  emails: [],
  activities: [],
  templates: [],
  automationRules: [],
  summary: EMPTY_SUMMARY,
};

const AUTOMATION_COPY: Record<AutomationMode, { label: string; description: string }> = {
  off: {
    label: "Off",
    description: "Nothing is created or sent automatically. You stay fully manual.",
  },
  remind: {
    label: "Remind me",
    description: "Studio OS creates a follow-up task for you. No client email is prepared or sent.",
  },
  approve: {
    label: "Approval",
    description: "Studio OS prepares the approved message, then waits for your review before queueing it.",
  },
  autopilot: {
    label: "Autopilot",
    description: "Approved templates can queue on schedule and stop automatically when the client books.",
  },
};

const OWNER_ATTESTED_CONSENT_SOURCE = "owner_attested_in_studio_os";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmailIdentity(value: unknown): string {
  return clean(value).toLowerCase();
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizePayload(value: unknown): CrmPayload {
  const source = value && typeof value === "object" ? (value as Partial<CrmPayload>) : {};
  const summary = source.summary && typeof source.summary === "object" ? source.summary : EMPTY_SUMMARY;
  return {
    ok: source.ok !== false,
    clients: arrayOrEmpty<CrmClient>(source.clients),
    locations: arrayOrEmpty<CrmLocation>(source.locations),
    locationPhotos: arrayOrEmpty<CrmLocationPhoto>(source.locationPhotos),
    locationPhotoSearch: arrayOrEmpty<CrmLocationPhotoSearch>(source.locationPhotoSearch),
    contacts: arrayOrEmpty<CrmContact>(source.contacts),
    agreements: arrayOrEmpty<CrmAgreement>(source.agreements),
    bookingCycles: arrayOrEmpty<CrmBookingCycle>(source.bookingCycles),
    bookingJobs: arrayOrEmpty<CrmBookingJob>(source.bookingJobs),
    bookingHistory: arrayOrEmpty<CrmBookingHistory>(source.bookingHistory),
    tasks: arrayOrEmpty<CrmTask>(source.tasks),
    emails: arrayOrEmpty<CrmEmailResult>(source.emails),
    activities: arrayOrEmpty<CrmActivity>(source.activities),
    templates: arrayOrEmpty<CrmTemplate>(source.templates),
    automationRules: arrayOrEmpty<CrmAutomationRule>(source.automationRules),
    summary: {
      totalClients: numberOrZero(summary.totalClients),
      bookedThisYear: numberOrZero(summary.bookedThisYear),
      notBookedThisYear: numberOrZero(summary.notBookedThisYear),
      followUpsDue: numberOrZero(summary.followUpsDue),
      openTasks: numberOrZero(summary.openTasks),
      pendingApprovals: numberOrZero(summary.pendingApprovals),
    },
  };
}

type CrmIndexPage = Partial<CrmPayload> & {
  page?: { offset: number; limit: number; total: number; hasMore: boolean };
};

function mergeRowsById<T extends { id: string }>(base: T[], detail: T[]): T[] {
  const byId = new Map(base.map((row) => [row.id, row]));
  for (const row of detail) byId.set(row.id, row);
  return Array.from(byId.values());
}

function combineClientIndexPages(pages: CrmIndexPage[]): CrmPayload {
  const combined = pages.map((page) => normalizePayload(page));
  const clients = combined.flatMap((page) => page.clients);
  const bookingCycles = combined.flatMap((page) => page.bookingCycles);
  const tasks = combined.flatMap((page) => page.tasks);
  const emails = combined.flatMap((page) => page.emails);
  const currentYear = new Date().getUTCFullYear();
  const bookedIds = new Set(bookingCycles
    .filter((cycle) => cycle.seasonYear === currentYear && isBookedStatus(cycle.status))
    .map((cycle) => cycle.clientId));
  const now = Date.now();
  return {
    ...EMPTY_PAYLOAD,
    clients,
    contacts: combined.flatMap((page) => page.contacts),
    locations: combined.flatMap((page) => page.locations),
    locationPhotoSearch: combined.flatMap((page) => page.locationPhotoSearch),
    bookingCycles,
    tasks,
    emails,
    summary: {
      totalClients: pages[0]?.page?.total ?? clients.length,
      bookedThisYear: bookedIds.size,
      notBookedThisYear: Math.max(0, clients.length - bookedIds.size),
      followUpsDue: bookingCycles.filter((cycle) =>
        !!cycle.nextFollowUpAt && dateValue(cycle.nextFollowUpAt) <= now
        && !["booked", "completed", "lost", "skipped"].includes(clean(cycle.status).toLowerCase()),
      ).length,
      openTasks: tasks.filter(isOpenTask).length,
      pendingApprovals: emails.length,
    },
  };
}

function mergeClientDetail(index: CrmPayload, detail: CrmPayload): CrmPayload {
  return {
    ...index,
    clients: mergeRowsById(index.clients, detail.clients),
    contacts: mergeRowsById(index.contacts, detail.contacts),
    locations: mergeRowsById(index.locations, detail.locations),
    bookingCycles: mergeRowsById(index.bookingCycles, detail.bookingCycles),
    tasks: mergeRowsById(index.tasks, detail.tasks),
    emails: mergeRowsById(index.emails, detail.emails),
    locationPhotos: detail.locationPhotos,
    agreements: detail.agreements,
    bookingJobs: detail.bookingJobs,
    bookingHistory: detail.bookingHistory,
    activities: detail.activities,
    templates: detail.templates,
    automationRules: detail.automationRules,
  };
}

function statusLabel(value: string | null | undefined): string {
  const raw = clean(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  if (!raw) return "Not started";
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isBookedStatus(value: string | null | undefined): boolean {
  return ["booked", "confirmed", "complete", "completed"].includes(clean(value).toLowerCase());
}

function isPendingApproval(value: string | null | undefined): boolean {
  return clean(value).toLowerCase().replaceAll("_", "") === "pendingapproval";
}

function isOpenTask(task: CrmTask): boolean {
  return !["completed", "cancelled", "canceled"].includes(clean(task.status).toLowerCase()) && !task.completedAt;
}

function dateValue(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "Not set";
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: clean(currency) || "CAD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return "$" + (cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 2 });
  }
}

function formatBookingCurrencyTotals(
  totals: CrmBookingCurrencyTotal[],
  field: "grossCollectedCents" | "creditRedeemedCents",
): string {
  if (!totals.length) return "Not available";
  return totals
    .map((total) => total.currency + " " + formatMoney(total[field], total.currency))
    .join(" · ");
}

function clientKindLabel(kind: string): string {
  const normalized = clean(kind).toLowerCase();
  if (normalized === "school") return "School";
  if (normalized === "college") return "College";
  if (normalized === "university") return "University";
  if (normalized === "daycare") return "Daycare";
  if (normalized === "montessori") return "Montessori";
  if (normalized === "wedding") return "Wedding";
  if (normalized === "event") return "Event";
  if (normalized === "corporate") return "Corporate";
  if (normalized === "sports") return "Sports";
  if (normalized === "family") return "Family";
  if (normalized === "person") return "Person";
  if (normalized === "nonprofit") return "Nonprofit";
  if (normalized === "other") return "Other";
  return normalized ? statusLabel(normalized) : "Client";
}

function isSchoolSideClientKind(kind: string): boolean {
  return ["school", "college", "university", "daycare", "montessori"].includes(
    clean(kind).toLowerCase(),
  );
}

function locationPostalAddress(location: CrmLocation | null): string {
  if (!location) return "";
  return [
    clean(location.addressLine1),
    clean(location.addressLine2),
    clean(location.city),
    clean(location.region),
    clean(location.postalCode),
    clean(location.countryCode),
  ].filter(Boolean).join(", ");
}

function clientAddress(location: CrmLocation | null): string {
  if (!location) return "No location saved";
  return locationPostalAddress(location) || clean(location.label) || "No address saved";
}

function locationMapDestination(location: CrmLocation): string {
  const latitude = location.latitude;
  const longitude = location.longitude;
  if (
    typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  ) {
    return `${latitude},${longitude}`;
  }
  return locationPostalAddress(location);
}

function locationMapHref(location: CrmLocation, directions = false): string {
  const destination = locationMapDestination(location);
  if (!destination) return "";
  return directions
    ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination)
    : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(destination);
}

function blobBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("The photo could not be encoded."));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });
}

async function optimizeLocationPhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    const longestSide = Math.max(width, height);
    if (longestSide > 1600) {
      const scale = 1600 / longestSide;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    for (const quality of [0.86, 0.76, 0.66]) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("The photo could not be prepared.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (!blob) throw new Error("The photo could not be prepared.");
      if (blob.size <= 1024 * 1024 || quality === 0.66) {
        return {
          content: await blobBase64(blob),
          contentType: "image/jpeg",
          filename: file.name.replace(/\.[^.]+$/, "").slice(0, 245) + ".jpg",
        };
      }
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The photo could not be prepared.");
}

function templateMessage(template: CrmTemplate | null): string {
  if (!template) return "";
  if (clean(template.textTemplate)) return clean(template.textTemplate);
  return clean(template.htmlTemplate)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function emailPreviewText(email: CrmEmailResult): string {
  if (clean(email.text)) return clean(email.text);
  return clean(email.html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function statusClass(value: string | null | undefined, due: boolean): string {
  if (isBookedStatus(value)) return styles.statusBooked;
  if (due) return styles.statusDue;
  if (["contacted", "negotiating", "proposal_sent", "proposalsent", "drafted"].includes(clean(value).toLowerCase())) {
    return styles.statusContacted;
  }
  return styles.statusOpen;
}

function requestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "crm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function responseMessage(payload: CrmPostResponse, fallback: string): string {
  return clean(payload.message) || clean(payload.error) || fallback;
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function nullableInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function contactConsentPayload(values: Record<string, string>) {
  const marketingConsent = ["optedIn", "optedOut"].includes(values.marketingConsent)
    ? values.marketingConsent
    : "unknown";
  if (marketingConsent === "optedIn") {
    return {
      marketingConsent,
      consentRecordedAt: nullableText(values.consentRecordedAt),
      consentSource: nullableText(values.consentSource),
    };
  }
  return {
    marketingConsent,
    consentRecordedAt: null,
    consentSource: null,
  };
}

function dollarsToCents(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function savedRecordId(result: CrmPostResponse): string {
  return clean(result.id)
    || clean(result.record?.id)
    || clean(result.item?.id)
    || clean(result.client?.id);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function targetHref(
  surface: "dashboard" | "mobile",
  client: CrmClient,
  cycle: CrmBookingCycle | null,
): string | null {
  if (!cycle) return null;
  if (cycle.gallerySchoolId) {
    return surface === "mobile"
      ? "/m/schools/" + encodeURIComponent(cycle.gallerySchoolId)
      : "/dashboard/projects/schools/" + encodeURIComponent(cycle.gallerySchoolId);
  }
  if (cycle.projectId) {
    return surface === "mobile"
      ? "/m/events/" + encodeURIComponent(cycle.projectId)
      : "/dashboard/projects/" + encodeURIComponent(cycle.projectId);
  }
  if (isSchoolSideClientKind(client.kind)) {
    return surface === "mobile" ? "/m/schools" : "/dashboard/schools";
  }
  return surface === "mobile" ? "/m/events" : "/dashboard/projects/events";
}

export function CrmClientsWorkspace({
  surface = "dashboard",
}: {
  surface?: "dashboard" | "mobile";
}) {
  const viewportCompact = useIsMobile(760);
  const compact = surface === "mobile" || viewportCompact;
  const [indexPayload, setIndexPayload] = useState<CrmPayload>(EMPTY_PAYLOAD);
  const [detailState, setDetailState] = useState<{ clientId: string; payload: CrmPayload } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [selectedId, setSelectedId] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailState, setEmailState] = useState<EmailComposerState>({
    contactId: "",
    templateId: "",
    subject: "",
    message: "",
    outboxId: "",
    contentSource: "",
  });
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [automationMode, setAutomationMode] = useState<AutomationMode>("off");
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState("");
  const [recordEditor, setRecordEditor] = useState<RecordEditorState | null>(null);
  const [recordEditorError, setRecordEditorError] = useState("");
  const [savingRecord, setSavingRecord] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState("");
  const [locationPhotoFile, setLocationPhotoFile] = useState<File | null>(null);
  const [locationPhotoAudience, setLocationPhotoAudience] = useState<"client" | "staff">("client");
  const [locationPhotoCategory, setLocationPhotoCategory] = useState<CrmLocationPhoto["category"]>("entrance");
  const [locationPhotoCaption, setLocationPhotoCaption] = useState("");
  const [locationPhotoAltText, setLocationPhotoAltText] = useState("");
  const [uploadingLocationPhoto, setUploadingLocationPhoto] = useState(false);
  const [deletingLocationPhotoId, setDeletingLocationPhotoId] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchTemplateId, setBatchTemplateId] = useState("");
  const [batchConfirmed, setBatchConfirmed] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchQueueing, setBatchQueueing] = useState(false);
  const [approvalEmailId, setApprovalEmailId] = useState("");
  const [approvingEmailId, setApprovingEmailId] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [approvalsExpanded, setApprovalsExpanded] = useState(false);
  const [bookingRepair, setBookingRepair] = useState<BookingRepairState | null>(null);
  const [bookingRepairError, setBookingRepairError] = useState("");
  const [repairingBookingJob, setRepairingBookingJob] = useState(false);
  const sendKeyRef = useRef("");
  const loadRequestIdRef = useRef(0);
  const clientBundleKeyRef = useRef("");
  const locationPhotoInputRef = useRef<HTMLInputElement>(null);
  const locationPhotoUploadKeyRef = useRef("");
  const payload = useMemo(
    () => detailState?.clientId === selectedId
      ? mergeClientDetail(indexPayload, detailState.payload)
      : indexPayload,
    [detailState, indexPayload, selectedId],
  );

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const pages: CrmIndexPage[] = [];
      let offset = 0;
      for (;;) {
        const response = await fetch(`/api/dashboard/crm?mode=index&limit=200&offset=${offset}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => ({}))) as CrmPostResponse & CrmIndexPage;
        if (response.status === 401) {
          const redirect = surface === "mobile" ? "/m/clients" : "/dashboard/clients";
          window.location.href = "/sign-in?redirect=" + encodeURIComponent(redirect);
          return;
        }
        if (!response.ok || body.ok === false || !body.page || !Array.isArray(body.clients)) {
          throw new Error(responseMessage(body, "The Clients database could not be loaded."));
        }
        pages.push(body);
        if (requestId !== loadRequestIdRef.current) return;
        if (!body.page.hasMore) break;
        if (!body.clients.length) throw new Error("The Clients list stopped before every record was loaded.");
        offset += body.clients.length;
      }
      const next = combineClientIndexPages(pages);
      if (next.clients.length !== pages[0].page?.total
        || new Set(next.clients.map((client) => client.id)).size !== next.clients.length) {
        throw new Error("The Clients list changed while loading. Refresh to try again.");
      }
      if (requestId !== loadRequestIdRef.current) return;
      setDetailState(null);
      setIndexPayload(next);
      setSelectedId((current) => {
        if (current && next.clients.some((client) => client.id === current)) return current;
        return next.clients.find((client) => !client.archivedAt)?.id || "";
      });
    } catch (caught) {
      if (requestId === loadRequestIdRef.current) {
        setError(caught instanceof Error ? caught.message : "The Clients database could not be loaded.");
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [surface]);

  useEffect(() => {
    void load();
    return () => { loadRequestIdRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!selectedId || !indexPayload.clients.some((client) => client.id === selectedId)) {
      setDetailState(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailState(null);
    setDetailLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/dashboard/crm?clientId=${encodeURIComponent(selectedId)}&limit=1`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => ({}))) as CrmPostResponse & Partial<CrmPayload>;
        if (cancelled) return;
        if (response.status === 401) {
          const redirect = surface === "mobile" ? "/m/clients" : "/dashboard/clients";
          window.location.href = "/sign-in?redirect=" + encodeURIComponent(redirect);
          return;
        }
        if (!response.ok || body.ok === false) {
          throw new Error(responseMessage(body, "This client's details could not be loaded."));
        }
        setDetailState({ clientId: selectedId, payload: normalizePayload(body) });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "This client's details could not be loaded.");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [indexPayload, selectedId, surface]);

  useEffect(() => {
    if (!emailOpen && !recordEditor && !batchOpen && !approvalEmailId && !bookingRepair) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [approvalEmailId, batchOpen, bookingRepair, emailOpen, recordEditor]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const activeClients = useMemo(
    () => payload.clients.filter((client) => !client.archivedAt),
    [payload.clients],
  );
  const clientsById = useMemo(
    () => new Map(activeClients.map((client) => [client.id, client])),
    [activeClients],
  );
  const educationClients = useMemo(
    () => activeClients
      .filter((client) => isSchoolSideClientKind(client.kind))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [activeClients],
  );
  const bookingRepairLocations = useMemo(
    () => bookingRepair
      ? payload.locations
          .filter((location) => location.clientId === bookingRepair.clientId && !location.archivedAt)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)
            || clean(a.label).localeCompare(clean(b.label)))
      : [],
    [bookingRepair, payload.locations],
  );
  const pendingApprovalEmails = useMemo(
    () => payload.emails
      .filter((email) => isPendingApproval(email.status))
      .sort((a, b) => dateValue(a.scheduledFor || a.createdAt) - dateValue(b.scheduledFor || b.createdAt)),
    [payload.emails],
  );
  const approvalEmail = approvalEmailId
    ? pendingApprovalEmails.find((email) => email.id === approvalEmailId) || null
    : null;

  const cyclesByClient = useMemo(() => {
    const grouped = new Map<string, CrmBookingCycle[]>();
    for (const cycle of payload.bookingCycles) {
      const rows = grouped.get(cycle.clientId) || [];
      rows.push(cycle);
      grouped.set(cycle.clientId, rows);
    }
    for (const rows of grouped.values()) {
      rows.sort((a, b) => b.seasonYear - a.seasonYear || dateValue(b.updatedAt) - dateValue(a.updatedAt));
    }
    return grouped;
  }, [payload.bookingCycles]);

  const tasksByClient = useMemo(() => {
    const grouped = new Map<string, CrmTask[]>();
    for (const task of payload.tasks) {
      const rows = grouped.get(task.clientId) || [];
      rows.push(task);
      grouped.set(task.clientId, rows);
    }
    for (const rows of grouped.values()) {
      rows.sort((a, b) => {
        const aDate = dateValue(a.dueAt) || Number.MAX_SAFE_INTEGER;
        const bDate = dateValue(b.dueAt) || Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
    }
    return grouped;
  }, [payload.tasks]);

  const primaryLocationFor = useCallback((clientId: string) => {
    const rows = payload.locations.filter(
      (location) => location.clientId === clientId && !location.archivedAt,
    );
    return rows.find((location) => location.isPrimary) || rows[0] || null;
  }, [payload.locations]);

  const primaryContactFor = useCallback((client: CrmClient) => {
    const rows = payload.contacts.filter(
      (contact) => contact.clientId === client.id && !contact.archivedAt,
    );
    return rows.find((contact) => contact.id === client.primaryContactId)
      || rows.find((contact) => contact.isPrimary)
      || rows[0]
      || null;
  }, [payload.contacts]);

  const cycleFor = useCallback((client: CrmClient) => {
    const rows = cyclesByClient.get(client.id) || [];
    return rows.find((cycle) => cycle.seasonYear === seasonYear) || null;
  }, [cyclesByClient, seasonYear]);

  const seasonSummary = useMemo(() => {
    const booked = activeClients.reduce(
      (count, client) => count + (isBookedStatus(cycleFor(client)?.status) ? 1 : 0),
      0,
    );
    return {
      booked,
      notBooked: activeClients.length - booked,
    };
  }, [activeClients, cycleFor]);

  const clientDue = useCallback((client: CrmClient) => {
    const now = Date.now();
    const cycle = cycleFor(client);
    if (cycle?.nextFollowUpAt && dateValue(cycle.nextFollowUpAt) <= now && !isBookedStatus(cycle.status)) {
      return true;
    }
    return (tasksByClient.get(client.id) || []).some(
      (task) => isOpenTask(task) && !!task.dueAt && dateValue(task.dueAt) <= now,
    );
  }, [cycleFor, tasksByClient]);

  const filteredClients = useMemo(() => {
    const term = query.trim().toLowerCase();
    return activeClients.filter((client) => {
      const contact = primaryContactFor(client);
      const location = primaryLocationFor(client.id);
      const clientContacts = payload.contacts.filter(
        (candidate) => candidate.clientId === client.id && !candidate.archivedAt,
      );
      const clientLocations = payload.locations.filter(
        (candidate) => candidate.clientId === client.id && !candidate.archivedAt,
      );
      const cycle = cycleFor(client);
      const due = clientDue(client);
      if (kindFilter !== "all" && clean(client.kind).toLowerCase() !== kindFilter) return false;
      if (statusFilter === "booked" && !isBookedStatus(cycle?.status)) return false;
      if (statusFilter === "not_booked" && isBookedStatus(cycle?.status)) return false;
      if (statusFilter === "follow_up" && !due) return false;
      if (!term) return true;
      return [
        client.displayName,
        client.legalName,
        client.tags?.join(" "),
        contact?.fullName,
        contact?.email,
        contact?.phone,
        clientAddress(location),
        ...clientContacts.flatMap((candidate) => [
          candidate.fullName,
          candidate.jobTitle,
          candidate.email,
          candidate.phone,
        ]),
        ...clientLocations.flatMap((candidate) => [
          candidate.label,
          candidate.addressLine1,
          candidate.addressLine2,
          candidate.city,
          candidate.region,
          candidate.postalCode,
          candidate.phone,
          candidate.arrivalInstructions,
          candidate.parkingInstructions,
          candidate.setupInstructions,
          candidate.internalNotes,
        ]),
        ...payload.locationPhotoSearch
          .filter((photo) => photo.clientId === client.id)
          .flatMap((photo) => [photo.category, photo.caption, photo.altText]),
      ].some((value) => clean(value).toLowerCase().includes(term));
    });
  }, [
    activeClients,
    clientDue,
    cycleFor,
    kindFilter,
    payload.contacts,
    payload.locationPhotoSearch,
    payload.locations,
    primaryContactFor,
    primaryLocationFor,
    query,
    statusFilter,
  ]);

  const selectedClient = useMemo(
    () => activeClients.find((client) => client.id === selectedId) || null,
    [activeClients, selectedId],
  );
  const selectedContacts = useMemo(
    () => selectedClient
      ? payload.contacts
          .filter((contact) => contact.clientId === selectedClient.id && !contact.archivedAt)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.fullName.localeCompare(b.fullName))
      : [],
    [payload.contacts, selectedClient],
  );
  const selectedLocations = useMemo(
    () => selectedClient
      ? payload.locations
          .filter((location) => location.clientId === selectedClient.id && !location.archivedAt)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)
            || clean(a.label).localeCompare(clean(b.label)))
      : [],
    [payload.locations, selectedClient],
  );
  const locationPhotosByLocation = useMemo(() => {
    const grouped = new Map<string, CrmLocationPhoto[]>();
    for (const photo of payload.locationPhotos) {
      const rows = grouped.get(photo.locationId) || [];
      rows.push(photo);
      grouped.set(photo.locationId, rows);
    }
    for (const rows of grouped.values()) {
      rows.sort((a, b) => a.sortOrder - b.sortOrder || dateValue(a.createdAt) - dateValue(b.createdAt));
    }
    return grouped;
  }, [payload.locationPhotos]);
  const bookingUseCountByLocation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of payload.bookingJobs) {
      if (!job.locationId) continue;
      counts.set(job.locationId, (counts.get(job.locationId) || 0) + 1);
    }
    return counts;
  }, [payload.bookingJobs]);
  const selectedAgreements = useMemo(
    () => selectedClient
      ? payload.agreements
          .filter((agreement) => agreement.clientId === selectedClient.id)
          .sort((a, b) => dateValue(b.startsOn) - dateValue(a.startsOn))
      : [],
    [payload.agreements, selectedClient],
  );
  const selectedCycles = useMemo(
    () => selectedClient ? cyclesByClient.get(selectedClient.id) || [] : [],
    [cyclesByClient, selectedClient],
  );
  const selectedBookingHistory = useMemo(
    () => selectedClient
      ? payload.bookingHistory
          .filter((row) => row.clientId === selectedClient.id)
          .sort((a, b) => dateValue(b.shootDate || b.firstSlotAt)
            - dateValue(a.shootDate || a.firstSlotAt))
      : [],
    [payload.bookingHistory, selectedClient],
  );
  const selectedBookingTotals = useMemo(() => {
    const moneyByCurrency = new Map<string, {
      activeCashCents: number;
      retainedCancellationCashCents: number;
      grossCollectedCents: number;
      creditRedeemedCents: number;
    }>();
    for (const row of selectedBookingHistory) {
      const rowTotals = Array.isArray(row.paymentTotalsByCurrency)
        ? row.paymentTotalsByCurrency
        : row.currency
          ? [{
              currency: row.currency,
              activeCashCents: row.activeCashCents,
              retainedCancellationCashCents: row.retainedCancellationCashCents,
              grossCollectedCents: row.grossCollectedCents,
              creditRedeemedCents: row.creditRedeemedCents,
            }]
          : [];
      for (const rowTotal of rowTotals) {
        const currency = clean(rowTotal.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) continue;
        const total = moneyByCurrency.get(currency) || {
          activeCashCents: 0,
          retainedCancellationCashCents: 0,
          grossCollectedCents: 0,
          creditRedeemedCents: 0,
        };
        total.activeCashCents += numberOrZero(rowTotal.activeCashCents);
        total.retainedCancellationCashCents += numberOrZero(
          rowTotal.retainedCancellationCashCents,
        );
        total.grossCollectedCents += numberOrZero(rowTotal.grossCollectedCents);
        total.creditRedeemedCents += numberOrZero(rowTotal.creditRedeemedCents);
        moneyByCurrency.set(currency, total);
      }
    }
    return {
      jobs: selectedBookingHistory.length,
      bookingPages: selectedBookingHistory.filter((row) => !!row.bookingEventId).length,
      booked: selectedBookingHistory.reduce((total, row) => total + numberOrZero(row.booked), 0),
      cancelled: selectedBookingHistory.reduce((total, row) => total + numberOrZero(row.cancelled), 0),
      paidBookings: selectedBookingHistory.reduce(
        (total, row) => total + numberOrZero(row.paidBookings),
        0,
      ),
      moneyByCurrency: Array.from(moneyByCurrency.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, values]) => ({ currency, ...values })),
    };
  }, [selectedBookingHistory]);
  const selectedCycle = selectedClient ? cycleFor(selectedClient) : null;
  const selectedTasks = useMemo(
    () => selectedClient ? tasksByClient.get(selectedClient.id) || [] : [],
    [selectedClient, tasksByClient],
  );
  const selectedOpenTasks = selectedTasks.filter(isOpenTask);
  const selectedContact = selectedClient ? primaryContactFor(selectedClient) : null;
  const selectedAgreement = selectedAgreements.find((agreement) => clean(agreement.status).toLowerCase() === "active")
    || selectedAgreements[0]
    || null;
  const selectedRule = selectedClient
    ? payload.automationRules.find((rule) => rule.clientId === selectedClient.id)
      || payload.automationRules.find((rule) => !rule.clientId)
      || null
    : null;
  const approvedTemplates = payload.templates.filter(
    (template) => !template.archivedAt && clean(template.status).toLowerCase() === "approved",
  );
  const approvedBulkTemplates = approvedTemplates.filter((template) =>
    ["relationship", "marketing"].includes(clean(template.messageClass).toLowerCase()),
  );

  const selectedBatchRows = useMemo(() => {
    return activeClients
      .filter((client) => selectedClientIds.has(client.id))
      .map((client) => {
        const contact = primaryContactFor(client);
        let reason = "";
        if (!contact) reason = "No primary contact";
        else if (contact.doNotContact) reason = "Do not contact";
        else if (!clean(contact.email)) reason = "No email";
        else if (clean(contact.marketingConsent) !== "optedIn") reason = "Consent not opted in";
        return { client, contact, reason };
      });
  }, [activeClients, primaryContactFor, selectedClientIds]);
  const eligibleBatchRows = selectedBatchRows.filter((row) => row.contact && !row.reason);

  useEffect(() => {
    const nextMode = selectedRule?.mode;
    setAutomationMode(
      nextMode && ["off", "remind", "approve", "autopilot"].includes(nextMode)
        ? nextMode
        : "off",
    );
  }, [selectedId, selectedRule?.id, selectedRule?.mode]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!selectedClient) return [];
    const entries: TimelineEntry[] = [];
    for (const activity of payload.activities) {
      if (activity.clientId !== selectedClient.id || !activity.occurredAt) continue;
      entries.push({
        id: "activity-" + activity.id,
        occurredAt: activity.occurredAt,
        title: statusLabel(activity.activityType),
        detail: activity.summary,
      });
    }
    for (const cycle of selectedCycles) {
      if (cycle.bookedAt) {
        entries.push({
          id: "cycle-booked-" + cycle.id,
          occurredAt: cycle.bookedAt,
          title: "Booked for " + cycle.seasonYear,
          detail: clean(cycle.label) || "Annual booking confirmed",
        });
      }
      if (cycle.lastContactedAt) {
        entries.push({
          id: "cycle-contacted-" + cycle.id,
          occurredAt: cycle.lastContactedAt,
          title: "Client contacted",
          detail: statusLabel(cycle.status) + " · " + cycle.seasonYear,
        });
      }
    }
    for (const agreement of selectedAgreements) {
      const occurredAt = agreement.signedAt || agreement.createdAt;
      if (!occurredAt) continue;
      entries.push({
        id: "agreement-" + agreement.id,
        occurredAt,
        title: agreement.signedAt ? "Agreement signed" : "Agreement added",
        detail: agreement.title + " · " + formatMoney(agreement.amountCents, agreement.currency),
      });
    }
    for (const task of selectedTasks) {
      if (!task.completedAt) continue;
      entries.push({
        id: "task-" + task.id,
        occurredAt: task.completedAt,
        title: "Task completed",
        detail: task.title,
      });
    }
    for (const contact of selectedContacts) {
      if (!contact.createdAt) continue;
      entries.push({
        id: "contact-" + contact.id,
        occurredAt: contact.createdAt,
        title: "Contact added",
        detail: contact.fullName,
      });
    }
    if (selectedClient.createdAt) {
      entries.push({
        id: "client-" + selectedClient.id,
        occurredAt: selectedClient.createdAt,
        title: "Client record created",
        detail: clientKindLabel(selectedClient.kind),
      });
    }
    return entries
      .filter((entry) => dateValue(entry.occurredAt) > 0)
      .sort((a, b) => dateValue(b.occurredAt) - dateValue(a.occurredAt))
      .slice(0, 10);
  }, [payload.activities, selectedAgreements, selectedClient, selectedContacts, selectedCycles, selectedTasks]);

  async function postCrm(body: Record<string, unknown>): Promise<CrmPostResponse> {
    const response = await fetch("/api/dashboard/crm", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as CrmPostResponse;
    if (response.status === 401) {
      const redirect = surface === "mobile" ? "/m/clients" : "/dashboard/clients";
      window.location.href = "/sign-in?redirect=" + encodeURIComponent(redirect);
      throw new Error("Please sign in again.");
    }
    if (!response.ok || result.ok === false) {
      throw new Error(responseMessage(result, "Studio OS could not save that change."));
    }
    return result;
  }

  function openClient(client: CrmClient) {
    setSelectedId(client.id);
    if (compact) setMobileDetailOpen(true);
  }

  function openBookingRepair(history: CrmBookingHistory) {
    setBookingRepairError("");
    setBookingRepair({
      jobId: history.jobId,
      schoolName: history.schoolName,
      clientId: history.clientId,
      locationId: history.locationId || "",
    });
  }

  async function reassignBookingJob() {
    if (!bookingRepair) return;
    if (!bookingRepair.clientId || !bookingRepair.locationId) {
      setBookingRepairError("Choose the exact education client and campus for this shoot.");
      return;
    }
    const targetClient = educationClients.find(
      (client) => client.id === bookingRepair.clientId,
    );
    const targetLocation = bookingRepairLocations.find(
      (location) => location.id === bookingRepair.locationId,
    );
    if (!targetClient || !targetLocation) {
      setBookingRepairError("That client or campus is no longer available. Refresh and choose again.");
      return;
    }
    setRepairingBookingJob(true);
    setBookingRepairError("");
    try {
      await postCrm({
        action: "reassignSchoolBookingJob",
        jobId: bookingRepair.jobId,
        clientId: targetClient.id,
        locationId: targetLocation.id,
      });
      setBookingRepair(null);
      setNotice(
        bookingRepair.schoolName + " is now linked to "
        + targetClient.displayName + " · " + (targetLocation.label || "Campus") + ".",
      );
      await load();
      setSelectedId(targetClient.id);
    } catch (caught) {
      setBookingRepairError(
        caught instanceof Error ? caught.message : "The school booking link could not be repaired.",
      );
    } finally {
      setRepairingBookingJob(false);
    }
  }

  function openApprovalReview(email: CrmEmailResult) {
    setApprovalError("");
    setApprovalEmailId(email.id);
    if (email.clientId && clientsById.has(email.clientId)) {
      setSelectedId(email.clientId);
    }
  }

  async function approvePendingEmail(email: CrmEmailResult) {
    if (!isPendingApproval(email.status)) {
      setApprovalError("This message is no longer waiting for approval. Refresh the Clients page.");
      return;
    }
    setApprovingEmailId(email.id);
    setApprovalError("");
    try {
      const result = await postCrm({
        action: "approveEmail",
        outboxId: email.id,
      });
      if (!result.email || clean(result.email.status).toLowerCase() !== "queued") {
        throw new Error("The server did not confirm that this message was queued.");
      }
      const recipient = clean(result.email.toName) || "the saved contact";
      setApprovalEmailId("");
      setNotice("Approved and queued for " + recipient + ".");
      await load();
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : "The message could not be approved.");
    } finally {
      setApprovingEmailId("");
    }
  }

  function updateRecordValue(name: string, value: string) {
    if (recordEditor?.kind === "client" && recordEditor.mode === "create") {
      clientBundleKeyRef.current = "";
    }
    setRecordEditor((current) => {
      if (!current) return current;
      const resetsConsentAttestation = ["client", "contact"].includes(current.kind)
        && current.values.marketingConsent === "optedIn"
        && ["contactName", "contactEmail"].includes(name);
      const emailIdentityChanged = name === "contactEmail"
        && normalizeEmailIdentity(value) !== current.values.originalContactEmail;
      const returnsToOriginalEmail = name === "contactEmail"
        && !emailIdentityChanged
        && current.values.originalConsentEvidenceExisting === "true";
      const usesDefaultLocationLabel = ["Main location", "Main campus"].includes(
        clean(current.values.locationLabel),
      );
      const locationLanguageChanged = current.kind === "client"
        && current.mode === "create"
        && name === "kind"
        && isSchoolSideClientKind(current.values.kind) !== isSchoolSideClientKind(value)
        && usesDefaultLocationLabel;
      return {
        ...current,
        values: {
          ...current.values,
          [name]: value,
          ...(locationLanguageChanged ? {
            locationLabel: isSchoolSideClientKind(value) ? "Main campus" : "Main location",
          } : {}),
          ...(resetsConsentAttestation ? {
            consentAttested: "false",
          } : {}),
          ...(emailIdentityChanged ? {
            consentAttested: "false",
            consentRecordedAt: "",
            consentSource: "",
            consentEvidenceExisting: "false",
          } : returnsToOriginalEmail ? {
            consentRecordedAt: current.values.originalConsentRecordedAt,
            consentSource: current.values.originalConsentSource,
            consentEvidenceExisting: "true",
          } : {}),
        },
      };
    });
  }

  function updateMarketingConsent(value: string) {
    if (recordEditor?.kind === "client" && recordEditor.mode === "create") {
      clientBundleKeyRef.current = "";
    }
    setRecordEditor((current) => current ? {
      ...current,
      values: {
        ...current.values,
        marketingConsent: value,
        consentAttested: "false",
      },
    } : current);
  }

  function updateConsentAttestation(checked: boolean) {
    if (recordEditor?.kind === "client" && recordEditor.mode === "create") {
      clientBundleKeyRef.current = "";
    }
    const attestedAt = checked ? new Date().toISOString() : "";
    setRecordEditor((current) => current ? {
      ...current,
      values: {
        ...current.values,
        consentAttested: checked ? "true" : "false",
        consentRecordedAt: checked
          ? current.values.consentEvidenceExisting === "true"
            ? current.values.consentRecordedAt
            : attestedAt
          : current.values.consentRecordedAt,
        consentSource: checked
          ? current.values.consentEvidenceExisting === "true"
            ? current.values.consentSource
            : OWNER_ATTESTED_CONSENT_SOURCE
          : current.values.consentSource,
      },
    } : current);
  }

  function openNewClientEditor() {
    clientBundleKeyRef.current = "";
    setRecordEditorError("");
    setRecordEditor({
      kind: "client",
      mode: "create",
      recordId: "",
      contactId: "",
      locationId: "",
      values: {
        kind: "school",
        displayName: "",
        legalName: "",
        website: "",
        studentCount: "",
        bookingMonth: "",
        timezone: "America/Toronto",
        notes: "",
        tags: "",
        contactName: "",
        jobTitle: "",
        contactEmail: "",
        contactPhone: "",
        preferredChannel: "email",
        marketingConsent: "unknown",
        consentAttested: "false",
        consentRecordedAt: "",
        consentSource: "",
        consentEvidenceExisting: "false",
        originalContactEmail: "",
        originalConsentRecordedAt: "",
        originalConsentSource: "",
        originalConsentEvidenceExisting: "false",
        doNotContact: "false",
        locationLabel: "Main campus",
        addressLine1: "",
        addressLine2: "",
        city: "",
        region: "",
        postalCode: "",
        countryCode: "CA",
        locationPhone: "",
      },
    });
  }

  function openClientEditor() {
    if (!selectedClient) return;
    setRecordEditorError("");
    setRecordEditor({
      kind: "client",
      mode: "edit",
      recordId: selectedClient.id,
      contactId: "",
      locationId: "",
      values: {
        kind: selectedClient.kind,
        displayName: selectedClient.displayName,
        legalName: clean(selectedClient.legalName),
        website: clean(selectedClient.website),
        studentCount: selectedClient.currentStudentCount?.toString() || "",
        bookingMonth: selectedClient.defaultBookingMonth?.toString() || "",
        timezone: clean(selectedClient.defaultTimezone) || "America/Toronto",
        notes: clean(selectedClient.notes),
        tags: selectedClient.tags?.join(", ") || "",
      },
    });
  }

  function openContactEditor(contact: CrmContact | null = null) {
    if (!selectedClient) return;
    const hasExistingConsentEvidence = clean(contact?.marketingConsent) === "optedIn"
      && !!clean(contact?.consentRecordedAt)
      && !!clean(contact?.consentSource);
    setRecordEditorError("");
    setRecordEditor({
      kind: "contact",
      mode: contact ? "edit" : "create",
      recordId: contact?.id || "",
      contactId: contact?.id || "",
      locationId: contact?.locationId || "",
      values: {
        contactName: clean(contact?.fullName),
        jobTitle: clean(contact?.jobTitle),
        contactEmail: clean(contact?.email),
        contactPhone: clean(contact?.phone),
        preferredChannel: clean(contact?.preferredChannel) || "email",
        marketingConsent: clean(contact?.marketingConsent) || "unknown",
        consentAttested: "false",
        consentRecordedAt: clean(contact?.consentRecordedAt),
        consentSource: clean(contact?.consentSource),
        consentEvidenceExisting: hasExistingConsentEvidence ? "true" : "false",
        originalContactEmail: normalizeEmailIdentity(contact?.email),
        originalConsentRecordedAt: clean(contact?.consentRecordedAt),
        originalConsentSource: clean(contact?.consentSource),
        originalConsentEvidenceExisting: hasExistingConsentEvidence ? "true" : "false",
        doNotContact: contact?.doNotContact ? "true" : "false",
        locationId: contact?.locationId || "",
        isPrimary: contact?.isPrimary || selectedContacts.length === 0 ? "true" : "false",
        originalIsPrimary: contact?.isPrimary ? "true" : "false",
      },
    });
  }

  function resetLocationPhotoDraft() {
    setLocationPhotoFile(null);
    setLocationPhotoAudience("client");
    setLocationPhotoCategory("entrance");
    setLocationPhotoCaption("");
    setLocationPhotoAltText("");
    locationPhotoUploadKeyRef.current = "";
    if (locationPhotoInputRef.current) locationPhotoInputRef.current.value = "";
  }

  function openLocationEditor(location: CrmLocation | null = null) {
    if (!selectedClient) return;
    setRecordEditorError("");
    resetLocationPhotoDraft();
    setRecordEditor({
      kind: "location",
      mode: location ? "edit" : "create",
      recordId: location?.id || "",
      contactId: "",
      locationId: location?.id || "",
      values: {
        locationLabel: clean(location?.label)
          || (isSchoolSideClientKind(selectedClient.kind) ? "Campus" : "Location"),
        addressLine1: clean(location?.addressLine1),
        addressLine2: clean(location?.addressLine2),
        city: clean(location?.city),
        region: clean(location?.region),
        postalCode: clean(location?.postalCode),
        countryCode: clean(location?.countryCode) || "CA",
        timezone: clean(location?.timezone) || selectedClient.defaultTimezone || "America/Toronto",
        locationPhone: clean(location?.phone),
        arrivalInstructions: clean(location?.arrivalInstructions),
        parkingInstructions: clean(location?.parkingInstructions),
        setupInstructions: clean(location?.setupInstructions),
        internalNotes: clean(location?.internalNotes),
        originalUpdatedAt: clean(location?.updatedAt),
        isPrimary: location?.isPrimary || selectedLocations.length === 0 ? "true" : "false",
        originalIsPrimary: location?.isPrimary ? "true" : "false",
      },
    });
  }

  function openCycleEditor() {
    if (!selectedClient) return;
    setRecordEditorError("");
    setRecordEditor({
      kind: "bookingCycle",
      mode: selectedCycle ? "edit" : "create",
      recordId: selectedCycle?.id || "",
      contactId: "",
      locationId: "",
      values: {
        seasonYear: seasonYear.toString(),
        status: selectedCycle?.status || "notContacted",
        targetContactOn: clean(selectedCycle?.targetContactOn),
        lastContactedAt: toLocalDateTime(selectedCycle?.lastContactedAt),
        nextFollowUpAt: toLocalDateTime(selectedCycle?.nextFollowUpAt),
        shootStartAt: toLocalDateTime(selectedCycle?.shootStartAt),
        shootEndAt: toLocalDateTime(selectedCycle?.shootEndAt),
        studentEstimate: selectedCycle?.studentCountEstimate?.toString() || "",
        studentActual: selectedCycle?.studentCountActual?.toString() || "",
        quotedAmount: selectedCycle?.quotedAmountCents != null
          ? (selectedCycle.quotedAmountCents / 100).toString()
          : "",
        bookedAmount: selectedCycle?.bookedAmountCents != null
          ? (selectedCycle.bookedAmountCents / 100).toString()
          : "",
        currency: clean(selectedCycle?.currency) || "CAD",
        notes: clean(selectedCycle?.notes),
      },
    });
  }

  function openTaskEditor(task?: CrmTask) {
    if (!selectedClient) return;
    setRecordEditorError("");
    setRecordEditor({
      kind: "task",
      mode: task ? "edit" : "create",
      recordId: task?.id || "",
      contactId: task?.contactId || "",
      locationId: "",
      values: {
        title: task?.title || "",
        kind: task?.kind || "followUp",
        dueAt: toLocalDateTime(task?.dueAt || selectedCycle?.nextFollowUpAt),
        remindAt: toLocalDateTime(task?.remindAt),
        priority: task?.priority?.toString() || "1",
        contactId: task?.contactId || selectedContact?.id || "",
        bookingCycleId: task?.bookingCycleId || selectedCycle?.id || "",
        status: task?.completedAt ? "completed" : task?.status || "open",
        completedAt: task?.completedAt || "",
        notes: task?.notes || "",
      },
    });
  }

  function openAgreementEditor() {
    if (!selectedClient) return;
    setRecordEditorError("");
    setRecordEditor({
      kind: "agreement",
      mode: selectedAgreement ? "edit" : "create",
      recordId: selectedAgreement?.id || "",
      contactId: "",
      locationId: "",
      values: {
        title: selectedAgreement?.title || "",
        status: selectedAgreement?.status || "draft",
        startsOn: clean(selectedAgreement?.startsOn),
        endsOn: clean(selectedAgreement?.endsOn),
        signedAt: toLocalDateTime(selectedAgreement?.signedAt),
        amount: selectedAgreement?.amountCents != null
          ? (selectedAgreement.amountCents / 100).toString()
          : "",
        currency: clean(selectedAgreement?.currency) || "CAD",
        studentCommitment: selectedAgreement?.studentCommitment?.toString() || "",
        renewalNoticeDays: selectedAgreement?.renewalNoticeDays?.toString() || "30",
        termsSummary: clean(selectedAgreement?.termsSummary),
        notes: clean(selectedAgreement?.notes),
      },
    });
  }

  async function setPrimaryRecord(
    resource: "contact" | "location",
    clientId: string,
    id: string,
  ) {
    if (!isUuid(id)) throw new Error("The server did not confirm the saved record before changing its primary status.");
    const result = await postCrm({
      action: "setPrimary",
      resource,
      clientId,
      id,
    });
    if (clean(result.record?.id) !== id || result.record?.isPrimary !== true) {
      throw new Error("The server did not confirm the primary " + resource + ". Refresh and try again.");
    }
  }

  async function createClientBundle(values: Record<string, string>): Promise<string> {
    const bundleRequestKey = clientBundleKeyRef.current || requestKey();
    clientBundleKeyRef.current = bundleRequestKey;
    const result = await postCrm({
      action: "createClientBundle",
      requestKey: bundleRequestKey,
      client: {
        kind: values.kind,
        displayName: clean(values.displayName),
        legalName: nullableText(values.legalName),
        website: nullableText(values.website),
        currentStudentCount: nullableInteger(values.studentCount),
        defaultBookingMonth: nullableInteger(values.bookingMonth),
        defaultTimezone: clean(values.timezone) || "America/Toronto",
        notes: nullableText(values.notes),
        tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      },
      location: {
        label: clean(values.locationLabel)
          || (isSchoolSideClientKind(values.kind) ? "Main campus" : "Main location"),
        addressLine1: nullableText(values.addressLine1),
        addressLine2: nullableText(values.addressLine2),
        city: nullableText(values.city),
        region: nullableText(values.region),
        postalCode: nullableText(values.postalCode),
        countryCode: clean(values.countryCode).toUpperCase() || "CA",
        timezone: nullableText(values.timezone),
        phone: nullableText(values.locationPhone),
      },
      contact: {
        fullName: clean(values.contactName),
        jobTitle: nullableText(values.jobTitle),
        role: nullableText(values.jobTitle),
        email: nullableText(values.contactEmail)?.toLowerCase() || null,
        phone: nullableText(values.contactPhone),
        preferredChannel: values.preferredChannel || "email",
        ...contactConsentPayload(values),
        doNotContact: values.doNotContact === "true",
      },
      bookingCycle: {
        seasonYear,
        cycleKey: String(seasonYear),
        label: String(seasonYear) + " season",
        status: "notContacted",
        studentCountEstimate: nullableInteger(values.studentCount),
        currency: "CAD",
      },
    });
    const bundle = result.bundle;
    if (
      !bundle
      || !isUuid(bundle.clientId)
      || !isUuid(bundle.locationId)
      || !isUuid(bundle.contactId)
      || !isUuid(bundle.bookingCycleId)
    ) {
      throw new Error("The server did not confirm the complete client record. Retry this save before changing any details.");
    }
    clientBundleKeyRef.current = "";
    return bundle.clientId;
  }

  function validateContactValues(values: Record<string, string>) {
    if (!clean(values.contactName)) throw new Error("Contact name is required.");
    if (values.marketingConsent === "optedIn" && values.consentAttested !== "true") {
      throw new Error("Confirm that this person agreed to receive promotional email before marking them opted in.");
    }
    if (
      values.marketingConsent === "optedIn"
      && (!clean(values.consentRecordedAt) || !clean(values.consentSource))
    ) {
      throw new Error("Consent evidence is required before this contact can be marked opted in.");
    }
  }

  async function saveRecordEditor() {
    if (!recordEditor) return;
    const values = recordEditor.values;
    setRecordEditorError("");
    setSavingRecord(true);
    try {
      if (recordEditor.kind === "client") {
        if (!clean(values.displayName)) throw new Error("Client name is required.");
        if (recordEditor.mode === "create") {
          validateContactValues(values);
          const clientId = await createClientBundle(values);
          setSelectedId(clientId);
          setNotice("Client, contact, location, and season created together.");
        } else {
          const clientId = recordEditor.recordId;
          if (!clientId) throw new Error("Choose a client before editing its details.");
          await postCrm({
            action: "save",
            resource: "client",
            id: clientId,
            values: {
              kind: values.kind,
              displayName: clean(values.displayName),
              legalName: nullableText(values.legalName),
              website: nullableText(values.website),
              currentStudentCount: nullableInteger(values.studentCount),
              defaultBookingMonth: nullableInteger(values.bookingMonth),
              defaultTimezone: clean(values.timezone) || "America/Toronto",
              notes: nullableText(values.notes),
              tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            },
          });
          setSelectedId(clientId);
          setNotice("Client details updated.");
        }
      } else if (recordEditor.kind === "contact") {
        if (!selectedClient) throw new Error("Choose a client first.");
        validateContactValues(values);
        const preserveExistingPrimary = values.originalIsPrimary === "true" && values.isPrimary === "true";
        const promoteAfterSave = values.isPrimary === "true" && values.originalIsPrimary !== "true";
        const result = await postCrm({
          action: "save",
          resource: "contact",
          id: recordEditor.recordId || undefined,
          values: {
            clientId: selectedClient.id,
            locationId: nullableText(values.locationId),
            fullName: clean(values.contactName),
            jobTitle: nullableText(values.jobTitle),
            role: nullableText(values.jobTitle),
            email: nullableText(values.contactEmail)?.toLowerCase() || null,
            phone: nullableText(values.contactPhone),
            preferredChannel: values.preferredChannel || "email",
            // Primary promotion is a separate atomic operation. Saving true here
            // can conflict with the existing primary's unique constraint.
            ...(preserveExistingPrimary ? {} : { isPrimary: false }),
            ...contactConsentPayload(values),
            doNotContact: values.doNotContact === "true",
          },
        });
        const contactId = recordEditor.recordId || savedRecordId(result);
        if (!isUuid(contactId)) {
          throw new Error("The server did not confirm the saved contact. Refresh before trying again.");
        }
        if (!recordEditor.recordId) {
          // Keep retries on the created row if the separate primary promotion
          // fails, instead of creating a duplicate contact.
          setRecordEditor((current) => current?.kind === "contact"
            ? { ...current, mode: "edit", recordId: contactId, contactId }
            : current);
        }
        if (promoteAfterSave) {
          await setPrimaryRecord("contact", selectedClient.id, contactId);
        }
        setNotice(
          promoteAfterSave
            ? recordEditor.mode === "create" ? "Primary contact added." : "Contact updated and marked primary."
            : recordEditor.mode === "create" ? "Contact added." : "Contact updated.",
        );
      } else if (recordEditor.kind === "location") {
        if (!selectedClient) throw new Error("Choose a client first.");
        const usesCampusLanguage = isSchoolSideClientKind(selectedClient.kind);
        if (!clean(values.locationLabel)) {
          throw new Error((usesCampusLanguage ? "Campus" : "Location") + " name is required.");
        }
        const preserveExistingPrimary = values.originalIsPrimary === "true" && values.isPrimary === "true";
        const promoteAfterSave = values.isPrimary === "true" && values.originalIsPrimary !== "true";
        const result = await postCrm({
          action: "save",
          resource: "location",
          id: recordEditor.recordId || undefined,
          ...(recordEditor.recordId && clean(values.originalUpdatedAt)
            ? { expectedUpdatedAt: clean(values.originalUpdatedAt) }
            : {}),
          values: {
            clientId: selectedClient.id,
            label: clean(values.locationLabel),
            addressLine1: nullableText(values.addressLine1),
            addressLine2: nullableText(values.addressLine2),
            city: nullableText(values.city),
            region: nullableText(values.region),
            postalCode: nullableText(values.postalCode),
            countryCode: clean(values.countryCode).toUpperCase() || "CA",
            timezone: nullableText(values.timezone),
            phone: nullableText(values.locationPhone),
            arrivalInstructions: nullableText(values.arrivalInstructions),
            parkingInstructions: nullableText(values.parkingInstructions),
            setupInstructions: nullableText(values.setupInstructions),
            internalNotes: nullableText(values.internalNotes),
            ...(preserveExistingPrimary ? {} : { isPrimary: false }),
          },
        });
        const locationId = recordEditor.recordId || savedRecordId(result);
        if (!isUuid(locationId)) {
          throw new Error("The server did not confirm the saved campus. Refresh before trying again.");
        }
        if (!recordEditor.recordId) {
          // Primary promotion is a second request, so preserve the saved row ID
          // for an idempotent retry if promotion is interrupted.
          setRecordEditor((current) => current?.kind === "location"
            ? { ...current, mode: "edit", recordId: locationId, locationId }
            : current);
        }
        if (promoteAfterSave) {
          await setPrimaryRecord("location", selectedClient.id, locationId);
        }
        const recordLabel = usesCampusLanguage ? "Campus" : "Location";
        setNotice(promoteAfterSave
          ? recordEditor.mode === "create"
            ? "Primary " + recordLabel.toLowerCase() + " added."
            : recordLabel + " updated and marked primary."
          : recordEditor.mode === "create"
            ? recordLabel + " added."
            : recordLabel + " updated.",
        );
      } else if (recordEditor.kind === "bookingCycle") {
        if (!selectedClient) throw new Error("Choose a client first.");
        const year = Number(values.seasonYear);
        if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Enter a valid season year.");
        await postCrm({
          action: "save",
          resource: "bookingCycle",
          id: recordEditor.recordId || undefined,
          values: {
            clientId: selectedClient.id,
            seasonYear: year,
            cycleKey: recordEditor.mode === "create" ? String(year) : undefined,
            label: String(year) + " season",
            status: values.status,
            targetContactOn: nullableText(values.targetContactOn),
            lastContactedAt: toIsoDateTime(values.lastContactedAt),
            nextFollowUpAt: toIsoDateTime(values.nextFollowUpAt),
            bookedAt: values.status === "booked"
              ? selectedCycle?.bookedAt || new Date().toISOString()
              : selectedCycle?.bookedAt || null,
            shootStartAt: toIsoDateTime(values.shootStartAt),
            shootEndAt: toIsoDateTime(values.shootEndAt),
            studentCountEstimate: nullableInteger(values.studentEstimate),
            studentCountActual: nullableInteger(values.studentActual),
            quotedAmountCents: dollarsToCents(values.quotedAmount),
            bookedAmountCents: dollarsToCents(values.bookedAmount),
            currency: clean(values.currency).toUpperCase() || "CAD",
            notes: nullableText(values.notes),
          },
        });
        setNotice("Annual booking cycle updated.");
      } else if (recordEditor.kind === "task") {
        if (!selectedClient) throw new Error("Choose a client first.");
        if (!clean(values.title)) throw new Error("Task title is required.");
        const isCompleted = values.status === "completed";
        await postCrm({
          action: "save",
          resource: "task",
          id: recordEditor.recordId || undefined,
          values: {
            ...(recordEditor.mode === "create" ? { clientId: selectedClient.id } : {}),
            contactId: nullableText(values.contactId),
            bookingCycleId: nullableText(values.bookingCycleId),
            kind: values.kind,
            title: clean(values.title),
            notes: nullableText(values.notes),
            dueAt: toIsoDateTime(values.dueAt),
            remindAt: toIsoDateTime(values.remindAt),
            status: values.status,
            priority: Number(values.priority) || 0,
            completedAt: isCompleted
              ? values.completedAt || new Date().toISOString()
              : null,
          },
        });
        setNotice(recordEditor.mode === "create" ? "Follow-up task added." : "Task and reminder updated.");
      } else if (recordEditor.kind === "agreement") {
        if (!selectedClient) throw new Error("Choose a client first.");
        if (!clean(values.title)) throw new Error("Agreement title is required.");
        await postCrm({
          action: "save",
          resource: "agreement",
          id: recordEditor.recordId || undefined,
          values: {
            clientId: selectedClient.id,
            title: clean(values.title),
            status: values.status,
            startsOn: nullableText(values.startsOn),
            endsOn: nullableText(values.endsOn),
            signedAt: toIsoDateTime(values.signedAt),
            amountCents: dollarsToCents(values.amount),
            currency: clean(values.currency).toUpperCase() || "CAD",
            studentCommitment: nullableInteger(values.studentCommitment),
            renewalNoticeDays: nullableInteger(values.renewalNoticeDays) || 0,
            termsSummary: nullableText(values.termsSummary),
            notes: nullableText(values.notes),
          },
        });
        setNotice(recordEditor.mode === "create" ? "Agreement added." : "Agreement updated.");
      }
      setRecordEditor(null);
      await load();
    } catch (caught) {
      setRecordEditorError(caught instanceof Error ? caught.message : "The record could not be saved.");
    } finally {
      setSavingRecord(false);
    }
  }

  async function uploadLocationPhoto() {
    if (recordEditor?.kind !== "location" || !recordEditor.recordId) {
      setRecordEditorError("Save this location before adding photos.");
      return;
    }
    if (!locationPhotoFile) {
      setRecordEditorError("Choose a JPEG, PNG, or WebP photo first.");
      return;
    }
    const currentPhotos = locationPhotosByLocation.get(recordEditor.recordId) || [];
    if (currentPhotos.length >= MAX_LOCATION_PHOTOS) {
      setRecordEditorError(`A location can keep up to ${MAX_LOCATION_PHOTOS} photos.`);
      return;
    }
    if (!LOCATION_PHOTO_TYPES.includes(locationPhotoFile.type)) {
      setRecordEditorError("Location photos must be JPEG, PNG, or WebP files.");
      return;
    }
    if (locationPhotoFile.size > MAX_LOCATION_PHOTO_SOURCE_BYTES) {
      setRecordEditorError("Choose a photo no larger than 6 MB.");
      return;
    }

    const uploadKey = locationPhotoUploadKeyRef.current || requestKey();
    locationPhotoUploadKeyRef.current = uploadKey;
    setUploadingLocationPhoto(true);
    setRecordEditorError("");
    try {
      const optimized = await optimizeLocationPhoto(locationPhotoFile);
      const result = await postCrm({
        action: "uploadLocationPhoto",
        locationId: recordEditor.recordId,
        requestKey: uploadKey,
        audience: locationPhotoAudience,
        category: locationPhotoCategory,
        caption: nullableText(locationPhotoCaption),
        altText: nullableText(locationPhotoAltText),
        photo: {
          filename: optimized.filename || "location-photo.jpg",
          contentType: optimized.contentType,
          content: optimized.content,
        },
      });
      if (!result.photo?.id) {
        throw new Error("The server did not confirm the saved location photo.");
      }
      const audienceLabel = locationPhotoAudience === "client" ? "client-facing" : "staff-only";
      resetLocationPhotoDraft();
      setNotice(`Saved ${audienceLabel} location photo.`);
      await load();
    } catch (caught) {
      setRecordEditorError(
        caught instanceof Error ? caught.message : "The location photo could not be uploaded.",
      );
    } finally {
      setUploadingLocationPhoto(false);
    }
  }

  async function deleteLocationPhoto(photo: CrmLocationPhoto) {
    if (!window.confirm(
      `Remove this ${photo.audience === "client" ? "client-facing" : "staff-only"} ${statusLabel(photo.category).toLowerCase()} photo?`,
    )) return;
    setDeletingLocationPhotoId(photo.id);
    setRecordEditorError("");
    try {
      await postCrm({ action: "deleteLocationPhoto", id: photo.id });
      setNotice("Location photo removed.");
      await load();
    } catch (caught) {
      setRecordEditorError(
        caught instanceof Error ? caught.message : "The location photo could not be removed.",
      );
    } finally {
      setDeletingLocationPhotoId("");
    }
  }

  async function deleteContactRecord(contact: CrmContact) {
    if (contact.isPrimary && selectedContacts.length > 1) {
      setError("Mark another contact as primary before deleting this primary contact.");
      return;
    }
    if (!window.confirm("Remove " + contact.fullName + " from this client? Linked history may cause the record to be safely archived.")) return;
    setDeletingRecordId(contact.id);
    setError("");
    try {
      const result = await postCrm({ action: "delete", resource: "contact", id: contact.id });
      setNotice(responseMessage(result, result.disposition === "archived" ? "Contact archived." : "Contact removed."));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contact could not be deleted.");
    } finally {
      setDeletingRecordId("");
    }
  }

  async function deleteLocationRecord(location: CrmLocation) {
    const usesCampusLanguage = !!selectedClient && isSchoolSideClientKind(selectedClient.kind);
    const locationNoun = usesCampusLanguage ? "campus" : "location";
    const assignedContacts = selectedContacts.filter((contact) => contact.locationId === location.id);
    const bookingUses = bookingUseCountByLocation.get(location.id) || 0;
    if (location.isPrimary && selectedLocations.length > 1) {
      setError(usesCampusLanguage
        ? "Mark another campus as primary before deleting this primary campus."
        : "Mark another location as primary before deleting this primary location.");
      return;
    }
    const label = clean(location.label) || "this " + locationNoun;
    const reassignmentNote = assignedContacts.length
      ? "\n\nReassign " + assignedContacts.length + " contact"
        + (assignedContacts.length === 1 ? "" : "s")
        + " first if they should stay attached to an active location; otherwise they become unassigned."
      : "";
    if (!window.confirm(
      "Delete " + label + " from the active client record?"
        + (bookingUses
          ? "\n\nIt is used by " + bookingUses + " booking"
            + (bookingUses === 1 ? "" : "s")
            + ", so Studio OS will preserve that history by archiving the location."
          : "\n\nNo booking history uses it, so the location can be permanently deleted.")
        + reassignmentNote,
    )) return;
    setDeletingRecordId(location.id);
    setError("");
    try {
      const result = await postCrm({ action: "delete", resource: "location", id: location.id });
      setNotice(responseMessage(
        result,
        (usesCampusLanguage ? "Campus" : "Location")
          + (result.disposition === "archived" ? " archived with its history." : " deleted."),
      ));
      await load();
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : "The " + locationNoun + " could not be deleted.");
    } finally {
      setDeletingRecordId("");
    }
  }

  function toggleClientSelection(clientId: string) {
    setSelectedClientIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function openBatchReview() {
    setBatchTemplateId(approvedBulkTemplates[0]?.id || "");
    setBatchConfirmed(false);
    setBatchError("");
    setBatchOpen(true);
  }

  async function queueBatchEmail() {
    if (!batchTemplateId) {
      setBatchError("Choose an approved relationship or marketing preset.");
      return;
    }
    if (!eligibleBatchRows.length) {
      setBatchError("None of the selected clients has an eligible opted-in primary contact.");
      return;
    }
    if (eligibleBatchRows.length > 100) {
      setBatchError("Reviewed outreach is limited to 100 eligible contacts at a time.");
      return;
    }
    if (!batchConfirmed) {
      setBatchError("Confirm that you reviewed the recipients and preset before queueing.");
      return;
    }
    setBatchQueueing(true);
    setBatchError("");
    try {
      const result = await postCrm({
        action: "bulkQueue",
        contactIds: eligibleBatchRows.map((row) => row.contact?.id).filter(Boolean),
        templateId: batchTemplateId,
        requestKey: requestKey(),
      });
      const queued = numberOrZero(result.queued);
      const skipped = arrayOrEmpty<{ contactId: string; code: string }>(result.skipped).length;
      setBatchOpen(false);
      setSelectedClientIds(new Set());
      setNotice(
        queued + " email" + (queued === 1 ? "" : "s") + " queued for delivery"
          + (skipped ? "; " + skipped + " skipped by final server checks." : "."),
      );
      await load();
    } catch (caught) {
      setBatchError(caught instanceof Error ? caught.message : "The reviewed email batch could not be queued.");
    } finally {
      setBatchQueueing(false);
    }
  }

  function openEmailComposer() {
    if (!selectedClient) return;
    const contact = selectedContact && selectedContact.email && !selectedContact.doNotContact
      ? selectedContact
      : selectedContacts.find((row) => !!clean(row.email) && !row.doNotContact) || null;
    const template = approvedTemplates[0] || null;
    setEmailState({
      contactId: contact?.id || "",
      templateId: template?.id || "",
      subject: template?.subjectTemplate || "",
      message: templateMessage(template),
      outboxId: "",
      contentSource: template ? "approved template" : "",
    });
    setEmailError("");
    sendKeyRef.current = requestKey();
    setEmailOpen(true);
  }

  function chooseTemplate(templateId: string) {
    const template = approvedTemplates.find((row) => row.id === templateId) || null;
    setEmailState((current) => ({
      ...current,
      templateId,
      subject: template?.subjectTemplate || "",
      message: templateMessage(template),
      outboxId: "",
      contentSource: template ? "approved template" : "",
    }));
    sendKeyRef.current = requestKey();
  }

  async function draftEmailWithAi() {
    if (!selectedClient || !emailState.contactId) {
      setEmailError("Choose a saved contact with an email address first.");
      return;
    }
    if (!emailState.templateId && (!clean(emailState.subject) || !clean(emailState.message))) {
      setEmailError("Choose a preset or write a subject and message before asking AI to refine it.");
      return;
    }
    setDrafting(true);
    setEmailError("");
    try {
      const result = await postCrm({
        action: "draftEmail",
        clientId: selectedClient.id,
        contactId: emailState.contactId,
        bookingCycleId: selectedCycle?.id || undefined,
        templateId: emailState.templateId || undefined,
        useAi: true,
        subject: clean(emailState.subject) || undefined,
        message: clean(emailState.message) || undefined,
      });
      if (!result.email?.id) throw new Error("The draft was not returned. Please try again.");
      setEmailState((current) => ({
        ...current,
        outboxId: result.email?.id || "",
        subject: clean(result.email?.subject) || current.subject,
        message: clean(result.email?.text) || current.message,
        contentSource: clean(result.email?.contentSource) || "AI-assisted draft",
      }));
      setNotice("AI draft prepared. Review it before queueing.");
    } catch (caught) {
      setEmailError(caught instanceof Error ? caught.message : "The AI draft could not be prepared.");
    } finally {
      setDrafting(false);
    }
  }

  async function queueEmail() {
    if (!selectedClient || !emailState.contactId) {
      setEmailError("Choose a saved contact with an email address first.");
      return;
    }
    if (!emailState.outboxId && !emailState.templateId) {
      setEmailError("Choose an approved preset. Custom messages must be drafted and reviewed first.");
      return;
    }
    if (!emailState.outboxId && emailState.contentSource !== "approved template") {
      setEmailError("This message was edited. Prepare a reviewed draft before queueing it.");
      return;
    }
    setSending(true);
    setEmailError("");
    try {
      let result: CrmPostResponse;
      if (emailState.outboxId) {
        result = await postCrm({
          action: "sendEmail",
          outboxId: emailState.outboxId,
          requestKey: sendKeyRef.current || requestKey(),
        });
      } else {
        result = await postCrm({
          action: "sendEmail",
          clientId: selectedClient.id,
          contactId: emailState.contactId,
          bookingCycleId: selectedCycle?.id || undefined,
          templateId: emailState.templateId,
          requestKey: sendKeyRef.current || requestKey(),
        });
      }
      const recipient = clean(result.email?.toName) || clean(result.email?.toEmail) || "the contact";
      setEmailOpen(false);
      setNotice("Email queued for " + recipient + ". It will appear in the delivery audit.");
      sendKeyRef.current = "";
      await load();
    } catch (caught) {
      setEmailError(caught instanceof Error ? caught.message : "The email could not be queued.");
    } finally {
      setSending(false);
    }
  }

  async function completeTask(task: CrmTask) {
    setCompletingTaskId(task.id);
    setError("");
    try {
      await postCrm({
        action: "save",
        resource: "task",
        id: task.id,
        values: {
          clientId: task.clientId,
          status: "completed",
          completedAt: new Date().toISOString(),
        },
      });
      setNotice("Task completed.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task could not be completed.");
    } finally {
      setCompletingTaskId("");
    }
  }

  async function saveAutomationMode() {
    if (!selectedClient) return;
    const template = selectedRule?.templateId
      ? approvedBulkTemplates.find((row) => row.id === selectedRule.templateId) || approvedBulkTemplates[0]
      : approvedBulkTemplates[0];
    if (automationMode !== "off" && !template) {
      setError("Add an approved CRM email preset before enabling reminder automation.");
      return;
    }
    setSavingAutomation(true);
    setError("");
    try {
      await postCrm({
        action: "save",
        resource: "automationRule",
        id: selectedRule?.clientId === selectedClient.id ? selectedRule.id : undefined,
        values: {
          clientId: selectedClient.id,
          templateId: template?.id || selectedRule?.templateId || null,
          name: selectedRule?.name || "Annual booking follow-up",
          triggerType: selectedRule?.triggerType || "bookingSeasonOpen",
          actionType: selectedRule?.actionType || "emailClient",
          mode: automationMode,
          daysOffset: selectedRule?.daysOffset ?? 0,
          maxRunsPerCycle: 1,
          sendLocalTime: selectedRule?.sendLocalTime || "09:00",
          timezone: selectedRule?.timezone || selectedClient.defaultTimezone || "America/Toronto",
          conditions: {},
          enabled: automationMode !== "off",
          confirmAutopilot: automationMode === "autopilot",
        },
      });
      setNotice("Automation mode saved for " + selectedClient.displayName + ".");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The automation mode could not be saved.");
    } finally {
      setSavingAutomation(false);
    }
  }

  const metricValues = [
    { label: "All clients", value: payload.summary.totalClients || activeClients.length },
    { label: "Booked " + seasonYear, value: seasonSummary.booked },
    { label: "Still to book", value: seasonSummary.notBooked },
    { label: "Follow-ups due", value: payload.summary.followUpsDue },
    { label: "Open tasks", value: payload.summary.openTasks },
    { label: "Awaiting approval", value: payload.summary.pendingApprovals || pendingApprovalEmails.length },
  ];

  const showList = !compact || !mobileDetailOpen || !selectedClient;
  const showDetail = !compact || (mobileDetailOpen && !!selectedClient);
  const selectedDue = selectedClient ? clientDue(selectedClient) : false;
  const galleryHref = selectedClient ? targetHref(surface, selectedClient, selectedCycle) : null;
  const selectedUsesCampusLanguage = !!selectedClient && isSchoolSideClientKind(selectedClient.kind);
  const editorLocationKind = recordEditor?.kind === "client"
    ? recordEditor.values.kind
    : selectedClient?.kind || "";
  const editorUsesCampusLanguage = isSchoolSideClientKind(editorLocationKind);
  const editorLocationPhotos = recordEditor?.kind === "location" && recordEditor.recordId
    ? locationPhotosByLocation.get(recordEditor.recordId) || []
    : [];
  const locationEditorBusy = savingRecord || uploadingLocationPhoto || !!deletingLocationPhotoId;
  return (
    <div className={styles.workspace + (surface === "mobile" ? " " + styles.mobileWorkspace : "")}>
      <div className={styles.shell}>
        <section className={styles.hero} aria-labelledby="crm-title">
          <div className={styles.heroTop}>
            <div>
              <p className={styles.eyebrow}>Studio relationships</p>
              <h1 id="crm-title" className={styles.title}>Clients</h1>
              <p className={styles.subtitle}>
                Keep every school and event contact, annual booking, agreement, follow-up, and message in one place.
              </p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className={styles.primaryButton} onClick={openNewClientEditor}>
                <UsersRound size={16} aria-hidden="true" /> New client
              </button>
              <button
                type="button"
                className={styles.refreshButton}
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span className={styles.refreshLabel}>Refresh</span>
              </button>
            </div>
          </div>
          <div className={styles.metrics} aria-label="Client summary">
            {metricValues.map((metric) => (
              <div key={metric.label} className={styles.metric}>
                <span className={styles.metricValue}>{metric.value}</span>
                <span className={styles.metricLabel}>{metric.label}</span>
              </div>
            ))}
          </div>
        </section>

        {error ? (
          <div className={styles.error} role="alert">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <section className={styles.filters} aria-label="Client filters">
          <label className={styles.searchWrap}>
            <Search className={styles.searchIcon} size={17} aria-hidden="true" />
            <span className="sr-only">Search clients</span>
            <input
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search school, client, contact, email or city"
            />
          </label>
          <label>
            <span className="sr-only">Client type</span>
            <select className={styles.select} value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">All client types</option>
              <option value="school">Schools</option>
              <option value="college">Colleges</option>
              <option value="university">Universities</option>
              <option value="daycare">Daycares</option>
              <option value="montessori">Montessori schools</option>
              <option value="corporate">Corporate</option>
              <option value="wedding">Weddings</option>
              <option value="event">Events</option>
              <option value="sports">Sports</option>
              <option value="family">Families</option>
              <option value="person">People</option>
              <option value="nonprofit">Nonprofits</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Booking status</span>
            <select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All booking statuses</option>
              <option value="booked">Booked this season</option>
              <option value="not_booked">Not booked</option>
              <option value="follow_up">Follow-up due</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Season year</span>
            <select
              className={styles.select}
              value={seasonYear}
              onChange={(event) => setSeasonYear(Number(event.target.value))}
            >
              {[seasonYear - 2, seasonYear - 1, seasonYear, seasonYear + 1, seasonYear + 2]
                .filter((value, index, rows) => rows.indexOf(value) === index)
                .sort((a, b) => b - a)
                .map((year) => <option key={year} value={year}>{year} season</option>)}
            </select>
          </label>
        </section>

        {pendingApprovalEmails.length ? (
          <section className={styles.approvalPanel} aria-labelledby="approval-inbox-title">
            <div className={styles.approvalPanelHeader}>
              <div>
                <h2 id="approval-inbox-title" className={styles.approvalPanelTitle}>
                  <ShieldCheck size={16} aria-hidden="true" /> Email approval inbox
                </h2>
                <div className={styles.muted} style={{ marginTop: 3 }}>
                  Review every message before it enters the delivery queue.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className={styles.statusPill + " " + styles.statusDue}>
                  {pendingApprovalEmails.length} waiting
                </span>
                {pendingApprovalEmails.length > 4 ? (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    style={{ minHeight: 32, padding: "5px 8px" }}
                    onClick={() => setApprovalsExpanded((current) => !current)}
                  >
                    {approvalsExpanded ? "Show less" : "Show all"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className={styles.approvalList}>
              {(approvalsExpanded ? pendingApprovalEmails : pendingApprovalEmails.slice(0, 4)).map((email) => {
                const client = clientsById.get(email.clientId);
                return (
                  <article key={email.id} className={styles.approvalCard}>
                    <div className={styles.approvalCardMain}>
                      <span className={styles.approvalSubject}>{clean(email.subject) || "Untitled message"}</span>
                      <span className={styles.approvalRecipient}>
                        {client?.displayName || "Client"} · {clean(email.toName) || "Saved contact"}
                        {email.toEmail ? " · " + email.toEmail : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.approvalReviewButton}
                      onClick={() => openApprovalReview(email)}
                    >
                      Review
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className={styles.layout}>
          {showList ? (
            <section className={styles.panel + " " + styles.listPanel} aria-labelledby="client-list-title">
              <div className={styles.panelHeader}>
                <h2 id="client-list-title" className={styles.panelTitle}>Client database</h2>
                <span className={styles.panelCount}>{filteredClients.length}</span>
              </div>
              {selectedClientIds.size > 0 ? (
                <div className={styles.panelHeader} aria-live="polite">
                  <span className={styles.muted}>{selectedClientIds.size} selected</span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={openBatchReview}
                    title="Review eligible saved contacts and an approved preset before queueing."
                  >
                    <Mail size={14} aria-hidden="true" /> Queue email (review)
                  </button>
                </div>
              ) : null}
              <div className={styles.clientList}>
                {loading ? (
                  <>
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                  </>
                ) : filteredClients.length === 0 ? (
                  <div className={styles.empty}>
                    <div>
                      <span className={styles.emptyIcon}><UsersRound size={22} /></span>
                      <div className={styles.panelTitle}>No matching clients</div>
                      <p className={styles.muted}>Try a different filter or use New client to add the first relationship.</p>
                    </div>
                  </div>
                ) : (
                  filteredClients.map((client) => {
                    const cycle = cycleFor(client);
                    const contact = primaryContactFor(client);
                    const location = primaryLocationFor(client.id);
                    const due = clientDue(client);
                    const status = cycle?.status || null;
                    const selected = selectedId === client.id;
                    return (
                      <div key={client.id} style={{ position: "relative" }}>
                        <button
                          type="button"
                          className={styles.clientButton + (selected ? " " + styles.clientButtonActive : "")}
                          onClick={() => openClient(client)}
                          aria-current={selected ? "true" : undefined}
                        >
                          <span className={styles.clientRowTop}>
                            <span className={styles.avatar}>
                              {isSchoolSideClientKind(client.kind)
                                ? <GraduationCap size={19} aria-hidden="true" />
                                : <Building2 size={19} aria-hidden="true" />}
                            </span>
                            <span className={styles.clientMain}>
                              <span className={styles.clientName}>{client.displayName || "Unnamed client"}</span>
                              <span className={styles.clientMeta}>
                                {contact?.fullName || "No primary contact"}
                                {location?.city ? " · " + location.city : ""}
                              </span>
                            </span>
                            <ChevronRight size={16} color="#8b95a6" aria-hidden="true" />
                          </span>
                          <span className={styles.clientRowBottom}>
                            <span className={styles.kindPill}>{clientKindLabel(client.kind)}</span>
                            <span className={styles.statusPill + " " + statusClass(status, !!cycle && due)}>
                              {!cycle
                                ? "No " + seasonYear + " cycle"
                                : due && !isBookedStatus(status) ? "Follow-up due" : statusLabel(status)}
                            </span>
                          </span>
                        </button>
                        <label
                          title="Select for a future reviewed batch"
                          style={{
                            position: "absolute",
                            top: 22,
                            right: 34,
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedClientIds.has(client.id)}
                            onChange={() => toggleClientSelection(client.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={"Select " + client.displayName}
                          />
                        </label>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}

          {showDetail ? (
            <section className={styles.panel + " " + styles.detail} aria-live="polite">
              {!selectedClient ? (
                <div className={styles.empty}>
                  <div>
                    <span className={styles.emptyIcon}><UserRound size={22} /></span>
                    <div className={styles.panelTitle}>Choose a client</div>
                    <p className={styles.muted}>Contact, booking, agreement, and follow-up details will appear here.</p>
                  </div>
                </div>
              ) : detailLoading || detailState?.clientId !== selectedClient.id ? (
                <div className={styles.empty}>
                  <div>
                    {compact ? (
                      <button type="button" className={styles.backButton} onClick={() => setMobileDetailOpen(false)}>
                        <ArrowLeft size={15} aria-hidden="true" /> All clients
                      </button>
                    ) : null}
                    <div className={styles.panelTitle}>{detailLoading ? "Loading " : "Could not load "}{selectedClient.displayName}</div>
                    <p className={styles.muted}>
                      {detailLoading
                        ? "Contacts and history are loading from Studio OS Cloud."
                        : "Use Refresh to retry this client's details."}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.detailHero}>
                    {compact ? (
                      <button type="button" className={styles.backButton} onClick={() => setMobileDetailOpen(false)}>
                        <ArrowLeft size={15} aria-hidden="true" /> All clients
                      </button>
                    ) : null}
                    <div className={styles.detailTitleRow}>
                      <div style={{ minWidth: 0 }}>
                        <span className={styles.kindPill}>{clientKindLabel(selectedClient.kind)}</span>
                        <h2 className={styles.detailTitle}>{selectedClient.displayName}</h2>
                        <div className={styles.detailSubline}>
                          <span className={styles.statusPill + " " + statusClass(selectedCycle?.status, !!selectedCycle && selectedDue)}>
                            {!selectedCycle
                              ? "No " + seasonYear + " cycle"
                              : selectedDue && !isBookedStatus(selectedCycle.status)
                                ? "Follow-up due"
                                : statusLabel(selectedCycle.status)}
                          </span>
                          <span>{selectedClient.yearsBooked || 0} year{selectedClient.yearsBooked === 1 ? "" : "s"} booked</span>
                          {selectedClient.currentStudentCount ? <span>{selectedClient.currentStudentCount.toLocaleString()} people</span> : null}
                        </div>
                      </div>
                      <div className={styles.detailActions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => openClientEditor()}>
                          <UserRound size={15} aria-hidden="true" /> Edit client
                        </button>
                        {galleryHref ? (
                          <Link className={styles.secondaryButton} href={galleryHref}>
                            <ExternalLink size={15} aria-hidden="true" /> Open job
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={openEmailComposer}
                          disabled={!selectedContacts.some((contact) => !!clean(contact.email) && !contact.doNotContact)}
                        >
                          <Mail size={15} aria-hidden="true" /> Email contact
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={styles.detailGrid}>
                    <section className={styles.sectionCard} aria-labelledby="contact-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="contact-heading" className={styles.sectionHeadingText}>
                          <UserRound className={styles.sectionIcon} size={17} aria-hidden="true" /> Contacts
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span className={styles.panelCount}>{selectedContacts.length}</span>
                          <button
                            type="button"
                            className={styles.ghostButton}
                            style={{ minHeight: 32, padding: "5px 8px" }}
                            onClick={() => openContactEditor()}
                          >
                            <Plus size={13} aria-hidden="true" /> Add contact
                          </button>
                        </div>
                      </div>
                      {selectedContacts.length ? selectedContacts.map((contact) => {
                        const assignedLocation = selectedLocations.find((location) => location.id === contact.locationId) || null;
                        return (
                          <article key={contact.id} className={styles.contactCard}>
                          <div className={styles.contactTop}>
                            <div style={{ minWidth: 0 }}>
                              <p className={styles.contactName}>{contact.fullName || "Unnamed contact"}</p>
                              <div className={styles.muted}>
                                {clean(contact.jobTitle) || (clean(contact.role) ? statusLabel(contact.role) : "Contact")}
                                {" · " + (assignedLocation?.label
                                  || (selectedUsesCampusLanguage ? "All campuses / unassigned" : "All locations / unassigned"))}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {contact.isPrimary ? <span className={styles.tag}>Primary</span> : null}
                              <button
                                type="button"
                                className={styles.ghostButton}
                                style={{ minHeight: 30, padding: "4px 7px" }}
                                onClick={() => openContactEditor(contact)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={styles.dangerTextButton}
                                aria-label={"Remove " + contact.fullName}
                                title="Remove contact"
                                onClick={() => void deleteContactRecord(contact)}
                                disabled={deletingRecordId === contact.id}
                              >
                                <Trash2 size={13} aria-hidden="true" />
                                {deletingRecordId === contact.id ? "Removing…" : "Remove contact"}
                              </button>
                            </div>
                          </div>
                          {contact.doNotContact ? (
                            <div className={styles.error} style={{ marginTop: 9 }}>
                              Do not contact
                            </div>
                          ) : null}
                          <div className={styles.contactLinks}>
                            {contact.email ? (
                              <a className={styles.contactLink} href={"mailto:" + contact.email}>
                                <Mail size={13} aria-hidden="true" /> {contact.email}
                              </a>
                            ) : null}
                            {contact.phone ? (
                              <a className={styles.contactLink} href={"tel:" + contact.phone}>
                                <Phone size={13} aria-hidden="true" /> {contact.phone}
                              </a>
                            ) : null}
                          </div>
                          <div className={styles.muted} style={{ marginTop: 8 }}>
                            Preferred: {statusLabel(contact.preferredChannel || "email")}
                            {contact.marketingConsent ? " · Consent: " + statusLabel(contact.marketingConsent) : ""}
                            {contact.consentRecordedAt ? " · Recorded " + formatDate(contact.consentRecordedAt) : ""}
                          </div>
                          </article>
                        );
                      }) : (
                        <div className={styles.empty + " " + styles.emptyCompact}>No contacts saved yet.</div>
                      )}
                    </section>

                    <section className={styles.sectionCard} aria-labelledby="location-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="location-heading" className={styles.sectionHeadingText}>
                          <MapPin className={styles.sectionIcon} size={17} aria-hidden="true" />{" "}
                          {selectedUsesCampusLanguage ? <>Campuses &amp; locations</> : <>Locations</>}
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span className={styles.panelCount}>{selectedLocations.length}</span>
                          <button
                            type="button"
                            className={styles.ghostButton}
                            style={{ minHeight: 32, padding: "5px 8px" }}
                            onClick={() => openLocationEditor()}
                          >
                            <Plus size={13} aria-hidden="true" />{" "}
                            {selectedUsesCampusLanguage ? "Add campus" : "Add location"}
                          </button>
                        </div>
                      </div>
                      <p className={styles.muted} style={{ margin: "0 0 10px" }}>
                        {selectedUsesCampusLanguage
                          ? "Keep every campus under this one " + clientKindLabel(selectedClient.kind).toLowerCase()
                            + " client. Each campus can have its own address, phone, timezone, and assigned contacts."
                          : "Keep every operating location under this client, with its own address, phone, timezone, and assigned contacts."}
                      </p>
                      {selectedLocations.length ? selectedLocations.map((location) => {
                        const address = locationPostalAddress(location) || "No address saved";
                        const mapHref = locationMapHref(location);
                        const directionsHref = locationMapHref(location, true);
                        const assignedCount = selectedContacts.filter((contact) => contact.locationId === location.id).length;
                        const bookingUseCount = bookingUseCountByLocation.get(location.id) || 0;
                        const locationPhotos = locationPhotosByLocation.get(location.id) || [];
                        const clientPhotoCount = locationPhotos.filter((photo) => photo.audience === "client").length;
                        const staffPhotoCount = locationPhotos.length - clientPhotoCount;
                        const coverPhoto = locationPhotos.find((photo) => photo.audience === "client" && !!photo.previewUrl)
                          || locationPhotos.find((photo) => !!photo.previewUrl)
                          || null;
                        const hasPublicInstructions = !!clean(location.arrivalInstructions)
                          || !!clean(location.parkingInstructions);
                        const hasInternalInstructions = !!clean(location.setupInstructions)
                          || !!clean(location.internalNotes);
                        const locationName = clean(location.label)
                          || (selectedUsesCampusLanguage ? "Unnamed campus" : "Unnamed location");
                        return (
                          <article key={location.id} className={styles.locationCard}>
                            <div className={styles.locationCardTop}>
                              {mapHref ? (
                                <a
                                  className={styles.locationMapSquare}
                                  href={mapHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open ${locationName} in maps`}
                                >
                                  <span className={styles.locationMapGrid} aria-hidden="true" />
                                  <MapPin size={22} aria-hidden="true" />
                                  <small>{clean(location.city) || clean(location.postalCode) || "Map"}</small>
                                </a>
                              ) : (
                                <div className={styles.locationMapSquare + " " + styles.locationMapSquareEmpty}>
                                  <MapPin size={22} aria-hidden="true" />
                                  <small>Add address</small>
                                </div>
                              )}
                              <div className={styles.locationCardBody}>
                                <div className={styles.locationTitleRow}>
                                  <div style={{ minWidth: 0 }}>
                                    <p className={styles.locationName}>{locationName}</p>
                                    <p className={styles.locationAddress}>{address}</p>
                                  </div>
                                  {location.isPrimary ? <span className={styles.tag}>Primary</span> : null}
                                </div>
                                <div className={styles.locationCounts}>
                                  <span><UsersRound size={12} aria-hidden="true" /> {assignedCount} contact{assignedCount === 1 ? "" : "s"}</span>
                                  <span><CalendarClock size={12} aria-hidden="true" /> Used by {bookingUseCount} booking{bookingUseCount === 1 ? "" : "s"}</span>
                                  <span><Camera size={12} aria-hidden="true" /> {locationPhotos.length} photo{locationPhotos.length === 1 ? "" : "s"}</span>
                                </div>
                                <div className={styles.locationActions}>
                                  <button
                                    type="button"
                                    className={styles.locationEditButton}
                                    onClick={() => openLocationEditor(location)}
                                  >
                                    <Pencil size={13} aria-hidden="true" /> Edit
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.locationDeleteButton}
                                    aria-label={`Delete ${locationName}`}
                                    onClick={() => void deleteLocationRecord(location)}
                                    disabled={deletingRecordId === location.id}
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                    {deletingRecordId === location.id ? "Deleting…" : "Delete"}
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className={styles.locationLinkRow}>
                              {mapHref ? (
                                <a className={styles.contactLink} href={mapHref} target="_blank" rel="noreferrer">
                                  <MapPin size={13} aria-hidden="true" /> Open map
                                </a>
                              ) : null}
                              {directionsHref ? (
                                <a className={styles.contactLink} href={directionsHref} target="_blank" rel="noreferrer">
                                  <Navigation size={13} aria-hidden="true" /> Directions
                                </a>
                              ) : null}
                              {location.phone ? (
                                <a className={styles.contactLink} href={"tel:" + location.phone}>
                                  <Phone size={13} aria-hidden="true" /> {location.phone}
                                </a>
                              ) : null}
                              <span className={styles.locationTimezone}>
                                {location.timezone || selectedClient.defaultTimezone || "Timezone not set"}
                              </span>
                            </div>

                            <div className={styles.locationPhotoSummary}>
                              {coverPhoto?.previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={coverPhoto.previewUrl}
                                  alt={clean(coverPhoto.altText) || clean(coverPhoto.caption) || `${locationName} reference`}
                                />
                              ) : (
                                <span className={styles.locationPhotoPlaceholder}><Camera size={18} aria-hidden="true" /></span>
                              )}
                              <div>
                                <strong>{locationPhotos.length ? `${locationPhotos.length} saved photo${locationPhotos.length === 1 ? "" : "s"}` : "Remember this location with photos"}</strong>
                                <small>{clientPhotoCount} client-facing · {staffPhotoCount} staff-only</small>
                              </div>
                              <button type="button" onClick={() => openLocationEditor(location)}>
                                {locationPhotos.length ? "Manage photos" : "Add photos"}
                              </button>
                            </div>

                            <div className={styles.locationKnowledgeGrid}>
                              <div className={styles.locationKnowledgePublic}>
                                <strong><Navigation size={13} aria-hidden="true" /> Client arrival &amp; parking</strong>
                                {hasPublicInstructions ? (
                                  <>
                                    {clean(location.arrivalInstructions) ? <p><b>Arrival:</b> {location.arrivalInstructions}</p> : null}
                                    {clean(location.parkingInstructions) ? <p><b>Parking:</b> {location.parkingInstructions}</p> : null}
                                  </>
                                ) : <p>No reusable client instructions yet.</p>}
                              </div>
                              <div className={styles.locationKnowledgePrivate}>
                                <strong><Lock size={13} aria-hidden="true" /> Team only</strong>
                                {hasInternalInstructions ? (
                                  <>
                                    {clean(location.setupInstructions) ? <p><b>Setup:</b> {location.setupInstructions}</p> : null}
                                    {clean(location.internalNotes) ? <p><b>Notes:</b> {location.internalNotes}</p> : null}
                                  </>
                                ) : <p>No internal setup notes yet.</p>}
                              </div>
                            </div>
                            <p className={styles.locationReuseHint}>
                              <strong>Assign location</strong> links this saved place to a booking. Emailing contacts is a separate reviewed action.
                            </p>
                          </article>
                        );
                      }) : (
                        <div className={styles.empty + " " + styles.emptyCompact}>
                          {selectedUsesCampusLanguage
                            ? "No campuses saved yet. Add the first campus for this education client."
                            : "No locations saved yet."}
                        </div>
                      )}
                      {selectedClient.website ? (
                        <a
                          className={styles.addressLink}
                          style={{ display: "inline-flex", marginTop: 10 }}
                          href={selectedClient.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Visit client website <ExternalLink size={11} aria-hidden="true" />
                        </a>
                      ) : null}
                    </section>

                    <section className={styles.sectionCard} aria-labelledby="cycle-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="cycle-heading" className={styles.sectionHeadingText}>
                          <CalendarClock className={styles.sectionIcon} size={17} aria-hidden="true" /> {seasonYear} booking cycle
                        </h3>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          style={{ minHeight: 32, padding: "5px 8px" }}
                          onClick={openCycleEditor}
                        >
                          {selectedCycle ? "Update" : "Add " + seasonYear + " season"}
                        </button>
                      </div>
                      {!selectedCycle ? (
                        <p className={styles.helpText} style={{ margin: "0 0 12px" }}>
                          No booking cycle exists for {seasonYear}. Add this season to track outreach and dates without changing earlier years.
                        </p>
                      ) : null}
                      <div className={styles.infoRows}>
                        <div className={styles.infoRow}>
                          <span>Status</span>
                          <span className={styles.infoValue}>
                            {selectedCycle ? statusLabel(selectedCycle.status) : "No cycle created"}
                          </span>
                        </div>
                        <div className={styles.infoRow}>
                          <span>Last contacted</span>
                          <span className={styles.infoValue}>{formatDate(selectedCycle?.lastContactedAt, true)}</span>
                        </div>
                        <div className={styles.infoRow}>
                          <span>Next follow-up</span>
                          <span className={styles.infoValue}>{formatDate(selectedCycle?.nextFollowUpAt, true)}</span>
                        </div>
                        <div className={styles.infoRow}>
                          <span>Shoot date</span>
                          <span className={styles.infoValue}>{formatDate(selectedCycle?.shootStartAt, true)}</span>
                        </div>
                        <div className={styles.infoRow}>
                          <span>People / students</span>
                          <span className={styles.infoValue}>
                            {selectedCycle?.studentCountActual
                              || selectedCycle?.studentCountEstimate
                              || selectedClient.currentStudentCount
                              || "Not set"}
                          </span>
                        </div>
                        <div className={styles.infoRow}>
                          <span>Booked value</span>
                          <span className={styles.infoValue}>
                            {formatMoney(
                              selectedCycle?.bookedAmountCents ?? selectedCycle?.quotedAmountCents,
                              selectedCycle?.currency,
                            )}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className={styles.sectionCard} aria-labelledby="agreement-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="agreement-heading" className={styles.sectionHeadingText}>
                          <FileSignature className={styles.sectionIcon} size={17} aria-hidden="true" /> Agreement
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {selectedAgreement ? <span className={styles.tag}>{statusLabel(selectedAgreement.status)}</span> : null}
                          <button
                            type="button"
                            className={styles.ghostButton}
                            style={{ minHeight: 32, padding: "5px 8px" }}
                            onClick={openAgreementEditor}
                          >
                            {selectedAgreement ? "Edit" : "Add"}
                          </button>
                        </div>
                      </div>
                      {selectedAgreement ? (
                        <article className={styles.agreementCard}>
                          <div className={styles.agreementTop}>
                            <div>
                              <p className={styles.agreementTitle}>{selectedAgreement.title}</p>
                              <div className={styles.muted}>
                                {formatDate(selectedAgreement.startsOn)} – {formatDate(selectedAgreement.endsOn)}
                              </div>
                            </div>
                            <span className={styles.priorityPill}>
                              <CircleDollarSign size={12} aria-hidden="true" />
                              {formatMoney(selectedAgreement.amountCents, selectedAgreement.currency)}
                            </span>
                          </div>
                          <p className={styles.muted} style={{ margin: "10px 0 0" }}>
                            {clean(selectedAgreement.termsSummary) || "No agreement summary saved."}
                          </p>
                          <div className={styles.infoRows} style={{ marginTop: 12 }}>
                            <div className={styles.infoRow}>
                              <span>Signed</span>
                              <span className={styles.infoValue}>{formatDate(selectedAgreement.signedAt)}</span>
                            </div>
                            <div className={styles.infoRow}>
                              <span>Student commitment</span>
                              <span className={styles.infoValue}>{selectedAgreement.studentCommitment || "Not set"}</span>
                            </div>
                            <div className={styles.infoRow}>
                              <span>Renewal notice</span>
                              <span className={styles.infoValue}>
                                {selectedAgreement.renewalNoticeDays
                                  ? selectedAgreement.renewalNoticeDays + " days"
                                  : "Not set"}
                              </span>
                            </div>
                          </div>
                        </article>
                      ) : (
                        <div className={styles.empty + " " + styles.emptyCompact}>No agreement saved yet.</div>
                      )}
                    </section>

                    {selectedUsesCampusLanguage ? (
                      <section
                        className={styles.sectionCard + " " + styles.wideCard}
                        aria-labelledby="booking-history-heading"
                      >
                        <div className={styles.sectionHeading}>
                          <h3 id="booking-history-heading" className={styles.sectionHeadingText}>
                            <CalendarClock className={styles.sectionIcon} size={17} aria-hidden="true" /> School booking history
                          </h3>
                          <span className={styles.panelCount}>
                            {selectedBookingTotals.jobs} shoot{selectedBookingTotals.jobs === 1 ? "" : "s"} linked
                          </span>
                        </div>
                        {selectedBookingHistory.length ? (
                          <>
                            <div className={styles.bookingSummaryGrid} aria-label="Lifetime booking summary">
                              <article className={styles.bookingMetric}>
                                <span>Lifetime shoots</span>
                                <strong>{selectedBookingTotals.jobs}</strong>
                              </article>
                              <article className={styles.bookingMetric}>
                                <span>Booking pages</span>
                                <strong>{selectedBookingTotals.bookingPages}</strong>
                              </article>
                              <article className={styles.bookingMetric}>
                                <span>Active bookings</span>
                                <strong>{selectedBookingTotals.booked}</strong>
                                {selectedBookingTotals.cancelled ? (
                                  <small>{selectedBookingTotals.cancelled} cancelled</small>
                                ) : null}
                              </article>
                              <article className={styles.bookingMetric}>
                                <span>Cash-paid bookings</span>
                                <strong>{selectedBookingTotals.paidBookings}</strong>
                              </article>
                            </div>

                            {selectedBookingTotals.moneyByCurrency.length ? (
                              <div className={styles.bookingMoneyGrid} aria-label="Lifetime payment totals by currency">
                                {selectedBookingTotals.moneyByCurrency.map((total) => (
                                  <article key={total.currency} className={styles.bookingMoneyCard}>
                                    <div className={styles.bookingMoneyTitle}>
                                      <CircleDollarSign size={15} aria-hidden="true" /> {total.currency} lifetime
                                    </div>
                                    <div className={styles.infoRows}>
                                      <div className={styles.infoRow}>
                                        <span>Gross booking fees collected</span>
                                        <span className={styles.infoValue}>
                                          {formatMoney(total.grossCollectedCents, total.currency)}
                                        </span>
                                      </div>
                                      <div className={styles.infoRow}>
                                        <span>From active appointment bookings</span>
                                        <span className={styles.infoValue}>
                                          {formatMoney(total.activeCashCents, total.currency)}
                                        </span>
                                      </div>
                                      <div className={styles.infoRow}>
                                        <span>Retained cancellation fees</span>
                                        <span className={styles.infoValue}>
                                          {formatMoney(total.retainedCancellationCashCents, total.currency)}
                                        </span>
                                      </div>
                                      <div className={styles.infoRow}>
                                        <span>Studio credit redeemed</span>
                                        <span className={styles.infoValue}>
                                          {formatMoney(total.creditRedeemedCents, total.currency)}
                                        </span>
                                      </div>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <p className={styles.helpText} style={{ margin: "12px 0 0" }}>
                                No payment totals are available for these shoots yet.
                              </p>
                            )}

                            <div className={styles.bookingHistoryList}>
                              {selectedBookingHistory.map((history) => (
                                <article key={history.jobId} className={styles.bookingHistoryCard}>
                                  <div className={styles.bookingHistoryTop}>
                                    <div style={{ minWidth: 0 }}>
                                      <p className={styles.bookingHistoryTitle}>{history.schoolName}</p>
                                      <div className={styles.bookingHistoryTags}>
                                        <span className={styles.tag}>{statusLabel(history.role)}</span>
                                        <span className={styles.tag}>
                                          {history.bookingEventId
                                            ? history.bookingEnabled ? "Booking open" : "Booking paused"
                                            : "Booking page not set up"}
                                        </span>
                                        {history.schoolStatus ? (
                                          <span className={styles.tag}>{statusLabel(history.schoolStatus)}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className={styles.bookingHistoryActions}>
                                      <button
                                        type="button"
                                        className={styles.bookingSecondaryLink}
                                        onClick={() => openBookingRepair(history)}
                                        title="Repair CRM link"
                                      >
                                        Assign location
                                      </button>
                                      <Link
                                        className={styles.bookingSecondaryLink}
                                        href={surface === "mobile"
                                          ? "/m/schools/" + history.gallerySchoolId
                                          : "/dashboard/projects/schools/" + history.gallerySchoolId}
                                      >
                                        Open school
                                      </Link>
                                      {history.publicUrl ? (
                                        <a
                                          className={styles.bookingPrimaryLink}
                                          href={history.publicUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Open booking page <ExternalLink size={12} aria-hidden="true" />
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className={styles.bookingHistoryFacts}>
                                    <div>
                                      <span>Campus</span>
                                      <strong>{history.locationLabel || "Campus not assigned"}</strong>
                                    </div>
                                    <div>
                                      <span>Shoot date</span>
                                      <strong>{formatDate(history.shootDate || history.firstSlotAt)}</strong>
                                    </div>
                                    <div>
                                      <span>Bookings</span>
                                      <strong>
                                        {history.booked}{history.capacity > 0 ? " / " + history.capacity : ""}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>Cash-paid</span>
                                      <strong>{history.paidBookings}</strong>
                                    </div>
                                    <div>
                                      <span>Gross booking fees collected</span>
                                      <strong>
                                        {formatBookingCurrencyTotals(
                                          history.paymentTotalsByCurrency || [],
                                          "grossCollectedCents",
                                        )}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>Credit redeemed</span>
                                      <strong>
                                        {formatBookingCurrencyTotals(
                                          history.paymentTotalsByCurrency || [],
                                          "creditRedeemedCents",
                                        )}
                                      </strong>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className={styles.empty + " " + styles.emptyCompact}>
                            No school shoots are linked to this CRM client yet. Creating a new school booking can add the first link automatically.
                          </div>
                        )}
                      </section>
                    ) : null}

                    <section className={styles.sectionCard} aria-labelledby="tasks-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="tasks-heading" className={styles.sectionHeadingText}>
                          <ListChecks className={styles.sectionIcon} size={17} aria-hidden="true" /> Tasks &amp; reminders
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className={styles.panelCount}>{selectedOpenTasks.length} open</span>
                          <button
                            type="button"
                            className={styles.ghostButton}
                            style={{ minHeight: 32, padding: "5px 8px" }}
                            onClick={() => openTaskEditor()}
                          >
                            Add task
                          </button>
                        </div>
                      </div>
                      {selectedTasks.length ? selectedTasks.map((task) => (
                        <article key={task.id} className={styles.taskRow + (!isOpenTask(task) ? " " + styles.taskRowClosed : "")}>
                          <div className={styles.taskTop}>
                            <div style={{ minWidth: 0 }}>
                              <p className={styles.taskTitle}>{task.title}</p>
                              {task.notes ? <div className={styles.muted}>{task.notes}</div> : null}
                              <div className={styles.taskDue}>
                                <Clock3 size={12} aria-hidden="true" /> Due {formatDate(task.dueAt, true)}
                              </div>
                              <div className={styles.taskStatus}>{statusLabel(task.completedAt ? "completed" : task.status)}</div>
                            </div>
                            <div className={styles.taskActions}>
                              <button
                                type="button"
                                className={styles.taskEditButton}
                                aria-label={"Edit " + task.title}
                                title="Edit task and reminder"
                                onClick={() => openTaskEditor(task)}
                              >
                                <Pencil size={14} aria-hidden="true" /> Edit
                              </button>
                              {isOpenTask(task) ? (
                                <button
                                  type="button"
                                  className={styles.taskCompleteButton}
                                  aria-label={"Complete " + task.title}
                                  title="Mark complete"
                                  onClick={() => void completeTask(task)}
                                  disabled={completingTaskId === task.id}
                                >
                                  <Check size={15} aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      )) : (
                        <div className={styles.empty + " " + styles.emptyCompact}>
                          <div>
                            <CheckCircle2 size={20} color="#27834f" />
                            <div style={{ marginTop: 6 }}>No open follow-ups.</div>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className={styles.sectionCard} aria-labelledby="timeline-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="timeline-heading" className={styles.sectionHeadingText}>
                          <Clock3 className={styles.sectionIcon} size={17} aria-hidden="true" /> Timeline
                        </h3>
                      </div>
                      {timeline.length ? (
                        <div className={styles.timeline}>
                          {timeline.map((entry) => (
                            <div key={entry.id} className={styles.timelineItem}>
                              <span className={styles.timelineDot} />
                              <div>
                                <div className={styles.timelineTitle}>{entry.title}</div>
                                <div className={styles.timelineMeta}>
                                  {formatDate(entry.occurredAt, true)} · {entry.detail}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.empty + " " + styles.emptyCompact}>Activity will appear as this relationship grows.</div>
                      )}
                    </section>

                    <section className={styles.automationCard + " " + styles.wideCard} aria-labelledby="automation-heading">
                      <div className={styles.sectionHeading}>
                        <h3 id="automation-heading" className={styles.sectionHeadingText}>
                          <Bot className={styles.sectionIcon} size={18} aria-hidden="true" /> Annual booking assistant
                        </h3>
                        <span className={styles.tag}>You control every send</span>
                      </div>
                      <p className={styles.muted} style={{ margin: 0 }}>
                        Choose how far Studio OS can help. Recipients always come from this client record, approved presets are used for sending, and booked or do-not-contact clients are stopped automatically.
                      </p>
                      <div className={styles.automationModes} role="radiogroup" aria-label="Automation mode">
                        {(Object.keys(AUTOMATION_COPY) as AutomationMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={automationMode === mode}
                            className={styles.modeButton + (automationMode === mode ? " " + styles.modeButtonActive : "")}
                            onClick={() => setAutomationMode(mode)}
                            disabled={savingAutomation}
                          >
                            {AUTOMATION_COPY[mode].label}
                          </button>
                        ))}
                      </div>
                      <p className={styles.modeDescription}>{AUTOMATION_COPY[automationMode].description}</p>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void saveAutomationMode()}
                          disabled={savingAutomation || automationMode === (selectedRule?.mode || "off")}
                        >
                          {savingAutomation ? "Saving…" : "Save automation mode"}
                        </button>
                      </div>
                    </section>

                    {selectedClient.notes || selectedClient.tags?.length ? (
                      <section className={styles.sectionCard + " " + styles.wideCard} aria-labelledby="notes-heading">
                        <div className={styles.sectionHeading}>
                          <h3 id="notes-heading" className={styles.sectionHeadingText}>Relationship notes</h3>
                        </div>
                        {selectedClient.notes ? <p className={styles.muted} style={{ marginTop: 0 }}>{selectedClient.notes}</p> : null}
                        {selectedClient.tags?.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {selectedClient.tags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      </div>

      {bookingRepair ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !repairingBookingJob) {
              setBookingRepair(null);
            }
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="crm-booking-repair-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow} style={{ color: "#9a650a", marginBottom: 5 }}>
                  Saved location assignment
                </p>
                <h2 id="crm-booking-repair-title" className={styles.modalTitle}>
                  Assign booking location
                </h2>
                <p className={styles.modalSubtitle}>{bookingRepair.schoolName}</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close booking link repair"
                onClick={() => setBookingRepair(null)}
                disabled={repairingBookingJob}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.aiBox}>
                <ShieldCheck size={17} aria-hidden="true" />
                <div>
                  <strong>The gallery, appointment page, bookings, and payments stay intact.</strong><br />
                  This only moves the linked shoot and its booking-fee history to the education client and campus you select. The server verifies both exact IDs belong to your account.
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Education client *</span>
                <select
                  className={styles.select}
                  value={bookingRepair.clientId}
                  onChange={(event) => {
                    setBookingRepair((current) => current ? {
                      ...current,
                      clientId: event.target.value,
                      locationId: "",
                    } : current);
                    setBookingRepairError("");
                  }}
                  disabled={repairingBookingJob}
                >
                  <option value="">Choose the correct education client</option>
                  {educationClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.displayName} · {clientKindLabel(client.kind)}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Campus *</span>
                <select
                  className={styles.select}
                  value={bookingRepair.locationId}
                  onChange={(event) => {
                    setBookingRepair((current) => current ? {
                      ...current,
                      locationId: event.target.value,
                    } : current);
                    setBookingRepairError("");
                  }}
                  disabled={repairingBookingJob || !bookingRepair.clientId}
                >
                  <option value="">Choose the exact campus</option>
                  {bookingRepairLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.label || "Campus"}
                      {location.city ? " · " + location.city : ""}
                      {location.isPrimary ? " · Primary" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {bookingRepair.clientId && bookingRepairLocations.length === 0 ? (
                <div className={styles.error}>
                  This client has no campus yet. Add a campus to the client record before repairing this link.
                </div>
              ) : null}
              {bookingRepairError ? <div className={styles.error} role="alert">{bookingRepairError}</div> : null}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setBookingRepair(null)}
                  disabled={repairingBookingJob}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void reassignBookingJob()}
                  disabled={
                    repairingBookingJob
                    || !bookingRepair.clientId
                    || !bookingRepair.locationId
                  }
                >
                  <Check size={15} aria-hidden="true" />
                  {repairingBookingJob ? "Assigning…" : "Assign location"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {approvalEmail ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !approvingEmailId) setApprovalEmailId("");
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="crm-approval-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow} style={{ color: "#9a650a", marginBottom: 5 }}>Approval required</p>
                <h2 id="crm-approval-title" className={styles.modalTitle}>
                  {clean(approvalEmail.subject) || "Review email"}
                </h2>
                <p className={styles.modalSubtitle}>
                  {clientsById.get(approvalEmail.clientId)?.displayName || "Client message"}
                </p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close approval review"
                onClick={() => setApprovalEmailId("")}
                disabled={!!approvingEmailId}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.recipientBox}>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.recipientName}>{clean(approvalEmail.toName) || "Saved contact"}</div>
                  <div className={styles.recipientEmail}>{approvalEmail.toEmail || "Email hidden"}</div>
                </div>
                <span className={styles.verified}><ShieldCheck size={14} /> Owner-scoped</span>
              </div>

              <div className={styles.infoRows}>
                <div className={styles.infoRow}>
                  <span>Prepared</span>
                  <span className={styles.infoValue}>{formatDate(approvalEmail.createdAt, true)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>Scheduled for</span>
                  <span className={styles.infoValue}>{formatDate(approvalEmail.scheduledFor, true)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>Content source</span>
                  <span className={styles.infoValue}>{statusLabel(approvalEmail.contentSource)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>Message class</span>
                  <span className={styles.infoValue}>{statusLabel(approvalEmail.messageClass)}</span>
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Message preview</span>
                <div className={styles.approvalBodyPreview}>
                  {emailPreviewText(approvalEmail) || "No readable message body was returned."}
                </div>
              </div>

              <div className={styles.aiBox}>
                <ShieldCheck size={17} aria-hidden="true" />
                <div>
                  <strong>Approve &amp; queue is the send decision.</strong><br />
                  Studio OS re-checks ownership, suppression, contact status, and approval state before moving this message into the delivery queue.
                </div>
              </div>

              {approvalError ? <div className={styles.error} role="alert">{approvalError}</div> : null}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setApprovalEmailId("")}
                  disabled={!!approvingEmailId}
                >
                  Keep pending
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void approvePendingEmail(approvalEmail)}
                  disabled={!!approvingEmailId}
                >
                  <Send size={15} aria-hidden="true" />
                  {approvingEmailId === approvalEmail.id ? "Approving…" : "Approve & queue"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {batchOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !batchQueueing) setBatchOpen(false);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="crm-batch-title">
            <div className={styles.modalHeader}>
              <div>
                <h2 id="crm-batch-title" className={styles.modalTitle}>Review client email queue</h2>
                <p className={styles.modalSubtitle}>
                  {eligibleBatchRows.length} eligible · {selectedBatchRows.length - eligibleBatchRows.length} skipped before server checks
                  {eligibleBatchRows.length > 100 ? " · reduce selection to 100" : ""}
                </p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close batch review"
                onClick={() => setBatchOpen(false)}
                disabled={batchQueueing}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.aiBox}>
                <ShieldCheck size={17} aria-hidden="true" />
                <div>
                  <strong>This action queues; it does not synchronously blast.</strong><br />
                  Studio OS resolves saved contact IDs, requires explicit opt-in, rejects do-not-contact and suppressed recipients, and records skips in the audit.
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Approved outreach preset</span>
                <select className={styles.select} value={batchTemplateId} onChange={(event) => {
                  setBatchTemplateId(event.target.value);
                  setBatchConfirmed(false);
                }}>
                  <option value="">Choose a relationship or marketing preset</option>
                  {approvedBulkTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · {statusLabel(template.messageClass)}
                    </option>
                  ))}
                </select>
              </label>

              {approvedBulkTemplates.length === 0 ? (
                <div className={styles.error}>No approved relationship or marketing preset is available for reviewed outreach.</div>
              ) : null}

              <div className={styles.reviewList} aria-label="Selected client review">
                {selectedBatchRows.map((row) => (
                  <div key={row.client.id} className={styles.reviewRow + (row.reason ? " " + styles.reviewSkipped : "")}>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.recipientName}>{row.client.displayName}</div>
                      <div className={styles.recipientEmail}>
                        {row.contact ? row.contact.fullName + (row.contact.email ? " · " + row.contact.email : "") : "No primary contact"}
                      </div>
                    </div>
                    <span className={row.reason ? styles.statusPill + " " + styles.statusDue : styles.statusPill + " " + styles.statusBooked}>
                      {row.reason || "Eligible"}
                    </span>
                  </div>
                ))}
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  border: "1px solid #dce2eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fafbfc",
                  color: "#344158",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={batchConfirmed}
                  onChange={(event) => setBatchConfirmed(event.target.checked)}
                />
                <span>I reviewed this preset and the eligible saved contacts. Queue each as a separate audited email.</span>
              </label>

              {batchError ? <div className={styles.error} role="alert">{batchError}</div> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.ghostButton} onClick={() => setBatchOpen(false)} disabled={batchQueueing}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void queueBatchEmail()}
                  disabled={
                    batchQueueing
                    || !batchConfirmed
                    || !batchTemplateId
                    || eligibleBatchRows.length === 0
                    || eligibleBatchRows.length > 100
                  }
                >
                  <Send size={15} aria-hidden="true" /> {batchQueueing ? "Queueing…" : "Queue reviewed emails"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {recordEditor ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !locationEditorBusy) setRecordEditor(null);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="crm-editor-title">
            <div className={styles.modalHeader}>
              <div>
                <h2 id="crm-editor-title" className={styles.modalTitle}>
                  {recordEditor.kind === "client"
                    ? recordEditor.mode === "create" ? "New client" : "Edit client"
                    : recordEditor.kind === "contact"
                      ? recordEditor.mode === "create" ? "Add contact" : "Edit contact"
                      : recordEditor.kind === "location"
                        ? recordEditor.mode === "create"
                          ? editorUsesCampusLanguage ? "Add campus" : "Add location"
                          : editorUsesCampusLanguage ? "Edit campus" : "Edit location"
                        : recordEditor.kind === "bookingCycle"
                          ? "Annual booking cycle"
                          : recordEditor.kind === "task"
                            ? recordEditor.mode === "create" ? "Add follow-up task" : "Edit task & reminder"
                            : recordEditor.mode === "create" ? "Add agreement" : "Edit agreement"}
                </h2>
                <p className={styles.modalSubtitle}>
                  {recordEditor.kind === "client"
                    ? "Keep the permanent relationship separate from each yearly photography booking."
                    : recordEditor.kind === "contact"
                      ? editorUsesCampusLanguage
                        ? "Assign this person to an optional campus and choose who is the primary contact."
                        : "Assign this person to an optional location and choose who is the primary contact."
                      : recordEditor.kind === "location"
                        ? editorUsesCampusLanguage
                          ? "Save the campus once, including directions, parking, setup knowledge, contacts, and reference photos, then reuse it every season."
                          : "Save the location once, including directions, parking, setup knowledge, contacts, and reference photos, then reuse it every season."
                        : recordEditor.kind === "bookingCycle"
                          ? "Track this season without overwriting earlier years."
                          : recordEditor.kind === "task"
                            ? recordEditor.mode === "create"
                              ? "Add the next call, email, or agreement follow-up."
                              : "Update the title, dates, notes, priority, contact, or status without creating a duplicate."
                            : "Record the value, term, renewal window, and important terms."}
                </p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close editor"
                onClick={() => setRecordEditor(null)}
                disabled={locationEditorBusy}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.modalBody}>
              {recordEditor.kind === "client" ? (
                <>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Client type</span>
                      <select className={styles.select} value={recordEditor.values.kind} onChange={(event) => updateRecordValue("kind", event.target.value)}>
                        <option value="school">School</option>
                        <option value="college">College</option>
                        <option value="university">University</option>
                        <option value="daycare">Daycare</option>
                        <option value="montessori">Montessori</option>
                        <option value="corporate">Corporate</option>
                        <option value="wedding">Wedding</option>
                        <option value="event">Event</option>
                        <option value="sports">Sports</option>
                        <option value="family">Family</option>
                        <option value="person">Person</option>
                        <option value="nonprofit">Nonprofit</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Display name *</span>
                      <input className={styles.input} value={recordEditor.values.displayName} onChange={(event) => updateRecordValue("displayName", event.target.value)} placeholder="Westview Academy" autoFocus />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Legal name</span>
                      <input className={styles.input} value={recordEditor.values.legalName} onChange={(event) => updateRecordValue("legalName", event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Website</span>
                      <input className={styles.input} type="url" value={recordEditor.values.website} onChange={(event) => updateRecordValue("website", event.target.value)} placeholder="https://" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Current students / people</span>
                      <input className={styles.input} type="number" min="0" value={recordEditor.values.studentCount} onChange={(event) => updateRecordValue("studentCount", event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Usual booking month</span>
                      <input className={styles.input} type="number" min="1" max="12" value={recordEditor.values.bookingMonth} onChange={(event) => updateRecordValue("bookingMonth", event.target.value)} placeholder="1–12" />
                    </label>
                    <label className={styles.field + " " + styles.fieldSpan}>
                      <span className={styles.fieldLabel}>Tags</span>
                      <input className={styles.input} value={recordEditor.values.tags} onChange={(event) => updateRecordValue("tags", event.target.value)} placeholder="priority, returning, spring" />
                    </label>
                    <label className={styles.field + " " + styles.fieldSpan}>
                      <span className={styles.fieldLabel}>Relationship notes</span>
                      <textarea className={styles.textarea} value={recordEditor.values.notes} onChange={(event) => updateRecordValue("notes", event.target.value)} placeholder="Preferences, history, and details the team should remember." />
                    </label>
                  </div>

                  {recordEditor.mode === "create" ? (
                    <>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.fieldsetTitle}>Primary contact</legend>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Full name *</span>
                      <input className={styles.input} value={recordEditor.values.contactName} onChange={(event) => updateRecordValue("contactName", event.target.value)} placeholder="Jordan Lee" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Role / title</span>
                      <input className={styles.input} value={recordEditor.values.jobTitle} onChange={(event) => updateRecordValue("jobTitle", event.target.value)} placeholder="Principal, coordinator, client" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Email</span>
                      <input className={styles.input} type="email" value={recordEditor.values.contactEmail} onChange={(event) => updateRecordValue("contactEmail", event.target.value)} autoComplete="email" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Phone</span>
                      <input className={styles.input} type="tel" value={recordEditor.values.contactPhone} onChange={(event) => updateRecordValue("contactPhone", event.target.value)} autoComplete="tel" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Preferred channel</span>
                      <select className={styles.select} value={recordEditor.values.preferredChannel} onChange={(event) => updateRecordValue("preferredChannel", event.target.value)}>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                        <option value="none">None</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Marketing consent</span>
                      <select className={styles.select} value={recordEditor.values.marketingConsent} onChange={(event) => updateMarketingConsent(event.target.value)}>
                        <option value="unknown">Unknown</option>
                        <option value="optedIn">Opted in — confirmation required</option>
                        <option value="optedOut">Opted out</option>
                      </select>
                    </label>
                    {recordEditor.values.marketingConsent === "optedIn" ? (
                      <label
                        className={styles.field + " " + styles.fieldSpan}
                        style={{
                          display: "flex",
                          gridTemplateColumns: "none",
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: 10,
                          border: "1px solid #c9ddd3",
                          borderRadius: 11,
                          padding: 11,
                          background: "#f6fbf8",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={recordEditor.values.consentAttested === "true"}
                          onChange={(event) => updateConsentAttestation(event.target.checked)}
                        />
                        <span>
                          <span className={styles.fieldLabel} style={{ display: "block" }}>
                            Promotional email consent confirmation *
                          </span>
                          <span className={styles.helpText}>
                            I confirm this person explicitly agreed to receive promotional email from this studio.
                            Studio OS records this attestation; choosing Opted in alone is not enough.
                          </span>
                          {recordEditor.values.consentEvidenceExisting === "true" ? (
                            <span className={styles.helpText} style={{ display: "block", marginTop: 4 }}>
                              Existing evidence recorded {formatDate(recordEditor.values.consentRecordedAt, true)} will be preserved.
                            </span>
                          ) : recordEditor.values.consentAttested === "true" ? (
                            <span className={styles.helpText} style={{ display: "block", marginTop: 4 }}>
                              Attestation recorded for this save at {formatDate(recordEditor.values.consentRecordedAt, true)}.
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ) : null}
                    <label
                      className={styles.field + " " + styles.fieldSpan}
                      style={{
                        display: "flex",
                        gridTemplateColumns: "none",
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 10,
                        border: "1px solid #ead6d6",
                        borderRadius: 11,
                        padding: 11,
                        background: "#fff8f8",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={recordEditor.values.doNotContact === "true"}
                        onChange={(event) => updateRecordValue("doNotContact", event.target.checked ? "true" : "false")}
                      />
                      <span>
                        <span className={styles.fieldLabel} style={{ display: "block" }}>Do not contact</span>
                        <span className={styles.helpText}>Blocks one-click and automated email for this contact.</span>
                      </span>
                    </label>
                  </fieldset>

                  <fieldset className={styles.fieldset}>
                    <legend className={styles.fieldsetTitle}>
                      {editorUsesCampusLanguage ? "Primary campus" : "Primary location"}
                    </legend>
                    <p className={styles.helpText + " " + styles.fieldSpan} style={{ margin: 0 }}>
                      {editorUsesCampusLanguage
                        ? "Start with the main campus. After saving, open Campuses & locations to add every other campus under this same client."
                        : "Start with the main location. After saving, open Locations to add any other addresses under this same client."}
                    </p>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        {editorUsesCampusLanguage ? "Campus name" : "Location name"}
                      </span>
                      <input
                        className={styles.input}
                        value={recordEditor.values.locationLabel}
                        onChange={(event) => updateRecordValue("locationLabel", event.target.value)}
                        placeholder={editorUsesCampusLanguage ? "Main campus" : "Main location"}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        {editorUsesCampusLanguage ? "Campus phone" : "Location phone"}
                      </span>
                      <input className={styles.input} type="tel" value={recordEditor.values.locationPhone} onChange={(event) => updateRecordValue("locationPhone", event.target.value)} />
                    </label>
                    <label className={styles.field + " " + styles.fieldSpan}>
                      <span className={styles.fieldLabel}>Street address</span>
                      <input className={styles.input} value={recordEditor.values.addressLine1} onChange={(event) => updateRecordValue("addressLine1", event.target.value)} autoComplete="street-address" />
                    </label>
                    <label className={styles.field + " " + styles.fieldSpan}>
                      <span className={styles.fieldLabel}>Address line 2</span>
                      <input className={styles.input} value={recordEditor.values.addressLine2} onChange={(event) => updateRecordValue("addressLine2", event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>City</span>
                      <input className={styles.input} value={recordEditor.values.city} onChange={(event) => updateRecordValue("city", event.target.value)} autoComplete="address-level2" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Province / state</span>
                      <input className={styles.input} value={recordEditor.values.region} onChange={(event) => updateRecordValue("region", event.target.value)} autoComplete="address-level1" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Postal / ZIP code</span>
                      <input className={styles.input} value={recordEditor.values.postalCode} onChange={(event) => updateRecordValue("postalCode", event.target.value)} autoComplete="postal-code" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Country code</span>
                      <input className={styles.input} maxLength={2} value={recordEditor.values.countryCode} onChange={(event) => updateRecordValue("countryCode", event.target.value.toUpperCase())} />
                    </label>
                    <label className={styles.field + " " + styles.fieldSpan}>
                      <span className={styles.fieldLabel}>Timezone</span>
                      <input className={styles.input} value={recordEditor.values.timezone} onChange={(event) => updateRecordValue("timezone", event.target.value)} placeholder="America/Toronto" />
                    </label>
                  </fieldset>
                    </>
                  ) : null}
                </>
              ) : null}

              {recordEditor.kind === "contact" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Full name *</span>
                    <input
                      className={styles.input}
                      value={recordEditor.values.contactName}
                      onChange={(event) => updateRecordValue("contactName", event.target.value)}
                      placeholder="Jordan Lee"
                      autoFocus
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Role / title</span>
                    <input
                      className={styles.input}
                      value={recordEditor.values.jobTitle}
                      onChange={(event) => updateRecordValue("jobTitle", event.target.value)}
                      placeholder="Principal, coordinator, client"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Email</span>
                    <input
                      className={styles.input}
                      type="email"
                      value={recordEditor.values.contactEmail}
                      onChange={(event) => updateRecordValue("contactEmail", event.target.value)}
                      autoComplete="email"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Phone</span>
                    <input
                      className={styles.input}
                      type="tel"
                      value={recordEditor.values.contactPhone}
                      onChange={(event) => updateRecordValue("contactPhone", event.target.value)}
                      autoComplete="tel"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {editorUsesCampusLanguage ? "Campus" : "Location"}
                    </span>
                    <select
                      className={styles.select}
                      value={recordEditor.values.locationId}
                      onChange={(event) => updateRecordValue("locationId", event.target.value)}
                    >
                      <option value="">
                        {editorUsesCampusLanguage ? "All campuses / unassigned" : "All locations / unassigned"}
                      </option>
                      {selectedLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {clean(location.label) || clientAddress(location)}
                        </option>
                      ))}
                    </select>
                    <span className={styles.helpText}>
                      Optional. Use this when a contact is responsible for one {editorUsesCampusLanguage ? "campus" : "location"}.
                    </span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Preferred channel</span>
                    <select
                      className={styles.select}
                      value={recordEditor.values.preferredChannel}
                      onChange={(event) => updateRecordValue("preferredChannel", event.target.value)}
                    >
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Marketing consent</span>
                    <select
                      className={styles.select}
                      value={recordEditor.values.marketingConsent}
                      onChange={(event) => updateMarketingConsent(event.target.value)}
                    >
                      <option value="unknown">Unknown</option>
                      <option value="optedIn">Opted in — confirmation required</option>
                      <option value="optedOut">Opted out</option>
                    </select>
                  </label>
                  {recordEditor.values.marketingConsent === "optedIn" ? (
                    <label
                      className={styles.field + " " + styles.fieldSpan}
                      style={{
                        display: "flex",
                        gridTemplateColumns: "none",
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 10,
                        border: "1px solid #c9ddd3",
                        borderRadius: 11,
                        padding: 11,
                        background: "#f6fbf8",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={recordEditor.values.consentAttested === "true"}
                        onChange={(event) => updateConsentAttestation(event.target.checked)}
                      />
                      <span>
                        <span className={styles.fieldLabel} style={{ display: "block" }}>
                          Promotional email consent confirmation *
                        </span>
                        <span className={styles.helpText}>
                          I confirm this person explicitly agreed to receive promotional email from this studio.
                          Studio OS records this attestation; choosing Opted in alone is not enough.
                        </span>
                        {recordEditor.values.consentEvidenceExisting === "true" ? (
                          <span className={styles.helpText} style={{ display: "block", marginTop: 4 }}>
                            Existing evidence recorded {formatDate(recordEditor.values.consentRecordedAt, true)} will be preserved.
                          </span>
                        ) : recordEditor.values.consentAttested === "true" ? (
                          <span className={styles.helpText} style={{ display: "block", marginTop: 4 }}>
                            Attestation recorded for this save at {formatDate(recordEditor.values.consentRecordedAt, true)}.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ) : null}
                  <label
                    className={styles.field + " " + styles.fieldSpan}
                    style={{
                      display: "flex",
                      gridTemplateColumns: "none",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 10,
                      border: "1px solid #d8dee9",
                      borderRadius: 11,
                      padding: 11,
                      background: "#f8fafc",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={recordEditor.values.isPrimary === "true"}
                      disabled={recordEditor.values.originalIsPrimary === "true"}
                      onChange={(event) => updateRecordValue("isPrimary", event.target.checked ? "true" : "false")}
                    />
                    <span>
                      <span className={styles.fieldLabel} style={{ display: "block" }}>Primary contact</span>
                      <span className={styles.helpText}>
                        {recordEditor.values.originalIsPrimary === "true"
                          ? "This is the current primary. To change it, edit another contact and mark that person primary."
                          : "Marking this person primary safely replaces the previous primary contact."}
                      </span>
                    </span>
                  </label>
                  <label
                    className={styles.field + " " + styles.fieldSpan}
                    style={{
                      display: "flex",
                      gridTemplateColumns: "none",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 10,
                      border: "1px solid #ead6d6",
                      borderRadius: 11,
                      padding: 11,
                      background: "#fff8f8",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={recordEditor.values.doNotContact === "true"}
                      onChange={(event) => updateRecordValue("doNotContact", event.target.checked ? "true" : "false")}
                    />
                    <span>
                      <span className={styles.fieldLabel} style={{ display: "block" }}>Do not contact</span>
                      <span className={styles.helpText}>Blocks one-click and automated email for this contact.</span>
                    </span>
                  </label>
                </div>
              ) : null}

              {recordEditor.kind === "location" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {editorUsesCampusLanguage ? "Campus name *" : "Location name *"}
                    </span>
                    <input
                      className={styles.input}
                      value={recordEditor.values.locationLabel}
                      onChange={(event) => updateRecordValue("locationLabel", event.target.value)}
                      placeholder={editorUsesCampusLanguage ? "North campus" : "Downtown studio"}
                      autoFocus
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Phone</span>
                    <input
                      className={styles.input}
                      type="tel"
                      value={recordEditor.values.locationPhone}
                      onChange={(event) => updateRecordValue("locationPhone", event.target.value)}
                    />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Street address</span>
                    <input
                      className={styles.input}
                      value={recordEditor.values.addressLine1}
                      onChange={(event) => updateRecordValue("addressLine1", event.target.value)}
                      autoComplete="street-address"
                    />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Address line 2</span>
                    <input className={styles.input} value={recordEditor.values.addressLine2} onChange={(event) => updateRecordValue("addressLine2", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>City</span>
                    <input className={styles.input} value={recordEditor.values.city} onChange={(event) => updateRecordValue("city", event.target.value)} autoComplete="address-level2" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Province / state</span>
                    <input className={styles.input} value={recordEditor.values.region} onChange={(event) => updateRecordValue("region", event.target.value)} autoComplete="address-level1" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Postal / ZIP code</span>
                    <input className={styles.input} value={recordEditor.values.postalCode} onChange={(event) => updateRecordValue("postalCode", event.target.value)} autoComplete="postal-code" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Country code</span>
                    <input className={styles.input} maxLength={2} value={recordEditor.values.countryCode} onChange={(event) => updateRecordValue("countryCode", event.target.value.toUpperCase())} />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Timezone</span>
                    <input
                      className={styles.input}
                      value={recordEditor.values.timezone}
                      onChange={(event) => updateRecordValue("timezone", event.target.value)}
                      placeholder="America/Toronto"
                    />
                    <span className={styles.helpText}>
                      Used for reminders and scheduled messages for this {editorUsesCampusLanguage ? "campus" : "location"}.
                    </span>
                  </label>
                  <fieldset className={styles.locationNoteFieldset + " " + styles.fieldSpan}>
                    <legend><Navigation size={14} aria-hidden="true" /> Client-facing arrival details</legend>
                    <p>
                      Safe to reuse in booking messages after review. Keep door codes, equipment, and staff instructions out of this section.
                    </p>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Arrival / entrance instructions</span>
                      <textarea
                        className={styles.textarea}
                        value={recordEditor.values.arrivalInstructions}
                        maxLength={10_000}
                        rows={3}
                        onChange={(event) => updateRecordValue("arrivalInstructions", event.target.value)}
                        placeholder="Use the east entrance and follow signs to the gym."
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}><Car size={12} aria-hidden="true" /> Parking / drop-off</span>
                      <textarea
                        className={styles.textarea}
                        value={recordEditor.values.parkingInstructions}
                        maxLength={10_000}
                        rows={3}
                        onChange={(event) => updateRecordValue("parkingInstructions", event.target.value)}
                        placeholder="Visitor parking is beside the main office; loading is at door 4."
                      />
                    </label>
                  </fieldset>
                  <fieldset className={styles.locationInternalFieldset + " " + styles.fieldSpan}>
                    <legend><Lock size={14} aria-hidden="true" /> Internal team knowledge</legend>
                    <p>
                      Locked to studio staff. These fields are never preloaded into client booking emails.
                    </p>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Setup instructions</span>
                      <textarea
                        className={styles.textarea}
                        value={recordEditor.values.setupInstructions}
                        maxLength={20_000}
                        rows={3}
                        onChange={(event) => updateRecordValue("setupInstructions", event.target.value)}
                        placeholder="Power, room layout, backdrop position, elevator, loading, and equipment details."
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Private location notes</span>
                      <textarea
                        className={styles.textarea}
                        value={recordEditor.values.internalNotes}
                        maxLength={20_000}
                        rows={3}
                        onChange={(event) => updateRecordValue("internalNotes", event.target.value)}
                        placeholder="Access codes, staff reminders, or details that must stay inside Studio OS."
                      />
                    </label>
                  </fieldset>
                  <label
                    className={styles.field + " " + styles.fieldSpan}
                    style={{
                      display: "flex",
                      gridTemplateColumns: "none",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 10,
                      border: "1px solid #d8dee9",
                      borderRadius: 11,
                      padding: 11,
                      background: "#f8fafc",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={recordEditor.values.isPrimary === "true"}
                      disabled={recordEditor.values.originalIsPrimary === "true"}
                      onChange={(event) => updateRecordValue("isPrimary", event.target.checked ? "true" : "false")}
                    />
                    <span>
                      <span className={styles.fieldLabel} style={{ display: "block" }}>
                        Primary {editorUsesCampusLanguage ? "campus" : "location"}
                      </span>
                      <span className={styles.helpText}>
                        {recordEditor.values.originalIsPrimary === "true"
                          ? "This is the current primary. To change it, edit another "
                            + (editorUsesCampusLanguage ? "campus" : "location") + " and mark it primary."
                          : "Marking this " + (editorUsesCampusLanguage ? "campus" : "location")
                            + " primary safely replaces the previous primary."}
                      </span>
                    </span>
                  </label>
                  <section className={styles.locationPhotoManager + " " + styles.fieldSpan} aria-labelledby="location-photo-manager-title">
                    <div className={styles.locationPhotoManagerHeader}>
                      <div>
                        <h3 id="location-photo-manager-title"><Camera size={15} aria-hidden="true" /> Location memory</h3>
                        <p>
                          Save entrances, parking, setup areas, and exterior references. Choose the audience for every photo.
                        </p>
                      </div>
                      <span>{editorLocationPhotos.length}/{MAX_LOCATION_PHOTOS}</span>
                    </div>
                    {!recordEditor.recordId ? (
                      <div className={styles.locationPhotoSaveFirst}>
                        Save the new {editorUsesCampusLanguage ? "campus" : "location"} first, then edit it to add photos.
                      </div>
                    ) : (
                      <>
                        <div className={styles.locationPhotoUploadGrid}>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Audience *</span>
                            <select
                              className={styles.select}
                              value={locationPhotoAudience}
                              onChange={(event) => setLocationPhotoAudience(event.target.value === "staff" ? "staff" : "client")}
                              disabled={uploadingLocationPhoto}
                            >
                              <option value="client">Client-facing — eligible for booking emails</option>
                              <option value="staff">Staff-only — never shared</option>
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Category *</span>
                            <select
                              className={styles.select}
                              value={locationPhotoCategory}
                              onChange={(event) => setLocationPhotoCategory(event.target.value as CrmLocationPhoto["category"])}
                              disabled={uploadingLocationPhoto}
                            >
                              <option value="exterior">Exterior</option>
                              <option value="entrance">Entrance</option>
                              <option value="parking">Parking</option>
                              <option value="loading">Loading area</option>
                              <option value="room">Photo room</option>
                              <option value="setup">Setup area</option>
                              <option value="other">Other</option>
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Caption</span>
                            <input
                              className={styles.input}
                              value={locationPhotoCaption}
                              maxLength={1_000}
                              onChange={(event) => setLocationPhotoCaption(event.target.value)}
                              placeholder="East entrance beside visitor parking"
                              disabled={uploadingLocationPhoto}
                            />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Accessible description</span>
                            <input
                              className={styles.input}
                              value={locationPhotoAltText}
                              maxLength={500}
                              onChange={(event) => setLocationPhotoAltText(event.target.value)}
                              placeholder="Brick entrance with a blue door"
                              disabled={uploadingLocationPhoto}
                            />
                          </label>
                          <label className={styles.locationPhotoFileField}>
                            <Camera size={17} aria-hidden="true" />
                            <span>
                              <strong>{locationPhotoFile?.name || "Choose a photo"}</strong>
                              <small>JPEG, PNG, or WebP · up to 6 MB</small>
                            </span>
                            <input
                              ref={locationPhotoInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={uploadingLocationPhoto || editorLocationPhotos.length >= MAX_LOCATION_PHOTOS}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0] || null;
                                locationPhotoUploadKeyRef.current = "";
                                setLocationPhotoFile(file);
                                setRecordEditorError("");
                                if (file && !LOCATION_PHOTO_TYPES.includes(file.type)) {
                                  setRecordEditorError("Location photos must be JPEG, PNG, or WebP files.");
                                } else if (file && file.size > MAX_LOCATION_PHOTO_SOURCE_BYTES) {
                                  setRecordEditorError("Choose a photo no larger than 6 MB.");
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className={styles.locationPhotoUploadButton}
                            onClick={() => void uploadLocationPhoto()}
                            disabled={
                              uploadingLocationPhoto
                              || !locationPhotoFile
                              || editorLocationPhotos.length >= MAX_LOCATION_PHOTOS
                            }
                          >
                            <Upload size={14} aria-hidden="true" />
                            {uploadingLocationPhoto ? "Saving photo…" : "Save photo"}
                          </button>
                        </div>
                        <p className={styles.locationPhotoAudienceNote}>
                          <Lock size={12} aria-hidden="true" /> Staff-only photos and notes are excluded from client email tools by design.
                        </p>
                        {editorLocationPhotos.length ? (
                          <div className={styles.locationPhotoGallery}>
                            {editorLocationPhotos.map((photo) => (
                              <article key={photo.id}>
                                {photo.previewUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={photo.previewUrl}
                                    alt={clean(photo.altText) || clean(photo.caption) || `${statusLabel(photo.category)} location reference`}
                                  />
                                ) : (
                                  <span className={styles.locationPhotoPlaceholder}><Camera size={18} aria-hidden="true" /></span>
                                )}
                                <div>
                                  <strong>{statusLabel(photo.category)}</strong>
                                  <span className={photo.audience === "client" ? styles.locationPhotoClientBadge : styles.locationPhotoStaffBadge}>
                                    {photo.audience === "client" ? "Client-facing" : "Staff-only"}
                                  </span>
                                  <small>{clean(photo.caption) || "No caption"}</small>
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Remove ${statusLabel(photo.category).toLowerCase()} location photo`}
                                  onClick={() => void deleteLocationPhoto(photo)}
                                  disabled={!!deletingLocationPhotoId || uploadingLocationPhoto}
                                >
                                  <Trash2 size={13} aria-hidden="true" />
                                  {deletingLocationPhotoId === photo.id ? "Removing…" : "Remove"}
                                </button>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.locationPhotoSaveFirst}>No location photos saved yet.</div>
                        )}
                      </>
                    )}
                  </section>
                </div>
              ) : null}

              {recordEditor.kind === "bookingCycle" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Season year</span>
                    <input className={styles.input} type="number" min="2000" max="2200" value={recordEditor.values.seasonYear} readOnly />
                    <span className={styles.helpText}>Choose a different year from the season filter before opening this editor.</span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Booking status</span>
                    <select className={styles.select} value={recordEditor.values.status} onChange={(event) => updateRecordValue("status", event.target.value)}>
                      <option value="notContacted">Not contacted</option>
                      <option value="contactDue">Contact due</option>
                      <option value="contacted">Contacted</option>
                      <option value="followUp">Follow-up</option>
                      <option value="proposalSent">Proposal sent</option>
                      <option value="negotiating">Negotiating</option>
                      <option value="booked">Booked</option>
                      <option value="completed">Completed</option>
                      <option value="lost">Lost</option>
                      <option value="skipped">Skipped</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Target contact date</span>
                    <input className={styles.input} type="date" value={recordEditor.values.targetContactOn} onChange={(event) => updateRecordValue("targetContactOn", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Next follow-up</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.nextFollowUpAt} onChange={(event) => updateRecordValue("nextFollowUpAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Last contacted</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.lastContactedAt} onChange={(event) => updateRecordValue("lastContactedAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Shoot starts</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.shootStartAt} onChange={(event) => updateRecordValue("shootStartAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Shoot ends</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.shootEndAt} onChange={(event) => updateRecordValue("shootEndAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Estimated students / people</span>
                    <input className={styles.input} type="number" min="0" value={recordEditor.values.studentEstimate} onChange={(event) => updateRecordValue("studentEstimate", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Actual students / people</span>
                    <input className={styles.input} type="number" min="0" value={recordEditor.values.studentActual} onChange={(event) => updateRecordValue("studentActual", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Quoted value</span>
                    <input className={styles.input} type="number" min="0" step="0.01" value={recordEditor.values.quotedAmount} onChange={(event) => updateRecordValue("quotedAmount", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Booked value</span>
                    <input className={styles.input} type="number" min="0" step="0.01" value={recordEditor.values.bookedAmount} onChange={(event) => updateRecordValue("bookedAmount", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Currency</span>
                    <input className={styles.input} maxLength={3} value={recordEditor.values.currency} onChange={(event) => updateRecordValue("currency", event.target.value.toUpperCase())} />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Season notes</span>
                    <textarea className={styles.textarea} value={recordEditor.values.notes} onChange={(event) => updateRecordValue("notes", event.target.value)} />
                  </label>
                </div>
              ) : null}

              {recordEditor.kind === "task" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Task title *</span>
                    <input className={styles.input} value={recordEditor.values.title} onChange={(event) => updateRecordValue("title", event.target.value)} placeholder="Email principal about fall dates" autoFocus />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Task type</span>
                    <select className={styles.select} value={recordEditor.values.kind} onChange={(event) => updateRecordValue("kind", event.target.value)}>
                      <option value="followUp">Follow-up</option>
                      <option value="call">Call</option>
                      <option value="email">Email</option>
                      <option value="agreement">Agreement</option>
                      <option value="booking">Booking</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Contact</span>
                    <select className={styles.select} value={recordEditor.values.contactId} onChange={(event) => updateRecordValue("contactId", event.target.value)}>
                      <option value="">No specific contact</option>
                      {selectedContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.fullName}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Due</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.dueAt} onChange={(event) => updateRecordValue("dueAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Reminder</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.remindAt} onChange={(event) => updateRecordValue("remindAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Priority</span>
                    <select className={styles.select} value={recordEditor.values.priority} onChange={(event) => updateRecordValue("priority", event.target.value)}>
                      <option value="0">Low</option>
                      <option value="1">Normal</option>
                      <option value="2">High</option>
                      <option value="3">Urgent</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Status</span>
                    <select className={styles.select} value={recordEditor.values.status} onChange={(event) => updateRecordValue("status", event.target.value)}>
                      <option value="open">Open</option>
                      <option value="snoozed">Snoozed</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Notes</span>
                    <textarea className={styles.textarea} value={recordEditor.values.notes} onChange={(event) => updateRecordValue("notes", event.target.value)} />
                  </label>
                </div>
              ) : null}

              {recordEditor.kind === "agreement" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Agreement title *</span>
                    <input className={styles.input} value={recordEditor.values.title} onChange={(event) => updateRecordValue("title", event.target.value)} placeholder="2026–2028 school photography agreement" autoFocus />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Status</span>
                    <select className={styles.select} value={recordEditor.values.status} onChange={(event) => updateRecordValue("status", event.target.value)}>
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="signed">Signed</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Signed at</span>
                    <input className={styles.input} type="datetime-local" value={recordEditor.values.signedAt} onChange={(event) => updateRecordValue("signedAt", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Starts</span>
                    <input className={styles.input} type="date" value={recordEditor.values.startsOn} onChange={(event) => updateRecordValue("startsOn", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ends</span>
                    <input className={styles.input} type="date" value={recordEditor.values.endsOn} onChange={(event) => updateRecordValue("endsOn", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Agreement value</span>
                    <input className={styles.input} type="number" min="0" step="0.01" value={recordEditor.values.amount} onChange={(event) => updateRecordValue("amount", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Currency</span>
                    <input className={styles.input} maxLength={3} value={recordEditor.values.currency} onChange={(event) => updateRecordValue("currency", event.target.value.toUpperCase())} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Student / people commitment</span>
                    <input className={styles.input} type="number" min="0" value={recordEditor.values.studentCommitment} onChange={(event) => updateRecordValue("studentCommitment", event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Renewal notice days</span>
                    <input className={styles.input} type="number" min="0" max="730" value={recordEditor.values.renewalNoticeDays} onChange={(event) => updateRecordValue("renewalNoticeDays", event.target.value)} />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Terms summary</span>
                    <textarea className={styles.textarea} value={recordEditor.values.termsSummary} onChange={(event) => updateRecordValue("termsSummary", event.target.value)} placeholder="Term length, exclusivity, minimums, renewal, and important conditions." />
                  </label>
                  <label className={styles.field + " " + styles.fieldSpan}>
                    <span className={styles.fieldLabel}>Internal notes</span>
                    <textarea className={styles.textarea} value={recordEditor.values.notes} onChange={(event) => updateRecordValue("notes", event.target.value)} />
                  </label>
                </div>
              ) : null}

              <p className={styles.helpText}>
                Changes are saved to your photographer-owned cloud CRM and become available on desktop and mobile after refresh.
              </p>
              {recordEditorError ? <div className={styles.error} role="alert">{recordEditorError}</div> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.ghostButton} onClick={() => setRecordEditor(null)} disabled={locationEditorBusy}>
                  Cancel
                </button>
                <button type="button" className={styles.primaryButton} onClick={() => void saveRecordEditor()} disabled={locationEditorBusy}>
                  <Check size={15} aria-hidden="true" /> {savingRecord ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {emailOpen && selectedClient ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !drafting && !sending) setEmailOpen(false);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="crm-email-title">
            <div className={styles.modalHeader}>
              <div>
                <h2 id="crm-email-title" className={styles.modalTitle}>Email {selectedClient.displayName}</h2>
                <p className={styles.modalSubtitle}>
                  Pick an approved preset for a one-click queue, or ask AI to prepare a draft for review.
                </p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close email composer"
                onClick={() => setEmailOpen(false)}
                disabled={drafting || sending}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Recipient</span>
                <select
                  className={styles.select}
                  value={emailState.contactId}
                  onChange={(event) => {
                    setEmailState((current) => ({ ...current, contactId: event.target.value, outboxId: "" }));
                    sendKeyRef.current = requestKey();
                  }}
                >
                  <option value="">Choose a saved contact</option>
                  {selectedContacts
                    .filter((contact) => !!clean(contact.email) && !contact.doNotContact)
                    .map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.fullName} · {contact.email}
                      </option>
                    ))}
                </select>
              </label>

              {emailState.contactId ? (() => {
                const recipient = selectedContacts.find((contact) => contact.id === emailState.contactId);
                return recipient ? (
                  <div className={styles.recipientBox}>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.recipientName}>{recipient.fullName}</div>
                      <div className={styles.recipientEmail}>{recipient.email}</div>
                    </div>
                    <span className={styles.verified}><ShieldCheck size={14} /> Server verified</span>
                  </div>
                ) : null;
              })() : null}

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Preset message</span>
                <select className={styles.select} value={emailState.templateId} onChange={(event) => chooseTemplate(event.target.value)}>
                  <option value="">Custom draft</option>
                  {approvedTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}{template.purpose ? " · " + template.purpose : ""}
                    </option>
                  ))}
                </select>
              </label>

              {approvedTemplates.length === 0 ? (
                <div className={styles.error}>
                  No approved CRM presets are available yet. Add and approve a template before using one-click email.
                </div>
              ) : null}

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Subject</span>
                <input
                  className={styles.input}
                  value={emailState.subject}
                  onChange={(event) => setEmailState((current) => ({
                    ...current,
                    subject: event.target.value,
                    outboxId: "",
                    contentSource: "custom draft",
                  }))}
                  placeholder="Annual photography booking"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Message</span>
                <textarea
                  className={styles.textarea}
                  value={emailState.message}
                  onChange={(event) => setEmailState((current) => ({
                    ...current,
                    message: event.target.value,
                    outboxId: "",
                    contentSource: "custom draft",
                  }))}
                  placeholder="Your approved message will appear here."
                />
              </label>

              <div className={styles.aiBox}>
                <Sparkles size={17} aria-hidden="true" />
                <div>
                  <strong>AI assists; it does not choose who to contact.</strong><br />
                  The server resolves the saved contact, checks ownership and do-not-contact status, and returns a draft for you to review.
                  {emailState.contentSource ? " Current content: " + statusLabel(emailState.contentSource) + "." : ""}
                </div>
              </div>

              {emailError ? <div className={styles.error} role="alert">{emailError}</div> : null}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setEmailOpen(false)}
                  disabled={drafting || sending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void draftEmailWithAi()}
                  disabled={drafting || sending || !emailState.contactId}
                >
                  <WandSparkles size={15} aria-hidden="true" /> {drafting ? "Drafting…" : "Draft with AI"}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void queueEmail()}
                  disabled={
                    drafting
                    || sending
                    || !emailState.contactId
                    || (!emailState.outboxId && (!emailState.templateId || emailState.contentSource !== "approved template"))
                  }
                >
                  <Send size={15} aria-hidden="true" /> {sending ? "Queueing…" : "Queue email"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {notice ? <div className={styles.activityToast} role="status">{notice}</div> : null}
    </div>
  );
}
