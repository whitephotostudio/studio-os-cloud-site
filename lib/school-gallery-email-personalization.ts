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
