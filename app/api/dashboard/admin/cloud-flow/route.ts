import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import {
  getFounding100MarketingReport,
  getOwnerActivityReport,
  getOwnerNotificationDiagnostics,
} from "@/lib/admin-notification-center";
import {
  ageInMilliseconds,
  summarizeCloudFlow,
  type CloudFlowCard,
} from "@/lib/cloud-flow";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { getR2Client, hasR2Config, R2_BUCKET } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 24 * 60 * 60 * 1000;
const FOUNDING_100_STARTED_AT = "2026-07-28T00:00:00-04:00";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asTime(value: unknown): string | null {
  const text = clean(value);
  if (!text || Number.isNaN(new Date(text).getTime())) return null;
  return new Date(text).toISOString();
}

function newest(values: Array<string | null | undefined>): string | null {
  let newestValue: string | null = null;
  let newestTime = -1;
  for (const value of values) {
    const normalized = asTime(value);
    if (!normalized) continue;
    const time = new Date(normalized).getTime();
    if (time > newestTime) {
      newestTime = time;
      newestValue = normalized;
    }
  }
  return newestValue;
}

function money(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function safeJwtAal(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as {
      aal?: unknown;
    };
    return clean(decoded.aal) || null;
  } catch {
    return null;
  }
}

function card(
  checkedAt: string,
  input: Omit<CloudFlowCard, "checkedAt">,
): CloudFlowCard {
  return { ...input, checkedAt };
}

