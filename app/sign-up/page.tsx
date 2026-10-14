import SignUpClient from "@/components/sign-up-client";
import { getPricingCatalogSnapshot } from "@/lib/studio-pricing";

/** Resolve the public offer once on the server, including the trial disclosure. */
export default function SignUpPage() {
  return <SignUpClient catalog={getPricingCatalogSnapshot()} />;
}
