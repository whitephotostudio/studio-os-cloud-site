// supabase/functions/send-digital-delivery/index.ts
// Deploy with: supabase functions deploy send-digital-delivery
//
// Environment variables needed in Supabase Dashboard → Edge Functions → Secrets:
//   RESEND_API_KEY   — your Resend API key (from resend.com)
//   SUPABASE_URL     — your project URL (auto-injected)
//   SUPABASE_ANON_KEY — publishable key used to validate the caller's JWT
//   SUPABASE_SERVICE_ROLE_KEY — service role key (auto-injected)
//   R2_PUBLIC_URL    — optional public base URL for migrated R2 photo storage

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  cleanText,
  encodeObjectKey,
  escapeHtml,
  validateOrderId,
  validatePhotoPaths,
} from "./security.ts";

const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim().replace(/[^\x20-\x7E]/g, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_PUBLIC_URL = (Deno.env.get("R2_PUBLIC_URL") ?? "").trim().replace(/\/$/, "");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "Please sign in again." }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Please sign in again." }, 401);
    }

    const payload = await req.json().catch(() => ({}));
    const orderId = validateOrderId(payload?.order_id);
    if (!orderId) return json({ error: "A valid order is required." }, 400);

    const { data: photographer, error: photographerError } = await admin
      .from("photographers")
      .select("id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (photographerError || !photographer?.id) {
      return json({ error: "Photographer profile not found." }, 403);
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id,photographer_id,school_id,student_id,parent_email,customer_email,parent_name,customer_name")
      .eq("id", orderId)
      .eq("photographer_id", photographer.id)
      .maybeSingle();
    if (orderError || !order?.id) {
      return json({ error: "Order not found." }, 404);
    }

    const validatedPaths = validatePhotoPaths(
      payload?.photo_paths,
      cleanText(order.school_id),
      cleanText(order.student_id),
    );
    if (!validatedPaths.ok) return json({ error: validatedPaths.error }, 400);

    const parentEmail = cleanText(order.customer_email) || cleanText(order.parent_email);
    const parentName = cleanText(order.customer_name) || cleanText(order.parent_name);
    if (
      !parentEmail ||
      parentEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parentEmail)
    ) {
      return json({ error: "This order has no valid delivery email." }, 400);
    }

    const [{ data: student }, { data: school }] = await Promise.all([
      admin
        .from("students")
        .select("first_name,last_name")
        .eq("id", order.student_id)
        .eq("school_id", order.school_id)
        .maybeSingle(),
      admin
        .from("schools")
        .select("school_name")
        .eq("id", order.school_id)
        .eq("photographer_id", photographer.id)
        .maybeSingle(),
    ]);

    const studentName = [cleanText(student?.first_name), cleanText(student?.last_name)]
      .filter(Boolean)
      .join(" ") || "your child";
    const schoolName = cleanText(school?.school_name);
    const studentSubject = studentName.replace(/[\u0000\r\n]+/g, " ").slice(0, 160);

    if (!RESEND_API_KEY) return json({ error: "Email delivery is not configured." }, 503);

    const usingR2PublicUrls = !!R2_PUBLIC_URL;

    // Generate R2 public URLs when configured; otherwise fall back to
    // Supabase signed URLs for legacy storage.
    const signedUrls: { path: string; url: string }[] = [];
    for (const path of validatedPaths.paths) {
      if (usingR2PublicUrls) {
        signedUrls.push({
          path,
          url: `${R2_PUBLIC_URL}/${encodeObjectKey(path)}`,
        });
      } else {
        const { data, error } = await admin.storage
          .from("photos")
          .createSignedUrl(path, 604800); // 7 days

        if (error || !data?.signedUrl) {
          console.error("[send-digital-delivery] could not sign an order photo");
          continue;
        }
        signedUrls.push({ path, url: data.signedUrl });
      }
    }

    if (signedUrls.length === 0) {
      return json({ error: "Could not generate download links." }, 500);
    }

    // Build email HTML
    const firstName = escapeHtml(parentName.split(" ")[0] || "there");
    const studentDisplay = escapeHtml(studentSubject);
    const schoolDisplay = schoolName ? ` from ${escapeHtml(schoolName)}` : "";

    const photoLinksHtml = signedUrls
      .map((item, i) => {
        const filename = escapeHtml(item.path.split("/").pop() ?? `photo-${i + 1}.jpg`);
        return `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e5e5e5;">
              <a href="${item.url}" 
                 style="display: inline-block; background: #000; color: #fff; text-decoration: none; 
                        padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">
                ⬇ Download ${filename}
              </a>
            </td>
          </tr>`;
      })
      .join("");

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background: #000; padding: 32px 40px; text-align: center;">
              <h1 style="color: #fff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.02em;">
                Your Photos Are Ready
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; color: #111;">Hi ${firstName},</p>
              <p style="margin: 0 0 24px; font-size: 15px; color: #555; line-height: 1.7;">
                Your digital photo${signedUrls.length > 1 ? "s" : ""} of <strong style="color: #111;">${studentDisplay}</strong>${schoolDisplay} 
                ${signedUrls.length > 1 ? "are" : "is"} ready to download. 
                Click the button${signedUrls.length > 1 ? "s" : ""} below to save 
                ${signedUrls.length > 1 ? "them" : "it"} to your device.
              </p>

              <!-- Download links -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                ${photoLinksHtml}
              </table>

              ${
                usingR2PublicUrls
                  ? `<p style="margin: 0 0 8px; font-size: 13px; color: #999; line-height: 1.6;">
                Save your photos to your device for safekeeping after download.
              </p>`
                  : `<p style="margin: 0 0 8px; font-size: 13px; color: #999; line-height: 1.6;">
                ⏱ These download links expire in <strong>7 days</strong>. 
                Please save your photos before then.
              </p>`
              }
              <p style="margin: 0; font-size: 13px; color: #999; line-height: 1.6;">
                Order reference: <code style="font-size: 11px; color: #bbb;">${escapeHtml(orderId)}</code>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f9f9f9; padding: 20px 40px; border-top: 1px solid #eee; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #bbb;">
                Powered by Studio OS · Thank you for your order
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Studio OS <noreply@studiooscloud.com>",
        to: [parentEmail],
        subject: `Your photos are ready — ${studentSubject}`,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      console.error("[send-digital-delivery] email provider rejected the request", resendRes.status);
      return json({ error: "Failed to send email." }, 502);
    }

    // Mark order as digital_delivered in Supabase
    const { error: updateError } = await admin
      .from("orders")
      .update({ status: "digital_delivered", digital_delivered_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("photographer_id", photographer.id);
    if (updateError) {
      console.error("[send-digital-delivery] email sent but order status update failed");
    }

    return json({ success: true, links: signedUrls.length });

  } catch (err) {
    console.error("[send-digital-delivery] unexpected failure", err instanceof Error ? err.name : "unknown");
    return json({ error: "Digital delivery failed." }, 500);
  }
});
