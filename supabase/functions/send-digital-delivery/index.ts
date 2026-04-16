// supabase/functions/send-digital-delivery/index.ts
// Deploy with: supabase functions deploy send-digital-delivery
//
// Environment variables needed in Supabase Dashboard → Edge Functions → Secrets:
//   RESEND_API_KEY   — your Resend API key (from resend.com)
//   SUPABASE_URL     — your project URL (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (auto-injected)
//   R2_PUBLIC_URL    — optional public base URL for migrated R2 photo storage

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim().replace(/[^\x20-\x7E]/g, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_PUBLIC_URL = (Deno.env.get("R2_PUBLIC_URL") ?? "").trim().replace(/\/$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface DigitalDeliveryPayload {
  order_id: string;
  parent_email: string;
  parent_name?: string;
  student_name?: string;
  school_name?: string;
  photo_paths: string[]; // storage paths in the photos bucket
}

function encodeKey(key: string) {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

Deno.serve(async (req) => {
  // Allow CORS for local dev
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const payload: DigitalDeliveryPayload = await req.json();

    const { order_id, parent_email, parent_name, student_name, school_name, photo_paths } = payload;

    if (!parent_email || !photo_paths?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const usingR2PublicUrls = !!R2_PUBLIC_URL;

    // Generate R2 public URLs when configured; otherwise fall back to
    // Supabase signed URLs for legacy storage.
    const signedUrls: { path: string; url: string }[] = [];
    for (const path of photo_paths) {
      if (usingR2PublicUrls) {
        signedUrls.push({
          path,
          url: `${R2_PUBLIC_URL}/${encodeKey(path)}`,
        });
      } else {
        const { data, error } = await supabase.storage
          .from("photos")
          .createSignedUrl(path, 604800); // 7 days

        if (error || !data?.signedUrl) {
          console.error(`Failed to create signed URL for ${path}:`, error);
          continue;
        }
        signedUrls.push({ path, url: data.signedUrl });
      }
    }

    if (signedUrls.length === 0) {
      return new Response(JSON.stringify({ error: "Could not generate download links" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build email HTML
    const firstName = parent_name?.split(" ")[0] || "there";
    const studentDisplay = student_name || "your child";
    const schoolDisplay = school_name ? ` from ${school_name}` : "";

    const photoLinksHtml = signedUrls
      .map((item, i) => {
        const filename = item.path.split("/").pop() ?? `photo-${i + 1}.jpg`;
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
                Order reference: <code style="font-size: 11px; color: #bbb;">${order_id}</code>
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
        to: [parent_email],
        subject: `Your photos are ready — ${studentDisplay}`,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const resendErr = await resendRes.text();
      console.error("Resend error:", resendErr);
      return new Response(JSON.stringify({ error: "Failed to send email", detail: resendErr }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Mark order as digital_delivered in Supabase
    await supabase
      .from("orders")
      .update({ status: "digital_delivered", digital_delivered_at: new Date().toISOString() })
      .eq("id", order_id);

    return new Response(JSON.stringify({ success: true, sent_to: parent_email, links: signedUrls.length }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
