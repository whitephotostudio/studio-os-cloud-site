import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { createDashboardServiceClient, isTrustedDashboardRequest } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { productionAccess, type ProductionAccess } from "./production-server";
import { readLabRowsInPages } from "./server";
import { requireLabOrderAgreement } from "./orders-server";
import { loadProductionV2Job } from "./production-v2-server";
import { prepareProductionV2Files } from "./production-v2-files";
import { connectorError, connectorHash, connectorStableId, connectorManagementSchema } from "./connector-validation";
import { LabError } from "./validation";
type Row=Record<string,unknown>;
const BUCKET="lab-connector-files";

export async function connectorManagementAccess(request:NextRequest){return productionAccess(request,request.nextUrl.searchParams.get("audience")==="lab"?"lab":"studio");}
async function targets(access:ProductionAccess){
 if(access.audience==="studio")return[{id:access.photographerId!,kind:"in_house" as const,label:"My in-house test workspace"}];
 const ids=access.memberships.filter(m=>m.role!=="viewer").map(m=>m.labId);
 if(!ids.length)return[];
 const r=await access.service.from("studio_labs").select("id,name").in("id",ids).limit(2000);
 if(r.error)connectorError(r.error);
 return(r.data||[]).map(r=>({id:String(r.id),kind:"partner_lab" as const,label:String(r.name)}));
}
export async function connectorWorkspace(access:ProductionAccess){
 const t=await targets(access);
 const d=t.length?await readLabRowsInPages((from,to)=>access.service.from("lab_connector_devices").select("id,name,target_kind,target_id,created_at,last_seen_at,expires_at,revoked_at").in("target_id",t.map(t=>t.id)).order("created_at",{ascending:false}).order("id").range(from,to),2000):[];
 return{targets:t,devices:d.filter(d=>t.some(t=>t.kind===d.target_kind&&t.id===d.target_id)).map(d=>({id:String(d.id),name:String(d.name),targetLabel:t.find(t=>t.kind===d.target_kind&&t.id===d.target_id)!.label,createdAt:d.created_at,lastSeenAt:d.last_seen_at,expiresAt:d.expires_at,revokedAt:d.revoked_at})),testOnly:true,printAllowed:false};
}
export async function manageConnector(access:ProductionAccess,action:z.infer<typeof connectorManagementSchema>){
 await requireLabOrderAgreement(access);
 if(action.action==="create_pair"){
  if(!(await targets(access)).some(t=>t.kind===action.targetKind&&t.id===action.targetId))throw new LabError("Choose a workspace you receive orders for.",404,"CONNECTOR_FORBIDDEN");
  const code=randomBytes(16).toString("hex");
  const r=await access.service.rpc("create_lab_connector_pair",{p_user_id:access.userId,p_kind:action.targetKind,p_target:action.targetId,p_name:action.name,p_code_hash:connectorHash(code)});
  if(r.error)connectorError(r.error);
  return{...await connectorWorkspace(access),pairCode:code.match(/.{1,8}/g)!.join("-"),expiresAt:r.data.expiresAt};
 }
 if(action.action==="revoke"){
  const r=await access.service.rpc("revoke_lab_connector",{p_user_id:access.userId,p_device_id:action.deviceId});if(r.error)connectorError(r.error);return connectorWorkspace(access);
 }
 const job=await loadProductionV2Job(access,action.jobId);
 if(!job.canReceive)throw new LabError("The receiving workspace seals its own reviewed files.",404,"CONNECTOR_FORBIDDEN");
 const existing=await access.service.from("lab_connector_dispatches").select("id,job_id,expected_version").eq("created_by",access.userId).eq("request_id",action.requestId).maybeSingle();
 if(existing.error)connectorError(existing.error);
 if(existing.data){if(existing.data.job_id!==action.jobId||existing.data.expected_version!==action.expectedVersion)connectorError({message:"REQUEST_CONFLICT"});return{...await connectorWorkspace(access),dispatchId:existing.data.id,replayed:true};}
 if(job.version!==action.expectedVersion||job.status!=="in_production"||job.dispatchState!=="idle")connectorError({message:"HELD"});
 const output=await prepareProductionV2Files(access,job.id),id=connectorStableId(`${access.userId}:${action.requestId}:dispatch`);
 const manifest={...output.manifest,dispatchId:id},bytes=Buffer.from(JSON.stringify(manifest,null,2));
 const bucket=await access.service.storage.getBucket(BUCKET);if(bucket.error||bucket.data?.public!==false)throw new LabError("Private helper storage is unavailable.",503);
 for(const [name,body] of [["manifest.json",bytes],["8x10.jpg",output.files.get("8x10")!],["10x7.jpg",output.files.get("10x7")!]] as const){
  const key=`${id}/${name}`,r=await access.service.storage.from(BUCKET).upload(key,body,{contentType:name.endsWith("json")?"application/json":"image/jpeg",cacheControl:"0",upsert:false});
  if(r.error){const old=await access.service.storage.from(BUCKET).download(key);if(old.error||!old.data||old.data.size!==body.length||connectorHash(Buffer.from(await old.data.arrayBuffer()))!==connectorHash(body))throw new LabError("Retry this same helper request. Its sealed files were not replaced.",409,"CONNECTOR_CONFLICT");}
 }
 const r=await access.service.rpc("queue_lab_connector_dispatch",{p_user_id:access.userId,p_job_id:job.id,p_expected_version:action.expectedVersion,p_request_id:action.requestId,p_dispatch_id:id,p_manifest:manifest,p_manifest_sha256:connectorHash(bytes)});
 if(r.error)connectorError(r.error);
 return{...await connectorWorkspace(access),dispatchId:id,replayed:r.data.replayed===true};
}

