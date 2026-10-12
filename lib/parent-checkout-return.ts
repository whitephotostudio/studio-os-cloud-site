import "server-only";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  bootstrapParentGallerySession, parentSessionCookieBinding, resolveParentGallerySession,
  type ParentGallerySessionScope,
} from "@/lib/parent-gallery-session";
import { getConnectedAccountId, retrieveCheckoutSession, type StripeCheckoutSession } from "@/lib/payments";
import { storedOrderTotalCents, sumStoredOrderTotalsCents } from "@/lib/order-checkout-totals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
type Service = ReturnType<typeof createDashboardServiceClient>;
export type ParentCheckoutOrder = {
  id: string; photographer_id: string | null; order_group_id: string | null;
  school_id: string | null; project_id?: string | null; student_id: string | null;
  customer_email: string | null; parent_email: string | null;
  stripe_checkout_session_id: string | null; total_cents?: number | null;
  total_amount?: number | null; currency?: string | null;
};
export class ParentCheckoutReturnError extends Error {
  constructor(public status: number, message = "Reopen your gallery and review your saved basket before continuing. Your basket was kept.") {
    super(message); this.name = "ParentCheckoutReturnError";
  }
}
function fail(status = 403): never { throw new ParentCheckoutReturnError(status); }
function rpcFailure(error: { message?: string } | null) {
  if (error?.message?.startsWith("PARENT_")) fail(409);
  fail(503);
}

/** The creation adapter is the sole caller: only an already validated create
 * result can attest an event order whose edited billing email is not its viewer. */
export async function recordParentOrderSessionAccess(request: Request, scopes: ParentGallerySessionScope[], payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(503);
  const result = payload as Record<string, unknown>;
  if (result.ok !== true) return;
  const rawIds = Array.isArray(result.orderIds) ? result.orderIds : [result.orderId];
  const orderIds = rawIds.map(value => clean(value).toLowerCase());
  const laneIds = [...new Set(scopes.map(scope => scope.laneId.toLowerCase()))];
  const binding = parentSessionCookieBinding(request);
  if (!binding || !orderIds.length || orderIds.length > 6 || orderIds.some(id => !UUID.test(id)) ||
    new Set(orderIds).size !== orderIds.length || !laneIds.length || laneIds.length > 32 ||
    laneIds.some(id => !UUID.test(id)) || new Set(scopes.map(scope => scope.photographerId)).size !== 1 ||
    (result.primaryOrderId !== undefined && !orderIds.includes(clean(result.primaryOrderId).toLowerCase()))) fail(503);
  const { error } = await createDashboardServiceClient().rpc("record_parent_order_session_access", {
    p_token_hash: binding, p_lane_ids: laneIds, p_order_ids: orderIds,
  });
  if (error) rpcFailure(error);
}

export type ParentCheckoutAccess = {
  request: Request; scope: ParentGallerySessionScope; hasProvenance: boolean; legacySchool: boolean;
  applyCookie<T extends { headers: Headers }>(response: T): Promise<T>;
};
/** Resolve explicit legacy credentials without ever deriving a PIN from an
 * order ID. The new adapter supplies its already authenticated private scope. */
