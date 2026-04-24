// GET /api/dashboard/agreement/status
//
// Returns whether the currently authenticated photographer has accepted
// the current Studio OS Cloud agreement version. The AgreementGate client
// component calls this on mount to decide whether to render the modal.
//
// Response shape:
//   { accepted: boolean, agreementVersion: string, authenticated: boolean }
//
// `authenticated: false` → the client should redirect to /sign-in; the
// gate deliberately doesn't throw 401 because we want the layout to still
// render (Next will handle the redirect its own way).

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { hasAcceptedCurrentAgreement } from "@/lib/require-agreement";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/agreement";

export async function GET(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user?.id) {
    return NextResponse.json(
      {
        accepted: false,
        authenticated: false,
        agreementVersion: CURRENT_AGREEMENT_VERSION,
      },
      { status: 200 },
    );
  }

  const service = createDashboardServiceClient();
  const accepted = await hasAcceptedCurrentAgreement({
    service,
    userId: user.id,
  });

  return NextResponse.json(
    {
      accepted,
      authenticated: true,
      agreementVersion: CURRENT_AGREEMENT_VERSION,
    },
    { status: 200 },
  );
}
