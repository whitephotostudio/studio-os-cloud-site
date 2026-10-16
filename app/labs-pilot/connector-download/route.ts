import { isLabPilot } from "@/lib/labs/pilot";
import { productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { LAB_CONNECTOR_PACKAGE_BASE64, LAB_CONNECTOR_PACKAGE_SHA256 } from "@/lib/labs/connector-package";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(){
 if(!isLabPilot())return new Response(null,{status:404,headers:productionPrivateHeaders});
 try {const bytes=Buffer.from(LAB_CONNECTOR_PACKAGE_BASE64,"base64");
  return new Response(bytes,{headers:{...productionPrivateHeaders,"Content-Type":"application/zip","Content-Disposition":"attachment; filename=studio-os-lab-helper-windows.zip","X-Content-SHA256":LAB_CONNECTOR_PACKAGE_SHA256}});
 }catch{return new Response("The helper package is temporarily unavailable.",{status:503,headers:productionPrivateHeaders});}
}
