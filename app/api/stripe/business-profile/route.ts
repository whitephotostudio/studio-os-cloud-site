import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { configureConnectBusinessProfile, getOrCreatePhotographerByUser } from "@/lib/payments";
import { ConnectProfileError } from "@/lib/stripe-connect-country";

export async function POST(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user) return NextResponse.json({ ok: false, message: "Please sign in again before saving your payment profile." }, { status: 401 });
    if (mfaSatisfied === false) return NextResponse.json({ ok: false, message: "Complete two-factor sign-in before saving your payment profile." }, { status: 403 });
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectProfileError("Unable to read your payment profile.");
    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    const profile = await configureConnectBusinessProfile(service, photographer, body);
    return NextResponse.json({ ok: true, ...profile });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof ConnectProfileError ? error.message : "Unable to save your payment profile. Try again before connecting Stripe." },
      { status: error instanceof ConnectProfileError ? error.status : 500 });
  }
}
