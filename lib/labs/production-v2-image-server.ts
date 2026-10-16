import { createHash, randomUUID } from "node:crypto";
import type { ProductionAccess } from "./production-server";
import { loadProductionV2Asset, loadProductionV2Job, productionV2AssetFromRow, productionV2DatabaseError, productionV2RegistrationMatches, type ProductionV2InternalAsset } from "./production-v2-server";
import { PRODUCTION_V2_BUCKET } from "./production-v2-validation";
import { inspectProductionImage, normalizeProductionCorrection, productionHash, renderProductionCrop, renderProductionPreview } from "./production-renderer";
import { publicProductionAsset } from "./production-image-server";
import type { ProductionV2AssetRegistration, ProductionV2OwnerAction, ProductionV2SlotId } from "./production-v2-types";
import { LabError } from "./validation";
type Service=ProductionAccess["service"];
export async function productionV2Bytes(service:Service,asset:ProductionV2InternalAsset):Promise<Buffer>{
 if(asset.storageKey!==`${asset.photographerId}/${asset.id}.${asset.contentType==="image/png"?"png":"jpg"}`)throw new LabError("The immutable file identity is invalid.",409,"PRODUCTION_INTEGRITY");
 const result=await service.storage.from(asset.bucket).download(asset.storageKey);
 if(result.error||!result.data||result.data.size!==asset.byteSize||result.data.size>4_000_000)throw new LabError("The private file is unavailable.",503,"PRODUCTION_STORAGE");
 const bytes=Buffer.from(await result.data.arrayBuffer());if(productionHash(bytes)!==asset.sha256)throw new LabError("The immutable file failed its checksum.",409,"PRODUCTION_INTEGRITY");return bytes;
}
export async function productionV2Preview(service:Service,asset:ProductionV2InternalAsset){return renderProductionPreview(await productionV2Bytes(service,asset));}
async function upload(service:Service,document:ProductionV2AssetRegistration,bytes:Buffer){
 const bucket=await service.storage.getBucket(PRODUCTION_V2_BUCKET);if(bucket.error||bucket.data?.public!==false)throw new LabError("Private independent-print storage is unavailable.",503,"PRODUCTION_STORAGE");
 const result=await service.storage.from(PRODUCTION_V2_BUCKET).upload(document.storageKey,bytes,{contentType:document.contentType,cacheControl:"0",upsert:false});
 if(result.error){const old=await service.storage.from(PRODUCTION_V2_BUCKET).download(document.storageKey);if(old.error||!old.data)throw new LabError("The immutable upload could not be confirmed. Retry the retained request.",503,"PRODUCTION_STORAGE");if(old.data.size!==bytes.length||productionHash(Buffer.from(await old.data.arrayBuffer()))!==document.sha256)throw new LabError("This request already names different file bytes.",409,"PRODUCTION_REQUEST_CONFLICT");}
}
async function reconcile(service:Service,document:ProductionV2AssetRegistration,ownerId:string,error:{message?:string;code?:string}|null):Promise<ProductionV2InternalAsset>{
 const result=await service.from("lab_production_v2_assets").select("*").eq("id",document.id).maybeSingle();
 if(!result.error&&result.data){const asset=productionV2AssetFromRow(result.data);if(productionV2RegistrationMatches(asset,document,ownerId))return asset;throw new LabError("The immutable file identity belongs to different details.",409,"PRODUCTION_REQUEST_CONFLICT");}
 // A missing row after a transport failure does not prove a remote transaction
 // cannot still commit. Only a definite database rejection permits cleanup.
 if(!result.error&&!result.data&&error?.code&&["PT409","22023","42501","23505","23514","23502","22P02","22003"].includes(error.code))await service.storage.from(PRODUCTION_V2_BUCKET).remove([document.storageKey]).catch(()=>undefined);
 return productionV2DatabaseError(error||result.error);
}
export async function uploadProductionV2Correction(access:ProductionAccess,file:File,jobId:string,slotId:ProductionV2SlotId,reviewedCropId:string){
 let bytes:Buffer=Buffer.from(await file.arrayBuffer());let inspected=await inspectProductionImage(bytes);
 const job=await loadProductionV2Job(access,jobId),slot=job.slots.find(s=>s.id===slotId);
 if(!job.canReceive||job.status!=="accepted"||job.dispatchState!=="idle"||!job.policy.labColourCorrection||!slot?.cropAsset||!slot.cropApproved)throw new LabError("Accept the job and approve this print's crop before colour work.",409,"PRODUCTION_HELD");
 if(reviewedCropId!==slot.cropAsset.id)throw new LabError("This print's crop changed. Review its current exact file.",409,"PRODUCTION_STALE_RENDER");
 if(inspected.widthPixels!==slot.cropAsset.widthPixels||inspected.heightPixels!==slot.cropAsset.heightPixels)throw new LabError("Keep the exact approved crop dimensions when correcting colour.",400,"PRODUCTION_GEOMETRY");
 const source=await loadProductionV2Asset(access,reviewedCropId,jobId);
 bytes=await normalizeProductionCorrection(bytes);inspected=await inspectProductionImage(bytes);
 const id=randomUUID();const name=file.name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g,"").replace(/\.[^.]*$/,"").trim().slice(0,160)||"colour-review";
 const document:ProductionV2AssetRegistration={...inspected,contentType:"image/jpeg",id,kind:"corrected",filename:`${name}.jpg`,storageKey:`${source.photographerId}/${id}.jpg`,jobId,slotId,sourceAssetId:reviewedCropId};
 await upload(access.service,document,bytes);
 const result=await access.service.rpc("register_lab_production_v2_asset",{p_user_id:access.userId,p_document:document});
 const asset=result.error||!result.data?await reconcile(access.service,document,source.photographerId,result.error):productionV2AssetFromRow(result.data);return publicProductionAsset(asset);
}
export async function saveProductionV2Crop(access:ProductionAccess,action:Extract<ProductionV2OwnerAction,{action:"save_crop"}>){
 const job=await loadProductionV2Job(access,action.jobId),slot=job.slots.find(s=>s.id===action.slotId);
 if(!job.canCrop||!slot)throw new LabError("Cropping this exact print is assigned to another workspace.",403,"PRODUCTION_FORBIDDEN");
 const source=await loadProductionV2Asset(access,slot.source.id,job.id);
 const bytes=await renderProductionCrop(await productionV2Bytes(access.service,source),source,slot.size,action.rect);
 const hex=createHash("sha256").update(`production-v2:${access.userId}:${action.jobId}:${action.requestId}`).digest("hex").slice(0,32);
 const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
 const document:ProductionV2AssetRegistration={...await inspectProductionImage(bytes),contentType:"image/jpeg",id,kind:"crop",filename:`${action.slotId}-crop.jpg`,storageKey:`${source.photographerId}/${id}.jpg`,jobId:job.id,slotId:action.slotId,sourceAssetId:source.id};
 await upload(access.service,document,bytes);
 const result=await access.service.rpc("save_lab_production_v2_crop",{p_user_id:access.userId,p_job_id:job.id,p_expected_version:action.expectedVersion,p_request_id:action.requestId,p_slot_id:action.slotId,p_crop:action.rect,p_asset_document:document});
 if(result.error||!result.data){await reconcile(access.service,document,source.photographerId,result.error);productionV2DatabaseError(result.error);}
 return{job:await loadProductionV2Job(access,job.id),replayed:result.data.replayed===true};
}
