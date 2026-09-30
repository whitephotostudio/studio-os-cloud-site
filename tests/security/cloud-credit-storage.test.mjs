import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { r2PresignedGetUrl, r2PresignedPutUrl } from "../../lib/r2-signed-urls.ts";

const source=(name)=>readFileSync(new URL(`../../${name}`,import.meta.url),"utf8");
test("generic signed GET and PUT cannot expose or overwrite a cloud credit output",()=>{
  assert.equal(r2PresignedGetUrl("credits/other-account/job.png"),"");
  assert.equal(r2PresignedPutUrl("credits/other-account/job.png"),"");
});
test("legacy storage proxies reject server output namespace before school compatibility lookups",()=>{
  const image=source("app/api/r2/img/[...path]/route.ts");
  const folder=source("app/api/dashboard/storage-folder/route.ts");
  assert.ok(image.indexOf("isServerOnlyR2Key(storagePath)")<image.indexOf("resolveSchoolNamespace(firstSegment)"));
  assert.ok(folder.indexOf("isServerOnlyR2Key(folderPath)")<folder.indexOf("await ownedSchoolId(first)"));
});
test("generic transformations and destructive operations cannot copy or consume server credit outputs",()=>{
  const storage=source("lib/r2.ts");
  for(const name of ["r2Copy","r2Download","r2Delete","r2DeletePrefix"]) {
    const start=storage.indexOf(`export async function ${name}(`);
    const next=storage.indexOf("export ",start+1);
    const block=storage.slice(start,next<0?undefined:next);
    assert.ok(block.indexOf('"credits"')<block.indexOf("getR2Client()"),name);
  }
  const ownership=source("lib/upload-ownership.ts");
  assert.ok(ownership.indexOf("isServerOnlyR2Key(key)")<ownership.indexOf('service.from("schools")'));
});
test("a generic upload cannot overwrite server output; an explicitly owned gateway upload can",async()=>{
  const calls=[];
  const exports={};
  const modules={
    "@aws-sdk/client-s3":{
      S3Client:class {send(command){calls.push(command);return Promise.resolve({});}},
      PutObjectCommand:class {constructor(input){this.input=input;}},
    },
    "@/lib/r2-signed-urls":{r2PresignedGetUrl:()=>""},
    "@/lib/school-photo-deletions":{schoolPhotoFamilyForKey:()=>null},
  };
  const compiled=ts.transpileModule(source("lib/r2.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","exports","process",compiled)(name=>modules[name],exports,{env:{R2_ACCOUNT_ID:"fixture",R2_ACCESS_KEY_ID:"fixture",R2_SECRET_ACCESS_KEY:"fixture"}});
  await assert.rejects(()=>exports.r2Upload("credits/victim/job.png",new Uint8Array([1]),"image/png"));
  assert.equal(calls.length,0);
  assert.equal(await exports.r2Upload("credits/owner/job.png",new Uint8Array([1]),"image/png","private,no-store",{allowCloudCreditOutput:true}),"credits/owner/job.png");
  assert.equal(calls.length,1);
  assert.equal(calls[0].input.Key,"credits/owner/job.png");
});
