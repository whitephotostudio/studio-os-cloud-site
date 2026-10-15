import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
import { guardAgreement } from "@/lib/require-agreement";
import { catalogFromRow, labDashboardAccess, labFromRow, readLabRowsInPages, LAB_DIRECTORY_MAX_ROWS, LAB_CATALOG_MAX_ROWS } from "./server";
import { LabError } from "./validation";
import { orderFromRow, type LabOrder, type LabOrderAction, type LabOrdersWorkspace, type ManagedOrderLab } from "./orders-types";

export const LAB_ORDER_BUCKET = "lab-production-files";
type Row = Record<string, unknown>;
type Membership = { labId: string; role: ManagedOrderLab["role"] };
export type LabOrderAccess = { service: SupabaseClient; userId: string; photographerId: string | null; memberships: Membership[]; audience: "studio" | "lab" };
const uuid = z.string().uuid();
const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: uuid }).strict();
const PAGE_SIZE = 100;

export function labOrderDatabaseError(error: { message?: string } | null): never {
  const message = error?.message || "";
  if (/VERSION_CONFLICT/.test(message)) throw new LabError("This order changed in another window. Refresh its status before trying again.", 409, "LAB_ORDER_VERSION_CONFLICT");
  if (/REQUEST_CONFLICT/.test(message)) throw new LabError("This request was already used with different details. Review the order before starting a new request.", 409, "LAB_ORDER_REQUEST_CONFLICT");
  if (/FORBIDDEN|OWNER|NOT_FOUND/.test(message)) throw new LabError("This lab order is not available to your account.", 404, "LAB_ORDER_NOT_FOUND");
  if (/STUDIO_REQUIRED/.test(message)) throw new LabError("A photographer account is required to send a lab order.", 403, "LAB_ORDER_STUDIO_REQUIRED");
  if (/NOT_READY|CATALOG|PRODUCT_UNAVAILABLE|SKU_NOT_VERIFIED/.test(message)) throw new LabError("This lab is still in setup, or its product catalog needs confirmation. Nothing was sent.", 409, "LAB_ORDER_NOT_READY");
  if (/ASPECT/.test(message)) throw new LabError("A photo does not match its print shape. Upload a finished file cropped to the selected size.", 400, "LAB_ORDER_ASPECT");
  if (/TRANSITION|STATUS/.test(message)) throw new LabError("That status change is not available for this order. Refresh to see its current stage.", 409, "LAB_ORDER_TRANSITION");
  if (/INVALID|ASSET|REASON|TRACKING|ADDRESS|QUANTITY|DUPLICATE|LIMIT|DELIVERY_MISMATCH/.test(message)) throw new LabError("Check the production files, products, quantities and delivery details. Nothing was changed.", 400, "LAB_ORDER_INVALID");
  throw new LabError("The lab order service is unavailable. Its additive setup may still be pending. Your school prices and existing orders have not changed.", 503, "LAB_ORDERS_UNAVAILABLE");
}

export async function labOrderAccess(request: NextRequest, audience: "studio" | "lab"): Promise<LabOrderAccess> {
  if (audience === "studio") return { ...await labDashboardAccess(request), memberships: [], audience };
  const auth = await resolveDashboardAuth(request, { requireMfaEnrollment: true });
  if (!auth.user || !auth.mfaSatisfied) throw new LabError("Sign in with two-step verification to open the lab portal.", 401, "LAB_PORTAL_AUTH_REQUIRED");
  const quota = await rateLimit(auth.user.id, { namespace: "lab-order-portal", limit: request.method === "GET" ? 120 : 45, windowSeconds: 60, failClosed: true });
  if (!quota.allowed) throw new LabError("Lab account protection is unavailable or its request limit was reached. Try again shortly.", quota.unavailable ? 503 : 429, "LAB_PORTAL_RATE_LIMIT");
  const service = createDashboardServiceClient();
  const rows = await readLabRowsInPages((from, to) => service.from("lab_memberships").select("lab_id,role").eq("user_id", auth.user!.id).eq("active", true).order("lab_id").range(from, to), LAB_DIRECTORY_MAX_ROWS);
  const memberships = rows.map(row => ({ labId: String(row.lab_id), role: row.role as Membership["role"] }));
  // Platform administration alone never grants access to a lab's customer files.
  return { service, userId: auth.user.id, photographerId: null, memberships, audience };
}

export async function requireLabOrderAgreement(access: LabOrderAccess) {
  if (access.audience !== "studio") return;
  const result = await guardAgreement({ service: access.service, userId: access.userId });
  if (!result.ok) throw new LabError(result.body.error, result.status, result.body.code);
}

