import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GalleryDownloadReservation = {
  allowedMediaIds: string[];
  downloadsUsed: number;
  downloadsRemaining: number | null;
  reservationId: string;
  attemptId: string;
  busy: boolean;
};

export async function reserveGalleryDownload(params: {
  service: SupabaseClient;
  galleryKind: "event" | "school";
  galleryId: string;
  photographerId: string | null;
  viewerEmail: string;
  mediaIds: string[];
  collectionId?: string | null;
  mode?: "prepare" | "zip";
  reservationId?: string;
  gallerySettings: unknown;
}): Promise<GalleryDownloadReservation> {
  const reservationId = params.reservationId || randomUUID(), attemptId = randomUUID();
  const { data, error } = await params.service.rpc("reserve_portal_gallery_download", {
    p_gallery_kind: params.galleryKind, p_gallery_id: params.galleryId,
    p_photographer_id: params.photographerId, p_viewer_email: params.viewerEmail,
    p_media_ids: params.mediaIds, p_reservation_id: reservationId, p_attempt_id: attemptId,
    p_collection_id: params.collectionId || null, p_mode: params.mode || "prepare",
    p_gallery_settings: params.gallerySettings ?? null,
  }).abortSignal(AbortSignal.timeout(20000));
  if (error) throw error;
  if (!data || (data.busy !== undefined && typeof data.busy !== "boolean") || !Array.isArray(data.allowedMediaIds) ||
    (data.busy === true && data.allowedMediaIds.length !== 0) || data.allowedMediaIds.some((id: unknown) => typeof id !== "string" || !params.mediaIds.includes(id)) ||
    new Set(data.allowedMediaIds).size !== data.allowedMediaIds.length ||
    (params.mode === "zip" && data.allowedMediaIds.length !== 0 && data.allowedMediaIds.length !== new Set(params.mediaIds).size) ||
    (!data.busy && (!Number.isSafeInteger(data.downloadsUsed) || data.downloadsUsed < 0 ||
      (data.downloadsRemaining !== null && (!Number.isSafeInteger(data.downloadsRemaining) || data.downloadsRemaining < 0))))) {
    throw new Error("Download quota could not be verified. Please retry.");
  }
  return { allowedMediaIds: data.allowedMediaIds, downloadsUsed: data.downloadsUsed ?? 0,
    downloadsRemaining: data.downloadsRemaining ?? null, reservationId, attemptId, busy: data.busy === true };
}

export async function finishGalleryDownload(service: SupabaseClient, reservation: GalleryDownloadReservation, mediaIds: string[], release = false) {
  const { error } = await service.rpc("finish_portal_gallery_download", {
    p_reservation_id: reservation.reservationId, p_attempt_id: reservation.attemptId,
    p_completed_media_ids: mediaIds, p_release: release,
  }).abortSignal(AbortSignal.timeout(20000));
  if (error) throw error;
}
