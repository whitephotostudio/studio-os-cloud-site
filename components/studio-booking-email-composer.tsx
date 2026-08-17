"use client";

import {
  type ChangeEvent,
  useEffect,
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
  buildStudioBookingMailBody,
  collectStudioBookingEmailRecipients,
  defaultStudioBookingEmailCopy,
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
  total: number;
  message: string;
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

export function StudioBookingEmailComposer({ detail }: { detail: StudioBookingDetail }) {
  const supabase = useMemo(() => createClient(), []);
  const defaults = useMemo(() => defaultStudioBookingEmailCopy(detail), [detail]);
  const subjectRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaults.subject);
  const [headline, setHeadline] = useState(defaults.headline);
  const [message, setMessage] = useState(defaults.message);
  const [location, setLocation] = useState(clean(detail.schedule.location));
  const [address, setAddress] = useState(clean(detail.schedule.address));
  const [directions, setDirections] = useState("");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendId, setSendId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

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
  const brandedRecipientLimitExceeded =
    recipientEmails.length > STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS;
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
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => subjectRef.current?.focus(), 50);
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

  function openComposer() {
    setOpen(true);
    setError("");
    setNotice("");
    setResult(null);
    setSendId(window.crypto.randomUUID());
  }

  function resetComposer() {
    setSubject(defaults.subject);
    setHeadline(defaults.headline);
    setMessage(defaults.message);
    setLocation(clean(detail.schedule.location));
    setAddress(clean(detail.schedule.address));
    setDirections("");
    setPhotos([]);
    setError("");
    setNotice("");
    setResult(null);
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
    const query = new URLSearchParams({
      bcc: recipientEmails.join(","),
      subject: clean(subject),
      body: mailBody,
    });
    const to = detail.studio.email ? encodeURIComponent(detail.studio.email) : "";
    const mailto = `mailto:${to}?${query.toString()}`;
    if (mailto.length > 16_000) {
      setError("This confirmed booking list is too large for one Mail draft. Copy the BCC list instead.");
      return;
    }
    setError("");
    setNotice(
      "Opened a plain-text draft in your default Mail app with recipients in BCC. Mail drafts cannot include the branded logo, personalized appointment block, or website photo attachments; add photos manually, or use Send branded email for the full design.",
    );
    window.location.href = mailto;
  }

  async function sendBrandedEmail() {
    const count = recipientSummary.recipients.length;
    if (!count) {
      setError("There are no valid email addresses for confirmed bookings.");
      return;
    }
    if (brandedRecipientLimitExceeded) {
      setError(
        `Branded delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time. Copy the BCC list and split this event into smaller messages.`,
      );
      return;
    }
    if (!clean(subject) || !clean(headline) || !clean(message)) {
      setError("Add a subject, headline, and message before sending.");
      return;
    }
    const confirmed = window.confirm(
      `Send this branded email to ${count} private recipient${count === 1 ? "" : "s"}?\n\n` +
        "Recipients: confirmed bookings only\n" +
        `Direction photos: ${photos.length}\n\nEach client will receive a separate email.`,
    );
    if (!confirmed) return;

    setSending(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(detail.event.id)}/email`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers,
          body: JSON.stringify({
            sendId: sendId || window.crypto.randomUUID(),
            recipientFingerprint,
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
      const payload = (await response.json().catch(() => ({}))) as ErrorPayload & SendResult;
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
      if (!response.ok && !payload.sent) {
        throw new Error(payload.message || "The booking emails could not be sent.");
      }
      const nextResult = {
        sent: Number(payload.sent ?? 0),
        failed: Number(payload.failed ?? 0),
        total: Number(payload.total ?? count),
        message: payload.message || "Booking email delivery finished.",
      };
      setResult(nextResult);
      if (nextResult.failed > 0) {
        setError(`${nextResult.failed} email${nextResult.failed === 1 ? "" : "s"} could not be delivered.`);
      }
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
        if (event.target === event.currentTarget && !sending) setOpen(false);
      }}
    >
      <section
        ref={modalRef}
        className={styles.emailModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-email-title"
        aria-busy={sending}
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
            disabled={sending}
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
            {result.failed ? <AlertTriangle size={46} /> : <CheckCircle2 size={46} />}
            <h3>{result.failed ? "Email delivery finished with a warning" : "Booking emails sent"}</h3>
            <p>{result.message}</p>
            <div>
              <span><strong>{result.sent}</strong> sent</span>
              <span><strong>{result.failed}</strong> failed</span>
              <span><strong>{result.total}</strong> recipients</span>
            </div>
            {error ? <div className={styles.emailInlineError} role="alert"><XCircle size={16} /> {error}</div> : null}
            <div className={styles.emailResultActions}>
              <button type="button" onClick={() => setOpen(false)}>Done</button>
              {!result.failed ? <button type="button" onClick={resetComposer}>Create another email</button> : null}
            </div>
          </div>
        ) : (
          <fieldset className={styles.emailComposerFieldset} disabled={sending}>
            <div className={styles.emailComposerGrid}>
            <div className={styles.emailFormPane}>
              <div className={styles.emailAudienceCard}>
                <div className={styles.emailFieldHeading}>
                  <span>Confirmed bookings only</span>
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
              </div>

              <label className={styles.emailField}>
                <span>Subject</span>
                <input
                  ref={subjectRef}
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
                <span><strong>Recipients stay private.</strong> Branded delivery sends a separate email to each address. Mail-app delivery uses BCC.</span>
              </div>
            </div>

            <aside className={styles.emailPreviewPane}>
              <div className={styles.emailPreviewLabel}>Branded email preview</div>
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
              <button type="button" onClick={() => void copyBccList()} disabled={sending || !recipientEmails.length}>
                {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "BCC copied" : "Copy BCC"}
              </button>
              <button type="button" onClick={openMailApp} disabled={sending || !recipientEmails.length}>
                <Mail size={16} /> Open in Mail app
              </button>
            </div>
            <button
              type="button"
              className={styles.emailSendButton}
              onClick={() => void sendBrandedEmail()}
              disabled={sending || processingPhotos || !recipientEmails.length || brandedRecipientLimitExceeded}
            >
              {sending ? <LoaderCircle size={17} className={styles.spin} /> : <Send size={17} />}
              {sending ? "Sending private emails…" : `Send branded email to ${recipientEmails.length}`}
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