async function managedLabs(access: LabOrderAccess): Promise<ManagedOrderLab[]> {
  const rows: Row[] = [];
  for (let start = 0; start < access.memberships.length; start += 100) {
    const result = await access.service.from("studio_labs").select("*").in("id", access.memberships.slice(start, start + 100).map(row => row.labId));
    if (result.error || !result.data) labOrderDatabaseError(result.error);
    rows.push(...result.data);
  }
  const roles = new Map(access.memberships.map(row => [row.labId, row.role]));
  return rows.map(row => ({ ...labFromRow(row), role: roles.get(String(row.id))! })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    if (value.length > 250) throw Error();
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch { throw new LabError("Reload this order list before loading older orders.", 400, "LAB_ORDER_CURSOR_INVALID"); }
}

export async function readLabOrder(access: LabOrderAccess, id: string): Promise<LabOrder> {
  if (!uuid.safeParse(id).success) throw new LabError("Choose a valid lab order.");
  let query = access.service.from("lab_orders").select("*").eq("id", id);
  if (access.audience === "studio") query = query.eq("photographer_id", access.photographerId!);
  const result = await query.maybeSingle();
  if (result.error) labOrderDatabaseError(result.error);
  if (!result.data || access.audience === "lab" && !access.memberships.some(member => member.labId === result.data.lab_id)) throw new LabError("This lab order is not available to your account.", 404, "LAB_ORDER_NOT_FOUND");
  const events = await access.service.from("lab_order_events").select("*").eq("order_id", id).order("version");
  if (events.error) labOrderDatabaseError(events.error);
  return orderFromRow(result.data, events.data || []);
}

export async function labOrdersWorkspace(access: LabOrderAccess, request: NextRequest): Promise<{ workspace: LabOrdersWorkspace; nextCursor: string | null }> {
  const parameters = request.nextUrl.searchParams;
  const labId = parameters.get("labId");
  if (labId && !uuid.safeParse(labId).success) throw new LabError("Choose a valid lab.");
  const managed = access.audience === "lab" ? await managedLabs(access) : [];
  let chosenLabId = labId;
  if (access.audience === "lab") {
    chosenLabId ||= managed[0]?.id || null;
    if (chosenLabId && !managed.some(lab => lab.id === chosenLabId)) throw new LabError("You do not have access to this lab.", 403, "LAB_PORTAL_FORBIDDEN");
  }
  const labs = access.audience === "lab" ? managed : (await readLabRowsInPages((from, to) => access.service.from("studio_labs").select("*").order("name").order("id").range(from, to), LAB_DIRECTORY_MAX_ROWS)).map(labFromRow);
  const readyLabIds = new Set(labs.filter(lab => lab.status === "active" && lab.intakeEnabled && lab.catalogVerified).map(lab => lab.id));
  const catalog = access.audience === "studio" ? (await readLabRowsInPages((from, to) => access.service.from("studio_lab_catalog").select("*").eq("active", true).eq("verified", true).order("lab_id").order("id").range(from, to), LAB_CATALOG_MAX_ROWS)).map(catalogFromRow).filter(product => readyLabIds.has(product.labId)) : [];
  const workspace: LabOrdersWorkspace = { photographerId: access.photographerId, labs, managedLabs: managed, catalog, assets: [], orders: [] };
  if (access.audience === "lab" && !chosenLabId) return { workspace, nextCursor: null };
  let ordersQuery = access.service.from("lab_orders").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
  if (access.audience === "studio") ordersQuery = ordersQuery.eq("photographer_id", access.photographerId!);
  if (chosenLabId) ordersQuery = ordersQuery.eq("lab_id", chosenLabId);
  const cursor = parseCursor(parameters.get("cursor"));
  if (cursor) ordersQuery = ordersQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const result = await ordersQuery;
  if (result.error || !result.data) labOrderDatabaseError(result.error);
  const page = result.data.slice(0, PAGE_SIZE);
  const events = page.length ? await readLabRowsInPages((from, to) => access.service.from("lab_order_events").select("*").in("order_id", page.map(order => String(order.id))).order("order_id").order("version").range(from, to), PAGE_SIZE * 8) : [];
  workspace.orders = page.map(order => orderFromRow(order, events.filter(event => event.order_id === order.id)));
  const last = page.at(-1);
  return { workspace, nextCursor: result.data.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url") : null };
}

export async function performLabOrderAction(access: LabOrderAccess, action: LabOrderAction) {
  await requireLabOrderAgreement(access);
  if (action.action === "submit" && access.audience !== "studio") throw new LabError("Only a studio can send a production order.", 403);
  if (action.action === "transition") {
    if (access.audience === "studio" && action.status !== "cancelled") throw new LabError("Your studio can cancel a request before the lab accepts it.", 403);
    if (access.audience === "lab" && action.status === "cancelled") throw new LabError("Use decline to return an unaccepted order to its studio.", 403);
    await readLabOrder(access, action.orderId);
  }
  const result = action.action === "submit" ? await access.service.rpc("submit_lab_order", {
    p_actor_user_id: access.userId, p_request_id: action.requestId,
    p_payload: { labId: action.labId, reference: action.reference, notes: action.notes, delivery: action.delivery, items: action.items },
  }) : await access.service.rpc("transition_lab_order", {
    p_actor_user_id: access.userId, p_order_id: action.orderId, p_expected_version: action.expectedVersion, p_request_id: action.requestId,
    p_status: action.status, p_reason: action.reason, p_carrier: action.carrier, p_tracking_number: action.trackingNumber,
  });
  if (result.error) labOrderDatabaseError(result.error);
  const id = result.data?.id;
  if (typeof id !== "string") throw new LabError("The order receipt was unavailable. Refresh your orders before retrying this same request.", 503, "LAB_ORDER_RECEIPT_UNAVAILABLE");
  return readLabOrder(access, id);
}
