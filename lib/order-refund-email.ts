export type RefundEmailDetails = {
  audience: "client" | "photographer";
  studioName: string;
  customerName: string;
  orderIds: string[];
  amountCents: number;
  currency: string;
  refundId: string;
  issuedAt: string;
};

function esc(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function buildOrderRefundEmail(input: RefundEmailDetails) {
  const amount = new Intl.NumberFormat("en-CA", { style: "currency", currency: input.currency.toUpperCase(), currencyDisplay: "code" }).format(input.amountCents / 100);
  const orders = input.orderIds.map(id => `#${id.slice(0, 8)}`).join(", ");
  const client = input.audience === "client";
  const subject = `${client ? "Your refund confirmation" : "Customer refund confirmed"} — ${amount} — ${orders}`;
  const intro = client
    ? `${input.studioName} has issued a refund of ${amount} for your order${input.orderIds.length > 1 ? "s" : ""} ${orders}.`
    : `A refund of ${amount} has been issued to ${input.customerName} for order${input.orderIds.length > 1 ? "s" : ""} ${orders}.`;
  const timing = "The refund is going back to the original payment method. The time it takes to appear depends on the payment provider and bank.";
  const scope = "This confirmation applies only to the refund and orders listed here. Other orders are unchanged.";
  const issued = new Date(input.issuedAt).toISOString().slice(0, 10);
  const details = `Refund amount: ${amount}\nOrder reference${input.orderIds.length > 1 ? "s" : ""}: ${input.orderIds.join(", ")}\nRefund reference: ${input.refundId}\nIssued: ${issued} (UTC)`;
  const closing = client ? "If you have any questions, reply to this email to contact your photographer." : "Review the affected orders in Studio OS before continuing production.";
  const text = `${intro}\n\n${details}\n\n${timing}\n\n${scope}\n\n${closing}\n\n${input.studioName}`;
  const html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#18202c"><div style="max-width:600px;margin:32px auto;background:#fff;padding:32px;border-radius:12px"><p style="color:#6366f1;font-weight:bold">${esc(input.studioName)}</p><h1 style="font-size:25px">Refund confirmation</h1><p style="line-height:1.6">${esc(intro)}</p><div style="padding:20px;background:#f5f6fa;border-radius:8px;line-height:1.8;overflow-wrap:anywhere">${esc(details).replaceAll("\n", "<br>")}</div><p style="line-height:1.6">${esc(timing)}</p><p style="line-height:1.6">${esc(scope)}</p><p style="line-height:1.6">${esc(closing)}</p>${client ? "" : '<p><a href="https://www.studiooscloud.com/dashboard/orders">Open orders</a></p>'}</div></body></html>`;
  return { subject, html, text };
}
