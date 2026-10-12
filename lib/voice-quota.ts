import type { SupabaseClient } from "@supabase/supabase-js";

type ServiceClient = Pick<SupabaseClient, "rpc">;
type VoiceQuotaDecision =
  | { status: "admin" | "disabled" }
  | { status: "limit"; usedThisMonth: number; monthlyLimit: number }
  | { status: "reserved"; reservationId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export class VoiceQuotaUnavailable extends Error {
  constructor() { super("Premium voice accounting is temporarily unavailable. Browser voice will be used."); }
}

/** Database authorization and quota reservation are one row-locked transaction. */
export async function reserveVoiceUsage(service: ServiceClient, photographerId: string, characterCount: number): Promise<VoiceQuotaDecision> {
  try {
    if (!UUID.test(photographerId) || !Number.isInteger(characterCount) || characterCount < 1 || characterCount > 400) throw new VoiceQuotaUnavailable();
    const { data, error } = await service.rpc("reserve_voice_usage", {
      p_photographer_id: photographerId, p_character_count: characterCount,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data) ||
        data.photographer_id !== photographerId || data.character_count !== characterCount) throw new VoiceQuotaUnavailable();
    if ((data.status === "admin" || data.status === "disabled") && data.reservation_id === null) return { status: data.status };
    if (data.status === "limit" && data.reservation_id === null && count(data.used_this_month) && count(data.monthly_limit) &&
        (data.monthly_limit === 0 || data.used_this_month + characterCount > data.monthly_limit)) {
      return { status: "limit", usedThisMonth: data.used_this_month, monthlyLimit: data.monthly_limit };
    }
    if (data.status === "reserved" && typeof data.reservation_id === "string" && UUID.test(data.reservation_id) &&
        typeof data.period_start === "string" && Number.isFinite(Date.parse(data.period_start)) &&
        count(data.used_this_month) && count(data.monthly_limit) && data.used_this_month >= characterCount &&
        data.used_this_month <= data.monthly_limit) return { status: "reserved", reservationId: data.reservation_id };
    throw new VoiceQuotaUnavailable();
  } catch { throw new VoiceQuotaUnavailable(); }
}

/** The database consumes this token once; a retry can never refund twice. */
export async function releaseVoiceUsage(service: ServiceClient, photographerId: string, reservationId: string) {
  try {
    if (!UUID.test(photographerId) || !UUID.test(reservationId)) throw new VoiceQuotaUnavailable();
    const { data, error } = await service.rpc("release_voice_usage", {
      p_photographer_id: photographerId, p_reservation_id: reservationId,
    });
    if (error || typeof data !== "boolean") throw new VoiceQuotaUnavailable();
  } catch { throw new VoiceQuotaUnavailable(); }
}
