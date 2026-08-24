export type SchoolGalleryBookingEmailRow = {
  id?: string | null;
  parent_email?: string | null;
  student_first_name?: string | null;
  student_last_name?: string | null;
  class_name?: string | null;
  status?: string | null;
};

export type SchoolGalleryStudentEmailRow = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  class_name?: string | null;
  pin?: string | null;
  parent_email?: string | null;
};

export type SchoolGalleryMatchedBookingEmailRow =
  SchoolGalleryBookingEmailRow & {
    student_id: string;
    access_pin: string;
    roster_parent_email: string;
  };

export type SchoolGalleryEmailDelivery = {
  recipientEmail: string;
  bookingId: string | null;
  studentId: string | null;
  studentName: string;
  studentPin: string;
};

export type SchoolGalleryStudentRecipientResolution = {
  recipientEmail: string;
  conflict: boolean;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedEmail(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function validNormalizedEmail(value: string | null | undefined) {
  const email = normalizedEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizedIdentity(value: string | null | undefined) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function isCancelled(status: string | null | undefined) {
  const value = clean(status).toLowerCase();
  return value === "cancelled" || value === "canceled";
}

export function isConfirmedSchoolGalleryBooking(
  status: string | null | undefined,
) {
  return clean(status).toLowerCase() === "confirmed";
}

/**
 * Resolve bookings to roster students without trusting a client- or
 * booking-supplied PIN. An exact name + class match wins when unique; an exact
 * name match is used only when that name is unique across the owned school.
 * Ambiguous or incomplete identities are intentionally left unmatched.
 */
export function matchSchoolGalleryBookingsToRoster(
  bookings: SchoolGalleryBookingEmailRow[],
  students: SchoolGalleryStudentEmailRow[],
): SchoolGalleryMatchedBookingEmailRow[] {
  const usableStudents = students.filter(
    (student) =>
      clean(student.id) &&
      normalizedIdentity(student.first_name) &&
      normalizedIdentity(student.last_name),
  );
  const matched: SchoolGalleryMatchedBookingEmailRow[] = [];

  for (const booking of bookings) {
    const firstName = normalizedIdentity(booking.student_first_name);
    const lastName = normalizedIdentity(booking.student_last_name);
    if (!firstName || !lastName) continue;

    const nameMatches = usableStudents.filter(
      (student) =>
        normalizedIdentity(student.first_name) === firstName &&
        normalizedIdentity(student.last_name) === lastName,
    );
    if (!nameMatches.length) continue;

    const bookingClass = normalizedIdentity(booking.class_name);
    const classMatches = bookingClass
      ? nameMatches.filter(
          (student) => normalizedIdentity(student.class_name) === bookingClass,
        )
      : [];
    const student =
      classMatches.length === 1
        ? classMatches[0]
        : nameMatches.length === 1
          ? nameMatches[0]
          : null;
    if (!student?.id) continue;

    matched.push({
      ...booking,
      student_id: clean(student.id),
      access_pin: clean(student.pin),
      roster_parent_email: normalizedEmail(student.parent_email),
    });
  }

  return matched;
}

export function resolveSchoolGalleryStudentRecipient(
  bookings: SchoolGalleryMatchedBookingEmailRow[],
  rosterParentEmail?: string | null,
): SchoolGalleryStudentRecipientResolution {
  const recipientEmails = new Set(
    [
      ...bookings.flatMap((booking) => [
        validNormalizedEmail(booking.parent_email),
        validNormalizedEmail(booking.roster_parent_email),
      ]),
      validNormalizedEmail(rosterParentEmail),
    ].filter(Boolean),
  );
  if (recipientEmails.size !== 1) {
    return { recipientEmail: "", conflict: recipientEmails.size > 1 };
  }
  return {
    recipientEmail: Array.from(recipientEmails)[0],
    conflict: false,
  };
}

/**
 * Removes campaign contacts that only belong to cancelled bookings. A shared
 * parent email is kept when it also belongs to any confirmed booking.
 */
export function excludeCancelledOnlyRecipientEmails(
  recipientEmails: string[],
  bookings: SchoolGalleryBookingEmailRow[],
) {
  const confirmedBookingEmails = new Set<string>();
  const cancelledBookingEmails = new Set<string>();

  for (const booking of bookings) {
    const email = normalizedEmail(booking.parent_email);
    if (!email) continue;
    if (isCancelled(booking.status)) {
      cancelledBookingEmails.add(email);
    } else if (isConfirmedSchoolGalleryBooking(booking.status)) {
      confirmedBookingEmails.add(email);
    }
  }

  return Array.from(
    new Set(recipientEmails.map(normalizedEmail).filter(Boolean)),
  ).filter(
    (email) =>
      confirmedBookingEmails.has(email) || !cancelledBookingEmails.has(email),
  );
}

/**
 * Expands recipients into privacy-isolated deliveries. A parent with two
 * matched students receives two separate messages, each containing only one
 * student's PIN. Dedupe is by normalized recipient + immutable student id,
 * never by PIN (PINs are not guaranteed unique).
 */
export function buildSchoolGalleryEmailDeliveries(
  recipientEmails: string[],
  bookings: SchoolGalleryMatchedBookingEmailRow[],
  personalizeStudentPins: boolean,
): SchoolGalleryEmailDelivery[] {
  const uniqueRecipients = Array.from(
    new Set(recipientEmails.map(normalizedEmail).filter(Boolean)),
  );
  if (!personalizeStudentPins) {
    return uniqueRecipients.map((recipientEmail) => ({
      recipientEmail,
      bookingId: null,
      studentId: null,
      studentName: "",
      studentPin: "",
    }));
  }

  const bookingsByStudent = new Map<
    string,
    SchoolGalleryMatchedBookingEmailRow[]
  >();
  for (const booking of bookings) {
    if (!isConfirmedSchoolGalleryBooking(booking.status)) continue;
    const pin = clean(booking.access_pin);
    const studentId = clean(booking.student_id);
    if (!pin || !studentId) continue;
    const rows = bookingsByStudent.get(studentId) ?? [];
    rows.push(booking);
    bookingsByStudent.set(studentId, rows);
  }

  const bookingsByEmail = new Map<
    string,
    SchoolGalleryMatchedBookingEmailRow[]
  >();
  for (const rows of bookingsByStudent.values()) {
    const resolution = resolveSchoolGalleryStudentRecipient(rows);
    // Conflicting registered addresses are intentionally left generic. The
    // photographer must resolve the roster/booking mismatch before a PIN can
    // be sent to either address.
    if (!resolution.recipientEmail) continue;
    const recipientEmail = resolution.recipientEmail;
    const representative =
      rows.find(
        (booking) =>
          validNormalizedEmail(booking.parent_email) === recipientEmail,
      ) ?? rows[0];
    const emailRows = bookingsByEmail.get(recipientEmail) ?? [];
    emailRows.push(representative);
    bookingsByEmail.set(recipientEmail, emailRows);
  }

  const deliveries: SchoolGalleryEmailDelivery[] = [];
  for (const recipientEmail of uniqueRecipients) {
    const matchingBookings = bookingsByEmail.get(recipientEmail) ?? [];
    const seenStudents = new Set<string>();
    for (const booking of matchingBookings) {
      const studentId = clean(booking.student_id);
      if (seenStudents.has(studentId)) continue;
      seenStudents.add(studentId);
      const studentName = [
        clean(booking.student_first_name),
        clean(booking.student_last_name),
      ]
        .filter(Boolean)
        .join(" ");
      deliveries.push({
        recipientEmail,
        bookingId: clean(booking.id) || null,
        studentId,
        studentName,
        studentPin: clean(booking.access_pin),
      });
    }
    if (matchingBookings.length === 0) {
      deliveries.push({
        recipientEmail,
        bookingId: null,
        studentId: null,
        studentName: "",
        studentPin: "",
      });
    }
  }
  return deliveries;
}
