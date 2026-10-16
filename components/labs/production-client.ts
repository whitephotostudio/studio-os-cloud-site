"use client";

import { createClient } from "@/lib/supabase/client";
import type { ProductionResponse } from "@/lib/labs/production-types";

export class ProductionApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export const productionToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
export const productionSessionRead = <T>(key: string): T | null => { try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; } };
export function productionSessionWrite(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { throw new Error("Enable browser session storage to retain this private request and retry it safely."); } }
export function productionGalleryPath(galleryId: string, accessToken: string) {
  if (!/^[a-f0-9-]{36}$/i.test(galleryId) || !/^[a-f0-9]{64}$/.test(accessToken)) throw new Error("Generate a new private gallery link first.");
  return `/labs-pilot/production/${galleryId}#access=${accessToken}`;
}
async function checkedSession(userId?: string) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token || userId && session.user.id !== userId) throw new Error("Sign in with the account connected to this private production workspace.");
  return session;
}
export async function productionFetch(path: string, body?: object | FormData, userId?: string, signal?: AbortSignal): Promise<Response> {
  const session = await checkedSession(userId), multipart = body instanceof FormData;
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", signal, headers: { Authorization: `Bearer ${session.access_token}`, ...(body && !multipart ? { "Content-Type": "application/json" } : {}) }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
  await checkedSession(session.user.id);
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new ProductionApiError(result.message || "The production request could not be confirmed. Your original request is retained.", response.status); }
  return response;
}
export async function productionRequest(path: string, body?: object | FormData, userId?: string, signal?: AbortSignal): Promise<ProductionResponse> {
  const response = await productionFetch(path, body, userId, signal), result = await response.json() as ProductionResponse;
  if (!result.ok) throw new ProductionApiError(result.message || "The saved production result could not be confirmed.", response.status);
  return result;
}
export async function productionPrivateBlob(path: string, userId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await productionFetch(path, undefined, userId, signal), blob = await response.blob();
  await checkedSession(userId);
  return blob;
}
export async function productionParentRequest(body: object, signal?: AbortSignal): Promise<ProductionResponse> {
  const response = await fetch("/api/labs-pilot/production", { method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as ProductionResponse;
  if (!response.ok || !result.ok) throw new ProductionApiError(result.message || "This private gallery request could not be confirmed. Retry the original request.", response.status);
  return result;
}
