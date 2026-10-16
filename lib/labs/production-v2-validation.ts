import { z } from "zod";
import { LabError } from "./validation";
import { parseProductionOwnerAction, productionCropSchema } from "./production-validation";
import { PRODUCTION_V2_SLOT_IDS, type ProductionV2OwnerAction, type ProductionV2ParentAction } from "./production-v2-types";
export const PRODUCTION_V2_BUCKET = "lab-production-v2-files";
const uuid=z.string().uuid(), version=z.number().int().min(1).max(2_000_000_000), token=z.string().regex(/^[a-f0-9]{64}$/), slotId=z.enum(PRODUCTION_V2_SLOT_IDS);
const base={jobId:uuid,expectedVersion:version,requestId:uuid};
const reason=z.string().trim().min(5).max(500).refine(s=>!/[\x00-\x1f\x7f]/.test(s));
const selections=z.object({"8x10":uuid,"5x7-a":uuid,"5x7-b":uuid}).strict();
const owner=z.discriminatedUnion("action",[
 z.object({action:z.literal("approve_order"),...base}).strict(),z.object({action:z.literal("accept"),...base}).strict(),
 z.object({action:z.literal("set_slot_source"),...base,slotId,photoId:uuid}).strict(),
 z.object({action:z.literal("save_crop"),...base,slotId,rect:productionCropSchema}).strict(),
 z.object({action:z.literal("approve_crop"),...base,slotId,assetId:uuid}).strict(),
 z.object({action:z.literal("complete_colour"),...base,slotId,assetId:uuid,reviewNoChange:z.boolean()}).strict(),
 z.object({action:z.literal("final_review"),...base,slotId,assetId:uuid}).strict(),
 z.object({action:z.literal("transition"),...base,status:z.enum(["in_production","ready","completed"])}).strict(),
 z.object({action:z.literal("reopen"),...base,reason}).strict(),
 z.object({action:z.literal("reprint"),...base,reason,receiptToken:token}).strict(),
]);
const parent=z.discriminatedUnion("action",[
 z.object({action:z.literal("gallery"),galleryId:uuid,accessToken:token}).strict(),
 z.object({action:z.literal("photo"),galleryId:uuid,accessToken:token,photoId:uuid}).strict(),
 z.object({action:z.literal("submit"),galleryId:uuid,accessToken:token,requestId:uuid,receiptToken:token,selections,quantity:z.number().int().min(1).max(10)}).strict(),
 z.object({action:z.literal("receipt"),receiptToken:token}).strict(),
]);
export function parseProductionV2OwnerAction(value:unknown):ProductionV2OwnerAction {
 if(value&&typeof value==="object"&&"action" in value&&["save_policy","create_gallery","rotate_gallery","revoke_gallery"].includes(String(value.action)))return parseProductionOwnerAction(value) as ProductionV2OwnerAction;
 const parsed=owner.safeParse(value);if(!parsed.success)throw new LabError("Check the exact print slot, saved version and review details.",400,"PRODUCTION_INVALID");return parsed.data;
}
export function parseProductionV2ParentAction(value:unknown):ProductionV2ParentAction {const parsed=parent.safeParse(value);if(!parsed.success)throw new LabError("Choose one gallery photograph for each print and 1 to 10 package sets.",400,"PRODUCTION_INVALID");return parsed.data;}
