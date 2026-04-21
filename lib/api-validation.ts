/**
 * Shared JSON body parsing + Zod validation for API routes.
 *
 * Usage:
 *   const parsed = await parseJson(request, BodySchema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data; // fully typed
 *
 * The helper returns either the validated data or a ready-to-return 400
 * NextResponse. Zod issues are included in the response so legitimate
 * callers (our own client code) can debug, but no internal schema
 * details beyond `path` + `message` leak — we don't include the Zod
 * `code`, `expected`/`received`, or any stack traces.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";

export type ParseSuccess<T> = { ok: true; data: T };
export type ParseFailure = { ok: false; response: NextResponse };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export async function parseJson<T>(
  request: NextRequest,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          message: "Invalid request body.",
          issues: formatIssues(result.error),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

function formatIssues(
  error: ZodError,
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
