export type SchoolGalleryBookingEmailRow = {
  id?: string | null;
  student_id?: string | null;
  parent_email?: string | null;
  access_pin?: string | null;
  student_first_name?: string | null;
  student_last_name?: string | null;
  class_name?: string | null;
  status?: string | null;
};

export type SchoolGalleryRosterStudentRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  pin?: string | null;
  parent_email?: string | null;
  class_name?: string | null;
  role?: string | null;
  photo_url?: string | null;
};

export type SchoolGalleryEmailDelivery = {
  recipientEmail: string;
  bookingId: string | null;
  studentId?: string;
  studentName: string;
  studentPin: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export type SchoolStudentEmailContact = { student_id: string; email: string };
export type SchoolPreReleaseRegistration = { email: string; class_names?: string[] | null };

/** Class selection is applied to student identities BEFORE email expansion.
 * Shared family addresses must never pull a sibling from an unselected class
 * into the delivery. Email-only school registrations are not identity proof.
 */
export function buildSchoolClassEmailAudience(params: {
  students: SchoolGalleryRosterStudentRow[];
  bookings: SchoolGalleryBookingEmailRow[];
  contacts: SchoolStudentEmailContact[];
  visitorEmails: string[];
  prereleaseRegistrations?: SchoolPreReleaseRegistration[];
  classNames: string[];
  onlyWithPhotos: boolean;
}) {
  const roster = params.students.filter((s) => !clean(s.role) || clean(s.role).toLowerCase() === "student");
  const studentsByPin = new Map<string, SchoolGalleryRosterStudentRow[]>();
  for (const student of roster) {
    const pin = clean(student.pin);
    if (pin) studentsByPin.set(pin, [...(studentsByPin.get(pin) ?? []), student]);
  }
  const contactsByStudent = new Map<string, string[]>();
  for (const contact of params.contacts) {
    contactsByStudent.set(contact.student_id, [...(contactsByStudent.get(contact.student_id) ?? []), contact.email]);
  }
  const rows = [
    ...params.bookings,
    ...buildIndependentRosterEmailRows(roster, params.bookings),
  ].map((row) => {
    const matches = studentsByPin.get(clean(row.access_pin)) ?? [];
    const student = matches.length === 1 ? matches[0] : undefined;
    const activeBookings = params.bookings.filter((b) => clean(b.access_pin) === clean(row.access_pin) && !isCancelled(b.status));
    return {
      ...row,
      student_id: student?.id || row.student_id,
      class_name: student ? clean(student.class_name) : clean(row.class_name),
      hasPhoto: Boolean(clean(student?.photo_url)),
      ambiguous: matches.length > 1 || activeBookings.length > 1,
      emails: Array.from(new Set([row.parent_email, ...(student ? contactsByStudent.get(student.id) ?? [] : [])]
        .map(normalizedEmail).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))),
    };
  });
  const classOptions = Array.from(new Set(rows.map((r) => clean(r.class_name)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const selected = new Set(params.classNames.map(clean).filter(Boolean));
  const unknownClasses = [...selected].filter((name) => !classOptions.includes(name));
  const selectedRows = rows.filter((r) => selected.has(clean(r.class_name)));
  const knownEmails = new Set(rows.flatMap((r) => r.emails));
  const unlinkedRegistrations = (params.prereleaseRegistrations ?? []).filter((registration) =>
    !knownEmails.has(normalizedEmail(registration.email)) &&
    (registration.class_names ?? []).some((name) => selected.has(clean(name))),
  ).length;
  const summary = {
    selectedStudents: selectedRows.filter((r) => !isCancelled(r.status)).length,
    missingEmail: 0, missingPin: 0, withoutPhotos: 0, ambiguous: 0,
    cancelledExcluded: 0,
    unlinkedRegistrations,
  };
  const deliveries: (SchoolGalleryEmailDelivery & { className: string })[] = [];
  const review: { studentName: string; className: string; emails: string[]; reason: string }[] = [];
  const seen = new Set<string>();
  for (const row of selectedRows) {
    const studentName = [clean(row.student_first_name), clean(row.student_last_name)].filter(Boolean).join(" ") || "Student";
    let reason = "Included";
    if (isCancelled(row.status)) { reason = "Cancelled booking"; }
    else if (row.ambiguous) { reason = "Conflicting student PIN records"; }
    else if (!clean(row.access_pin)) { reason = "Missing PIN"; }
    else if (!row.emails.length) { reason = "No linked email"; }
    else if (params.onlyWithPhotos && !row.hasPhoto) { reason = "No uploaded photo"; }
    if (reason === "Cancelled booking") summary.cancelledExcluded++;
    else if (reason === "Conflicting student PIN records") summary.ambiguous++;
    else if (reason === "Missing PIN") summary.missingPin++;
    else if (reason === "No linked email") summary.missingEmail++;
    else if (reason === "No uploaded photo") summary.withoutPhotos++;
    review.push({ studentName, className: clean(row.class_name), emails: row.emails, reason });
    if (reason !== "Included") continue;
    for (const recipientEmail of row.emails) {
      const key = `${recipientEmail}\u0000${clean(row.access_pin)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deliveries.push({
        recipientEmail, bookingId: clean(row.id) || null,
        ...(row.student_id ? { studentId: row.student_id } : {}),
        studentName, studentPin: clean(row.access_pin), className: clean(row.class_name),
      });
    }
  }
  const readySelectedClasses = new Set(
    selectedRows.filter((row) => row.hasPhoto && !isCancelled(row.status)).map((row) => clean(row.class_name)),
  );
  const linkedEmails = new Set(deliveries.map((delivery) => delivery.recipientEmail));
  for (const registration of params.prereleaseRegistrations ?? []) {
    const email = normalizedEmail(registration.email);
    const matchesSelectedClass = (registration.class_names ?? []).some((name) => selected.has(clean(name)));
    const hasReadyPhoto = !params.onlyWithPhotos || (registration.class_names ?? []).some((name) => readySelectedClasses.has(clean(name)));
    if (!email || !matchesSelectedClass || !hasReadyPhoto || linkedEmails.has(email)) continue;
    linkedEmails.add(email);
    const matchedClass = (registration.class_names ?? []).find((name) => selected.has(clean(name))) ?? "";
    deliveries.push({ recipientEmail: email, bookingId: null, studentName: "", studentPin: "", className: clean(matchedClass) });
  }
  return { deliveries, classOptions, unknownClasses, review, summary };
}

function normalizedEmail(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function isCancelled(status: string | null | undefined) {
  const value = clean(status).toLowerCase();
  return value === "cancelled" || value === "canceled";
}

/**
 * Converts only non-booking roster students (such as on-site walk-ins) into
 * private email candidates. A booking with the same PIN remains authoritative,
 * including when it was cancelled, so a synced duplicate cannot bypass the
 * booking's status or registered recipient.
 */
export function buildIndependentRosterEmailRows(
  students: SchoolGalleryRosterStudentRow[],
  bookings: SchoolGalleryBookingEmailRow[],
): SchoolGalleryBookingEmailRow[] {
  const bookedPins = new Set(
    bookings.map((row) => clean(row.access_pin)).filter(Boolean),
  );
  return students
    .filter((student) => {
      const role = clean(student.role).toLowerCase();
      if (role && role !== "student") return false;
      const pin = clean(student.pin);
      return !pin || !bookedPins.has(pin);
    })
    .map((student) => ({
      id: null,
      student_id: student.id,
      parent_email: student.parent_email,
      access_pin: student.pin,
      student_first_name: student.first_name,
      student_last_name: student.last_name,
      class_name: student.class_name,
      status: "manual",
    }));
}

/**
 * Removes campaign contacts that only belong to cancelled bookings. A shared
 * parent email is kept when it also belongs to any active booking, so the
 * active student's personalized email is never suppressed.
 */
export function excludeCancelledOnlyRecipientEmails(
  recipientEmails: string[],
  bookings: SchoolGalleryBookingEmailRow[],
) {
  const activeBookingEmails = new Set<string>();
  const cancelledBookingEmails = new Set<string>();

  for (const booking of bookings) {
    const email = normalizedEmail(booking.parent_email);
    if (!email) continue;
    if (isCancelled(booking.status)) {
      cancelledBookingEmails.add(email);
    } else {
      activeBookingEmails.add(email);
    }
  }

  return Array.from(
    new Set(recipientEmails.map(normalizedEmail).filter(Boolean)),
  ).filter(
    (email) =>
      activeBookingEmails.has(email) || !cancelledBookingEmails.has(email),
  );
}

/**
 * Expands visitor recipients into privacy-safe deliveries. A parent with two
 * active student bookings receives two separate emails; each delivery carries
 * only one student's name and PIN. Recipients without a matching booking keep
 * receiving the ordinary gallery email.
 */
export function buildSchoolGalleryEmailDeliveries(
  recipientEmails: string[],
  bookings: SchoolGalleryBookingEmailRow[],
  personalizeStudentPins: boolean,
): SchoolGalleryEmailDelivery[] {
  const uniqueRecipients = Array.from(
    new Set(recipientEmails.map(normalizedEmail).filter(Boolean)),
  );
  if (!personalizeStudentPins) {
    return uniqueRecipients.map((recipientEmail) => ({
      recipientEmail,
      bookingId: null,
      studentName: "",
      studentPin: "",
    }));
  }

  const bookingsByEmail = new Map<string, SchoolGalleryBookingEmailRow[]>();
  for (const booking of bookings) {
    if (isCancelled(booking.status)) continue;
    const email = normalizedEmail(booking.parent_email);
    const pin = clean(booking.access_pin);
    if (!email || !pin) continue;
    const rows = bookingsByEmail.get(email) ?? [];
    rows.push(booking);
    bookingsByEmail.set(email, rows);
  }

  const deliveries: SchoolGalleryEmailDelivery[] = [];
  for (const recipientEmail of uniqueRecipients) {
    const matchingBookings = bookingsByEmail.get(recipientEmail) ?? [];
    const seenPins = new Set<string>();
    for (const booking of matchingBookings) {
      const studentPin = clean(booking.access_pin);
      if (seenPins.has(studentPin)) continue;
      seenPins.add(studentPin);
      const studentName = [
        clean(booking.student_first_name),
        clean(booking.student_last_name),
      ].filter(Boolean).join(" ");
      deliveries.push({
        recipientEmail,
        bookingId: clean(booking.id) || null,
        ...(clean(booking.student_id)
          ? { studentId: clean(booking.student_id) }
          : {}),
        studentName,
        studentPin,
      });
    }
    if (matchingBookings.length === 0) {
      deliveries.push({
        recipientEmail,
        bookingId: null,
        studentName: "",
        studentPin: "",
      });
    }
  }
  return deliveries;
}
