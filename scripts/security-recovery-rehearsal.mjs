#!/usr/bin/env node
// Explicit, local-only partial recovery rehearsal. Archived SQL is never executed.
import {promises as fs,constants as C,createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

export const REVIEWED_RESTORE_TOOL_SHA256='a8dd408dd5d1d54cf5c4ba9bf7ce6d9a5e3b3493e8226bb927a43d74efb62e00';
export const SELECTED_MEMBERS={catalog:'prepare-final-recovery-20261012/final-recovery-catalog-private.json',data:'prepare-final-recovery-20261012/final-data-checkpoint-private.json'};
const MAX_ARCHIVE=2*1024**3,MAX_INPUT=64*1024**2,MAX_INDEX=4*1024**2,MAX_RECORDS=250000,MAX_RELATIONS=1000,MAX_TIME=20*60*1000;
const here=fileURLToPath(import.meta.url),repo=path.dirname(path.dirname(here));
const codeError=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw codeError(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(file,dir)=>file===dir||file.startsWith(dir+path.sep);
const identifier=value=>{if(typeof value!=='string'||!value||value.includes('\0'))fail('INVALID_IDENTIFIER');return '"'+value.replaceAll('"','""')+'"';};
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const key=(schema,name)=>JSON.stringify([schema,name]);
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{12,80}$/.test(value);
const remaining=deadline=>{const left=deadline-Date.now();if(left<=0)fail('RECOVERY_TIMEOUT');return left;};

export async function privatePath(file,{directory=false,maximum=MAX_INPUT}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||inside(file,'/Volumes'))fail('PRIVATE_MAC_PATH_REQUIRED');
 const real=await fs.realpath(file),stat=await fs.lstat(file);
 if(real!==file||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid())||
    (directory?(!stat.isDirectory()||(stat.mode&0o777)!==0o700):(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size>maximum)))fail('PRIVATE_MAC_PATH_REQUIRED');
 return stat;
}
export async function readPrivate(file,maximum=MAX_INPUT){
 await privatePath(path.dirname(file),{directory:true});await privatePath(file,{maximum});
 const handle=await fs.open(file,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
 try{const before=await handle.stat();const data=await handle.readFile();const after=await handle.stat();
  if(!before.isFile()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>maximum||data.length!==before.size||after.mtimeMs!==before.mtimeMs||after.size!==before.size)fail('INPUT_CHANGED');return data;
 }finally{await handle.close();}
}
async function exclusive(file,data){const fd=await fs.open(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}}
async function fileHash(file,signal){const digest=createHash('sha256');for await(const bytes of createReadStream(file,{signal}))digest.update(bytes);return digest.digest('hex');}
export function receiptShape(receipt){
 if(receipt?.format!=='studio-security-checkpoint-v1'||!safeId(receipt.checkpointId)||
    !/^[a-f0-9]{64}$/.test(receipt.archiveSha256||'')||!/^[a-f0-9]{64}$/.test(receipt.ciphertextSha256||'')||
    !Number.isSafeInteger(receipt.archiveBytes)||receipt.archiveBytes<1||receipt.archiveBytes>MAX_ARCHIVE||
    !Number.isSafeInteger(receipt.ciphertextBytes)||receipt.ciphertextBytes<1||receipt.ciphertextBytes>MAX_ARCHIVE+32768||
    !Number.isSafeInteger(receipt.fileCount)||receipt.fileCount<2||receipt.fileCount>MAX_RELATIONS)fail('INVALID_TRUSTED_RECEIPT');return receipt;
}
export function selectedIndex(index,receipt){
 if(index?.format!==receipt.format||index.checkpointId!==receipt.checkpointId||!Array.isArray(index.entries)||index.entries.length!==receipt.fileCount)fail('INVALID_AUTHENTICATED_INDEX');
 const names=new Set();for(const entry of index.entries){
  if(typeof entry.name!=='string'||!entry.name||entry.name.startsWith('/')||entry.name.startsWith('-')||entry.name.split('/').some(part=>!part||part==='.'||part==='..')||names.has(entry.name)||
     !Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>MAX_ARCHIVE||!/^[a-f0-9]{64}$/.test(entry.sha256||''))fail('INVALID_AUTHENTICATED_INDEX');names.add(entry.name);
 }
 return Object.fromEntries(Object.entries(SELECTED_MEMBERS).map(([name,member])=>{const entry=index.entries.find(row=>row.name===member);if(!entry||entry.bytes<1||entry.bytes>MAX_INPUT)fail('SELECTED_MEMBER_MISSING');return[name,entry];}));
}
export async function createScratch(scratch){
 if(typeof scratch!=='string'||!path.isAbsolute(scratch)||inside(scratch,'/Volumes')||inside(scratch,repo)||scratch.includes('\0'))fail('PRIVATE_MAC_PATH_REQUIRED');
 await privatePath(path.dirname(scratch),{directory:true});
 if(path.join(await fs.realpath(path.dirname(scratch)),path.basename(scratch))!==scratch)fail('PRIVATE_MAC_PATH_REQUIRED');
 await fs.mkdir(scratch,{mode:0o700});await privatePath(scratch,{directory:true});return scratch;
}
export function parseCatalog(text){
 let value;try{value=JSON.parse(text);}catch{fail('INVALID_CATALOG');}
 const catalog=value?.rows?.length===1?value.rows[0].recovery_catalog:null;
 if(!catalog||!Array.isArray(catalog.relations)||catalog.relations.length<2||catalog.relations.length>MAX_RELATIONS||!Array.isArray(catalog.constraints))fail('INVALID_CATALOG');
 const seen=new Set();for(const rel of catalog.relations){
  identifier(rel.schema);identifier(rel.name);
  if(!(rel.schema==='public'||rel.schema==='storage'&&['buckets','objects'].includes(rel.name))||!['r','p','v','m','S'].includes(rel.kind)||seen.has(key(rel.schema,rel.name))||!Array.isArray(rel.columns))fail('INVALID_CATALOG');
  seen.add(key(rel.schema,rel.name));const columns=new Set();for(const col of rel.columns){identifier(col.name);if(columns.has(col.name))fail('INVALID_CATALOG');columns.add(col.name);}
 }
 for(const name of ['buckets','objects'])if(!seen.has(key('storage',name)))fail('INVALID_CATALOG');return catalog;
}
export function projectionType(type){
 if(type==='storage.buckettype')return{text:'text',managedTypeMapped:true};
 if(typeof type!=='string'||!/^(?:bigint|boolean|date|double precision|inet|integer|jsonb|numeric(?:\([1-9][0-9]{0,2},[0-9]{1,3}\))?|real|smallint|text(?:\[\])?|time without time zone|timestamp (?:with|without) time zone|uuid(?:\[\])?)$/.test(type))fail('UNSUPPORTED_PROJECTION_TYPE');
 return{text:type,managedTypeMapped:false};
}
function tokens(text){
 const result=[];let i=0;while(i<text.length){if(/\s/.test(text[i])){i++;continue;}if('(),.'.includes(text[i])){result.push(text[i++]);continue;}
  if(text[i]==='"'){let value='';i++;let closed=false;while(i<text.length){if(text[i]==='"'){if(text[i+1]==='"'){value+='"';i+=2;}else{i++;closed=true;break;}}else value+=text[i++];}if(!closed||!value)fail('UNSUPPORTED_FOREIGN_KEY');result.push({id:value});continue;}
  const m=text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/);if(!m)fail('UNSUPPORTED_FOREIGN_KEY');result.push({id:m[0].toLowerCase()});i+=m[0].length;
 }return result;
}
export function parseForeignKey(constraint){
 const parts=tokens(constraint.definition||'');let i=0;
 const word=value=>{if(parts[i++]?.id!==value)fail('UNSUPPORTED_FOREIGN_KEY');};
 const ident=()=>{const value=parts[i++]?.id;if(!value)fail('UNSUPPORTED_FOREIGN_KEY');return value;};
 const list=()=>{if(parts[i++]!=='(')fail('UNSUPPORTED_FOREIGN_KEY');const values=[ident()];while(parts[i]===','){i++;values.push(ident());}if(parts[i++]!==')')fail('UNSUPPORTED_FOREIGN_KEY');return values;};
 word('foreign');word('key');const columns=list();word('references');const first=ident();let targetSchema=constraint.schema,targetName=first;
 if(parts[i]==='.'){i++;targetSchema=first;targetName=ident();}const targetColumns=list();
 if(columns.length!==targetColumns.length||new Set(columns).size!==columns.length||new Set(targetColumns).size!==targetColumns.length)fail('UNSUPPORTED_FOREIGN_KEY');
 let matchFull=false;if(parts[i]?.id==='match'){i++;const mode=ident();if(!['simple','full'].includes(mode))fail('UNSUPPORTED_FOREIGN_KEY');matchFull=mode==='full';}
 // Remaining tokens are never SQL. The source clause is used only for key
 // metadata; UPDATE/DELETE actions and deferrability are not replayed.
 return{columns,targetSchema,targetName,targetColumns,matchFull};
}
function relationByRegclass(catalog,qualified,defaultSchema){
 const parts=tokens(qualified||'');if(parts.length===1&&parts[0]?.id)return catalog.relations.find(row=>row.schema===defaultSchema&&row.name===parts[0].id);
 if(parts.length===3&&parts[0]?.id&&parts[1]==='.'&&parts[2]?.id)return catalog.relations.find(row=>row.schema===parts[0].id&&row.name===parts[2].id);return undefined;
}
export async function populateMirror(db,catalog,dataText){
 // The original UTF-8 bytes go directly to PostgreSQL JSONB. Never parse and
 // reserialize customer records with JS: bigint/numeric lexemes must survive.
 await db.exec('CREATE TABLE recovery_input(doc jsonb NOT NULL); CREATE TABLE recovery_records(schema_name text NOT NULL,relation_name text NOT NULL,kind text NOT NULL,ordinal bigint NOT NULL,data jsonb NOT NULL,PRIMARY KEY(schema_name,relation_name,ordinal)); CREATE SCHEMA projection_checks;');
 await db.query('INSERT INTO recovery_input VALUES($1::jsonb)',[dataText]);
 const shape=await db.query("SELECT jsonb_typeof(doc)='object' AND jsonb_typeof(doc->'rows')='array' AS valid FROM recovery_input");if(shape.rows[0]?.valid!==true)fail('INVALID_DATA_EXPORT');
 const meta=await db.query("SELECT entry->>'schema_name' schema_name,entry->>'relation_name' relation_name,entry->>'relation_kind' kind,(entry->>'row_count')::bigint::text row_count,jsonb_array_length(entry->'records')::text actual_count,entry->>'snapshot_id' snapshot_id,entry->>'captured_at' captured_at FROM recovery_input CROSS JOIN LATERAL jsonb_array_elements(doc->'rows') AS x(entry)");
 if(meta.rows.length!==catalog.relations.length)fail('INCOMPLETE_DATA_EXPORT');
 const seen=new Set();let total=0;for(const row of meta.rows){
  const rel=catalog.relations.find(r=>r.schema===row.schema_name&&r.name===row.relation_name&&r.kind===row.kind),n=Number(row.row_count);
  if(!rel||seen.has(key(row.schema_name,row.relation_name))||!Number.isSafeInteger(n)||n<0||n!==Number(row.actual_count)||!row.snapshot_id||!Number.isFinite(Date.parse(row.captured_at)))fail('INCOMPLETE_DATA_EXPORT');
  total+=n;seen.add(key(row.schema_name,row.relation_name));
 }
 if(total>MAX_RECORDS||new Set(meta.rows.map(row=>row.snapshot_id)).size!==1||new Set(meta.rows.map(row=>row.captured_at)).size!==1)fail('INCOMPLETE_DATA_EXPORT');
 await db.exec("INSERT INTO recovery_records SELECT entry->>'schema_name',entry->>'relation_name',entry->>'relation_kind',ordinal,record FROM recovery_input CROSS JOIN LATERAL jsonb_array_elements(doc->'rows') x(entry) CROSS JOIN LATERAL jsonb_array_elements(entry->'records') WITH ORDINALITY y(record,ordinal); CREATE INDEX recovery_relation_rows ON recovery_records(schema_name,relation_name);");
 const malformed=await db.query("SELECT count(*)::text n FROM recovery_records WHERE jsonb_typeof(data)<>'object'");if(malformed.rows[0].n!=='0')fail('INVALID_DATA_RECORD');return meta.rows;
}
async function canonicalHash(db,schema,name,source){
 const digest=createHash('sha256');let count=0;
 const base=source?"SELECT record::text canonical_json FROM recovery_input CROSS JOIN LATERAL jsonb_array_elements(doc->'rows') x(entry) CROSS JOIN LATERAL jsonb_array_elements(entry->'records') y(record) WHERE entry->>'schema_name'=$1 AND entry->>'relation_name'=$2 ORDER BY record::text COLLATE \"C\"":"SELECT data::text canonical_json FROM recovery_records WHERE schema_name=$1 AND relation_name=$2 ORDER BY data::text COLLATE \"C\"";
 for(let offset=0;;offset+=500){const batch=await db.query(base+' LIMIT 500 OFFSET $3',[schema,name,offset]);for(const row of batch.rows){const text=row.canonical_json;digest.update(String(Buffer.byteLength(text))+':');digest.update(text);count++;}if(batch.rows.length<500)break;}
 return{count,sha256:digest.digest('hex')};
}
export async function verifyMirror(db,catalog){
 let recordCount=0,typedRows=0,mappedTypes=0,internalForeignKeys=0,externalForeignKeys=0;const sourceDigest=createHash('sha256'),mirrorDigest=createHash('sha256');
 for(let i=0;i<catalog.relations.length;i++){
  const rel=catalog.relations[i],before=await canonicalHash(db,rel.schema,rel.name,true),after=await canonicalHash(db,rel.schema,rel.name,false);
  if(before.count!==after.count||before.sha256!==after.sha256)fail('MIRROR_CONTENT_MISMATCH');
  sourceDigest.update(JSON.stringify([rel.schema,rel.name,rel.kind,before.count,before.sha256]));mirrorDigest.update(JSON.stringify([rel.schema,rel.name,rel.kind,after.count,after.sha256]));recordCount+=after.count;
  if(rel.kind==='S')continue;
  if(!rel.columns.length)fail('INVALID_CATALOG');
  const projected=rel.columns.map(col=>{const type=projectionType(col.formatted_type);mappedTypes+=Number(type.managedTypeMapped);return identifier(col.name)+' '+type.text;});
  const typeName='projection_checks.'+identifier('relation_'+i);await db.exec('CREATE TABLE '+typeName+'('+projected.join(',')+');');
  const names=rel.columns.map(col=>literal(col.name)).join(','),required=rel.columns.filter(col=>col.not_null).map(col=>"data->"+literal(col.name)+" IS NULL OR data->"+literal(col.name)+"='null'::jsonb");
  const invalid=await db.query("SELECT count(*)::text n FROM recovery_records WHERE schema_name=$1 AND relation_name=$2 AND (NOT(data ?& ARRAY["+names+"]::text[]) OR (SELECT count(*) FROM jsonb_object_keys(data))<>"+rel.columns.length+(required.length?' OR '+required.map(x=>'('+x+')').join(' OR '):'')+')',[rel.schema,rel.name]);
  if(invalid.rows[0].n!=='0')fail('COLUMN_COVERAGE_MISMATCH');
  const cast=await db.query('SELECT count(jsonb_populate_record(NULL::'+typeName+',data))::text n FROM recovery_records WHERE schema_name=$1 AND relation_name=$2',[rel.schema,rel.name]);
  if(Number(cast.rows[0].n)!==after.count)fail('PROJECTION_COUNT_MISMATCH');typedRows+=after.count;
 }
 for(const constraint of catalog.constraints.filter(row=>row.kind==='f')){
  const child=relationByRegclass(catalog,constraint.relation,constraint.schema);if(!child)fail('UNSUPPORTED_FOREIGN_KEY');
  const fk=parseForeignKey(constraint),parent=catalog.relations.find(row=>row.schema===fk.targetSchema&&row.name===fk.targetName);
  if(!parent){if(['public','storage'].includes(fk.targetSchema))fail('MISSING_INTERNAL_FOREIGN_KEY_TARGET');externalForeignKeys++;continue;}
  if(fk.columns.some(name=>!child.columns.some(col=>col.name===name))||fk.targetColumns.some(name=>!parent.columns.some(col=>col.name===name)))fail('UNSUPPORTED_FOREIGN_KEY');
  const nonnull=fk.columns.map(name=>"c.data->"+literal(name)+" IS NOT NULL AND c.data->"+literal(name)+"<>'null'::jsonb"),equal=fk.columns.map((name,i)=>"c.data->"+literal(name)+"=p.data->"+literal(fk.targetColumns[i]));
  const missing="("+nonnull.map(value=>'('+value+')').join(' AND ')+") AND NOT EXISTS(SELECT 1 FROM recovery_records p WHERE p.schema_name=$3 AND p.relation_name=$4 AND "+equal.join(' AND ')+')';
  const partial=fk.matchFull?'(('+nonnull.map(value=>'('+value+')').join(' OR ')+') AND NOT('+nonnull.map(value=>'('+value+')').join(' AND ')+')) OR ':'';
  const result=await db.query('SELECT count(*)::text n FROM recovery_records c WHERE c.schema_name=$1 AND c.relation_name=$2 AND ('+partial+missing+')',[child.schema,child.name,parent.schema,parent.name]);
  if(result.rows[0].n!=='0')fail('INTERNAL_FOREIGN_KEY_MISMATCH');internalForeignKeys++;
 }
 return{ok:true,partialDataRecovery:true,relationSnapshotsVerified:catalog.relations.length,recordsVerified:recordCount,typedRecordsValidated:typedRows,managedTypeColumnsMappedToText:mappedTypes,
  sourceCanonicalSha256:sourceDigest.digest('hex'),mirrorCanonicalSha256:mirrorDigest.digest('hex'),internalForeignKeysChecked:internalForeignKeys,internalForeignKeyViolations:0,externalForeignKeysDeferred:externalForeignKeys,
  originalJsonNumericLexemesPreserved:true,archivedSqlExecuted:false,viewsFunctionsTriggersPoliciesRestored:false,managedAuthRestored:false,fullProviderApplicationDrProven:false,productionRequests:0,productionMutations:0};
}
async function closePermissions(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())fail('UNSAFE_SCRATCH_ENTRY');if(entry.isDirectory()){await fs.chmod(file,0o700);await closePermissions(file);}else if(entry.isFile())await fs.chmod(file,0o600);else fail('UNSAFE_SCRATCH_ENTRY');}}
async function mirrorWorker(config){
 globalThis.fetch=async()=>{throw codeError('NETWORK_DISABLED');};
 const {PGlite}=await import('@electric-sql/pglite');const catalogBytes=await readPrivate(config.catalogFile),dataBytes=await readPrivate(config.dataFile);
 if(hash(catalogBytes)!==config.catalogSha256||hash(dataBytes)!==config.dataSha256)fail('INPUT_CHANGED');
 const catalog=parseCatalog(catalogBytes.toString('utf8'));const db=new PGlite(config.dataDir);
 try{await populateMirror(db,catalog,dataBytes.toString('utf8'));return await verifyMirror(db,catalog);}finally{await db.close();}
}
async function runMirrorWorker(config,timeout){return await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:config});const timer=setTimeout(()=>{worker.terminate();reject(codeError('RECOVERY_TIMEOUT'));},timeout);worker.once('message',value=>{clearTimeout(timer);if(value.ok)resolve(value.proof);else reject(codeError('RECOVERY_MIRROR_VALIDATION_FAILED'));});worker.once('error',()=>{clearTimeout(timer);reject(codeError('RECOVERY_MIRROR_VALIDATION_FAILED'));});worker.once('exit',status=>{if(status!==0){clearTimeout(timer);reject(codeError('RECOVERY_MIRROR_VALIDATION_FAILED'));}});});}
async function childToFile(command,args,file,{deadline,maximum,expectedHash}){
 const fd=await fs.open(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);const digest=createHash('sha256');let bytes=0;
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});child.stderr.resume();const closed=new Promise(resolve=>{child.once('error',()=>resolve(false));child.once('close',status=>resolve(status===0));});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),remaining(deadline));
 try{for await(const chunk of child.stdout){bytes+=chunk.length;if(bytes>maximum)fail('RECOVERY_OUTPUT_CAP');digest.update(chunk);await fd.writeFile(chunk);}if(!await closed)fail('RECOVERY_CHILD_FAILED');await fd.sync();const sha256=digest.digest('hex');if(expectedHash&&sha256!==expectedHash)fail('INDEXED_MEMBER_MISMATCH');return{bytes,sha256};}
 catch(error){child.kill('SIGKILL');await closed;throw error;}finally{clearTimeout(timeout);await fd.close();}
}
async function runRestore(tool,args,deadline){
 return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[tool,...args],{stdio:['ignore','pipe','pipe']});let output='',size=0;child.stderr.resume();const timeout=setTimeout(()=>child.kill('SIGKILL'),remaining(deadline));child.stdout.on('data',chunk=>{size+=chunk.length;if(size>16384)child.kill('SIGKILL');else output+=chunk;});child.once('error',()=>{clearTimeout(timeout);reject(codeError('CHECKPOINT_RESTORE_FAILED'));});child.once('close',status=>{clearTimeout(timeout);let value;try{value=JSON.parse(output);}catch{}if(status===0&&value?.ok===true)resolve(value);else reject(codeError('CHECKPOINT_RESTORE_FAILED'));});});
}
export async function rehearse(options){
 if(options.approval!=='approved-offline-only')fail('EXPLICIT_OFFLINE_APPROVAL_REQUIRED');
 const deadline=Date.now()+MAX_TIME;process.umask(0o077);
 const tool=await fs.readFile(options.restoreTool);if(hash(tool)!==REVIEWED_RESTORE_TOOL_SHA256)fail('RESTORE_TOOL_HASH_MISMATCH');
 const receipt=receiptShape(JSON.parse(await readPrivate(options.receipt,16384)));await privatePath(options.privateKey,{maximum:16384});await privatePath(path.dirname(options.privateKey),{directory:true});
 const archiveStat=await fs.lstat(options.archive);if(!archiveStat.isFile()||archiveStat.isSymbolicLink()||archiveStat.nlink!==1||archiveStat.size!==receipt.ciphertextBytes)fail('INVALID_ENCRYPTED_ARCHIVE');
 const parent=path.dirname(options.scratch);await privatePath(parent,{directory:true});const capacity=await fs.statfs(parent);
 if(capacity.bavail*capacity.bsize<receipt.archiveBytes+2*1024**3)fail('INSUFFICIENT_REHEARSAL_CAPACITY');
 if(await fileHash(options.archive,AbortSignal.timeout(remaining(deadline)))!==receipt.ciphertextSha256)fail('CHECKPOINT_CIPHERTEXT_MISMATCH');
 const scratch=await createScratch(options.scratch);let proof;
 try{
  const localTool=path.join(scratch,'trusted-restore-checkpoint.mjs');await exclusive(localTool,tool);
  const restored=await runRestore(localTool,['restore','--archive',options.archive,'--private-key',options.privateKey,'--receipt',options.receipt,'--restore-dir',scratch],deadline);
  const tarFile=path.join(scratch,`checkpoint-${receipt.checkpointId}.tar.gz`);
  if(restored.checkpointId!==receipt.checkpointId||restored.archiveBytes!==receipt.archiveBytes||await fileHash(tarFile,AbortSignal.timeout(remaining(deadline)))!==receipt.archiveSha256)fail('CHECKPOINT_RESTORE_MISMATCH');
  const indexFile=path.join(scratch,'checkpoint-index.json');await childToFile('/usr/bin/tar',['-xOzf',tarFile,'--','checkpoint-index.json'],indexFile,{deadline,maximum:MAX_INDEX});
  const selected=selectedIndex(JSON.parse(await readPrivate(indexFile,MAX_INDEX)),receipt);const inputs={};
  for(const [name,entry] of Object.entries(selected)){const file=path.join(scratch,name+'.json');const actual=await childToFile('/usr/bin/tar',['-xOzf',tarFile,'--',entry.name],file,{deadline,maximum:MAX_INPUT,expectedHash:entry.sha256});if(actual.bytes!==entry.bytes)fail('INDEXED_MEMBER_MISMATCH');inputs[name]={file,...actual};}
  const mirror=await runMirrorWorker({catalogFile:inputs.catalog.file,catalogSha256:inputs.catalog.sha256,dataFile:inputs.data.file,dataSha256:inputs.data.sha256,dataDir:path.join(scratch,'row-mirror')},remaining(deadline));
  proof={...mirror,format:'studio-os-offline-partial-recovery-rehearsal-v1',performedAt:new Date().toISOString(),checkpointId:receipt.checkpointId,trustedRestoreToolSha256:hash(tool),ciphertextSha256:receipt.ciphertextSha256,authenticatedArchiveSha256:receipt.archiveSha256,
   authenticatedIndexSelectedFilesVerified:2,selectedCatalogSha256:inputs.catalog.sha256,selectedDataSha256:inputs.data.sha256,plaintextOnUsb:false,localEngine:'PGlite PostgreSQL WASM',executionTimeoutMs:MAX_TIME,
   limitations:['Partial row snapshots and primitive type projection only; views/functions/triggers/defaults/RLS/ACLs/auth/provider services are not restored.','Managed storage.buckettype is validated as text; exact managed enum definition is unavailable.','Internal foreign-key consistency is checked; external managed auth references remain deferred.','Sequences and view results are preserved as snapshot records; executable view/sequence behavior and high-water reconciliation are not proved.','Catalog and data are separately captured metadata snapshots; this is not full provider/application disaster recovery.']};
 }catch(error){proof={ok:false,format:'studio-os-offline-partial-recovery-rehearsal-v1',partialDataRecovery:true,errorCode:/^[A-Z_]{3,80}$/.test(error.code||'')?error.code:'RECOVERY_REHEARSAL_FAILED',productionRequests:0,productionMutations:0,plaintextMayRemainInPrivateScratch:true};throw Object.assign(codeError(proof.errorCode),{proof});}
 finally{await closePermissions(scratch);if(proof)await exclusive(path.join(scratch,'rehearsal-proof.json'),JSON.stringify(proof,null,2)+'\n');}
 return{...proof,scratch};
}
export function parseArguments(args){
 const keys={'--archive':'archive','--receipt':'receipt','--private-key':'privateKey','--restore-tool':'restoreTool','--scratch':'scratch','--approval':'approval'};const result={};
 for(let i=0;i<args.length;i+=2){const name=keys[args[i]];if(!name||result[name]||!args[i+1])fail('INVALID_ARGUMENTS');result[name]=args[i+1];}
 if(Object.keys(result).length!==Object.keys(keys).length)fail('INVALID_ARGUMENTS');return result;
}
if(!isMainThread){mirrorWorker(workerData).then(proof=>parentPort.postMessage({ok:true,proof}),()=>parentPort.postMessage({ok:false}));}
else if(process.argv[1]&&pathToFileURL(await fs.realpath(process.argv[1]).catch(()=>'' )).href===import.meta.url){
 if(process.argv[2]!=='rehearse')console.log(JSON.stringify({ok:true,skipped:true,reason:'explicit_private_offline_rehearsal_required'}));
 else Promise.resolve().then(()=>rehearse(parseArguments(process.argv.slice(3)))).then(proof=>console.log(JSON.stringify(proof)),error=>{console.error(JSON.stringify(error.proof||{ok:false,errorCode:/^[A-Z_]{3,80}$/.test(error.code||'')?error.code:'RECOVERY_REHEARSAL_FAILED',productionRequests:0,productionMutations:0}));process.exitCode=1;});
}