export async function connectorRequestGuard(request:NextRequest){
 if(!isTrustedDashboardRequest(request))throw new LabError("Use the paired Windows helper.",403,"CONNECTOR_ORIGIN");
 const r=await rateLimit(getClientIp(request),{namespace:"lab-connector",limit:90,windowSeconds:60,failClosed:true});
 if(!r.allowed)throw new LabError("The helper request limit was reached. Wait a moment before retrying.",r.unavailable?503:429,"CONNECTOR_RATE_LIMIT");
 return createDashboardServiceClient();
}
export async function connectorDeviceAuth(request:NextRequest){
 const service=await connectorRequestGuard(request),m=/^Bearer ([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(request.headers.get("authorization")||"");
 if(!m||!z.string().uuid().safeParse(m[1]).success)connectorError({message:"AUTH"});
 const id=m![1],tokenHash=connectorHash(m![2]),r=await service.rpc("authorize_lab_connector",{p_device_id:id,p_token_hash:tokenHash});if(r.error)connectorError(r.error);
 return{service,id,tokenHash,device:r.data as {id:string;targetKind:string;targetId:string;createdBy:string}};
}
export async function connectorDispatchFile(request:NextRequest){
 const access=await connectorDeviceAuth(request),id=z.string().uuid().parse(request.nextUrl.searchParams.get("dispatchId")),file=z.enum(["manifest","8x10","10x7"]).parse(request.nextUrl.searchParams.get("file"));
 const r=await access.service.from("lab_connector_dispatches").select("*").eq("id",id).eq("device_id",access.id).maybeSingle();if(r.error)connectorError(r.error);
 const d=r.data as Row|null;
 if(!d||d.target_kind!==access.device.targetKind||d.target_id!==access.device.targetId||!["claimed","staged_for_review"].includes(String(d.state)))connectorError({message:"FORBIDDEN"});
 const manifest=d!.manifest as {sheets:{size:string;byteSize:number;sha256:string}[]};
 const name=`${file}.${file==="manifest"?"json":"jpg"}`,expected=manifest.sheets.find(s=>s.size===file);
 const f=await access.service.storage.from(BUCKET).download(`${id}/${name}`);
 if(f.error||!f.data||f.data.size>(file==="manifest"?50000:4000000))throw new LabError("This sealed file is unavailable.",503,"CONNECTOR_STORAGE");
 const bytes=Buffer.from(await f.data.arrayBuffer());if(connectorHash(bytes)!==(file==="manifest"?d!.manifest_sha256:expected?.sha256)||file!=="manifest"&&bytes.length!==expected?.byteSize)throw new LabError("This sealed file failed its integrity check.",409,"CONNECTOR_INTEGRITY");
 return{bytes,name};
}
