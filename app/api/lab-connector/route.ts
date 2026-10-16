import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { connectorDeviceAuth, connectorDispatchFile, connectorRequestGuard } from "@/lib/labs/connector-server";
import { connectorDeviceSchema, connectorError, connectorHash } from "@/lib/labs/connector-validation";
import { productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This helper rehearsal is unavailable here.",404);
 if(request.nextUrl.searchParams.get("action")==="file"){
  const f=await connectorDispatchFile(request);return new Response(new Uint8Array(f.bytes),{headers:{...productionPrivateHeaders,"Content-Type":f.name.endsWith("json")?"application/json":"image/jpeg","Content-Disposition":`attachment; filename="${f.name}"`}});
 }
 if(request.nextUrl.searchParams.get("action")!=="next")throw new LabError("Choose a helper action.",400);
 const a=await connectorDeviceAuth(request),r=await a.service.rpc("claim_lab_connector_dispatch",{p_device_id:a.id,p_token_hash:a.tokenHash});if(r.error)connectorError(r.error);
 return NextResponse.json({ok:true,dispatch:r.data,testOnly:true,printAllowed:false},{headers:productionPrivateHeaders});
}catch(error){return productionImageFailure(error);}}
export async function POST(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This helper rehearsal is unavailable here.",404);
 const body=connectorDeviceSchema.parse(JSON.parse((await readBoundedLabBody(request,16000)).toString("utf8")));
 if(body.action==="pair"){
  const service=await connectorRequestGuard(request),r=await service.rpc("pair_lab_connector",{p_code_hash:connectorHash(body.pairCode.replace(/-/g,"").toLowerCase()),p_device_id:body.deviceId,p_token_hash:connectorHash(body.deviceToken)});if(r.error)connectorError(r.error);
  return NextResponse.json({ok:true,device:r.data},{headers:productionPrivateHeaders});
 }
 const a=await connectorDeviceAuth(request),r=await a.service.rpc("receipt_lab_connector_dispatch",{p_device_id:a.id,p_token_hash:a.tokenHash,p_dispatch_id:body.dispatchId,p_receipt:body.receipt});if(r.error)connectorError(r.error);
 return NextResponse.json({ok:true,...r.data,testOnly:true,printAllowed:false},{headers:productionPrivateHeaders});
}catch(error){return productionImageFailure(error);}}
