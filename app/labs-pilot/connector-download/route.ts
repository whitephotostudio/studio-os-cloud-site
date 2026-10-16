import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionPrivateHeaders } from "@/lib/labs/production-image-server";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(){
 if(!isLabPilot())return new Response(null,{status:404,headers:productionPrivateHeaders});
 try {const bytes=await readFile(path.join(process.cwd(),"public/downloads/studio-os-lab-helper-windows.zip"));
  return new Response(bytes,{headers:{...productionPrivateHeaders,"Content-Type":"application/zip","Content-Disposition":"attachment; filename=studio-os-lab-helper-windows.zip"}});
 }catch{return new Response("The helper package is temporarily unavailable.",{status:503,headers:productionPrivateHeaders});}
}
