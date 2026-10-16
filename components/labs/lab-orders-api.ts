"use client";

import { createClient } from "@/lib/supabase/client";
import type { LabOrdersResponse } from "@/lib/labs/orders-types";

export type OrdersResponse = LabOrdersResponse & { nextCursor?: string | null };
export class LabOrderApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function labOrderFetch(path: string, body?: object | FormData, signal?: AbortSignal) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) throw new LabOrderApiError("Sign in to open your lab orders.", 401);
  const multipart = body instanceof FormData;
  const response = await fetch(path, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body && !multipart ? { "Content-Type": "application/json" } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as OrdersResponse;
    throw new LabOrderApiError(error.message || "The lab order request could not be completed. Your input is preserved.", response.status, error.code);
  }
  return response;
}

export async function labOrderRequest(path: string, body?: object | FormData, signal?: AbortSignal): Promise<OrdersResponse> {
  const response = await labOrderFetch(path, body, signal);
  const result = await response.json() as OrdersResponse;
  if (!result.ok) throw new LabOrderApiError(result.message || "The request could not be confirmed. Please retry.", response.status, result.code);
  return result;
}