export async function authorizeParentCheckout(request: Request, service: Service, orders: ParentCheckoutOrder[],
  supplied: { pin?: string; email?: string; customerEmail?: string; schoolId?: string; projectId?: string; mode?: string },
  resolvedScope: ParentGallerySessionScope | null): Promise<ParentCheckoutAccess> {
  let scope = resolvedScope, authenticatedRequest = request;
  let applyCookie = async <T extends { headers: Headers }>(response: T): Promise<T> => response;
  if (!scope) {
    const pin = clean(supplied.pin), email = clean(supplied.email);
    const galleryId = clean(supplied.schoolId || supplied.projectId || orders[0]?.school_id || orders[0]?.project_id);
    if (!pin || !email || !UUID.test(galleryId)) fail();
    const kind = supplied.schoolId || (!supplied.projectId && orders[0]?.school_id) ? "school" : "event";
    const bootstrapped = await bootstrapParentGallerySession(request, { kind, galleryId, pin, email });
    const cookieResponse = await bootstrapped.applyCookie(new Response(null));
    const setCookies = cookieResponse.headers.getSetCookie();
    // Complete asynchronous budget/refund work before any Stripe mutation.
    // Publish those already-prepared cookies even if the provider reply is lost.
    applyCookie = async response => {
      for (const cookie of setCookies) response.headers.append("Set-Cookie", cookie);
      return response;
    };
    const sessionCookie = setCookies.find(value => /^(?:__Host-studio_os_parent_session|studio_os_parent_session_dev)=/.test(value));
    if (!sessionCookie) fail(503);
    const headers = new Headers(request.headers);
    const sessionName = sessionCookie.slice(0, sessionCookie.indexOf("="));
    const remaining = (headers.get("cookie") || "").split(";").map(value => value.trim()).filter(value => value && !value.startsWith(sessionName + "="));
    headers.set("cookie", [...remaining, sessionCookie.split(";")[0]].join("; "));
    authenticatedRequest = new Request(request.url, { method: request.method, headers });
    scope = await resolveParentGallerySession(authenticatedRequest, bootstrapped.grant.laneId);
  }
  const binding = parentSessionCookieBinding(authenticatedRequest);
  if (!binding || !orders.length || orders.some(order => order.photographer_id !== scope.photographerId)) fail();
  const rows = await service.from("parent_order_session_access").select("order_id,token_hash,photographer_id,order_group_id,school_id,project_id,student_id,lane_ids")
    .in("order_id", orders.map(order => order.id));
  if (rows.error) fail(503);
  const provenance = rows.data ?? [];
  const hasProvenance = provenance.length === orders.length && orders.every(order => provenance.some(row =>
    row.order_id === order.id && row.token_hash === binding && row.photographer_id === scope.photographerId && row.order_group_id === order.order_group_id && row.school_id === order.school_id &&
    row.project_id === (order.project_id ?? null) && row.student_id === order.student_id));
  // A conflicting attestation can never be rebound using an old school PIN.
  if (provenance.length && !hasProvenance) fail();
  if (hasProvenance) {
    const laneIds = [...new Set(provenance.flatMap(row => Array.isArray(row.lane_ids) ? row.lane_ids : []))];
    if (!laneIds.length || laneIds.length > 32 || laneIds.some(id => typeof id !== "string" || !UUID.test(id))) fail();
    const proofScopes = new Map<string, ParentGallerySessionScope>([[scope.laneId, scope]]);
    for (const laneId of laneIds) if (!proofScopes.has(laneId)) {
      proofScopes.set(laneId, await resolveParentGallerySession(authenticatedRequest, laneId));
    }
    const selectedStudents = orders.filter(order => order.school_id).map(order => order.student_id).filter((id): id is string => !!id);
    const students = selectedStudents.length ? await service.from("students").select("id,school_id,pin").in("id", selectedStudents) : { data: [], error: null };
    if (students.error) fail(503);
    for (const order of orders) {
      const attested = provenance.find(row => row.order_id === order.id)!;
      if (!Array.isArray(attested.lane_ids) || !attested.lane_ids.some((laneId: string) => {
        const proof = proofScopes.get(laneId);
        if (!proof || proof.photographerId !== order.photographer_id) return false;
        if (order.school_id) return proof.kind === "school" && proof.galleryId === order.school_id &&
          !!students.data?.some(student => student.id === order.student_id && student.school_id === order.school_id && student.pin === proof.pin);
        return proof.kind === "event" && proof.galleryId === order.project_id;
      })) fail();
    }
  }
  let legacySchool = false;
  if (!hasProvenance && scope.kind === "school") {
    const candidates = orders.filter(order => order.school_id === scope.galleryId && UUID.test(clean(order.student_id)));
    if (candidates.length) {
      const students = await service.from("students").select("id,school_id,pin").in("id", candidates.map(order => order.student_id!))
        .eq("school_id", scope.galleryId).eq("pin", scope.pin);
      if (students.error) fail(503);
      legacySchool = !!students.data?.some(student => candidates.some(order => order.student_id === student.id));
    }
    if (!legacySchool) fail();
  }
  if (!hasProvenance && scope.kind === "event") {
    const receipt = clean(supplied.customerEmail).toLowerCase();
    if (!receipt || orders.some(order => order.school_id || order.project_id !== scope.galleryId ||
      clean(order.customer_email || order.parent_email).toLowerCase() !== receipt)) fail();
  }
  return { request: authenticatedRequest, scope, hasProvenance, legacySchool, applyCookie };
}

