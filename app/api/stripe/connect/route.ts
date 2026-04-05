import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  connectReturnUrl,
  createConnectedAccount,
  createConnectedAccountLink,
  getConnectedAccountId,
  getOrCreatePhotographerByUser,
  retrieveStripeAccount,
  syncConnectState,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type ConnectBody = {
  businessName?: string | null;
  studioName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  billingEmail?: string | null;
  studioEmail?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function requestOrigin(request: NextRequest) {
  return new URL(request.url).origin.replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again before connecting Stripe." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const body = (await request.json().catch(() => ({}))) as ConnectBody;
    let photographer = await getOrCreatePhotographerByUser(service, user);

    const brandingUpdates: Record<string, string | null> = {};
    const businessName = clean(body.businessName) || photographer.business_name || null;
    const brandColor = clean(body.brandColor) || photographer.brand_color || "#0f172a";
    const logoUrl = clean(body.logoUrl) || photographer.logo_url || null;
    const billingEmail =
      clean(body.billingEmail) || clean(body.studioEmail) || photographer.billing_email || user.email || null;

    if (businessName !== photographer.business_name) {
      brandingUpdates.business_name = businessName;
    }
    if (brandColor !== photographer.brand_color) {
      brandingUpdates.brand_color = brandColor;
    }
    if (logoUrl !== (photographer.logo_url ?? null)) {
      brandingUpdates.logo_url = logoUrl;
    }
    if (billingEmail !== photographer.billing_email) {
      brandingUpdates.billing_email = billingEmail;
    }

    if (Object.keys(brandingUpdates).length > 0) {
      const { error: photographerUpdateError } = await service
        .from("photographers")
        .update(brandingUpdates)
        .eq("id", photographer.id);

      if (photographerUpdateError) throw photographerUpdateError;
      photographer = {
        ...photographer,
        ...brandingUpdates,
      };
    }

    const studioName = clean(body.studioName);
    if (studioName && photographer.studio_id) {
      await service.from("studios").update({ name: studioName }).eq("id", photographer.studio_id);
    }

    let stripeAccountId = getConnectedAccountId(photographer);
    let account;

    if (stripeAccountId) {
      account = await retrieveStripeAccount(stripeAccountId);
    } else {
      account = await createConnectedAccount({
        photographerId: photographer.id,
        userId: user.id,
        email: billingEmail,
        businessName,
      });

      stripeAccountId = account.id;

      const { error: accountSaveError } = await service
        .from("photographers")
        .update({
          stripe_account_id: stripeAccountId,
          stripe_connected_account_id: stripeAccountId,
        })
        .eq("id", photographer.id);

      if (accountSaveError) throw accountSaveError;
    }

    await syncConnectState(service, photographer.id, account);

    const origin = requestOrigin(request);
    const link = await createConnectedAccountLink(stripeAccountId, {
      returnUrl: connectReturnUrl(origin, "returned"),
      refreshUrl: connectReturnUrl(origin, "refresh"),
    });

    return NextResponse.json({
      ok: true,
      url: link.url,
      stripeAccountId,
      onboardingComplete:
        account.details_submitted && account.charges_enabled && account.payouts_enabled,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to start Stripe Connect onboarding.",
      },
      { status: 500 },
    );
  }
}
