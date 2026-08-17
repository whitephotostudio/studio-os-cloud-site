export type StudioBookingDaySummary = {
  date: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  booked: number;
  remaining: number;
  slotCount: number;
};

export type StudioBookingEventSummary = {
  id: string;
  name: string;
  kind: "school" | "event";
  enabled: boolean;
  sourceStatus: string | null;
  timezone: string;
  slotMinutes: number;
  requirePayment: boolean;
  sittingFeeCents: number;
  currency: string;
  includesDigitalImages: boolean;
  capacity: number;
  booked: number;
  remaining: number;
  cancelled: number;
  totalRecords: number;
  percentFilled: number;
  paidBookings: number;
  failedPayments: number;
  revenueCents: number;
  firstSlotAt: string | null;
  lastSlotAt: string | null;
  lastBookingAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  days: StudioBookingDaySummary[];
  publicUrl: string;
};

export type StudioBookingsOverview = {
  ok: true;
  checkedAt: string;
  totals: {
    bookingLinks: number;
    activeLinks: number;
    inactiveLinks: number;
    capacity: number;
    booked: number;
    remaining: number;
    cancelled: number;
    paidBookings: number;
    revenueCents: number;
    currency: string;
  };
  events: StudioBookingEventSummary[];
};

export type StudioBookingRecord = {
  id: string;
  slotId: string | null;
  status: string;
  studentName: string;
  className: string | null;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  notes: string | null;
  consentRecordedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  paymentStatus: string;
  paymentAmountCents: number;
  paymentCurrency: string;
};

export type StudioBookingSlot = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  capacity: number;
  bookedCount: number;
};

export type StudioBookingStudioDetails = {
  businessName: string;
  logoUrl: string | null;
  brandColor: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type StudioBookingScheduleDetails = {
  location: string | null;
  address: string | null;
  notes: string | null;
};

export type StudioBookingDetail = {
  ok: true;
  checkedAt: string;
  event: StudioBookingEventSummary;
  studio: StudioBookingStudioDetails;
  schedule: StudioBookingScheduleDetails;
  slots: StudioBookingSlot[];
  bookings: StudioBookingRecord[];
};
