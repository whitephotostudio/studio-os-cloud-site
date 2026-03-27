import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function resolveUser(request: NextRequest) {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const anonClient = createSupabaseClient(supabaseUrl, anonKey);

  if (bearer) {
    const { data } = await anonClient.auth.getUser(bearer);
    if (data.user) return data.user;
  }

  const cookieStore = await cookies();
  const serverClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const {
    data: { user },
  } = await serverClient.auth.getUser();

  return user;
}

async function stripeGetAccount(accountId: string) {
  const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` },
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.error?.message || "Unable to read Stripe account.";
    throw new Error(msg);
  }
  return json;
}

const EMPTY_PROFILE = {
  ok: false,
  signedIn: false,
  businessName: "WhitePhoto",
  studioName: "Studio OS Cloud",
  brandColor: "#0f172a",
  logoUrl: "",
  stripeAccountId: null,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingComplete: false,
  photographerId: null,
  studioId: null,
  watermarkEnabled: true,
  watermarkLogoUrl: "",
  studioAddress: "",
  studioPhone: "",
  studioEmail: "",
};

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json(
        {
          ...EMPTY_PROFILE,
          message: "Please sign in again before connecting Stripe.",
        },
        { status: 401 },
      );
    }

    const service = createSupabaseClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: photographer, error } = await service
      .from("photographers")
      .select("id, business_name, brand_color, stripe_account_id, studio_id, watermark_enabled, watermark_logo_url, studio_address, studio_phone, studio_email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    let studioName = "Studio OS Cloud";
    let logoUrl = "";

    if (photographer?.studio_id) {
      const { data: studio } = await service
        .from("studios")
        .select("id, name")
        .eq("id", photographer.studio_id)
        .maybeSingle();

      if (studio?.name) studioName = studio.name;
    }

    let detailsSubmitted = false;
    let chargesEnabled = false;
    let payoutsEnabled = false;
    let onboardingComplete = false;
    const stripeAccountId = photographer?.stripe_account_id || null;

    if (stripeAccountId) {
      const account = await stripeGetAccount(stripeAccountId);
      detailsSubmitted = Boolean(account.details_submitted);
      chargesEnabled = Boolean(account.charges_enabled);
      payoutsEnabled = Boolean(account.payouts_enabled);
      onboardingComplete = detailsSubmitted && chargesEnabled && payoutsEnabled;
    }

    return NextResponse.json({
      ok: true,
      signedIn: true,
      businessName: photographer?.business_name || "WhitePhoto",
      studioName,
      brandColor: photographer?.brand_color || "#0f172a",
      logoUrl,
      stripeAccountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete,
      photographerId: photographer?.id || null,
      studioId: photographer?.studio_id || null,
      watermarkEnabled: photographer?.watermark_enabled !== false,
      watermarkLogoUrl: photographer?.watermark_logo_url || "",
      studioAddress: photographer?.studio_address || "",
      studioPhone: photographer?.studio_phone || "",
      studioEmail: photographer?.studio_email || "",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ...EMPTY_PROFILE,
        ok: false,
        signedIn: true,
        message: e instanceof Error ? e.message : "Unable to load Stripe status.",
      },
      { status: 500 },
    );
  }
}
