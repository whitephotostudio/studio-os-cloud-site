import { NextRequest } from "next/server";
import { z } from "zod";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionAccess } from "@/lib/labs/production-server";
import { loadProductionV2Asset } from "@/lib/labs/production-v2-server";
import { productionV2Bytes, productionV2Preview, uploadProductionV2Correction } from "@/lib/labs/production-v2-image-server";
import { productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { PRODUCTION_MAX_BYTES } from "@/lib/labs/production-renderer";
import { PRODUCTION_V2_SLOT_IDS } from "@/lib/labs/production-v2-types";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { requireLabOrderAgreement } from "@/lib/labs/orders-server";
import { LabError } from "@/lib/labs/validation";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const audience=(v:unknown)=>v==="lab"?"lab" as const:"studio" as const;
export async function GET(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This private rehearsal is unavailable here.",404);
 const id=z.string().uuid().parse(request.nextUrl.searchParams.get("assetId")),jobValue=request.nextUrl.searchParams.get("jobId"),jobId=jobValue?z.string().uuid().parse(jobValue):undefined;
 const access=await productionAccess(request,audience(request.nextUrl.searchParams.get("audience"))),asset=await loadProductionV2Asset(access,id,jobId),preview=request.nextUrl.searchParams.get("preview")==="1";
 const bytes=preview?await productionV2Preview(access.service,asset):await productionV2Bytes(access.service,asset);
 return new Response(new Uint8Array(bytes),{headers:{...productionPrivateHeaders,"Content-Type":preview?"image/jpeg":asset.contentType,"Content-Disposition":`${preview?"inline":"attachment"}; filename="${preview?"preview.jpg":`${asset.id}.${asset.contentType==="image/png"?"png":"jpg"}`}"`}});
}catch(error){return productionImageFailure(error);}}
export async function POST(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This private rehearsal is unavailable here.",404);
 const type=request.headers.get("content-type")||"";if(!/^multipart\/form-data\s*;/i.test(type))throw new LabError("Choose a corrected JPEG or PNG file.",400);
 const body=await readBoundedLabBody(request,PRODUCTION_MAX_BYTES+250_000);let form:FormData;try{form=await new Response(new Uint8Array(body),{headers:{"Content-Type":type}}).formData();}catch{throw new LabError("This corrected upload could not be read.",400);}
 if(Array.from(form.keys()).some(k=>!["file","kind","audience","jobId","slotId","sourceAssetId"].includes(k)))throw new LabError("Unsupported independent-print upload fields.",400);
 if(form.get("kind")!=="corrected")throw new LabError("Upload original photographs through the existing original-file uploader.",400);
 const access=await productionAccess(request,audience(form.get("audience")));if(access.audience==="studio")await requireLabOrderAgreement(access);
 const quota=await rateLimit(access.userId,{namespace:"lab-production-v2-upload",limit:30,windowSeconds:60,failClosed:true});if(!quota.allowed)throw new LabError("Please wait before uploading more corrected files.",quota.unavailable?503:429);
 const file=form.get("file");if(!(file instanceof File)||file.size>PRODUCTION_MAX_BYTES)throw new LabError("Choose a JPEG or PNG up to4MB.",400);
 const jobId=z.string().uuid().parse(form.get("jobId")),slotId=z.enum(PRODUCTION_V2_SLOT_IDS).parse(form.get("slotId")),sourceId=z.string().uuid().parse(form.get("sourceAssetId"));
 return Response.json({ok:true,asset:await uploadProductionV2Correction(access,file,jobId,slotId,sourceId)},{headers:productionPrivateHeaders});
}catch(error){return productionImageFailure(error);}}
