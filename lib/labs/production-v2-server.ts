import type { NextRequest } from "next/server";
import { loadProductionWorkspace, performProductionOwnerAction, productionAssetFromRow, productionDatabaseError, productionParentAccess, type ProductionAccess, type ProductionInternalAsset } from "./production-server";
import { inHouseTestTokenHash } from "./in-house-orders-validation";
import { PRODUCTION_BUCKET } from "./production-validation";
import { PRODUCTION_V2_BUCKET } from "./production-v2-validation";
import { LabError } from "./validation";
import type { ProductionAsset, ProductionPolicy } from "./production-types";
import { PRODUCTION_V2_SLOT_IDS, type ProductionV2AssetRegistration, type ProductionV2Job, type ProductionV2OwnerAction, type ProductionV2ParentAction, type ProductionV2Receipt, type ProductionV2Slot, type ProductionV2SlotId, type ProductionV2Workspace } from "./production-v2-types";
export type ProductionV2InternalAsset = ProductionInternalAsset & { slotId: ProductionV2SlotId | null; bucket: string };
type Row=Record<string,unknown>;
const iso=(v:unknown)=>new Date(String(v)).toISOString();
const publicAsset=(a:ProductionV2InternalAsset):ProductionAsset=>({id:a.id,kind:a.kind,filename:a.filename,sha256:a.sha256,byteSize:a.byteSize,widthPixels:a.widthPixels,heightPixels:a.heightPixels,contentType:a.contentType});
export function productionV2AssetFromRow(row:Row):ProductionV2InternalAsset {
 const original=row.kind==="original";
 return {...productionAssetFromRow({...row,size:original?null:row.slot_id==="8x10"?"8x10":"5x7"}),slotId:original?null:row.slot_id as ProductionV2SlotId,bucket:original?PRODUCTION_BUCKET:PRODUCTION_V2_BUCKET};
}
function allowed(access:ProductionAccess,row:Row){return access.photographerId===row.photographer_id||access.memberships.some(m=>m.labId===row.lab_id);}
function receiving(access:ProductionAccess,row:Row){return row.lab_id==null?access.audience==="studio"&&access.photographerId===row.photographer_id:access.audience==="lab"&&access.memberships.some(m=>m.labId===row.lab_id&&m.role!=="viewer");}
export function productionV2DatabaseError(error:{message?:string;code?:string}|null):never {
 if(/DISPATCH_LOCKED/.test(error?.message||""))throw new LabError("This job has a sealed dispatch or has already been handed off. Use a linked reprint rather than changing its files.",409,"PRODUCTION_DISPATCH_LOCKED");
 return productionDatabaseError(error);
}
async function raw(access:ProductionAccess,id:string):Promise<Row>{const result=await access.service.from("lab_production_v2_jobs").select("*").eq("id",id).maybeSingle();if(result.error)productionV2DatabaseError(result.error);if(!result.data||!allowed(access,result.data))throw new LabError("This production job is unavailable to this account.",404,"PRODUCTION_NOT_FOUND");return result.data;}
export async function loadProductionV2Asset(access:ProductionAccess,id:string,jobId?:string):Promise<ProductionV2InternalAsset>{
 const derived=await access.service.from("lab_production_v2_assets").select("*").eq("id",id).maybeSingle();if(derived.error)productionV2DatabaseError(derived.error);
 if(derived.data){if(jobId&&derived.data.job_id!==jobId)throw new LabError("This file belongs to a different job.",404,"PRODUCTION_NOT_FOUND");await raw(access,String(derived.data.job_id));return productionV2AssetFromRow(derived.data);}
 const source=await access.service.from("lab_production_assets").select("*").eq("id",id).eq("kind","original").maybeSingle();if(source.error)productionV2DatabaseError(source.error);
 if(!source.data)throw new LabError("This immutable original is unavailable.",404,"PRODUCTION_NOT_FOUND");
 if(access.photographerId!==source.data.photographer_id){if(!jobId)throw new LabError("Choose the exact receiving job for this original.",404,"PRODUCTION_NOT_FOUND");const j=await raw(access,jobId);const work=j.work as {slots:Record<string,Row>};if(!Object.values(work.slots).some(s=>s.sourceAssetId===id))throw new LabError("This original is not selected by the receiving job.",404,"PRODUCTION_NOT_FOUND");}
 return productionV2AssetFromRow(source.data);
}
export function productionV2Holds(snapshot:Row,work:Row):string[]{const out:string[]=[];if(work.photographerApproved!==true)out.push("photographer_approval");for(const id of PRODUCTION_V2_SLOT_IDS){const slot=(work.slots as Record<string,Row>)[id];if(slot.cropApproved!==true||!slot.cropAssetId)out.push(`crop_${id}`);if((snapshot.policy as ProductionPolicy).labColourCorrection&&!slot.colourAssetId)out.push(`colour_${id}`);if(!slot.finalReviewedAt)out.push(`final_review_${id}`);}return out;}
async function project(access:ProductionAccess,row:Row):Promise<ProductionV2Job>{
 const snapshot=row.snapshot as Row,work=row.work as Row,slots=work.slots as Record<ProductionV2SlotId,Row>;
 const sourceIds=[...new Set(PRODUCTION_V2_SLOT_IDS.map(id=>String(slots[id].sourceAssetId)))];
 const derivedIds=PRODUCTION_V2_SLOT_IDS.flatMap(id=>[slots[id].cropAssetId,slots[id].colourAssetId]).filter(Boolean).map(String);
 const [sources,assets,events,gallery]=await Promise.all([
  access.service.from("lab_production_assets").select("*").in("id",sourceIds).eq("kind","original").limit(3),
  derivedIds.length?access.service.from("lab_production_v2_assets").select("*").in("id",derivedIds).eq("job_id",row.id).limit(6):Promise.resolve({data:[],error:null}),
  access.service.from("lab_production_v2_events").select("*").eq("job_id",row.id).order("version").limit(1000),
  access.service.from("lab_production_galleries").select("document").eq("id",row.gallery_id).maybeSingle(),
 ]);
 for(const r of [sources,assets,events,gallery])if(r.error)productionV2DatabaseError(r.error);
 const files=new Map([...sources.data||[],...assets.data||[]].map(a=>[String(a.id),publicAsset(productionV2AssetFromRow(a))]));
 const policy=snapshot.policy as ProductionPolicy;
 const projected=PRODUCTION_V2_SLOT_IDS.map(id=>{const s=slots[id],source=files.get(String(s.sourceAssetId));if(!source)throw new LabError("A selected immutable original is unavailable.",503,"PRODUCTION_UNAVAILABLE");const crop=s.cropAssetId?files.get(String(s.cropAssetId))??null:null,colour=s.colourAssetId?files.get(String(s.colourAssetId))??null:null;return{id,photoId:String(s.photoId),size:id==="8x10"?"8x10":"5x7",quantity:Number(snapshot.quantity),widthInches:id==="8x10"?8:5,heightInches:id==="8x10"?10:7,source,crop:s.crop??null,cropAsset:crop,cropApproved:s.cropApproved===true,cropApprovedAt:s.cropApprovedAt??null,colourAsset:colour,colourCompletedAt:s.colourCompletedAt??null,finalReviewedAt:s.finalReviewedAt??null,finalAsset:policy.labColourCorrection?colour:crop} as ProductionV2Slot;});
 const own=access.audience==="studio"&&access.photographerId===row.photographer_id,recv=receiving(access,row),wholesale=access.audience==="lab"&&row.lab_id!=null;
 const offer=snapshot.offer as ProductionV2Job["offer"],unitMinor=wholesale?Number((snapshot.source as Row).wholesalePackageMinor):offer.retailCents;
 return{workflowVersion:2,id:String(row.id),reference:String(row.reference),galleryId:String(row.gallery_id),version:Number(row.version),status:row.status as ProductionV2Job["status"],studioName:String(snapshot.studioName),targetLabel:String(snapshot.targetLabel),targetKind:row.lab_id==null?"in_house":"partner_lab",amountKind:wholesale?"wholesale":"retail",policy,offer:wholesale?{...offer,name:"1 × 8×10 + 2 × 5×7",retailCents:unitMinor}:offer,currency:String(snapshot.currency),quantity:Number(snapshot.quantity),subtotalMinor:unitMinor*Number(snapshot.quantity),slots:projected,availablePhotos:own?(gallery.data?.document as {photos:ProductionV2Job["availablePhotos"]}).photos:[],photographerApproved:work.photographerApproved===true,photographerApprovedAt:work.photographerApprovedAt==null?null:String(work.photographerApprovedAt),holds:productionV2Holds(snapshot,work),events:(events.data||[]).map(e=>({id:String(e.id),action:String(e.action),actorRole:e.actor_role as "photographer"|"lab"|"policy",version:Number(e.version),createdAt:iso(e.created_at)})),dispatchState:row.dispatch_state as ProductionV2Job["dispatchState"],reprintOf:row.reprint_of==null?null:String(row.reprint_of),canReceive:recv,canApproveOrder:own,canCrop:policy.cropResponsibility==="photographer"?own:recv,canChangeSource:own,canReopen:recv&&row.dispatch_state==="idle"&&["in_production","ready"].includes(String(row.status)),canReprint:(own||recv)&&(["ready","completed"].includes(String(row.status))||["claimed","handed_off","printed"].includes(String(row.dispatch_state))),testOnly:true,payment:"test_no_payment",printAllowed:false,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}
export async function loadProductionV2Job(access:ProductionAccess,id:string){return project(access,await raw(access,id));}
export async function loadProductionV2Workspace(access:ProductionAccess):Promise<ProductionV2Workspace>{
 const workspace=await loadProductionWorkspace(access);
 if(access.audience==="lab"&&!access.memberships.length)return{...workspace,jobs:[]};
 let q=access.service.from("lab_production_v2_jobs").select("*").order("created_at",{ascending:false}).limit(600);
 q=access.audience==="studio"?q.eq("photographer_id",access.photographerId!):q.in("lab_id",access.memberships.map(m=>m.labId));const result=await q;if(result.error)productionV2DatabaseError(result.error);
 return{...workspace,jobs:await Promise.all((result.data||[]).filter(r=>allowed(access,r)).map(r=>project(access,r)))};
}
export async function performProductionV2OwnerAction(access:ProductionAccess,action:Exclude<ProductionV2OwnerAction,{action:"save_crop"}>){
 if(action.action==="save_policy"||action.action==="create_gallery"||action.action==="rotate_gallery"||action.action==="revoke_gallery"){const result=await performProductionOwnerAction(access,action);return{...result,workspace:await loadProductionV2Workspace(access)};}
 const job=await loadProductionV2Job(access,action.jobId);
 if(action.action==="reprint"){
  if(!job.canReprint)throw new LabError("Use a separate linked full-package reprint for a ready, completed or sealed job. It does not cancel the original dispatch.",409,"PRODUCTION_TRANSITION");
  const result=await access.service.rpc("reprint_lab_production_v2_job",{p_user_id:access.userId,p_job_id:action.jobId,p_expected_version:action.expectedVersion,p_request_id:action.requestId,p_reason:action.reason,p_receipt_hash:inHouseTestTokenHash(action.receiptToken)});if(result.error)productionV2DatabaseError(result.error);
  return{job:await loadProductionV2Job(access,String(result.data.id)),workspace:await loadProductionV2Workspace(access),replayed:result.data.replayed===true};
 }
 let details:Row={};
 if(action.action==="transition")details={status:action.status};
 else if(action.action==="reopen")details={reason:action.reason};
 else if(action.action==="set_slot_source")details={slotId:action.slotId,photoId:action.photoId};
 else if("assetId" in action)details={slotId:action.slotId,assetId:action.assetId,...(action.action==="complete_colour"?{reviewNoChange:action.reviewNoChange}:{})};
 if(access.audience==="lab"&&action.action==="approve_order")throw new LabError("Only the photographer can release this order.",403,"PRODUCTION_FORBIDDEN");
 const result=await access.service.rpc("act_lab_production_v2_job",{p_user_id:access.userId,p_job_id:action.jobId,p_expected_version:action.expectedVersion,p_request_id:action.requestId,p_action:action.action,p_details:details});if(result.error)productionV2DatabaseError(result.error);
 return{job:await loadProductionV2Job(access,action.jobId),workspace:await loadProductionV2Workspace(access),replayed:result.data.replayed===true};
}
export async function performProductionV2ParentAction(request:NextRequest,action:Exclude<ProductionV2ParentAction,{action:"photo"}>){
 const service=await productionParentAccess(request);let result;
 if(action.action==="gallery")result=await service.rpc("read_lab_production_gallery",{p_gallery_id:action.galleryId,p_token_hash:inHouseTestTokenHash(action.accessToken)});
 else if(action.action==="receipt")result=await service.rpc("read_lab_production_v2_receipt",{p_receipt_hash:inHouseTestTokenHash(action.receiptToken)});
 else result=await service.rpc("submit_lab_production_v2_order",{p_gallery_id:action.galleryId,p_token_hash:inHouseTestTokenHash(action.accessToken),p_request_id:action.requestId,p_receipt_hash:inHouseTestTokenHash(action.receiptToken),p_selections:action.selections,p_quantity:action.quantity});
 if(result.error)productionV2DatabaseError(result.error);
 return action.action==="gallery"?{gallery:result.data}:{receipt:result.data as ProductionV2Receipt,replayed:result.data.replayed===true};
}
export function productionV2RegistrationMatches(row:ProductionV2InternalAsset,document:ProductionV2AssetRegistration,ownerId:string){return row.photographerId===ownerId&&row.id===document.id&&row.kind===document.kind&&row.jobId===document.jobId&&row.slotId===document.slotId&&row.sourceAssetId===document.sourceAssetId&&row.filename===document.filename&&row.storageKey===document.storageKey&&row.sha256===document.sha256&&row.byteSize===document.byteSize&&row.widthPixels===document.widthPixels&&row.heightPixels===document.heightPixels&&row.contentType===document.contentType;}
