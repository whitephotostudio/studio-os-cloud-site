import { createHash } from "node:crypto";
import { z } from "zod";
import { LabError } from "./validation";
const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
export const connectorManagementSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("create_pair"),name:z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/),targetKind:z.enum(["in_house","partner_lab"]),targetId:uuid}).strict(),
 z.object({action:z.literal("revoke"),deviceId:uuid}).strict(),
 z.object({action:z.literal("queue"),jobId:uuid,expectedVersion:z.number().int().min(1),requestId:uuid}).strict(),
]);
export const connectorDeviceSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("pair"),pairCode:z.string().regex(/^[a-fA-F0-9-]{32,39}$/),deviceId:uuid,deviceToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal("receipt"),dispatchId:uuid,receipt:z.object({state:z.literal("staged_for_review"),manifestSha256:hash,files:z.array(z.object({name:z.string().regex(/^[A-Z0-9-]+-(8x10|10x7)\.jpg$/),sha256:hash,byteSize:z.number().int().min(1).max(4000000)}).strict()).length(2)}).strict()}).strict(),
]);
export const connectorHash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
export function connectorStableId(s:string){const h=connectorHash(s);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function connectorError(error:{message?:string}|null):never {
 const m=error?.message||"";
 if(/AUTH/.test(m))throw new LabError("Pair this helper again or ask the lab owner to check its access.",401,"CONNECTOR_AUTH");
 if(/FORBIDDEN/.test(m))throw new LabError("This helper or order is unavailable to your account.",404,"CONNECTOR_FORBIDDEN");
 if(/CONFLICT|HELD/.test(m))throw new LabError("This job changed or has already been sealed for a helper. Refresh its status.",409,"CONNECTOR_CONFLICT");
 if(/INVALID|LIMIT/.test(m))throw new LabError("Check the helper details and exact reviewed files.",400,"CONNECTOR_INVALID");
 throw new LabError("The test helper service is temporarily unavailable. Retry the same request.",503,"CONNECTOR_UNAVAILABLE");
}
