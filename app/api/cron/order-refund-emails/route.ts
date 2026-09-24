import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { deliverOrderRefundEmails } from "@/lib/order-refund-notifications";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ok:false},{status:401});
  try { return NextResponse.json({ok:true,...await deliverOrderRefundEmails(createDashboardServiceClient())}); }
  catch { return NextResponse.json({ok:false,message:"Refund email retry unavailable."},{status:503}); }
}
