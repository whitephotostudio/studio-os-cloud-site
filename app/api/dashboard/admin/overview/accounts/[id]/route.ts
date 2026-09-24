import { NextRequest } from "next/server";
import { z } from "zod";
import { ownerJson, requireOwner } from "@/lib/owner-admin";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();
const noteSchema = z.object({ id: idSchema, body: z.string().trim().min(1).max(2000) }).strict();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const auth = await requireOwner(request);
    if (auth.response) return auth.response;
    const id = idSchema.safeParse((await context.params).id);
    const page = z.coerce.number().int().min(0).max(10000).safeParse(request.nextUrl.searchParams.get("page") ?? 0);
    if (!id.success || !page.success) return ownerJson({ message: "Invalid account or page." }, 400);
    const { data, error } = await auth.service.rpc("owner_account_history", { p_actor: auth.user.id, p_photographer: id.data, p_page: page.data }).abortSignal(AbortSignal.timeout(12000));
    if (error?.code === "P0002") return ownerJson({ message: "Account not found." }, 404);
    if (error || !data) throw error ?? new Error("No history returned");
    return ownerJson(data);
  } catch {
    return ownerJson({ message: "Account history could not be checked. Please retry." }, 503);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await requireOwner(request);
    if (auth.response) return auth.response;
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return ownerJson({ message: "Invalid request origin." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return ownerJson({ message: "Send a JSON note." }, 415);
    const id = idSchema.safeParse((await context.params).id);
    // Bound the body before parsing, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) return ownerJson({ message: "A note is required." }, 400);
    let raw = "", bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16000) { await reader.cancel(); return ownerJson({ message: "Note is too long." }, 413); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return ownerJson({ message: "Invalid note." }, 400); }
    const note = noteSchema.safeParse(parsed);
    if (!id.success || !note.success) return ownerJson({ message: "Use a valid account and a note of 1–2,000 characters." }, 400);
    const limit = await rateLimit(auth.user.id, { namespace: "owner-support-notes", limit: 20, windowSeconds: 60 });
    if (!limit.allowed) return ownerJson({ message: "Too many notes. Please wait a minute." }, 429);
    const { error } = await auth.service.rpc("owner_add_support_note", { p_actor: auth.user.id, p_photographer: id.data, p_id: note.data.id, p_body: note.data.body }).abortSignal(AbortSignal.timeout(12000));
    if (error?.code === "23503") return ownerJson({ message: "Account not found." }, 404);
    if (error?.code === "23505") return ownerJson({ message: "This note request changed. Reload the account before saving." }, 409);
    if (error) throw error;
    return ownerJson({ ok: true });
  } catch {
    return ownerJson({ message: "Could not confirm that the note was saved. Retry the same note safely." }, 503);
  }
}
