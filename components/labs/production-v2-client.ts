"use client";

import type { ProductionV2Response } from "@/lib/labs/production-v2-types";
import { ProductionApiError, productionFetch } from "./production-client";

export function productionV2GalleryPath(galleryId: string, token: string) {
  if (!/^[a-f0-9-]{36}$/i.test(galleryId) || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Generate a new private three-print gallery link first.");
  return `/labs-pilot/production-v2/${galleryId}#access=${token}`;
}
export async function productionV2Request(path: string, body?: object | FormData, userId?: string, signal?: AbortSignal): Promise<ProductionV2Response> {
  const response = await productionFetch(path, body, userId, signal), result = await response.json() as ProductionV2Response;
  if (!result.ok) throw new ProductionApiError(result.message || "The saved print-slot update could not be confirmed. Retry the retained request.", response.status);
  return result;
}
export async function productionV2ParentRequest(body: object, signal?: AbortSignal): Promise<ProductionV2Response> {
  const response = await fetch("/api/labs-pilot/production-v2", { method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as ProductionV2Response;
  if (!response.ok || !result.ok) throw new ProductionApiError(result.message || "The private gallery request could not be confirmed. Retry the same request.", response.status);
  return result;
}
