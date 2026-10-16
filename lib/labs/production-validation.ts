import { z } from "zod";
import { LabError } from "./validation";
import type { ProductionOwnerAction, ProductionParentAction } from "./production-types";
export const PRODUCTION_BODY_BYTES = 24000;
export const PRODUCTION_BUCKET = "lab-production-workflow-files";
const uuid=z.string().uuid(), version=z.number().int().min(1).max(2000000000), token=z.string().regex(/^[a-f0-9]{64}$/), size=z.enum(["8x10","5x7"]);
const text=z.string().trim().min(1).max(100).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
export const productionPolicySchema=z.object({autoApprove:z.boolean(),cropResponsibility:z.enum(["photographer","lab"]),labColourCorrection:z.boolean()}).strict();
export const productionCropSchema=z.object({x:z.number().int().min(0),y:z.number().int().min(0),width:z.number().int().min(1),height:z.number().int().min(1),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])}).strict();
const base={jobId:uuid,expectedVersion:version,requestId:uuid};
const owner=z.discriminatedUnion("action",[
 z.object({action:z.literal("save_policy"),expectedVersion:version,policy:productionPolicySchema}).strict(),
 z.object({action:z.literal("create_gallery"),requestId:uuid,sheetId:uuid,expectedSheetVersion:version,entryId:z.string().min(1).max(200),name:text,assetIds:z.array(uuid).min(1).max(20).refine(v=>new Set(v).size===v.length),accessToken:token,target:z.discriminatedUnion("kind",[z.object({kind:z.literal("in_house")}).strict(),z.object({kind:z.literal("partner_lab"),labId:uuid,product8x10Id:uuid,product5x7Id:uuid}).strict()])}).strict(),
 z.object({action:z.literal("rotate_gallery"),galleryId:uuid,expectedVersion:version,accessToken:token}).strict(),
 z.object({action:z.literal("revoke_gallery"),galleryId:uuid,expectedVersion:version}).strict(),
 z.object({action:z.literal("approve_order"),...base}).strict(),z.object({action:z.literal("accept"),...base}).strict(),
 z.object({action:z.literal("save_crop"),...base,productSize:size,rect:productionCropSchema}).strict(),
 z.object({action:z.literal("approve_crop"),...base,size,assetId:uuid}).strict(),
 z.object({action:z.literal("complete_colour"),...base,size,assetId:uuid,reviewNoChange:z.boolean()}).strict(),
 z.object({action:z.literal("final_review"),...base,size,assetId:uuid}).strict(),
 z.object({action:z.literal("transition"),...base,status:z.enum(["in_production","ready","completed"])}).strict(),
]);
const parent=z.discriminatedUnion("action",[
 z.object({action:z.literal("gallery"),galleryId:uuid,accessToken:token}).strict(),
 z.object({action:z.literal("photo"),galleryId:uuid,accessToken:token,photoId:uuid}).strict(),
 z.object({action:z.literal("submit"),galleryId:uuid,accessToken:token,requestId:uuid,receiptToken:token,photoId:uuid,quantity:z.number().int().min(1).max(10)}).strict(),
 z.object({action:z.literal("receipt"),receiptToken:token}).strict(),
]);
export function parseProductionOwnerAction(value:unknown):ProductionOwnerAction {const r=owner.safeParse(value);if(!r.success)throw new LabError("Check the production settings, exact crop and latest saved version.",400,"PRODUCTION_INVALID");return r.data as ProductionOwnerAction;}
export function parseProductionParentAction(value:unknown):ProductionParentAction {const r=parent.safeParse(value);if(!r.success)throw new LabError("Check the private gallery, selected photograph and quantity.",400,"PRODUCTION_INVALID");return r.data;}
