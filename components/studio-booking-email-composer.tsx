"use client";

import {
  type ChangeEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  LoaderCircle,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  bookingEmailEventDate,
  bookingEmailTime,
  buildStudioBookingMailtoUrl,
  buildStudioBookingMailBody,
  collectStudioBookingEmailRecipients,
  defaultStudioBookingEmailCopy,
  normalizeStudioBookingEmailAddress,
  STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS,
  studioBookingRecipientFingerprint,
} from "@/lib/studio-booking-email";
import type { StudioBookingDetail } from "@/lib/studio-bookings";
import styles from "@/app/dashboard/admin/bookings/studio-bookings.module.css";

const MAX_PHOTOS = 4;
const MAX_PHOTO_CONTENT_LENGTH = 1_000_000;
const MAX_TOTAL_PHOTO_CONTENT_LENGTH = 3_200_000;
const TARGET_PHOTO_BYTES = 680_000;

type PreparedPhoto = {
  filename: string;
  contentType: "image/jpeg";
  content: string;
};

type SendResult = {
  sent: number;
  failed: number;
  unattempted?: number;
  total: number;
  message: string;
  deliveryKind?: "all" | "new";
  retryAfterSeconds?: number;
  parentSent?: number;
  parentFailed?: number;
  staffCopy?: {
    requested: boolean;
    sent: boolean;
    failed: boolean;
  };
  campaignTrackingFailed?: boolean;
};

type BookingEmailCampaignSummary = {
  saved: boolean;
  id: string | null;
  subject: string;
  savedAt: string | null;
  photoCount: number;
  newRecipients: number;
  newBookings: number;
  handledBookings: number;
  confirmedRecipients: number;
  confirmedBookings: number;
  currentFingerprint: string;
  newFingerprint: string;
};

type CampaignPayload = {
  ok?: boolean;
  message?: string;
  sent?: number;
  failed?: number;
  unattempted?: number;
  total?: number;
  trackingFailed?: boolean;
  campaign?: Partial<BookingEmailCampaignSummary> | null;
};