async function runCheck(
  id: string,
  checkedAt: string,
  check: () => Promise<CloudFlowCard>,
): Promise<CloudFlowCard> {
  try {
    return await check();
  } catch (error) {
    console.error(`[cloud-flow:${id}]`, error);
    return card(checkedAt, {
      id,
      title: id
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      category: "infrastructure",
      status: "critical",
      summary: "The automated check could not complete.",
      detail: "No customer data was changed. Refresh once; if it stays red, investigate this service.",
      metric: "Check failed",
      metricLabel: "read-only monitor",
      lastActivity: null,
    });
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 7_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "StudioOSCloudFlow/1.0" },
    });
    return { response, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function loadFounding100Report(
  service: ReturnType<typeof createDashboardServiceClient>,
) {
  const marketing = await getFounding100MarketingReport();
  try {
    const { data: authData, error: authError } = await service.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (authError) throw authError;
    const campaignUsers = (authData.users ?? []).filter(
      (candidate) => clean(candidate.user_metadata?.campaign_source) === "founding-100",
    );
    const campaignUserIds = campaignUsers.map((candidate) => candidate.id).filter(Boolean);

    const photographerResult = campaignUserIds.length
      ? await service
          .from("photographers")
          .select("id,user_id,subscription_status,trial_ends_at")
          .in("user_id", campaignUserIds)
      : { data: [], error: null };
    if (photographerResult.error) throw photographerResult.error;
    const campaignPhotographers = photographerResult.data ?? [];
    const photographerIds = campaignPhotographers.map((row) => clean(row.id)).filter(Boolean);
    const userIdByPhotographerId = new Map(
      campaignPhotographers.map((row) => [clean(row.id), clean(row.user_id)]),
    );

    const [schoolResult, projectResult, deviceResult] = await Promise.all([
      photographerIds.length
        ? service.from("schools").select("photographer_id").in("photographer_id", photographerIds)
        : Promise.resolve({ data: [], error: null }),
      photographerIds.length
        ? service.from("projects").select("photographer_id").in("photographer_id", photographerIds)
        : Promise.resolve({ data: [], error: null }),
      campaignUserIds.length
        ? service
            .from("desktop_app_device_registrations")
            .select("user_id")
            .in("user_id", campaignUserIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (schoolResult.error) throw schoolResult.error;
    if (projectResult.error) throw projectResult.error;
    if (deviceResult.error) throw deviceResult.error;

    const activatedUserIds = new Set<string>();
    for (const row of [...(schoolResult.data ?? []), ...(projectResult.data ?? [])]) {
      const userId = userIdByPhotographerId.get(clean(row.photographer_id));
      if (userId) activatedUserIds.add(userId);
    }
    for (const row of deviceResult.data ?? []) {
      const userId = clean(row.user_id);
      if (userId) activatedUserIds.add(userId);
    }

    const paid = campaignPhotographers.filter(
      (row) => clean(row.subscription_status).toLowerCase() === "active",
    ).length;
    const now = Date.now();
    const activeTrials = campaignPhotographers.filter((row) => {
      const trialEndsAt = asTime(row.trial_ends_at);
      return trialEndsAt ? new Date(trialEndsAt).getTime() > now : false;
    }).length;
    const registrations = Math.max(campaignUsers.length, marketing.trackedSignups);
    const activated = activatedUserIds.size;

    return {
      goal: 100 as const,
      startedAt: FOUNDING_100_STARTED_AT,
      visitors: marketing.visitors,
      trialClicks: marketing.trialClicks,
      demoClicks: marketing.demoClicks,
      registrations,
      activeTrials,
      activated,
      paid,
      progressPercent: Math.min(100, activated),
      activationRate: registrations > 0 ? Math.round((activated / registrations) * 100) : 0,
      trackingMode: marketing.trackingMode,
    };
  } catch (error) {
    console.error("[cloud-flow:founding-100]", error);
    return {
      goal: 100 as const,
      startedAt: FOUNDING_100_STARTED_AT,
      visitors: marketing.visitors,
      trialClicks: marketing.trialClicks,
      demoClicks: marketing.demoClicks,
      registrations: marketing.trackedSignups,
      activeTrials: 0,
      activated: 0,
      paid: 0,
      progressPercent: 0,
      activationRate: 0,
      trackingMode: marketing.trackingMode,
    };
  }
}

export async function GET(request: NextRequest) {
  const checkedAt = new Date().toISOString();

  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return NextResponse.json(
        { ok: false, message: "Only the Studio OS Cloud owner can view Cloud Flow." },
        { status: 403 },
      );
    }

    const [{ data: schoolRows, error: schoolError }, { data: projectRows, error: projectError }] =
      await Promise.all([
        service.from("schools").select("id").eq("photographer_id", photographer.id),
        service.from("projects").select("id").eq("photographer_id", photographer.id),
      ]);
    if (schoolError) throw schoolError;
    if (projectError) throw projectError;
    const schoolIds = (schoolRows ?? []).map((row) => clean(row.id)).filter(Boolean);
    const projectIds = (projectRows ?? []).map((row) => clean(row.id)).filter(Boolean);
    const founding100 = await loadFounding100Report(service);

    const cards = await Promise.all([
      runCheck("public-website", checkedAt, async () => {
        const configuredBase =
          clean(process.env.NEXT_PUBLIC_SITE_URL) || "https://www.studiooscloud.com";
        const origin = (configuredBase.startsWith("http")
          ? configuredBase
          : `https://${configuredBase}`
        ).replace(/\/$/, "");
        const [home, bookingPage] = await Promise.all([
          fetchWithTimeout(`${origin}/`),
          fetchWithTimeout(`${origin}/book`),
        ]);
        const healthy = home.response.ok && bookingPage.response.ok;
        const latency = Math.max(home.latencyMs, bookingPage.latencyMs);
        return card(checkedAt, {
          id: "public-website",
          title: "Website & booking page",
          category: "infrastructure",
          status: healthy ? "healthy" : "critical",
          summary: healthy
            ? "The public website and booking page are reachable."
            : "A public page returned an error.",
          detail: `Read-only HTTP checks returned ${home.response.status} and ${bookingPage.response.status}.`,
          metric: healthy ? "Online" : "Attention",
          metricLabel: `${latency} ms slowest response`,
          lastActivity: checkedAt,
          href: "/book",
        });
      }),

      runCheck("cloud-database", checkedAt, async () => {
        const [{ count: studentCount, error: studentsError }, { count: orderCount, error: ordersError }] =
          await Promise.all([
            schoolIds.length
              ? service
                  .from("students")
                  .select("id", { count: "exact", head: true })
                  .in("school_id", schoolIds)
              : Promise.resolve({ count: 0, error: null }),
            service
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("photographer_id", photographer.id),
          ]);
        if (studentsError) throw studentsError;
        if (ordersError) throw ordersError;
        return card(checkedAt, {
          id: "cloud-database",
          title: "Supabase cloud database",
          category: "infrastructure",
          status: "healthy",
          summary: "The production database is responding to owner-scoped reads.",
          detail: `${schoolIds.length} schools, ${studentCount ?? 0} roster records, and ${orderCount ?? 0} orders are reachable.`,
          metric: "Connected",
          metricLabel: "production data reachable",
          lastActivity: checkedAt,
        });
      }),

      runCheck("online-booking", checkedAt, async () => {
        const [{ data: events, error: eventsError }, { data: bookings, error: bookingsError }] =
          await Promise.all([
            service
              .from("booking_events")
              .select("id,enabled,created_at,updated_at")
              .eq("photographer_id", photographer.id),
            service
              .from("bookings")
              .select("id,status,created_at,updated_at")
              .eq("photographer_id", photographer.id),
          ]);
        if (eventsError) throw eventsError;
        if (bookingsError) throw bookingsError;
        const eventRows = events ?? [];
        const bookingRows = bookings ?? [];
        const enabledEvents = eventRows.filter((row) => row.enabled === true);
        const active = bookingRows.filter((row) => clean(row.status).toLowerCase() !== "cancelled");
        const cancelled = bookingRows.length - active.length;
        const recent = active.filter((row) => {
          const value = asTime(row.created_at);
          return value ? Date.now() - new Date(value).getTime() <= 30 * DAY : false;
        }).length;
        let endpointHealthy = enabledEvents.length === 0;
        let availabilityDetail = "No enabled booking event is available for a live probe.";
        if (enabledEvents.length > 0) {
          const base = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
          const probe = await fetchWithTimeout(
            `${base}/functions/v1/booking-availability?event=${encodeURIComponent(clean(enabledEvents[0].id))}`,
          );
          const payload = (await probe.response.json().catch(() => ({}))) as {
            event?: unknown;
            slots?: unknown;
            takenSlots?: unknown;
          };
          endpointHealthy = probe.response.ok && Boolean(payload.event);
          availabilityDetail = endpointHealthy
            ? `The public availability API answered in ${probe.latencyMs} ms.`
            : `The public availability API returned ${probe.response.status}.`;
        }
        const status = !enabledEvents.length
          ? "warning"
          : endpointHealthy
            ? "healthy"
            : "critical";
        return card(checkedAt, {
          id: "online-booking",
          title: "Online booking",
          category: "customer-flow",
          status,
          summary:
            status === "healthy"
              ? "Students can reach live availability and confirmed bookings are recording."
              : status === "warning"
                ? "The booking system is reachable, but no booking event is enabled."
                : "The public booking availability check failed.",
          detail: `${availabilityDetail} ${active.length} active and ${cancelled} cancelled bookings are recorded.`,
          metric: `${active.length} active`,
          metricLabel: `${recent} booked in the last 30 days`,
          lastActivity: newest(active.map((row) => asTime(row.created_at))),
          href: "/dashboard/admin/bookings",
        });
      }),

      runCheck("online-payments", checkedAt, async () => {
        const [profileResult, bookingPaymentsResult, orderPaymentsResult] = await Promise.all([
          service
            .from("photographers")
            .select("stripe_connect_charges_enabled,stripe_connect_payouts_enabled")
            .eq("id", photographer.id)
            .maybeSingle(),
          service
            .from("booking_payments")
            .select("status,amount_cents,currency,created_at")
            .eq("photographer_id", photographer.id),
          service
            .from("orders")
            .select("payment_status,paid_at,total_cents,currency,created_at,is_test")
            .eq("photographer_id", photographer.id),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (bookingPaymentsResult.error) throw bookingPaymentsResult.error;
        if (orderPaymentsResult.error) throw orderPaymentsResult.error;
        const bookingPayments = bookingPaymentsResult.data ?? [];
        const orderPayments = (orderPaymentsResult.data ?? []).filter((row) => row.is_test !== true);
        const succeededBookings = bookingPayments.filter(
          (row) => clean(row.status).toLowerCase() === "succeeded",
        );
        const failedBookings = bookingPayments.filter((row) =>
          ["failed", "canceled", "cancelled"].includes(clean(row.status).toLowerCase()),
        );
        const paidOrders = orderPayments.filter((row) => {
          const paymentStatus = clean(row.payment_status).toLowerCase();
          return Boolean(row.paid_at) || ["paid", "succeeded", "digital_paid"].includes(paymentStatus);
        });
        const chargesEnabled = profileResult.data?.stripe_connect_charges_enabled === true;
        const platformConfigured = Boolean(clean(process.env.STRIPE_SECRET_KEY));
        const status = chargesEnabled && platformConfigured ? "healthy" : "critical";
        const bookingRevenue = succeededBookings.reduce(
          (sum, row) => sum + Number(row.amount_cents ?? 0),
          0,
        );
        return card(checkedAt, {
          id: "online-payments",
          title: "Online payments",
          category: "customer-flow",
          status,
          summary:
            status === "healthy"
              ? "Stripe payment collection is configured and charges are enabled."
              : "Stripe is not fully ready to accept new online charges.",
          detail: `${succeededBookings.length} successful booking payments, ${failedBookings.length} failed or cancelled attempts, and ${paidOrders.length} paid photo orders are recorded.`,
          metric: money(bookingRevenue, clean(succeededBookings[0]?.currency) || "CAD"),
          metricLabel: "successful booking fees recorded",
          lastActivity: newest([
            ...succeededBookings.map((row) => asTime(row.created_at)),
            ...paidOrders.map((row) => asTime(row.paid_at ?? row.created_at)),
          ]),
          href: "/dashboard/orders",
        });
      }),

      runCheck("customer-orders", checkedAt, async () => {
        const { data, error } = await service
          .from("orders")
          .select("status,payment_status,paid_at,created_at,is_test")
          .eq("photographer_id", photographer.id);
        if (error) throw error;
        const rows = (data ?? []).filter((row) => row.is_test !== true);
        const paid = rows.filter((row) => {
          const paymentStatus = clean(row.payment_status).toLowerCase();
          return Boolean(row.paid_at) || ["paid", "succeeded", "digital_paid"].includes(paymentStatus);
        });
        const pending = rows.filter((row) => {
          const status = clean(row.status).toLowerCase();
          const paymentStatus = clean(row.payment_status).toLowerCase();
          return ["pending", "payment_pending", "unpaid"].includes(status) ||
            ["pending", "unpaid", "requires_payment"].includes(paymentStatus);
        });
        const recent = rows.filter((row) => {
          const value = asTime(row.created_at);
          return value ? Date.now() - new Date(value).getTime() <= 30 * DAY : false;
        }).length;
        return card(checkedAt, {
          id: "customer-orders",
          title: "Customer orders",
          category: "customer-flow",
          status: "healthy",
          summary: "The owner order pipeline is readable and new orders can be tracked.",
          detail: `${paid.length} paid orders and ${pending.length} open or abandoned checkouts are recorded. Pending does not automatically mean a fault.`,
          metric: `${rows.length} orders`,
          metricLabel: `${recent} created in the last 30 days`,
          lastActivity: newest(rows.map((row) => asTime(row.created_at))),
          href: "/dashboard/orders",
        });
      }),

      runCheck("gallery-downloads", checkedAt, async () => {
        const since = new Date(Date.now() - 30 * DAY).toISOString();
        const [schoolResult, eventResult] = await Promise.all([
          schoolIds.length
            ? service
                .from("school_gallery_downloads")
                .select("download_count,created_at")
                .in("school_id", schoolIds)
            : Promise.resolve({ data: [], error: null }),
          projectIds.length
            ? service
                .from("event_gallery_downloads")
                .select("download_count,created_at")
                .in("project_id", projectIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (schoolResult.error) throw schoolResult.error;
        if (eventResult.error) throw eventResult.error;
        const rows = [...(schoolResult.data ?? []), ...(eventResult.data ?? [])];
        const recent = rows.filter((row) => clean(row.created_at) >= since);
        const files = recent.reduce((sum, row) => sum + Number(row.download_count ?? 0), 0);
        return card(checkedAt, {
          id: "gallery-downloads",
          title: "Client gallery downloads",
          category: "customer-flow",
          status: "healthy",
          summary: "Download activity is recording for school and event galleries.",
          detail:
            recent.length > 0
              ? `${recent.length} download sessions delivered ${files} file downloads in the last 30 days.`
              : "The download records are reachable. No download was recorded in the last 30 days.",
          metric: `${files} files`,
          metricLabel: "downloaded in the last 30 days",
          lastActivity: newest(rows.map((row) => asTime(row.created_at))),
          href: "/dashboard/gallery-activity",
        });
      }),

      runCheck("private-storage", checkedAt, async () => {
        if (!hasR2Config()) {
          return card(checkedAt, {
            id: "private-storage",
            title: "Private photo storage",
            category: "infrastructure",
            status: "critical",
            summary: "Cloudflare R2 credentials are not configured in this environment.",
            detail: "The monitor did not attempt to read any photo object.",
            metric: "Not configured",
            metricLabel: "private R2 bucket",
            lastActivity: null,
          });
        }
        const result = await getR2Client().send(
          new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 1 }),
        );
        return card(checkedAt, {
          id: "private-storage",
          title: "Private photo storage",
          category: "infrastructure",
          status: "healthy",
          summary: "The private Cloudflare R2 bucket is reachable from the server.",
          detail: "The check listed at most one object and returned no filename, photo, or private URL to the browser.",
          metric: result.KeyCount && result.KeyCount > 0 ? "Connected" : "Empty but online",
          metricLabel: "private bucket access",
          lastActivity: checkedAt,
        });
      }),

      runCheck("desktop-sync", checkedAt, async () => {
        const [deviceResult, snapshotResult] = await Promise.all([
          service
            .from("desktop_app_device_registrations")
            .select("last_seen_at,app_version")
            .eq("user_id", user.id)
            .is("released_at", null)
            .order("last_seen_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          schoolIds.length
            ? service
                .from("school_roster_snapshots")
                .select("created_at,student_count,source")
                .in("school_id", schoolIds)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (deviceResult.error) throw deviceResult.error;
        if (snapshotResult.error) throw snapshotResult.error;
        const lastSeen = asTime(deviceResult.data?.last_seen_at);
        const snapshotAt = asTime(snapshotResult.data?.created_at);
        const deviceAge = ageInMilliseconds(lastSeen);
        const snapshotAge = ageInMilliseconds(snapshotAt);
        const recentlySeen = deviceAge !== null && deviceAge <= 7 * DAY;
        const recentRosterSync = snapshotAge !== null && snapshotAge <= 30 * DAY;
        const hasRecentSyncEvidence = recentlySeen || recentRosterSync;
        return card(checkedAt, {
          id: "desktop-sync",
          title: "Desktop app & roster sync",
          category: "customer-flow",
          status: hasRecentSyncEvidence ? "healthy" : "warning",
          summary: recentlySeen
            ? "An active Studio OS desktop device checked in recently."
            : recentRosterSync
              ? "Recent roster activity proves the desktop-to-cloud handoff is working."
              : "No recent device check-in or roster sync evidence was found.",
          detail: snapshotResult.data
            ? `Latest cloud roster snapshot contains ${Number(snapshotResult.data.student_count ?? 0)} students. App version ${clean(deviceResult.data?.app_version) || "not reported"}.`
            : `No roster snapshot is recorded yet. App version ${clean(deviceResult.data?.app_version) || "not reported"}.`,
          metric: hasRecentSyncEvidence ? "Connected" : "Review",
          metricLabel: "desktop-to-cloud evidence",
          lastActivity: newest([lastSeen, snapshotAt]),
          href: "/dashboard/schools",
        });
      }),

      runCheck("site-traffic", checkedAt, async () => {
        const [report, diagnostics] = await Promise.all([
          getOwnerActivityReport(500),
          getOwnerNotificationDiagnostics(),
        ]);
        const storeHealthy = diagnostics.store.redisAvailable;
        return card(checkedAt, {
          id: "site-traffic",
          title: "Website traffic",
          category: "infrastructure",
          status: storeHealthy ? "healthy" : "warning",
          summary: storeHealthy
            ? "Privacy-limited website activity tracking is recording in Redis."
            : "Traffic tracking is using temporary memory instead of Redis.",
          detail: `${report.totals.pageViewsLast24Hours} public page views and ${report.totals.highIntentLast24Hours} high-intent visits were recorded in the last 24 hours.`,
          metric: `${report.totals.pageViewsLast24Hours} views`,
          metricLabel: "last 24 hours",
          lastActivity: newest(report.activities.map((activity) => activity.receivedAt)),
          href: "/dashboard/admin/notifications",
        });
      }),

      runCheck("owner-alerts", checkedAt, async () => {
        const diagnostics = await getOwnerNotificationDiagnostics();
        const ready = diagnostics.configured && !diagnostics.disabledByEnv;
        return card(checkedAt, {
          id: "owner-alerts",
          title: "Owner notifications",
          category: "infrastructure",
          status: ready ? "healthy" : "warning",
          summary: ready
            ? "Owner alert credentials are configured."
            : "Owner alerts are disabled or not fully configured.",
          detail: diagnostics.store.redisAvailable
            ? "Notification settings and activity deduplication are stored in Redis."
            : "Notification settings are currently relying on temporary memory.",
          metric: ready ? "Ready" : "Review",
          metricLabel: "owner alert channel",
          lastActivity: checkedAt,
          href: "/dashboard/admin/notifications",
        });
      }),

      runCheck("account-security", checkedAt, async () => {
        const { data, error } = await service.auth.admin.getUserById(user.id);
        if (error) throw error;
        const factors = ((data.user as unknown as { factors?: Array<{ status?: string }> })
          .factors ?? []);
        const verifiedFactors = factors.filter((factor) => factor.status === "verified").length;
        const aal = safeJwtAal(request);
        const secure = verifiedFactors > 0 && (aal === "aal2" || aal === null);
        return card(checkedAt, {
          id: "account-security",
          title: "Owner account security",
          category: "security-recovery",
          status: secure ? "healthy" : "critical",
          summary: secure
            ? "A verified authenticator protects the owner account."
            : "The owner account is missing a verified MFA factor or an MFA session.",
          detail: `${verifiedFactors} verified authenticator factor${verifiedFactors === 1 ? "" : "s"}. Current session assurance: ${aal ?? "server cookie session"}.`,
          metric: secure ? "Protected" : "Attention",
          metricLabel: "owner-only access",
          lastActivity: checkedAt,
          href: "/dashboard/settings",
        });
      }),

      Promise.resolve(
        card(checkedAt, {
          id: "backups",
          title: "Backups & recovery",
          category: "security-recovery",
          status: "manual",
          summary: "Backups exist, but a cloud page cannot verify a disconnected drive automatically.",
          detail: "Cloud/Supabase backup was verified July 22. A pre-change Cloud Flow rollback was copied to the Mac and external drive July 24. Recheck after major changes.",
          metric: "Manual check",
          metricLabel: "last verified July 24, 2026",
          lastActivity: "2026-07-24T20:12:00-04:00",
        }),
      ),
    ]);

    const summary = summarizeCloudFlow(cards);
    return NextResponse.json(
      {
        ok: true,
        checkedAt,
        environment: clean(process.env.VERCEL_ENV) || process.env.NODE_ENV || "unknown",
        deployment:
          clean(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 8) ||
          clean(process.env.VERCEL_DEPLOYMENT_ID) ||
          null,
        summary,
        cards,
        founding100,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error("[cloud-flow]", error);
    return NextResponse.json(
      { ok: false, message: "Cloud Flow could not load safely. No data was changed." },
      { status: 500 },
    );
  }
}
