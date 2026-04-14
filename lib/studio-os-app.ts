import { randomBytes } from "node:crypto";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { normalizePlanCode, type PlanCode } from "@/lib/studio-pricing";

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;

export type StudioAppReleaseState = "hidden" | "beta" | "public";
export type PhotographyKeyStatus = "active" | "suspended" | "revoked";
export type PhotographyKeyActivationStatus = "active" | "deactivated";

export type StudioAppPhotographerRow = {
  id: string;
  user_id: string;
  business_name: string | null;
  billing_email: string | null;
  studio_email: string | null;
  subscription_plan_code: string | null;
  subscription_status: string | null;
  extra_desktop_keys: number | null;
  is_platform_admin: boolean | null;
  studio_app_beta_access: boolean | null;
};

type StudioAppReleaseRow = {
  id: string;
  slug: string;
  release_state: StudioAppReleaseState;
  version: string | null;
  release_notes: string | null;
  beta_warning: string | null;
  mac_download_url: string | null;
  windows_download_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type PhotographyKeyRow = {
  id: string;
  photographer_id: string;
  slot_index: number;
  label: string | null;
  key_code: string;
  status: PhotographyKeyStatus;
  is_extra_key: boolean | null;
  last_validated_at: string | null;
  last_activated_at: string | null;
  created_at: string;
  updated_at: string;
};

type PhotographyKeyActivationRow = {
  id: string;
  photography_key_id: string;
  device_id: string;
  device_name: string | null;
  platform: string | null;
  app_version: string | null;
  status: PhotographyKeyActivationStatus;
  activated_at: string;
  last_validated_at: string;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioAppEntitlement = {
  planCode: PlanCode | null;
  releaseState: StudioAppReleaseState;
  releaseStateLabel: string;
  subscriptionActive: boolean;
  appEligibleByPlan: boolean;
  appAccessEnabled: boolean;
  canDownload: boolean;
  betaAccess: boolean;
  isPlatformAdmin: boolean;
  includedKeys: number;
  extraKeys: number;
  totalAllowedKeys: number;
  requiresStudioUpgradeForSecondKey: boolean;
  requiresStudioForExtraKeys: boolean;
  showBetaWarning: boolean;
  message: string;
};

export type StudioAppDashboardKey = {
  id: string;
  label: string;
  keyCode: string;
  status: PhotographyKeyStatus;
  slotIndex: number;
  isExtraKey: boolean;
  activationStatus: "active" | "inactive";
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  activatedAt: string | null;
  lastValidatedAt: string | null;
};

export type StudioAppDashboardState = {
  release: {
    slug: string;
    state: StudioAppReleaseState;
    stateLabel: string;
    version: string;
    releaseNotes: string;
    betaWarning: string;
    macDownloadUrl: string | null;
    windowsDownloadUrl: string | null;
    publishedAt: string | null;
    updatedAt: string;
  };
  entitlement: StudioAppEntitlement;
  keys: StudioAppDashboardKey[];
  admin: {
    isPlatformAdmin: boolean;
  };
};

export type ActivatePhotographyKeyInput = {
  keyCode: string;
  deviceId: string;
  deviceName?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

export type ValidatePhotographyKeyInput = {
  keyCode: string;
  deviceId: string;
  appVersion?: string | null;
  platform?: string | null;
};

const RELEASE_SLUG = "studio-os-flutter";
const DEFAULT_VERSION = "Beta 0.1.0";
const DEFAULT_NOTES =
  "Upload the latest Mac and Windows installers when the Studio OS Flutter build is ready for photographers.";
const DEFAULT_BETA_WARNING =
  "Beta builds are intended for approved photographers only. Download links, activations, and workflows may change during rollout.";
const PHOTOGRAPHER_SELECT =
  "id,user_id,business_name,billing_email,studio_email,subscription_plan_code,subscription_status,extra_desktop_keys,is_platform_admin,studio_app_beta_access";
const RELEASE_SELECT =
  "id,slug,release_state,version,release_notes,beta_warning,mac_download_url,windows_download_url,published_at,created_at,updated_at";
const KEY_SELECT =
  "id,photographer_id,slot_index,label,key_code,status,is_extra_key,last_validated_at,last_activated_at,created_at,updated_at";
const ACTIVATION_SELECT =
  "id,photography_key_id,device_id,device_name,platform,app_version,status,activated_at,last_validated_at,deactivated_at,created_at,updated_at";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedEmail(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function isSubscriptionActive(status: string | null | undefined) {
  const normalized = clean(status).toLowerCase();
  return normalized === "active" || normalized === "trialing";
}

function normalizeReleaseState(value: string | null | undefined): StudioAppReleaseState {
  const normalized = clean(value).toLowerCase();
  if (normalized === "beta" || normalized === "public") return normalized;
  return "hidden";
}

export function isPublicStudioAppRelease(state: string | null | undefined) {
  return normalizeReleaseState(state) === "public";
}

function releaseStateLabel(state: StudioAppReleaseState) {
  if (state === "public") return "Public release";
  if (state === "beta") return "Beta release";
  return "Hidden rollout";
}

function canUseStudioAppPlan(planCode: PlanCode | null) {
  return planCode === "core" || planCode === "studio";
}

export function getIncludedPhotographyKeyCount(planCode: PlanCode | null) {
  if (planCode === "core") return 1;
  if (planCode === "studio") return 2;
  return 0;
}

export function getExtraPhotographyKeyCount(photographer: Pick<StudioAppPhotographerRow, "subscription_plan_code" | "extra_desktop_keys" | "subscription_status">) {
  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  if (planCode !== "studio" || !isSubscriptionActive(photographer.subscription_status)) {
    return 0;
  }

  return Math.max(0, Number(photographer.extra_desktop_keys ?? 0));
}

export function getAllowedPhotographyKeyCount(
  photographer: Pick<
    StudioAppPhotographerRow,
    "subscription_plan_code" | "subscription_status" | "extra_desktop_keys" | "is_platform_admin"
  >,
) {
  // Platform owners get a fixed 4-key bundle regardless of stored plan.
  if (photographer.is_platform_admin) return 4;

  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  if (!planCode || !isSubscriptionActive(photographer.subscription_status)) {
    return 0;
  }

  return getIncludedPhotographyKeyCount(planCode) + getExtraPhotographyKeyCount(photographer);
}

function generatePhotographyKeyCode() {
  const chunk = () => randomBytes(2).toString("hex").toUpperCase();
  return `SOK-${chunk()}-${chunk()}-${chunk()}-${chunk()}`;
}

export function normalizePhotographyKeyCode(input: string | null | undefined) {
  return clean(input).toUpperCase().replace(/\s+/g, "");
}

export async function ensureStudioAppReleaseConfig(service: ServiceClient) {
  const { data, error } = await service
    .from("studio_app_releases")
    .select(RELEASE_SELECT)
    .eq("slug", RELEASE_SLUG)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as StudioAppReleaseRow;

  const { data: inserted, error: insertError } = await service
    .from("studio_app_releases")
    .insert({
      slug: RELEASE_SLUG,
      release_state: "hidden",
      version: DEFAULT_VERSION,
      release_notes: DEFAULT_NOTES,
      beta_warning: DEFAULT_BETA_WARNING,
    })
    .select(RELEASE_SELECT)
    .single();

  if (insertError) throw insertError;
  return inserted as StudioAppReleaseRow;
}

export async function updateStudioAppReleaseConfig(
  service: ServiceClient,
  input: {
    releaseState: StudioAppReleaseState;
    version: string;
    releaseNotes: string;
    betaWarning: string;
    macDownloadUrl: string | null;
    windowsDownloadUrl: string | null;
  },
) {
  const existing = await ensureStudioAppReleaseConfig(service);
  const now = new Date().toISOString();

  const { data, error } = await service
    .from("studio_app_releases")
    .update({
      release_state: input.releaseState,
      version: clean(input.version) || DEFAULT_VERSION,
      release_notes: clean(input.releaseNotes) || DEFAULT_NOTES,
      beta_warning: clean(input.betaWarning) || DEFAULT_BETA_WARNING,
      mac_download_url: clean(input.macDownloadUrl) || null,
      windows_download_url: clean(input.windowsDownloadUrl) || null,
      published_at: input.releaseState === "hidden" ? existing.published_at : now,
      updated_at: now,
    })
    .eq("id", existing.id)
    .select(RELEASE_SELECT)
    .single();

  if (error) throw error;
  return data as StudioAppReleaseRow;
}

export async function loadStudioAppPhotographer(
  service: ServiceClient,
  photographerId: string,
) {
  const { data, error } = await service
    .from("photographers")
    .select(PHOTOGRAPHER_SELECT)
    .eq("id", photographerId)
    .maybeSingle();

  if (error) throw error;
  return (data as StudioAppPhotographerRow | null) ?? null;
}

async function loadPhotographyKeys(service: ServiceClient, photographerId: string) {
  const { data, error } = await service
    .from("photography_keys")
    .select(KEY_SELECT)
    .eq("photographer_id", photographerId)
    .order("slot_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as PhotographyKeyRow[]).sort((left, right) => {
    if (left.slot_index !== right.slot_index) return left.slot_index - right.slot_index;
    return left.created_at.localeCompare(right.created_at);
  });
}

async function loadKeyActivations(service: ServiceClient, photographyKeyIds: string[]) {
  if (!photographyKeyIds.length) return [] as PhotographyKeyActivationRow[];

  const { data, error } = await service
    .from("photography_key_activations")
    .select(ACTIVATION_SELECT)
    .in("photography_key_id", photographyKeyIds)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PhotographyKeyActivationRow[];
}

function buildDefaultKeyLabel(index: number) {
  return `Photography Key ${index}`;
}

export function resolveStudioAppEntitlement(
  photographer: StudioAppPhotographerRow,
  release: StudioAppReleaseRow,
): StudioAppEntitlement {
  const isPlatformAdmin = Boolean(photographer.is_platform_admin);
  // Platform admins (owners) are always treated as Studio-plan, subscription-active.
  // This guarantees full desktop-app entitlement regardless of stored billing rows.
  const planCode = isPlatformAdmin
    ? "studio"
    : normalizePlanCode(photographer.subscription_plan_code);
  const releaseState = normalizeReleaseState(release.release_state);
  const subscriptionActive =
    isPlatformAdmin || isSubscriptionActive(photographer.subscription_status);
  const appEligibleByPlan = canUseStudioAppPlan(planCode);
  const betaAccess = Boolean(photographer.studio_app_beta_access);
  const rolloutEnabled =
    releaseState === "public" || betaAccess || isPlatformAdmin;
  // Owners get a fixed bundle of 4 Photography Keys (Studio's 2 + 2 extra),
  // regardless of what's stored in extra_desktop_keys.
  const OWNER_INCLUDED_KEYS = 2;
  const OWNER_EXTRA_KEYS = 2;
  const includedKeys = isPlatformAdmin
    ? OWNER_INCLUDED_KEYS
    : getIncludedPhotographyKeyCount(planCode);
  const extraKeys = isPlatformAdmin
    ? OWNER_EXTRA_KEYS
    : subscriptionActive && planCode === "studio"
    ? Math.max(0, Number(photographer.extra_desktop_keys ?? 0))
    : 0;
  const totalAllowedKeys = isPlatformAdmin
    ? OWNER_INCLUDED_KEYS + OWNER_EXTRA_KEYS
    : subscriptionActive && appEligibleByPlan
    ? includedKeys + extraKeys
    : 0;
  const appAccessEnabled = subscriptionActive && appEligibleByPlan && rolloutEnabled;
  const canDownload =
    appAccessEnabled &&
    (clean(release.mac_download_url).length > 0 || clean(release.windows_download_url).length > 0);

  let message = "Studio OS App access is ready for this account.";
  if (!appEligibleByPlan) {
    message =
      "This plan does not include Studio OS App access. Upgrade to App Plan or Studio to unlock downloads and Photography Keys.";
  } else if (!subscriptionActive) {
    message =
      "Reactivate the subscription to restore Studio OS App downloads, activations, and Photography Keys.";
  } else if (!rolloutEnabled && releaseState === "hidden") {
    message =
      "The Studio OS App rollout is currently hidden. This account is not on the approved beta list yet.";
  } else if (!rolloutEnabled) {
    message =
      "The Studio OS App is in beta. This account needs beta access before downloads and key activations are enabled.";
  } else if (planCode === "core") {
    message =
      "App Plan includes 1 Photography Key. Upgrade to Studio to unlock a second key or any extra keys.";
  } else if (planCode === "studio") {
    message =
      "Studio includes 2 Photography Keys, and extra keys can be added for $55 each.";
  }

  return {
    planCode,
    releaseState,
    releaseStateLabel: releaseStateLabel(releaseState),
    subscriptionActive,
    appEligibleByPlan,
    appAccessEnabled,
    canDownload,
    betaAccess,
    isPlatformAdmin,
    includedKeys,
    extraKeys,
    totalAllowedKeys,
    requiresStudioUpgradeForSecondKey: planCode === "core",
    requiresStudioForExtraKeys: planCode !== "studio",
    showBetaWarning: releaseState !== "public",
    message,
  };
}

export async function syncPhotographyKeysForPhotographer(
  service: ServiceClient,
  photographer: StudioAppPhotographerRow,
) {
  const allowedKeys = getAllowedPhotographyKeyCount(photographer);
  const includedKeys = getIncludedPhotographyKeyCount(
    normalizePlanCode(photographer.subscription_plan_code),
  );
  let keys = (await loadPhotographyKeys(service, photographer.id)).filter(
    (row) => row.status !== "revoked",
  );

  const missingKeys = Math.max(0, allowedKeys - keys.length);
  if (missingKeys > 0) {
    const { error: insertError } = await service.from("photography_keys").insert(
      Array.from({ length: missingKeys }, (_, index) => ({
        photographer_id: photographer.id,
        slot_index: keys.length + index + 1,
        label: buildDefaultKeyLabel(keys.length + index + 1),
        key_code: generatePhotographyKeyCode(),
        status: "active",
        is_extra_key: keys.length + index + 1 > includedKeys,
      })),
    );

    if (insertError) throw insertError;
    keys = (await loadPhotographyKeys(service, photographer.id)).filter(
      (row) => row.status !== "revoked",
    );
  }

  for (const [index, key] of keys.entries()) {
    const desiredStatus: PhotographyKeyStatus = index < allowedKeys ? "active" : "suspended";
    const desiredSlotIndex = index + 1;
    const desiredExtraKey = desiredSlotIndex > includedKeys;
    const desiredLabel = clean(key.label) || buildDefaultKeyLabel(desiredSlotIndex);

    if (
      key.status !== desiredStatus ||
      key.slot_index !== desiredSlotIndex ||
      Boolean(key.is_extra_key) !== desiredExtraKey ||
      clean(key.label) !== desiredLabel
    ) {
      const { error: updateError } = await service
        .from("photography_keys")
        .update({
          status: desiredStatus,
          slot_index: desiredSlotIndex,
          is_extra_key: desiredExtraKey,
          label: desiredLabel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", key.id);

      if (updateError) throw updateError;
    }
  }

  const refresh = (await loadPhotographyKeys(service, photographer.id)).filter(
    (row) => row.status !== "revoked",
  );
  const suspendedKeyIds = refresh
    .filter((row) => row.status !== "active")
    .map((row) => row.id);

  if (suspendedKeyIds.length) {
    const { error: deactivateError } = await service
      .from("photography_key_activations")
      .update({
        status: "deactivated",
        deactivated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in("photography_key_id", suspendedKeyIds)
      .eq("status", "active");

    if (deactivateError) throw deactivateError;
  }

  return refresh;
}

export async function syncPhotographyKeysByPhotographerId(
  service: ServiceClient,
  photographerId: string,
) {
  const photographer = await loadStudioAppPhotographer(service, photographerId);
  if (!photographer) return null;
  const keys = await syncPhotographyKeysForPhotographer(service, photographer);
  return { photographer, keys };
}

export async function buildStudioAppDashboardState(
  service: ServiceClient,
  photographerId: string,
): Promise<StudioAppDashboardState> {
  const photographer = await loadStudioAppPhotographer(service, photographerId);
  if (!photographer) {
    throw new Error("Photographer account not found for Studio OS App access.");
  }

  const release = await ensureStudioAppReleaseConfig(service);
  const keys = await syncPhotographyKeysForPhotographer(service, photographer);
  const activations = await loadKeyActivations(
    service,
    keys.map((row) => row.id),
  );
  const activationMap = new Map(
    activations
      .filter((row) => row.status === "active")
      .map((row) => [row.photography_key_id, row]),
  );
  const entitlement = resolveStudioAppEntitlement(photographer, release);

  return {
    release: {
      slug: release.slug,
      state: normalizeReleaseState(release.release_state),
      stateLabel: releaseStateLabel(normalizeReleaseState(release.release_state)),
      version: clean(release.version) || DEFAULT_VERSION,
      releaseNotes: clean(release.release_notes) || DEFAULT_NOTES,
      betaWarning: clean(release.beta_warning) || DEFAULT_BETA_WARNING,
      macDownloadUrl: clean(release.mac_download_url) || null,
      windowsDownloadUrl: clean(release.windows_download_url) || null,
      publishedAt: release.published_at,
      updatedAt: release.updated_at,
    },
    entitlement,
    keys: keys.map((key) => {
      const activation = activationMap.get(key.id);
      return {
        id: key.id,
        label: clean(key.label) || buildDefaultKeyLabel(key.slot_index),
        keyCode: key.key_code,
        status: key.status,
        slotIndex: key.slot_index,
        isExtraKey: Boolean(key.is_extra_key),
        activationStatus: activation ? "active" : "inactive",
        deviceId: activation?.device_id ?? null,
        deviceName: activation?.device_name ?? null,
        platform: activation?.platform ?? null,
        activatedAt: activation?.activated_at ?? key.last_activated_at ?? null,
        lastValidatedAt: activation?.last_validated_at ?? key.last_validated_at ?? null,
      } satisfies StudioAppDashboardKey;
    }),
    admin: {
      isPlatformAdmin: Boolean(photographer.is_platform_admin),
    },
  };
}

async function findPhotographyKeyByCode(service: ServiceClient, keyCode: string) {
  const normalized = normalizePhotographyKeyCode(keyCode);
  if (!normalized) return null;

  const { data, error } = await service
    .from("photography_keys")
    .select(KEY_SELECT)
    .eq("key_code", normalized)
    .maybeSingle();

  if (error) throw error;
  return (data as PhotographyKeyRow | null) ?? null;
}

async function findActiveActivationForKey(
  service: ServiceClient,
  photographyKeyId: string,
) {
  const { data, error } = await service
    .from("photography_key_activations")
    .select(ACTIVATION_SELECT)
    .eq("photography_key_id", photographyKeyId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  return (data as PhotographyKeyActivationRow | null) ?? null;
}

export async function activatePhotographyKey(
  service: ServiceClient,
  input: ActivatePhotographyKeyInput,
) {
  const key = await findPhotographyKeyByCode(service, input.keyCode);
  if (!key) {
    throw new Error("Photography Key not found.");
  }

  const synced = await syncPhotographyKeysByPhotographerId(service, key.photographer_id);
  if (!synced) {
    throw new Error("Photographer account not found for this Photography Key.");
  }

  const release = await ensureStudioAppReleaseConfig(service);
  const entitlement = resolveStudioAppEntitlement(synced.photographer, release);
  const freshKey = synced.keys.find((row) => row.id === key.id);

  if (!freshKey || freshKey.status !== "active") {
    throw new Error("This Photography Key is not currently active.");
  }

  if (!entitlement.appAccessEnabled) {
    throw new Error(entitlement.message);
  }

  const deviceId = clean(input.deviceId);
  if (!deviceId) {
    throw new Error("Device ID is required to activate this Photography Key.");
  }

  const activeActivation = await findActiveActivationForKey(service, freshKey.id);
  const now = new Date().toISOString();

  if (activeActivation && activeActivation.device_id !== deviceId) {
    throw new Error(
      `This Photography Key is already activated on ${clean(activeActivation.device_name) || "another device"}.`,
    );
  }

  if (activeActivation) {
    const { error: updateActivationError } = await service
      .from("photography_key_activations")
      .update({
        device_name: clean(input.deviceName) || activeActivation.device_name,
        platform: clean(input.platform) || activeActivation.platform,
        app_version: clean(input.appVersion) || activeActivation.app_version,
        last_validated_at: now,
        updated_at: now,
      })
      .eq("id", activeActivation.id);

    if (updateActivationError) throw updateActivationError;
  } else {
    const { error: insertActivationError } = await service
      .from("photography_key_activations")
      .insert({
        photography_key_id: freshKey.id,
        device_id: deviceId,
        device_name: clean(input.deviceName) || null,
        platform: clean(input.platform) || null,
        app_version: clean(input.appVersion) || null,
        status: "active",
      });

    if (insertActivationError) throw insertActivationError;
  }

  const { error: keyUpdateError } = await service
    .from("photography_keys")
    .update({
      last_activated_at: now,
      last_validated_at: now,
      updated_at: now,
    })
    .eq("id", freshKey.id);

  if (keyUpdateError) throw keyUpdateError;

  return {
    key: freshKey,
    release,
    entitlement,
    photographer: synced.photographer,
  };
}

export async function validatePhotographyKey(
  service: ServiceClient,
  input: ValidatePhotographyKeyInput,
) {
  const key = await findPhotographyKeyByCode(service, input.keyCode);
  if (!key) {
    throw new Error("Photography Key not found.");
  }

  const synced = await syncPhotographyKeysByPhotographerId(service, key.photographer_id);
  if (!synced) {
    throw new Error("Photographer account not found for this Photography Key.");
  }

  const release = await ensureStudioAppReleaseConfig(service);
  const entitlement = resolveStudioAppEntitlement(synced.photographer, release);
  const freshKey = synced.keys.find((row) => row.id === key.id);

  if (!freshKey || freshKey.status !== "active") {
    throw new Error("This Photography Key is not currently active.");
  }

  if (!entitlement.appAccessEnabled) {
    throw new Error(entitlement.message);
  }

  const deviceId = clean(input.deviceId);
  if (!deviceId) {
    throw new Error("Device ID is required to validate this Photography Key.");
  }

  const activeActivation = await findActiveActivationForKey(service, freshKey.id);
  if (!activeActivation || activeActivation.device_id !== deviceId) {
    throw new Error("Activate this Photography Key on this device before continuing.");
  }

  const now = new Date().toISOString();
  const { error: updateActivationError } = await service
    .from("photography_key_activations")
    .update({
      platform: clean(input.platform) || activeActivation.platform,
      app_version: clean(input.appVersion) || activeActivation.app_version,
      last_validated_at: now,
      updated_at: now,
    })
    .eq("id", activeActivation.id);

  if (updateActivationError) throw updateActivationError;

  const { error: updateKeyError } = await service
    .from("photography_keys")
    .update({
      last_validated_at: now,
      updated_at: now,
    })
    .eq("id", freshKey.id);

  if (updateKeyError) throw updateKeyError;

  return {
    key: freshKey,
    release,
    entitlement,
    photographer: synced.photographer,
  };
}

export async function setStudioAppBetaAccess(
  service: ServiceClient,
  input: {
    enabled: boolean;
    photographerId?: string | null;
    email?: string | null;
  },
) {
  const now = new Date().toISOString();

  if (clean(input.photographerId)) {
    const { data, error } = await service
      .from("photographers")
      .update({
        studio_app_beta_access: input.enabled,
      })
      .eq("id", clean(input.photographerId))
      .select(PHOTOGRAPHER_SELECT)
      .single();

    if (error) throw error;
    return data as StudioAppPhotographerRow;
  }

  const email = normalizedEmail(input.email);
  if (!email) {
    throw new Error("Enter a billing or studio email to update beta access.");
  }

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select(PHOTOGRAPHER_SELECT)
    .or(`billing_email.eq.${email},studio_email.eq.${email}`)
    .limit(1)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (!photographer) {
    throw new Error("No photographer account matched that email.");
  }

  const { data, error } = await service
    .from("photographers")
    .update({
      studio_app_beta_access: input.enabled,
    })
    .eq("id", photographer.id)
    .select(PHOTOGRAPHER_SELECT)
    .single();

  if (error) throw error;

  await service
    .from("studio_app_releases")
    .update({ updated_at: now })
    .eq("slug", RELEASE_SLUG);

  return data as StudioAppPhotographerRow;
}