export async function registerParentCheckoutReturn(service: Service, access: ParentCheckoutAccess,
  orders: ParentCheckoutOrder[], anchorId: string, previousExpiredSessionId: string | null) {
  if (!access.hasProvenance && !access.legacySchool) fail(409);
  const binding = parentSessionCookieBinding(access.request);
  if (!binding) fail();
  const { data, error } = await service.rpc("register_parent_checkout_return", {
    p_token_hash: binding, p_return_lane_id: access.scope.laneId, p_anchor_order_id: anchorId,
    p_order_ids: orders.map(order => order.id).sort(), p_attempt_key: previousExpiredSessionId || "initial",
    p_allow_legacy_school: access.legacySchool,
  });
  if (error) rpcFailure(error);
  if (!data || typeof data !== "object" || Array.isArray(data) || !UUID.test(clean(data.returnId)) ||
    !UUID.test(clean(data.laneId)) || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now() ||
    (data.sessionId !== null && (typeof data.sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(data.sessionId)))) fail(503);
  return { returnId: data.returnId as string, laneId: data.laneId as string, sessionId: data.sessionId as string | null };
}
export async function bindParentCheckoutReturn(service: Service, access: ParentCheckoutAccess, returnId: string, sessionId: string) {
  const { error } = await service.rpc("bind_parent_checkout_return", {
    p_return_id: returnId, p_token_hash: parentSessionCookieBinding(access.request), p_session_id: sessionId,
  });
  if (error) rpcFailure(error);
}
export function parentCheckoutReturnUrls(origin: string, returnId: string) {
  if (!UUID.test(returnId)) fail(503);
  const url = new URL(`/parents/checkout-return/${returnId}`, origin);
  return { successUrl: `${url}?result=success&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${url}?result=cancel` };
}

const RETURN_SELECT = "id,anchor_order_id,order_group_id,order_ids,order_scopes,legacy_school,photographer_id,return_lane_id,token_hash,stripe_session_id,expires_at";
type ReturnRow = { id: string; anchor_order_id: string; order_group_id: string | null; order_ids: string[];
  order_scopes: Array<{ id: string; school_id: string | null; project_id: string | null; student_id: string | null }>;
  legacy_school: boolean;
  photographer_id: string; return_lane_id: string; token_hash: string; stripe_session_id: string | null; expires_at: string };
const ORDER_SELECT = "id,photographer_id,order_group_id,school_id,project_id,student_id,customer_email,parent_email,stripe_checkout_session_id,total_cents,total_amount,currency";

export async function hasMappedParentCheckout(service: Service, orderId: string, sessionId: string | null) {
  if (!sessionId) return false;
  const result = await service.from("parent_checkout_returns").select("id").eq("stripe_session_id", sessionId).contains("order_ids", [orderId]).limit(1);
  if (result.error) fail(503);
  return !!result.data?.length;
}

function verifyPaidSession(row: ReturnRow, orders: ParentCheckoutOrder[], session: StripeCheckoutSession) {
  const metadata = session.metadata ?? {}, total = sumStoredOrderTotalsCents(orders);
  if (session.id !== row.stripe_session_id || session.mode !== "payment" || session.status !== "complete" ||
    !["paid", "no_payment_required"].includes(session.payment_status || "") ||
    total == null || session.amount_total !== total ||
    (session.payment_status === "no_payment_required" && total !== 0) ||
    orders.some(order => storedOrderTotalCents(order) == null || clean(order.currency || "cad").toLowerCase() !== session.currency?.toLowerCase()) ||
    metadata.billing_flow !== "customer_order" || metadata.photographer_id !== row.photographer_id ||
    metadata.order_id !== row.anchor_order_id || (metadata.order_group_id || null) !== row.order_group_id ||
    (session.client_reference_id != null && session.client_reference_id !== row.anchor_order_id)) fail();
}

