import { z } from "zod";
import type { ProductionAsset, ProductionCrop } from "./production-types";

export const SHEET_PAPERS = [
  { id: "4x6", name: "4 × 6 in", widthInches: 4, heightInches: 6 },
  { id: "5x7", name: "5 × 7 in", widthInches: 5, heightInches: 7 },
  { id: "7x10", name: "7 × 10 in", widthInches: 7, heightInches: 10 },
  { id: "8x10", name: "8 × 10 in", widthInches: 8, heightInches: 10 },
  { id: "8x12", name: "8 × 12 in", widthInches: 8, heightInches: 12 },
  { id: "12x18", name: "12 × 18 in", widthInches: 12, heightInches: 18 },
] as const;
export type SheetPaperId = typeof SHEET_PAPERS[number]["id"];
export type SheetCellGeometry = { id: string; label: string; xInches: number; yInches: number; widthInches: number; heightInches: number };
export const SHEET_TEMPLATES = [
  { id: "single-8x10", name: "One 8 × 10", widthInches: 8, heightInches: 10, cells: [{ id: "a", label: "8 × 10", xInches: 0, yInches: 0, widthInches: 8, heightInches: 10 }] },
  { id: "two-5x7", name: "Two 5 × 7", widthInches: 10, heightInches: 7, cells: [{ id: "a", label: "5 × 7 A", xInches: 0, yInches: 0, widthInches: 5, heightInches: 7 }, { id: "b", label: "5 × 7 B", xInches: 5, yInches: 0, widthInches: 5, heightInches: 7 }] },
  { id: "single-5x7", name: "One 5 × 7", widthInches: 5, heightInches: 7, cells: [{ id: "a", label: "5 × 7", xInches: 0, yInches: 0, widthInches: 5, heightInches: 7 }] },
  { id: "four-wallets", name: "Four 2½ × 3½ wallets", widthInches: 5, heightInches: 7, cells: [{ id: "a", label: "Wallet A", xInches: 0, yInches: 0, widthInches: 2.5, heightInches: 3.5 }, { id: "b", label: "Wallet B", xInches: 2.5, yInches: 0, widthInches: 2.5, heightInches: 3.5 }, { id: "c", label: "Wallet C", xInches: 0, yInches: 3.5, widthInches: 2.5, heightInches: 3.5 }, { id: "d", label: "Wallet D", xInches: 2.5, yInches: 3.5, widthInches: 2.5, heightInches: 3.5 }] },
  { id: "single-4x6", name: "One 4 × 6", widthInches: 4, heightInches: 6, cells: [{ id: "a", label: "4 × 6", xInches: 0, yInches: 0, widthInches: 4, heightInches: 6 }] },
] as const;
export type SheetTemplateId = typeof SHEET_TEMPLATES[number]["id"];
export type SheetCell = { id: string; assetId: string | null; crop: ProductionCrop | null };
export type SheetDocument = { paperId: SheetPaperId; orientation: 0 | 90; templateId: SheetTemplateId; copies: number; cells: SheetCell[] };
export type SheetGeometry = { widthInches: number; heightInches: number; widthPixels: number; heightPixels: number; cells: SheetCellGeometry[] };
export type SheetRender = { id: string; draftVersion: number; filename: string; sha256: string; byteSize: number; widthPixels: number; heightPixels: number; createdAt: string; reviewedAt: string | null };
export type SheetDraft = { id: string; name: string; jobId: string | null; version: number; document: SheetDocument; render: SheetRender | null; createdAt: string; updatedAt: string };
export type SheetSource = ProductionAsset;
export type SheetWorkspace = { drafts: SheetDraft[]; sources: SheetSource[]; jobId: string | null; jobReference: string | null; canCreate: boolean };
export type SheetAction =
  | { action: "save"; draftId: string; requestId: string; expectedVersion: number; jobId: string | null; name: string; document: SheetDocument }
  | { action: "render"; draftId: string; requestId: string; expectedVersion: number }
  | { action: "review"; draftId: string; renderId: string; expectedVersion: number; sha256: string };
