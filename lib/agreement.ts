// Single source of truth for the Studio OS Cloud legal agreement gate.
//
// Bump CURRENT_AGREEMENT_VERSION when we materially change the Terms,
// Privacy Policy, or Data Responsibility Agreement. Every photographer
// will be forced to re-accept on their next dashboard load.
//
// `TERMS_VERSION` / `PRIVACY_VERSION` are captured alongside the master
// agreement version at accept time so we can reconstruct *exactly* which
// document text a given photographer consented to, even after we update
// the public-facing pages.

export const CURRENT_AGREEMENT_VERSION = "2026-04-v1";
export const CURRENT_TERMS_VERSION = "2026-04-v1";
export const CURRENT_PRIVACY_VERSION = "2026-04-v1";
export const CURRENT_DATA_RESPONSIBILITY_VERSION = "2026-04-v1";

export const AGREEMENT_POLICY_LINKS = {
  terms: "/terms",
  privacy: "/privacy",
  dataResponsibility: "/data-responsibility-agreement",
} as const;