/** GET landing, clean gallery props and POST confirmation all use the same
 * browser, immutable order membership and current gallery checks. */
export async function resolveParentCheckoutReturn(request: Request, returnId: string, laneId?: string) {
  const query = new URL(request.url).searchParams;
  for (const field of ["result", "checkout", "session_id", "return"]) if (query.getAll(field).length > 1) fail(400);
  const result = query.get("result") || query.get("checkout") || "success";
  if (!["success", "cancel"].includes(result) || (query.has("result") && query.has("checkout") && query.get("result") !== query.get("checkout"))) fail(400);
  if (!UUID.test(returnId) || (laneId !== undefined && !UUID.test(laneId))) fail(400);
  const binding = parentSessionCookieBinding(request);
  if (!binding) fail();
  const service = createDashboardServiceClient();
  const found = await service.from("parent_checkout_returns").select(RETURN_SELECT).eq("id", returnId).eq("token_hash", binding).maybeSingle();
  if (found.error) fail(503);
  const row = found.data as ReturnRow | null;
  if (!row || row.token_hash !== binding || (laneId && row.return_lane_id !== laneId) || Date.parse(row.expires_at) <= Date.now() ||
    !Number.isFinite(Date.parse(row.expires_at)) || !row.stripe_session_id) fail();
  const scope = await resolveParentGallerySession(request, row.return_lane_id);
  if (scope.photographerId !== row.photographer_id) fail();
  const fetched = await service.from("orders").select(ORDER_SELECT, { count: "exact" })
    .in("id", row.order_ids);
  if (fetched.error) fail(503);
  const orders = (fetched.data ?? []) as ParentCheckoutOrder[];
  if (fetched.count !== row.order_ids.length || orders.length !== row.order_ids.length || new Set(row.order_ids).size !== row.order_ids.length ||
    !orders.some(order => order.id === row.anchor_order_id) || orders.some(order => order.photographer_id !== row.photographer_id ||
      order.order_group_id !== row.order_group_id || order.stripe_checkout_session_id !== row.stripe_session_id) ||
    !Array.isArray(row.order_scopes) || row.order_scopes.length !== orders.length ||
    orders.some(order => !row.order_scopes.some(saved => saved.id === order.id && saved.school_id === order.school_id &&
      saved.project_id === (order.project_id ?? null) && saved.student_id === order.student_id))) fail();
  if (row.order_group_id) {
    const group = await service.from("orders").select("id", { count: "exact" }).eq("order_group_id", row.order_group_id);
    if (group.error) fail(503);
    if (group.count !== row.order_ids.length || group.data?.length !== row.order_ids.length || group.data.some(order => !row.order_ids.includes(order.id))) fail();
  }
  const currentAccess = await authorizeParentCheckout(request, service, orders, {}, scope);
  if (row.legacy_school !== true && !currentAccess.hasProvenance) fail();
  if (result === "cancel") {
    if (query.has("session_id")) fail(400);
    return { returnId: row.id, laneId: row.return_lane_id, status: "cancel" as const };
  }
  const explicitSession = query.get("session_id");
  if (explicitSession !== null && explicitSession !== row.stripe_session_id) fail();
  // A Stripe landing must include the exact provider substitution; a clean
  // internal view/confirm loads the already-bound ID only in server memory.
  if (new URL(request.url).pathname.startsWith("/parents/checkout-return/") && !explicitSession) fail();
  const photographer = await service.from("photographers").select("id,stripe_account_id,stripe_connected_account_id").eq("id", row.photographer_id).maybeSingle();
  if (photographer.error) fail(503);
  const accountId = photographer.data ? getConnectedAccountId(photographer.data) : null;
  if (!accountId) fail(503);
  const session = await retrieveCheckoutSession(row.stripe_session_id, accountId);
  verifyPaidSession(row, orders, session);
  return { returnId: row.id, laneId: row.return_lane_id, status: "success" as const, sessionId: row.stripe_session_id };
}
export { privateHeaders as parentCheckoutPrivateHeaders };