export type SheetResponse = { ok: boolean; message?: string; code?: string; workspace?: SheetWorkspace; draft?: SheetDraft; replayed?: boolean };
export const SHEET_BUCKET = "lab-sheet-layout-files";
export const SHEET_MAX_BYTES = 4_000_000;
export const SHEET_DPI = 300;
export const SHEET_MIN_PPI = 200;
const uuid = z.string().uuid();
const cropSchema = z.object({ x: z.number().int().min(0).max(16000), y: z.number().int().min(0).max(16000), width: z.number().int().min(1).max(16000), height: z.number().int().min(1).max(16000), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }).strict();
const documentSchema = z.object({ paperId: z.enum(["4x6", "5x7", "7x10", "8x10", "8x12", "12x18"]), orientation: z.union([z.literal(0), z.literal(90)]), templateId: z.enum(["single-8x10", "two-5x7", "single-5x7", "four-wallets", "single-4x6"]), copies: z.number().int().min(1).max(10), cells: z.array(z.object({ id: z.enum(["a", "b", "c", "d"]), assetId: uuid.nullable(), crop: cropSchema.nullable() }).strict()).min(1).max(4) }).strict();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), draftId: uuid, requestId: uuid, expectedVersion: z.number().int().min(0).max(100000), jobId: uuid.nullable(), name: z.string().trim().min(1).max(100), document: documentSchema }).strict(),
  z.object({ action: z.literal("render"), draftId: uuid, requestId: uuid, expectedVersion: z.number().int().min(1).max(100000) }).strict(),
  z.object({ action: z.literal("review"), draftId: uuid, renderId: uuid, expectedVersion: z.number().int().min(1).max(100000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export function parseSheetAction(value: unknown): SheetAction { const action = actionSchema.parse(value); if (action.action === "save") sheetGeometry(action.document); return action; }
/** Finished print dimensions never change when selecting a different paper. */
export function sheetGeometry(document: SheetDocument): SheetGeometry {
  const paper = SHEET_PAPERS.find(p => p.id === document.paperId), template = SHEET_TEMPLATES.find(t => t.id === document.templateId);
  if (!paper || !template || ![0, 90].includes(document.orientation)) throw new Error("SHEET_INVALID_LAYOUT");
  const width = document.orientation === 90 ? paper.heightInches : paper.widthInches, height = document.orientation === 90 ? paper.widthInches : paper.heightInches;
  if (template.widthInches > width || template.heightInches > height) throw new Error("SHEET_LAYOUT_DOES_NOT_FIT");
  const ids = document.cells.map(c => c.id);
  if (ids.length !== template.cells.length || new Set(ids).size !== ids.length || template.cells.some(c => !ids.includes(c.id))) throw new Error("SHEET_INVALID_CELLS");
  const x = (width - template.widthInches) / 2, y = (height - template.heightInches) / 2;
  const cells: SheetCellGeometry[] = template.cells.map(c => ({ ...c, xInches: c.xInches + x, yInches: c.yInches + y }));
  for (const cell of cells) {
    if (cell.xInches < 0 || cell.yInches < 0 || cell.xInches + cell.widthInches > width || cell.yInches + cell.heightInches > height) throw new Error("SHEET_LAYOUT_DOES_NOT_FIT");
    if (cells.some(other => other.id !== cell.id && cell.xInches < other.xInches + other.widthInches && other.xInches < cell.xInches + cell.widthInches && cell.yInches < other.yInches + other.heightInches && other.yInches < cell.yInches + cell.heightInches)) throw new Error("SHEET_INVALID_OVERLAP");
  }
  return { widthInches: width, heightInches: height, widthPixels: width * SHEET_DPI, heightPixels: height * SHEET_DPI, cells };
}
/** Crop rectangle uses EXIF-upright source pixels, then rotation is applied. */
export function validateSheetCrop(source: SheetSource, crop: ProductionCrop, cell: SheetCellGeometry) {
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > source.widthPixels || crop.y + crop.height > source.heightPixels || ![0,90,180,270].includes(crop.rotation)) throw new Error("SHEET_INVALID_CROP");
  const turn = crop.rotation === 90 || crop.rotation === 270, w = turn ? crop.height : crop.width, h = turn ? crop.width : crop.height;
  if (Math.abs((w / h) / (cell.widthInches / cell.heightInches) - 1) > 0.002) throw new Error("SHEET_CROP_ASPECT");
  const retainedPpi = Math.min(w / cell.widthInches, h / cell.heightInches);
  if (retainedPpi < SHEET_MIN_PPI) throw new Error("SHEET_CROP_RESOLUTION");
  return { retainedPpi, widthPixels: cell.widthInches * SHEET_DPI, heightPixels: cell.heightInches * SHEET_DPI };
}