type ErrorPayload = {
  ok?: false;
  message?: string;
  sent?: number;
  failed?: number;
  total?: number;
  currentRecipients?: number;
};

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be prepared."))),
      "image/jpeg",
      quality,
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} could not be read.`));
    };
    image.src = url;
  });
}

function drawResizedImage(image: HTMLImageElement, maximumDimension: number) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("The selected image has no dimensions.");
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image editor is unavailable in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("The image could not be encoded."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("The image could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

async function preparePhoto(file: File, index: number): Promise<PreparedPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error(`${file.name} must be a JPEG, PNG, or WebP image.`);
  }
  const image = await loadImage(file);
  let canvas = drawResizedImage(image, 1600);
  let blob = await canvasBlob(canvas, 0.82);
  if (blob.size > TARGET_PHOTO_BYTES) {
    canvas = drawResizedImage(image, 1200);
    blob = await canvasBlob(canvas, 0.72);
  }
  if (blob.size > TARGET_PHOTO_BYTES) {
    blob = await canvasBlob(canvas, 0.58);
  }
  const content = await blobToBase64(blob);
  if (content.length > MAX_PHOTO_CONTENT_LENGTH) {
    throw new Error(`${file.name} is still too large after optimization.`);
  }
  return {
    filename: `direction-photo-${index + 1}.jpg`,
    contentType: "image/jpeg",
    content,
  };
}

function previewUrl(photo: PreparedPhoto) {
  return `data:${photo.contentType};base64,${photo.content}`;
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function campaignCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function normalizeCampaignSummary(
  value: Partial<BookingEmailCampaignSummary> | null | undefined,
): BookingEmailCampaignSummary {
  return {
    saved: Boolean(value?.saved),
    id: clean(value?.id) || null,
    subject: clean(value?.subject),
    savedAt: clean(value?.savedAt) || null,
    photoCount: campaignCount(value?.photoCount),
    newRecipients: campaignCount(value?.newRecipients),
    newBookings: campaignCount(value?.newBookings),
    handledBookings: campaignCount(value?.handledBookings),
    confirmedRecipients: campaignCount(value?.confirmedRecipients),
    confirmedBookings: campaignCount(value?.confirmedBookings),
    currentFingerprint: clean(value?.currentFingerprint),
    newFingerprint: clean(value?.newFingerprint),
  };
}

function campaignSavedLabel(value: string | null, timezone: string) {
  if (!value) return "Saved message";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Saved message";
  return `Saved ${new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)}`;
}

export function StudioBookingEmailComposer({ detail }: { detail: StudioBookingDetail }) {
  const supabase = useMemo(() => createClient(), []);
  const defaults = useMemo(() => defaultStudioBookingEmailCopy(detail), [detail]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const staffCopyInputRef = useRef<HTMLInputElement>(null);
  const staffCopyHelpId = useId();
  const campaignStatusId = useId();
  const sendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaults.subject);
  const [headline, setHeadline] = useState(defaults.headline);
  const [message, setMessage] = useState(defaults.message);
  const [location, setLocation] = useState(clean(detail.schedule.location));
  const [address, setAddress] = useState(clean(detail.schedule.address));
  const [directions, setDirections] = useState("");
  const [staffCopyEnabled, setStaffCopyEnabled] = useState(false);
  const [staffCopyEmail, setStaffCopyEmail] = useState("");
  const [staffCopyValidationAttempted, setStaffCopyValidationAttempted] = useState(false);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendId, setSendId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [rememberForNewBookings, setRememberForNewBookings] = useState(false);
  const [campaign, setCampaign] = useState<BookingEmailCampaignSummary | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignAction, setCampaignAction] = useState<"baseline" | "new" | null>(null);
  const [campaignError, setCampaignError] = useState("");
  const [campaignTrackingRecoveryNeeded, setCampaignTrackingRecoveryNeeded] = useState(false);

  const validSlotIds = useMemo(
    () => new Set(detail.slots.map((slot) => slot.id)),
    [detail.slots],
  );
  const recipientSummary = useMemo(
    () => collectStudioBookingEmailRecipients(detail.bookings, "confirmed", validSlotIds),
    [detail.bookings, validSlotIds],
  );
  const recipientEmails = useMemo(
    () => recipientSummary.recipients.map((recipient) => recipient.email),
    [recipientSummary.recipients],
  );
  const normalizedStaffCopyEmail = useMemo(
    () => normalizeStudioBookingEmailAddress(staffCopyEmail),
    [staffCopyEmail],
  );
  const staffCopyMatchesParent = useMemo(
    () =>
      Boolean(
        normalizedStaffCopyEmail &&
          recipientEmails.some(
            (email) => email.toLowerCase() === normalizedStaffCopyEmail.toLowerCase(),
          ),
      ),
    [normalizedStaffCopyEmail, recipientEmails],
  );
  const staffCopyReady = Boolean(
    staffCopyEnabled && normalizedStaffCopyEmail && !staffCopyMatchesParent,
  );
  const staffCopyFieldError = staffCopyEnabled
    ? staffCopyMatchesParent
      ? "This address is already included as a parent recipient."
      : staffCopyValidationAttempted && !normalizedStaffCopyEmail
        ? "Enter one valid school/staff email address, or turn off the staff copy."
        : ""
    : "";
  const brandedRecipientCount =
    recipientEmails.length + (staffCopyReady ? 1 : 0);
  const brandedRecipientLimitExceeded =
    brandedRecipientCount > STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS;
  const campaignBusy = campaignLoading || campaignAction !== null;
  const busy = sending || campaignAction !== null;
  const campaignInitialLoading = campaignLoading && campaign === null;
  const newRecipientLimitExceeded =
    (campaign?.newRecipients ?? 0) > STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS;
  const previewRecipient = recipientSummary.recipients[0] ?? null;
  const recipientFingerprint = useMemo(
    () => studioBookingRecipientFingerprint(recipientSummary.recipients),
    [recipientSummary.recipients],
  );
  const slotById = useMemo(
    () => new Map(detail.slots.map((slot) => [slot.id, slot])),
    [detail.slots],
  );

  useEffect(() => {
    sendingRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => modalRef.current?.focus(), 50);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sendingRef.current) setOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => resultRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  async function campaignRequestHeaders(includeJson = false) {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      ...(includeJson ? { "Content-Type": "application/json" } : {}),
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    };
  }

  async function refreshCampaign(options?: { silent?: boolean }) {
    if (!options?.silent) setCampaignLoading(true);
    setCampaignError("");
    try {
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(detail.event.id)}/email/campaign`,
        {
          cache: "no-store",
          credentials: "include",
          headers: await campaignRequestHeaders(),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as CampaignPayload;
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return null;
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "The saved booking message could not be loaded.");
      }
      const next = normalizeCampaignSummary(payload.campaign);
      setCampaign(next);
      if (next.saved) setRememberForNewBookings(false);
      return next;
    } catch (loadError) {
      setCampaignError(
        loadError instanceof Error
          ? loadError.message
          : "The saved booking message could not be loaded.",
      );
      return null;
    } finally {
      if (!options?.silent) setCampaignLoading(false);
    }
  }

  function openComposer() {
    const hasUnresolvedFullSend = Boolean(
      result?.deliveryKind === "all" &&
        (result.failed || result.unattempted || result.campaignTrackingFailed),
    );
    setOpen(true);
    setCampaign(null);
    if (!hasUnresolvedFullSend) {
      setError("");
      setNotice("");
      setResult(null);
      setRetrySeconds(0);
      setSendId(window.crypto.randomUUID());
    }
    void refreshCampaign();
  }

  function resetComposer() {
    setSubject(defaults.subject);
    setHeadline(defaults.headline);
    setMessage(defaults.message);
    setLocation(clean(detail.schedule.location));
    setAddress(clean(detail.schedule.address));
    setDirections("");
    setStaffCopyEnabled(false);
    setStaffCopyEmail("");
    setStaffCopyValidationAttempted(false);
    setPhotos([]);
    setError("");
    setNotice("");
    setResult(null);
    setRetrySeconds(0);
    setRememberForNewBookings(false);
    setCampaignError("");
    setSendId(window.crypto.randomUUID());
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const available = MAX_PHOTOS - photos.length;
    if (available <= 0) {
      setError(`You can include up to ${MAX_PHOTOS} direction photos.`);
      return;
    }
    setProcessingPhotos(true);
    setError("");
    setNotice("");
    try {
      const selected = files.slice(0, available);
      const prepared = await Promise.all(
        selected.map((file, index) => preparePhoto(file, photos.length + index)),
      );
      const next = [...photos, ...prepared];
      const total = next.reduce((sum, photo) => sum + photo.content.length, 0);
      if (total > MAX_TOTAL_PHOTO_CONTENT_LENGTH) {
        throw new Error("Those photos are too large together. Remove one or choose smaller images.");
      }
      setPhotos(next);
      if (files.length > available) {
        setNotice(`Added ${available}. A maximum of ${MAX_PHOTOS} direction photos can be included.`);
      }
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "The photos could not be prepared.");
    } finally {
      setProcessingPhotos(false);
    }
  }

  async function copyBccList() {
    if (!recipientEmails.length) return;
    try {
      await navigator.clipboard.writeText(recipientEmails.join(", "));
      setCopied(true);
      setError("");
      setNotice(
        "Copied all confirmed parent addresses. External BCC sends are not tracked as saved-campaign deliveries.",
      );
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("The BCC list could not be copied. Please allow clipboard access and try again.");
    }
  }

  function openMailApp() {
    if (!recipientEmails.length) {
      setError("There are no valid email addresses for confirmed bookings.");
      return;
    }
    const mailBody = [
      headline,
      "",
      buildStudioBookingMailBody(detail, message, {
        location,
        address,
        directions,
      }),
    ].join("\n");
    const mailto = buildStudioBookingMailtoUrl({
      to: detail.studio.email,
      bcc: recipientEmails,
      subject,
      body: mailBody,
    });
    if (!mailto) {
      setError("Add a valid studio email in Settings before opening a Mail draft. You can still copy the BCC list.");
      return;
    }
    if (mailto.length > 16_000) {
      setError("This confirmed booking list is too large for one Mail draft. Copy the BCC list instead.");
      return;
    }
    setError("");
    setNotice(
      "Opened a plain-text draft for all confirmed parents in BCC. External Mail sends are not tracked as saved-campaign deliveries. Mail drafts cannot include the branded logo, personalized appointment block, or website photo attachments; add photos manually, or use branded delivery for the full design.",
    );
    window.location.href = mailto;
  }

  function validatedStaffCopy() {
    if (!staffCopyEnabled) return { enabled: false as const };
    setStaffCopyValidationAttempted(true);
    if (!normalizedStaffCopyEmail) {
      setError("Enter one valid school/staff email address, or turn off the staff copy.");
      staffCopyInputRef.current?.focus();
      return null;
    }
    if (staffCopyMatchesParent) {
      setError(
        "That school/staff address is already included as a confirmed parent recipient. Use a different address or turn off the staff copy.",
      );
      staffCopyInputRef.current?.focus();
      return null;
    }
    return { enabled: true as const, email: normalizedStaffCopyEmail };
  }

  function sharedCopyIsValid() {
    if (clean(subject) && clean(headline) && clean(message)) return true;
    setError("Add a subject, headline, and message before saving or sending.");
    return false;
  }

  async function saveCampaignBaseline() {
    if (!sharedCopyIsValid()) return;
    if (processingPhotos) {
      setError("Wait for the direction photos to finish preparing before saving.");
      return;
    }
    if (campaignTrackingRecoveryNeeded) {
      setError(
        "Retry delivery tracking for the previous send before creating a baseline.",
      );
      return;
    }
    const count = recipientSummary.recipients.length;
    const confirmed = window.confirm(
      `Save this message for future new bookings without sending it now?\n\n` +
        `${count} current parent recipient${count === 1 ? "" : "s"} will be marked as already handled. ` +
        "Use this only if you already sent them this information. This action sends no email.",
    );
    if (!confirmed) return;

    setCampaignAction("baseline");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(detail.event.id)}/email/campaign`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: await campaignRequestHeaders(true),
          body: JSON.stringify({
            action: "save-baseline",
            saveId: window.crypto.randomUUID(),
            recipientFingerprint: campaign?.currentFingerprint || recipientFingerprint,
            subject: clean(subject),
            headline: clean(headline),
            message: clean(message),
            location: clean(location),
            address: clean(address),
            directions: clean(directions),
            photos,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as CampaignPayload;
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!response.ok || payload.ok === false) {
        if (response.status === 409) void refreshCampaign({ silent: true });
        throw new Error(payload.message || "The message could not be saved for future bookings.");
      }
      setCampaign(normalizeCampaignSummary(payload.campaign));
      setRememberForNewBookings(false);
      setCampaignTrackingRecoveryNeeded(false);
      setNotice(
        payload.message ||
          "Saved for future new bookings. No email was sent to current parents.",
      );
      await refreshCampaign({ silent: true });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The message could not be saved for future bookings.",
      );
    } finally {
      setCampaignAction(null);
    }
  }

  async function sendNewBookings() {
    if (!campaign?.saved || !campaign.id) {
      setCampaignError("Save a reusable booking message before sending to new bookings.");
      return;
    }
    if (!campaign.newRecipients || !campaign.newFingerprint) {
      setCampaignError("There are no new confirmed parent recipients to email.");
      return;
    }
    if (newRecipientLimitExceeded) {
      setCampaignError(
        `New-booking delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time.`,
      );
      return;
    }
    const confirmed = window.confirm(
      `Send the saved message to ${campaign.newRecipients} new parent recipient${campaign.newRecipients === 1 ? "" : "s"} for ${campaign.newBookings} new booking${campaign.newBookings === 1 ? "" : "s"}?\n\n` +
        "Each parent receives a private personalized email. The optional school/staff copy is not included in new-booking delivery.",
    );
    if (!confirmed) return;

    setCampaignAction("new");
    setCampaignError("");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(detail.event.id)}/email/campaign`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: await campaignRequestHeaders(true),
          body: JSON.stringify({
            action: "send-new",
            campaignId: campaign.id,
            recipientFingerprint: campaign.newFingerprint,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as CampaignPayload;
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (response.status === 409) {
        await refreshCampaign({ silent: true });
        throw new Error(
          payload.message ||
            "The new-booking list changed. Review the refreshed counts and try again.",
        );
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        setRetrySeconds(
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60,
        );
      }
      if (!response.ok && !payload.sent) {
        throw new Error(payload.message || "The new-booking emails could not be sent.");
      }
      const trackingFailed = Boolean(
        payload.trackingFailed ||
          (payload.ok === false && response.status === 503 && campaignCount(payload.sent) > 0),
      );
      const nextResult: SendResult = {
        sent: campaignCount(payload.sent),
        failed: campaignCount(payload.failed),
        unattempted: campaignCount(payload.unattempted),
        total: campaignCount(payload.total) || campaign.newRecipients,
        message: payload.message || "New-booking email delivery finished.",
        deliveryKind: "new",
        campaignTrackingFailed: trackingFailed,
      };
      setResult(nextResult);
      setCampaignTrackingRecoveryNeeded(trackingFailed);
      if (nextResult.failed || nextResult.unattempted) {
        setError(
          `${nextResult.failed} new-booking email${nextResult.failed === 1 ? "" : "s"} failed${nextResult.unattempted ? ` and ${nextResult.unattempted} ${nextResult.unattempted === 1 ? "was" : "were"} not attempted` : ""}.`,
        );
      }
      if (trackingFailed) {
        setError(
          "Some emails were accepted, but their new-booking tracking was not saved. Retry with the same delivery keys; accepted emails will not be duplicated.",
        );
      }
      if (payload.campaign) setCampaign(normalizeCampaignSummary(payload.campaign));
      await refreshCampaign({ silent: true });
    } catch (sendError) {
      const message = sendError instanceof Error
        ? sendError.message
        : "The new-booking emails could not be sent.";
      setCampaignError(message);
      setError(message);
    } finally {
      setCampaignAction(null);
    }
  }

  async function sendBrandedEmail(retry = false) {
    const count = recipientSummary.recipients.length;
    if (!count) {
      setError("There are no valid email addresses for confirmed bookings.");
      return;
    }
    const staffCopy = validatedStaffCopy();
    if (!staffCopy) return;
    if (brandedRecipientLimitExceeded) {
      setError(
        `Branded delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time. Copy the BCC list and split this event into smaller messages.`,
      );
      return;
    }
    if (!sharedCopyIsValid()) return;
    const confirmed = window.confirm(
      retry
        ? campaignTrackingRecoveryNeeded
          ? "Retry this send with the same delivery key to restore campaign tracking? Emails already accepted for delivery will not be duplicated."
          : "Retry the undelivered messages using the same campaign? Messages already accepted for delivery keep the same delivery key."
        : `Send this branded email to ${count} private parent recipient${count === 1 ? "" : "s"}${staffCopy.enabled ? " plus 1 school/staff copy" : ""}?\n\n` +
          "Parents: confirmed bookings only\n" +
          (staffCopy.enabled ? `School/staff copy: ${staffCopy.email}\n` : "") +
          (rememberForNewBookings
            ? "Saved follow-up: remember this message and mark successful parent deliveries for future new bookings\n"
            : "") +
          `Direction photos: ${photos.length}\n\nEach parent receives a separate personalized email.` +
          (staffCopy.enabled
            ? "\nThe school/staff copy omits the automatic personalized booking section. Review the shared subject, message, directions and photos for sensitive information."
            : ""),
    );
    if (!confirmed) return;

    setSending(true);
    setError("");
    setNotice("");
    if (!retry) setResult(null);
    try {
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(detail.event.id)}/email`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: await campaignRequestHeaders(true),
          body: JSON.stringify({
            sendId: sendId || window.crypto.randomUUID(),
            recipientFingerprint,
            subject: clean(subject),
            headline: clean(headline),
            message: clean(message),
            location: clean(location),
            address: clean(address),
            directions: clean(directions),
            staffCopy,
            rememberForNewBookings,
            photos,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as ErrorPayload &
        SendResult & {
          ok?: boolean;
          campaign?: { saved?: boolean; id?: string | null; trackingFailed?: boolean };
        };
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (response.status === 409) {
        throw new Error(
          payload.message ||
            "The confirmed booking list changed. Close this window, refresh the event, and review the recipients again.",
        );
      }
      if (response.status === 429 && retry) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        setRetrySeconds(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60);
      }
      if (!response.ok && !payload.sent) {
        throw new Error(payload.message || "The booking emails could not be sent.");
      }
      const trackingFailed = Boolean(payload.campaign?.trackingFailed);
      const nextResult: SendResult = {
        sent: Number(payload.sent ?? 0),
        failed: Number(payload.failed ?? 0),
        total: Number(payload.total ?? count + (staffCopy.enabled ? 1 : 0)),
        message: payload.message || "Booking email delivery finished.",
        deliveryKind: "all",
        retryAfterSeconds: Number(payload.retryAfterSeconds ?? 0),
        parentSent: payload.parentSent,
        parentFailed: payload.parentFailed,
        staffCopy: payload.staffCopy,
        campaignTrackingFailed: trackingFailed,
      };
      setResult(nextResult);
      setCampaignTrackingRecoveryNeeded(trackingFailed);
      setRetrySeconds(Math.max(0, nextResult.retryAfterSeconds ?? 0));
      if (nextResult.failed > 0) {
        setError(`${nextResult.failed} email${nextResult.failed === 1 ? "" : "s"} could not be delivered.`);
      } else if (trackingFailed) {
        setError(
          "The emails were accepted, but future-booking tracking was not saved. Retry with the same delivery key before creating a baseline.",
        );
      } else {
        setCampaignTrackingRecoveryNeeded(false);
        if (payload.campaign?.saved) setRememberForNewBookings(false);
      }
      await refreshCampaign({ silent: true });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The booking emails could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const modal = open ? (
    <div
      className={styles.emailModalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) setOpen(false);
      }}
    >
      <section
        ref={modalRef}
        className={styles.emailModal}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="booking-email-title"
        aria-busy={busy}
      >
        <header className={styles.emailModalHeader}>
          <div>
            <span><Mail size={15} /> Private booking message</span>
            <h2 id="booking-email-title">Email booking clients</h2>
            <p>{detail.event.name}</p>
          </div>
          <button
            type="button"
            className={styles.emailCloseButton}
            aria-label="Close email composer"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </header>

        {result ? (
          <div
            ref={resultRef}
            className={styles.emailResultPanel}
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            {result.failed || result.unattempted || result.campaignTrackingFailed
              ? <AlertTriangle size={46} />
              : <CheckCircle2 size={46} />}
            <h3>
              {result.failed || result.unattempted || result.campaignTrackingFailed
                ? "Email delivery finished with a warning"
                : result.deliveryKind === "new"
                  ? "New bookings emailed"
                  : "Booking emails sent"}
            </h3>
            <p>{result.message}</p>
            <div>
              <span><strong>{result.sent}</strong> sent</span>
              <span><strong>{result.failed}</strong> failed</span>
              {result.unattempted ? (
                <span><strong>{result.unattempted}</strong> not attempted</span>
              ) : null}
              <span><strong>{result.total}</strong> recipients</span>
            </div>
            {error ? <div className={styles.emailInlineError} role="alert"><XCircle size={16} /> {error}</div> : null}
            <div className={styles.emailResultActions}>
              <button type="button" onClick={() => setOpen(false)}>Done</button>
              {result.failed || result.unattempted || result.campaignTrackingFailed ? (
                <button
                  type="button"
                  onClick={() => void (
                    result.deliveryKind === "new"
                      ? sendNewBookings()
                      : sendBrandedEmail(true)
                  )}
                  disabled={
                    busy ||
                    (result.deliveryKind === "new"
                      ? retrySeconds > 0 || !campaign?.newRecipients || !campaign.newFingerprint
                      : retrySeconds > 0)
                  }
                >
                  {busy
                    ? "Retrying…"
                    : result.deliveryKind === "new"
                      ? retrySeconds > 0
                        ? `Retry in ${retrySeconds}s`
                        : "Retry remaining new bookings"
                      : retrySeconds > 0
                      ? `Retry in ${retrySeconds}s`
                      : result.campaignTrackingFailed
                        ? "Retry delivery tracking"
                        : "Retry failed deliveries"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={campaign?.saved
                    ? () => {
                        setResult(null);
                        setError("");
                      }
                    : resetComposer}
                >
                  {campaign?.saved ? "Back to message" : "Create another email"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <fieldset className={styles.emailComposerFieldset} disabled={busy}>
            <div className={styles.emailComposerGrid}>
            <div className={styles.emailFormPane}>
              <section
                className={styles.emailCampaignCard}
                aria-labelledby={campaignStatusId}
              >
                <div className={styles.emailCampaignHeader}>
                  <div>
                    <span>{campaign?.saved ? "Saved follow-up" : "Future bookings"}</span>
                    <h3 id={campaignStatusId}>
                      {campaign?.saved
                        ? "Booking information message"
                        : "Remember this message"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    className={styles.emailCampaignRefresh}
                    onClick={() => void refreshCampaign()}
                    disabled={campaignBusy}
                    aria-label="Refresh saved message and new booking counts"
                  >
                    {campaignLoading ? <LoaderCircle size={14} className={styles.spin} /> : "Refresh"}
                  </button>
                </div>

                {campaignError ? (
                  <div className={styles.emailCampaignError} role="alert">
                    <XCircle size={15} /> {campaignError}
                  </div>
                ) : null}

                {campaignLoading && !campaign ? (
                  <p className={styles.emailCampaignLoading} role="status">Checking for a saved message…</p>
                ) : campaign?.saved ? (
                  <>
                    <div className={styles.emailCampaignSavedMeta}>
                      <span>{campaignSavedLabel(campaign.savedAt, detail.event.timezone)}</span>
                      <strong>{campaign.subject || "Saved booking information"}</strong>
                      <small>
                        {campaign.photoCount} saved direction photo{campaign.photoCount === 1 ? "" : "s"}
                      </small>
                    </div>
                    <div
                      className={styles.emailCampaignCounts}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <span>
                        <strong>{campaign.newBookings}</strong>
                        new booking{campaign.newBookings === 1 ? "" : "s"}
                      </span>
                      <span>
                        <strong>{campaign.newRecipients}</strong>
                        parent email{campaign.newRecipients === 1 ? "" : "s"}
                      </span>
                      <span>
                        <strong>{campaign.handledBookings}</strong>
                        already handled
                      </span>
                    </div>
                    <p>
                      New-booking delivery uses this saved version. The editor below remains available
                      for a separate message to all confirmed parents.
                    </p>
                    {newRecipientLimitExceeded ? (
                      <div className={styles.emailCampaignError} role="alert">
                        New-booking delivery is limited to {STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} parent
                        recipients at a time.
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className={styles.emailCampaignSendNew}
                      onClick={() => void sendNewBookings()}
                      disabled={
                        campaignBusy ||
                        Boolean(campaignError) ||
                        !campaign.newRecipients ||
                        !campaign.newFingerprint ||
                        newRecipientLimitExceeded
                      }
                    >
                      {campaignAction === "new" ? (
                        <><LoaderCircle size={16} className={styles.spin} /> Sending new bookings…</>
                      ) : campaign.newRecipients ? (
                        <><Send size={16} /> Send to {campaign.newRecipients} new parent{campaign.newRecipients === 1 ? "" : "s"}</>
                      ) : (
                        <><CheckCircle2 size={16} /> No new bookings to email</>
                      )}
                    </button>
                    <small className={styles.emailCampaignStaffNote}>
                      School/staff copy is manual only and is never included in new-booking delivery.
                    </small>
                  </>
                ) : campaignError ? null : (
                  <>
                    <label className={styles.emailRememberCampaign}>
                      <input
                        type="checkbox"
                        checked={rememberForNewBookings}
                        onChange={(event) => setRememberForNewBookings(event.target.checked)}
                      />
                      <span>
                        <strong>Remember this message for future new bookings</strong>
                        <small>
                          When you send to all parents, successful deliveries become the starting point.
                        </small>
                      </span>
                    </label>
                    <div className={styles.emailCampaignBaseline}>
                      <span>
                        Already sent this information outside Studio OS? Save the current message and
                        mark today’s confirmed bookings as handled without emailing them again.
                      </span>
                      <button
                        type="button"
                        onClick={() => void saveCampaignBaseline()}
                        disabled={campaignBusy || processingPhotos || campaignTrackingRecoveryNeeded}
                      >
                        {campaignAction === "baseline"
                          ? "Saving…"
                          : "I already sent this — save for future bookings"}
                      </button>
                    </div>
                    {campaignTrackingRecoveryNeeded ? (
                      <div className={styles.emailCampaignError} role="alert">
                        Retry delivery tracking from the result screen before creating a baseline.
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              <div className={styles.emailAudienceCard}>
                <div className={styles.emailFieldHeading}>
                  <span>Parent recipients</span>
                  <strong><UsersRound size={14} /> {recipientSummary.recipients.length} private email{recipientSummary.recipients.length === 1 ? "" : "s"}</strong>
                </div>
                <p>
                  {recipientSummary.eligibleBookings} confirmed booking record{recipientSummary.eligibleBookings === 1 ? "" : "s"}.
                  {recipientSummary.duplicateEmailBookings ? ` ${recipientSummary.duplicateEmailBookings} duplicate email ${recipientSummary.duplicateEmailBookings === 1 ? "was" : "addresses were"} combined.` : ""}
                  {recipientSummary.missingEmailBookings || recipientSummary.invalidEmailBookings
                    ? ` ${recipientSummary.missingEmailBookings + recipientSummary.invalidEmailBookings} ${recipientSummary.missingEmailBookings + recipientSummary.invalidEmailBookings === 1 ? "record has" : "records have"} no usable email.`
                    : ""}
                  {recipientSummary.unusableSlotBookings
                    ? ` ${recipientSummary.unusableSlotBookings} ${recipientSummary.unusableSlotBookings === 1 ? "record has" : "records have"} no valid appointment slot and will not be emailed.`
                    : ""}
                  {brandedRecipientLimitExceeded
                    ? ` Branded sending is limited to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients per campaign; use Copy BCC to split this list.`
                    : ""}
                </p>
                <label className={styles.emailStaffCopyToggle}>
                  <input
                    type="checkbox"
                    checked={staffCopyEnabled}
                    onChange={(event) => {
                      setStaffCopyEnabled(event.target.checked);
                      setStaffCopyValidationAttempted(false);
                      setError("");
                    }}
                  />
                  <span>
                    <strong>School / staff copy</strong>
                    <small>Optional · manual all-parent branded delivery only</small>
                  </span>
                </label>
                {staffCopyEnabled ? (
                  <label className={styles.emailStaffCopyField}>
                    <span>School / staff email</span>
                    <input
                      ref={staffCopyInputRef}
                      type="email"
                      value={staffCopyEmail}
                      maxLength={254}
                      placeholder="coordinator@school.ca"
                      autoComplete="off"
                      required
                      aria-required="true"
                      aria-describedby={staffCopyHelpId}
                      aria-invalid={Boolean(staffCopyFieldError)}
                      onChange={(event) => {
                        setStaffCopyEmail(event.target.value);
                        setStaffCopyValidationAttempted(false);
                        setError("");
                      }}
                    />
                    <small id={staffCopyHelpId} className={staffCopyFieldError ? styles.emailFieldHintError : undefined}>
                      {staffCopyFieldError
                        ? staffCopyFieldError
                        : "Sends one separate copy with the same subject, message, event details and direction photos. The automatic personalized booking section is omitted; review shared content for sensitive information."}
                    </small>
                  </label>
                ) : null}
              </div>

              <label className={styles.emailField}>
                <span>Subject</span>
                <input
                  value={subject}
                  maxLength={200}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label className={styles.emailField}>
                <span>Headline</span>
                <input
                  value={headline}
                  maxLength={200}
                  onChange={(event) => setHeadline(event.target.value)}
                />
              </label>
              <label className={styles.emailField}>
                <span>Message</span>
                <textarea
                  value={message}
                  maxLength={10_000}
                  rows={7}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>

              <label className={styles.emailField}>
                <span>Location (leave blank to omit)</span>
                <input
                  value={location}
                  maxLength={500}
                  placeholder="Example: Main campus gym"
                  onChange={(event) => setLocation(event.target.value)}
                />
              </label>

              <label className={styles.emailField}>
                <span>Address (leave blank to omit)</span>
                <textarea
                  value={address}
                  maxLength={1_000}
                  rows={3}
                  placeholder="Street address and any helpful unit or room details"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>

              <label className={styles.emailField}>
                <span>Directions / arrival instructions (client-facing)</span>
                <textarea
                  value={directions}
                  maxLength={3_000}
                  rows={4}
                  placeholder="Example: Use the east entrance, then follow signs to the gym."
                  onChange={(event) => setDirections(event.target.value)}
                />
              </label>
              {detail.schedule.notes ? (
                <div className={styles.emailSavedNotesPrompt}>
                  <span>Saved schedule notes stay private unless you choose to copy them here.</span>
                  <button type="button" onClick={() => setDirections(detail.schedule.notes ?? "")}>
                    Use saved schedule notes
                  </button>
                </div>
              ) : null}

              <div className={styles.emailPhotosField}>
                <div className={styles.emailFieldHeading}>
                  <span>Direction photos</span>
                  <small>{photos.length}/{MAX_PHOTOS}</small>
                </div>
                <label className={styles.emailPhotoPicker}>
                  {processingPhotos ? <LoaderCircle size={18} className={styles.spin} /> : <ImagePlus size={18} />}
                  <span>{processingPhotos ? "Preparing photos…" : "Add direction photos"}<small>JPEG, PNG or WebP · optimized automatically</small></span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={processingPhotos || photos.length >= MAX_PHOTOS}
                    onChange={(event) => void addPhotos(event)}
                  />
                </label>
                {photos.length ? (
                  <div className={styles.emailPhotoList}>
                    {photos.map((photo, index) => (
                      <div key={`${photo.filename}-${index}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl(photo)} alt={`Direction photo ${index + 1}`} />
                        <button
                          type="button"
                          aria-label={`Remove direction photo ${index + 1}`}
                          disabled={processingPhotos}
                          onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {error ? <div className={styles.emailInlineError} role="alert"><XCircle size={16} /> {error}</div> : null}
              {notice ? <div className={styles.emailInlineNotice} role="status"><Check size={16} /> {notice}</div> : null}

              <div className={styles.emailPrivacyNote}>
                <ShieldCheck size={16} />
                <span>
                  <strong>Recipients stay private with branded delivery.</strong> Mail-app drafts and
                  copied BCC lists always contain all confirmed parents only. External Mail/BCC sends
                  are not tracked as saved-campaign deliveries; the school/staff copy is sent only with
                  manual branded delivery.
                </span>
              </div>
            </div>

            <aside className={styles.emailPreviewPane}>
              <div className={styles.emailPreviewLabel}>Parent email preview</div>
              {staffCopyReady ? (
                <div className={styles.emailStaffPreviewNote}>
                  The school/staff copy uses this design but omits the automatic personalized booking section. Review the shared message and photos before sending.
                </div>
              ) : null}
              <div className={styles.emailPreviewCard}>
                <div className={styles.emailPreviewBrand} style={{ background: detail.studio.brandColor }}>
                  {detail.studio.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={detail.studio.logoUrl} alt={detail.studio.businessName} />
                  ) : (
                    <strong>{detail.studio.businessName}</strong>
                  )}
                </div>
                <div className={styles.emailPreviewContent}>
                  <h3>{headline || "Your headline"}</h3>
                  <p className={styles.emailPreviewMessage}>{message || "Your message"}</p>
                  <div className={styles.emailPreviewDetails}>
                    <strong>Event details</strong>
                    <dl>
                      <div><dt>Event</dt><dd>{detail.event.name}</dd></div>
                      <div><dt>{detail.event.days.length > 1 ? "Event dates" : "Date"}</dt><dd>{bookingEmailEventDate(detail)}</dd></div>
                      {clean(location) ? <div><dt>Location</dt><dd>{location}</dd></div> : null}
                      {clean(address) ? <div><dt>Address</dt><dd>{address}</dd></div> : null}
                      {clean(directions) ? <div><dt>Directions</dt><dd>{directions}</dd></div> : null}
                    </dl>
                  </div>
                  {previewRecipient ? (
                    <div className={styles.emailPreviewAppointments}>
                      <strong>Sample personalized appointment</strong>
                      {previewRecipient.bookings.map((booking) => {
                        const slot = booking.slotId ? slotById.get(booking.slotId) : null;
                        return (
                          <div key={booking.id}>
                            <span>{booking.studentName}<small>{booking.className}</small><em>{booking.status}</em></span>
                            <b>{slot ? bookingEmailTime(slot.startAt, detail.event.timezone) : "Time unavailable"}</b>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {photos.length ? (
                    <div className={styles.emailPreviewPhotos}>
                      <strong>Direction photos</strong>
                      {photos.map((photo, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={`${photo.filename}-preview-${index}`} src={previewUrl(photo)} alt={`Direction preview ${index + 1}`} />
                      ))}
                    </div>
                  ) : null}
                </div>
                <footer>
                  <strong>{detail.studio.businessName}</strong>
                  <span>{[detail.studio.address, detail.studio.phone, detail.studio.email].filter(Boolean).join(" · ")}</span>
                </footer>
              </div>
            </aside>
            </div>
          </fieldset>
        )}

        {!result ? (
          <footer className={styles.emailModalFooter}>
            <div className={styles.emailMailActions}>
              <button type="button" onClick={() => void copyBccList()} disabled={busy || campaignInitialLoading || !recipientEmails.length}>
                {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "All-parent BCC copied" : "Copy all-parent BCC"}
              </button>
              <button type="button" onClick={openMailApp} disabled={busy || campaignInitialLoading || !recipientEmails.length}>
                <Mail size={16} /> Open all parents in Mail
              </button>
            </div>
            <button
              type="button"
              className={styles.emailSendButton}
              onClick={() => void sendBrandedEmail()}
              disabled={busy || campaignInitialLoading || processingPhotos || !recipientEmails.length || brandedRecipientLimitExceeded}
            >
              {sending ? <LoaderCircle size={17} className={styles.spin} /> : <Send size={17} />}
              {sending
                ? "Sending private emails…"
                : `${rememberForNewBookings ? "Send & remember" : "Send"} to ${recipientEmails.length} parent${recipientEmails.length === 1 ? "" : "s"}${staffCopyReady ? " + 1 staff" : ""}`}
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  ) : null;

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openComposer}>
        <Mail size={16} /> Email bookings
      </button>
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
