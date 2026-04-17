import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/admin/users
 *
 * Returns all photographers with full client contact info + trial & subscription status.
 * Only accessible to platform admins.
 */
export async function GET(request: NextRequest) {
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
        { ok: false, message: "Only platform admins can view registered users." },
        { status: 403 },
      );
    }

    // Fetch all photographers with contact + billing + trial + voice data.
    const { data: users, error } = await service
      .from("photographers")
      .select(
        "id,user_id,business_name,billing_email,studio_email,studio_phone,studio_address,subscription_plan_code,subscription_status,subscription_billing_interval,subscription_current_period_start,subscription_current_period_end,stripe_subscription_id,extra_desktop_keys,trial_starts_at,trial_ends_at,is_platform_admin,created_at,voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month,voice_usage_period_start",
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const photographerIds = (users ?? []).map((u) => u.id as string);

    // Photography keys per photographer (active = activated/usable, total = ever provisioned).
    const keysByPhotographer = new Map<string, { active: number; total: number }>();
    if (photographerIds.length > 0) {
      const { data: keyRows } = await service
        .from("photography_keys")
        .select("photographer_id,status")
        .in("photographer_id", photographerIds);
      for (const row of keyRows ?? []) {
        const pid = row.photographer_id as string;
        const entry = keysByPhotographer.get(pid) ?? { active: 0, total: 0 };
        entry.total += 1;
        if ((row.status as string) === "active") entry.active += 1;
        keysByPhotographer.set(pid, entry);
      }
    }

    // Studio credits (current balance, lifetime purchased credits, lifetime used credits).
    const creditsByPhotographer = new Map<
      string,
      { balance: number; totalPurchased: number; totalUsed: number }
    >();
    if (photographerIds.length > 0) {
      const { data: creditRows } = await service
        .from("studio_credits")
        .select("photographer_id,balance,total_purchased,total_used")
        .in("photographer_id", photographerIds);
      for (const row of creditRows ?? []) {
        const pid = row.photographer_id as string;
        if (!pid) continue;
        creditsByPhotographer.set(pid, {
          balance: Number(row.balance ?? 0),
          totalPurchased: Number(row.total_purchased ?? 0),
          totalUsed: Number(row.total_used ?? 0),
        });
      }
    }

    // Total $ spent per photographer = sum of credit_packages.price_cents for every
    // credit_transactions row marked as a 'purchase'. We pull the price catalog once
    // and then aggregate transactions client-side.
    const spentByPhotographer = new Map<string, number>();
    if (photographerIds.length > 0) {
      const { data: pkgRows } = await service
        .from("credit_packages")
        .select("id,price_cents");
      const pkgPriceMap = new Map<string, number>();
      for (const row of pkgRows ?? []) {
        pkgPriceMap.set(row.id as string, Number(row.price_cents ?? 0));
      }

      const { data: txnRows } = await service
        .from("credit_transactions")
        .select("photographer_id,package_id,source")
        .in("photographer_id", photographerIds)
        .eq("source", "purchase");

      for (const row of txnRows ?? []) {
        const pid = row.photographer_id as string;
        if (!pid) continue;
        const price = pkgPriceMap.get(row.package_id as string) ?? 0;
        spentByPhotographer.set(pid, (spentByPhotographer.get(pid) ?? 0) + price);
      }
    }

    // Pull auth metadata (full_name, phone) for each user via the admin auth API.
    // We batch with service.auth.admin.listUsers() to be efficient.
    const userIds = (users ?? []).map((u) => u.user_id as string).filter(Boolean);
    const authMetaMap = new Map<
      string,
      { fullName: string | null; phone: string | null; email: string | null; lastSignIn: string | null }
    >();

    // Supabase admin API pages at 1000 users. For most instances this is one call.
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const { data: authData, error: authError } = await service.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (authError) break;
      for (const authUser of authData?.users ?? []) {
        const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
        authMetaMap.set(authUser.id, {
          fullName: (meta.full_name as string) || null,
          phone: (meta.phone as string) || null,
          email: authUser.email || null,
          lastSignIn: authUser.last_sign_in_at || null,
        });
      }
      // If we got fewer than 1000, we've fetched all pages.
      hasMore = (authData?.users?.length ?? 0) >= 1000;
      page++;
    }

    const now = new Date();
    const enriched = (users ?? []).map((u) => {
      const trialEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : null;
      const subStatus = ((u.subscription_status as string) ?? "").trim().toLowerCase();
      const hasStripeSubscription = Boolean(u.stripe_subscription_id);
      const hasPaidSubscription =
        hasStripeSubscription && (subStatus === "active" || subStatus === "trialing" || subStatus === "trial");

      const isOwner = Boolean(u.is_platform_admin);

      let trialStatus: "active" | "expired" | "none" | "converted" | "owner" = "none";
      if (isOwner) {
        // Platform admins (owners) never expire and aren't subject to trial logic.
        trialStatus = "owner";
      } else if (hasPaidSubscription && hasStripeSubscription) {
        trialStatus = "converted";
      } else if (trialEnd && trialEnd > now) {
        trialStatus = "active";
      } else if (trialEnd && trialEnd <= now) {
        trialStatus = "expired";
      }

      const trialDaysRemaining =
        trialEnd && trialEnd > now
          ? Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

      const authMeta = authMetaMap.get(u.user_id as string);
      const keysEntry = keysByPhotographer.get(u.id as string) ?? { active: 0, total: 0 };
      const creditsEntry = creditsByPhotographer.get(u.id as string) ?? {
        balance: 0,
        totalPurchased: 0,
        totalUsed: 0,
      };
      const totalSpentCents = spentByPhotographer.get(u.id as string) ?? 0;

      // Roll the monthly window forward in the response if we've crossed
      // a month boundary, so the UI shows "0 used" cleanly without waiting
      // for the next TTS request to do the reset.
      const periodStart = u.voice_usage_period_start
        ? new Date(u.voice_usage_period_start as string)
        : null;
      const sameMonth =
        periodStart &&
        periodStart.getUTCFullYear() === now.getUTCFullYear() &&
        periodStart.getUTCMonth() === now.getUTCMonth();
      const voiceUsedThisMonth = sameMonth
        ? Number(u.voice_chars_used_this_month ?? 0)
        : 0;

      return {
        id: u.id,
        userId: u.user_id,
        fullName: authMeta?.fullName || null,
        businessName: u.business_name,
        email: u.billing_email || u.studio_email || authMeta?.email || "—",
        phone: u.studio_phone || authMeta?.phone || null,
        address: u.studio_address || null,
        subscriptionPlanCode: u.subscription_plan_code,
        subscriptionBillingInterval: u.subscription_billing_interval || null,
        subscriptionStatus: u.subscription_status || "inactive",
        subscriptionCurrentPeriodEnd: u.subscription_current_period_end,
        hasStripeSubscription,
        extraDesktopKeysPurchased: Number(u.extra_desktop_keys ?? 0),
        photographyKeysActive: keysEntry.active,
        photographyKeysTotal: keysEntry.total,
        creditBalance: isOwner ? null : creditsEntry.balance,
        creditTotalPurchased: creditsEntry.totalPurchased,
        creditTotalUsed: creditsEntry.totalUsed,
        totalSpentCents,
        trialStartsAt: u.trial_starts_at,
        trialEndsAt: u.trial_ends_at,
        trialStatus,
        trialDaysRemaining,
        isPlatformAdmin: Boolean(u.is_platform_admin),
        lastSignIn: authMeta?.lastSignIn || null,
        createdAt: u.created_at,
        voicePremiumEnabled: Boolean(u.voice_premium_enabled),
        voiceMonthlyCharLimit: Number(u.voice_monthly_char_limit ?? 0),
        voiceCharsUsedThisMonth: voiceUsedThisMonth,
      };
    });

    // Calculate "new since last visit" before we update the seen timestamp.
    const { data: adminRow } = await service
      .from("photographers")
      .select("admin_seen_users_at")
      .eq("id", photographer.id)
      .maybeSingle();
    const seenAt = adminRow?.admin_seen_users_at
      ? new Date(adminRow.admin_seen_users_at as string)
      : null;
    const newSinceLastVisit = enriched.filter((u) => {
      if (!u.createdAt) return false;
      const created = new Date(u.createdAt as string);
      return seenAt ? created > seenAt : true;
    }).length;

    // Mark the badge as cleared by stamping the seen timestamp to "now".
    await service
      .from("photographers")
      .update({ admin_seen_users_at: now.toISOString() })
      .eq("id", photographer.id);

    return NextResponse.json({
      ok: true,
      users: enriched,
      newSinceLastVisit,
      previousSeenAt: seenAt ? seenAt.toISOString() : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to load registered users.",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/dashboard/admin/users
 *
 * Admin actions: extend_trial, revoke_trial.
 */
export async function POST(request: NextRequest) {
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
        { ok: false, message: "Only platform admins can manage user trials." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      photographerId?: string;
      extraDays?: number;
    };

    const targetId = (body.photographerId ?? "").trim();
    if (!targetId) {
      return NextResponse.json(
        { ok: false, message: "photographerId is required." },
        { status: 400 },
      );
    }

    if (body.action === "extend_trial") {
      const extraDays = Math.max(1, Math.min(365, Number(body.extraDays) || 30));

      const { data: target, error: fetchError } = await service
        .from("photographers")
        .select("id,trial_starts_at,trial_ends_at,subscription_status")
        .eq("id", targetId)
        .single();

      if (fetchError || !target) {
        return NextResponse.json(
          { ok: false, message: "Photographer not found." },
          { status: 404 },
        );
      }

      const base = target.trial_ends_at ? new Date(target.trial_ends_at as string) : new Date();
      const startFrom = base > new Date() ? base : new Date();
      const newEnd = new Date(startFrom);
      newEnd.setDate(newEnd.getDate() + extraDays);

      const updates: Record<string, unknown> = {
        trial_ends_at: newEnd.toISOString(),
      };
      if (!target.trial_starts_at) {
        updates.trial_starts_at = new Date().toISOString();
      }
      const subStatus = ((target.subscription_status as string) ?? "").trim().toLowerCase();
      if (subStatus !== "active") {
        updates.subscription_status = "trial";
        updates.subscription_plan_code = "studio";
      }

      const { error: updateError } = await service
        .from("photographers")
        .update(updates)
        .eq("id", targetId);

      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        message: `Trial extended by ${extraDays} days (new end: ${newEnd.toLocaleDateString()}).`,
      });
    }

    if (body.action === "revoke_trial") {
      const { error: updateError } = await service
        .from("photographers")
        .update({
          trial_ends_at: new Date().toISOString(),
          subscription_status: "inactive",
        })
        .eq("id", targetId);

      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        message: "Trial revoked. User will be redirected to pricing on next visit.",
      });
    }

    if (body.action === "delete_user") {
      // Look up the target photographer + verify this isn't a self/admin delete.
      const { data: target, error: fetchError } = await service
        .from("photographers")
        .select("id,user_id,is_platform_admin,business_name,billing_email")
        .eq("id", targetId)
        .single();

      if (fetchError || !target) {
        return NextResponse.json(
          { ok: false, message: "Photographer not found." },
          { status: 404 },
        );
      }

      if (target.is_platform_admin) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "This account is a platform admin and cannot be deleted from the dashboard. Remove the admin flag first if you really want to delete it.",
          },
          { status: 400 },
        );
      }

      if (target.user_id === user.id) {
        return NextResponse.json(
          { ok: false, message: "You cannot delete your own account." },
          { status: 400 },
        );
      }

      const photographerId = target.id as string;
      const targetUserId = (target.user_id as string | null) ?? null;

      // Best-effort cleanup of child rows that reference this photographer.
      // We swallow errors per-table because some tables may not exist on every
      // deployment (the photographers table predates many of these), and we'd
      // rather delete as much as possible than abort on a missing-table error.
      const childTables = [
        "order_items",
        "orders",
        "packages",
        "package_profiles",
        "students",
        "collections",
        "media",
        "photos",
        "projects",
        "schools",
        "school_email_recipients",
        "event_gallery_visitors",
        "event_gallery_favorites",
        "event_gallery_downloads",
        "school_gallery_visitors",
        "school_gallery_downloads",
        "project_email_deliveries",
        "photography_keys",
        "subscriptions",
      ];

      for (const table of childTables) {
        try {
          await service.from(table).delete().eq("photographer_id", photographerId);
        } catch {
          // Ignore — table may not exist or column may not match. We just
          // want to clear what we can before deleting the parent row.
        }
      }

      // Now delete the photographer row itself.
      const { error: photogErr } = await service
        .from("photographers")
        .delete()
        .eq("id", photographerId);

      if (photogErr) {
        return NextResponse.json(
          {
            ok: false,
            message: `Could not delete photographer record: ${photogErr.message}. Some child rows may still reference it.`,
          },
          { status: 500 },
        );
      }

      // Finally, delete the auth user. This signs them out of any active
      // sessions. We do this last so a partial failure leaves the auth user
      // intact and the admin can retry.
      if (targetUserId) {
        const { error: authErr } = await service.auth.admin.deleteUser(targetUserId);
        if (authErr) {
          return NextResponse.json(
            {
              ok: true,
              message: `Photographer record deleted, but the auth user could not be removed: ${authErr.message}. Delete it manually from Supabase Auth.`,
            },
          );
        }
      }

      return NextResponse.json({
        ok: true,
        message: `Deleted account ${target.billing_email || target.business_name || photographerId}.`,
      });
    }

    if (body.action === "update_voice") {
      const enabled = Boolean(
        (body as { voicePremiumEnabled?: boolean }).voicePremiumEnabled,
      );
      const rawLimit = (body as { voiceMonthlyCharLimit?: number }).voiceMonthlyCharLimit;
      const limit = Math.max(
        0,
        Math.min(1_000_000, Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 1000),
      );
      const resetUsage = Boolean((body as { resetUsage?: boolean }).resetUsage);

      const updates: Record<string, unknown> = {
        voice_premium_enabled: enabled,
        voice_monthly_char_limit: limit,
      };
      if (resetUsage) {
        updates.voice_chars_used_this_month = 0;
        updates.voice_usage_period_start = new Date().toISOString();
      }

      const { error: updateError } = await service
        .from("photographers")
        .update(updates)
        .eq("id", targetId);

      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        message: enabled
          ? `Premium voice enabled (${limit.toLocaleString()} chars/month).`
          : "Premium voice disabled for this user.",
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message:
          "Valid actions: extend_trial, revoke_trial, delete_user, update_voice.",
      },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to update user trial.",
      },
      { status: 500 },
    );
  }
}
