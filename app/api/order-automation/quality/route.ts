import { NextRequest, NextResponse } from "next/server";
import { hasR2Config } from "@/lib/r2";
import { resendConfigured } from "@/lib/resend";
import {
  ProductionAuthError,
  productionAuth,
} from "@/lib/order-automation-auth";

export const dynamic = "force-dynamic";

// Order inspection runs on the photographer's Mac. Keep the former endpoint
// explicitly retired so an older client cannot silently invoke paid cloud AI.
export async function POST(request: NextRequest) {
  try {
    await productionAuth(request);
    return NextResponse.json(
      {
        ok: false,
        passed: false,
        message:
          "Cloud AI inspection is disabled. Use local AI in Studio OS V2 or review this print manually.",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        passed: false,
        message: "Sign in and complete MFA to check orders.",
      },
      { status: error instanceof ProductionAuthError ? error.status : 503 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await productionAuth(request);
    return NextResponse.json(
      {
        ok: true,
        aiConfigured: false,
        localAiRequired: true,
        emailConfigured: resendConfigured(),
        storageConfigured: hasR2Config(),
        model: "local-qwen2.5-vl-7b-4bit",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: "Sign in and complete MFA to view production setup.",
      },
      { status: error instanceof ProductionAuthError ? error.status : 503 },
    );
  }
}
