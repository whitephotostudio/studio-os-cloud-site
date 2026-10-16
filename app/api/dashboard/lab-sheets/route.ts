import { NextRequest } from "next/server";
import { sheetGet, sheetPost } from "@/lib/labs/sheet-layout-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) { return sheetGet(request, "studio"); }
export async function POST(request: NextRequest) { return sheetPost(request, "studio"); }
