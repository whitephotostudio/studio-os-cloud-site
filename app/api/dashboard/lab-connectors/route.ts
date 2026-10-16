import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { connectorManagementAccess, connectorWorkspace, manageConnector } from "@/lib/labs/connector-server";
import { connectorManagementSchema } from "@/lib/labs/connector-validation";
import { productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This helper rehearsal is unavailable here.",404);
 return NextResponse.json({ok:true,...await connectorWorkspace(await connectorManagementAccess(request))},{headers:productionPrivateHeaders});
}catch(error){return productionImageFailure(error);}}
export async function POST(request:NextRequest){try{
 if(!isLabPilot())throw new LabError("This helper rehearsal is unavailable here.",404);
 const access=await connectorManagementAccess(request),action=connectorManagementSchema.parse(JSON.parse((await readBoundedLabBody(request,16000)).toString("utf8")));
 return NextResponse.json({ok:true,...await manageConnector(access,action)},{headers:productionPrivateHeaders});
}catch(error){return productionImageFailure(error);}}
