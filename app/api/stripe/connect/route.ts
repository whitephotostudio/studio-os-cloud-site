import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AuthContext = {
  user: { id: string; email?: string | null } | null;
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function resolveAuth(request: NextRequest): Promise<AuthContext> {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const anonClient = createSupabaseClient(supabaseUrl, anonKey);

  if (bearer) {
    const { data } = await anonClient.auth.getUser(bearer);
    if (data.user) {
      return { user: data.user };
    }
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

  return { user };
}

async function stripeRequest(path: string, body?: URLSearchParams, method: "GET" | "POST" = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? body.toString() : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe request failed for ${path}`;
    throw new Error(msg);
  }
  return json;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again before connecting Stripe." }, { status: 401 });
    }

    const service = createSupabaseClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const payload = await request.json().catch(() => ({}));
    const businessName = String(payload.businessName || "").trim();
    const studioName = String(payload.studioName || "").trim();
    const brandColor = String(payload.brandColor || "").trim();
    const logoUrl = String(payload.logoUrl || "").trim();

    let { data: photographer } = await service
      .from("photographers")
      .select("id, user_id, business_name, brand_color, stripe_account_id, studio_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!photographer) {
      const created = await service
        .from("photographers")
        .insert({
          user_id: user.id,
          business_name: businessName || "Studio OS Photographer",
          brand_color: brandColor || "#0f172a",
        })
        .select("id, user_id, business_name, brand_color, stripe_account_id, studio_id")
        .single();

      if (created.error) throw created.error;
      photographer = created.data;
    }

    let stripeAccountId = photographer.stripe_account_id as string | null;

    if (!stripeAccountId) {
      const account = await stripeRequest(
        "accounts",
        new URLSearchParams({
          type: "express",
          email: user.email || "",
          country: "CA",
          business_type: "individual",
          "metadata[user_id]": user.id,
          ...(photographer.id ? { "metadata[photographer_id]": photographer.id } : {}),
        }),
      );

      stripeAccountId = account.id;

      const photographerUpdate = await service
        .from("photographers")
        .update({
          stripe_account_id: stripeAccountId,
          business_name: businessName || photographer.business_name,
          brand_color: brandColor || photographer.brand_color,
        })
        .eq("id", photographer.id);

      if (photographerUpdate.error) throw photographerUpdate.error;
    }

    if (photographer.studio_id) {
      await service
        .from("studios")
        .update({ name: studioName || undefined })
        .eq("id", photographer.studio_id);
    }

    const origin = request.nextUrl.origin;
    const returnUrl = `${origin}/dashboard/settings?stripe=returned`;
    const refreshUrl = `${origin}/dashboard/settings?stripe=refresh`;

    if (!stripeAccountId) {
      throw new Error("Stripe account ID is missing.");
    }

    const accountLink = await stripeRequest(
      "account_links",
      new URLSearchParams({
        account: stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      }),
    );

    return NextResponse.json({ ok: true, url: accountLink.url, stripeAccountId });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Unable to start Stripe onboarding." },
      { status: 500 },
    );
  }
}
