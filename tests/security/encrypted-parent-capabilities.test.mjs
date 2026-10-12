import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decryptCapability, encryptCapability, MAX_CAPABILITY_PAYLOAD_BYTES, PREVIEW_CAPABILITY_PAYLOAD_BYTES } from '../../lib/encrypted-capability.ts';
import { harness, id } from '../helpers/event-gallery-harness.mjs';

const golden=JSON.parse(readFileSync(new URL('../fixtures/legacy-parent-capabilities.json',import.meta.url),'utf8'));
const secret=golden.signingSecret;
function fixture(){
 const h=harness({overrides:{'@/lib/backdrop-composites':{},'@/lib/resend':{}}});
 const school=h.load('lib/school-portal-media.ts'),event=h.load('lib/event-gallery-download-tokens.ts'),digital=h.load('lib/digital-delivery.ts'),favorites=h.load('lib/favorites-delivery.ts');
 return {
  'school-gallery-preview':{create:school.createSchoolMediaToken,verify:token=>school.verifySchoolMediaToken(token,'school-gallery-preview')},
  'school-photo-download':{create:school.createSchoolMediaToken,verify:token=>school.verifySchoolMediaToken(token,'school-photo-download')},
  'event-gallery-preview':{create:event.createEventPreviewToken,verify:event.verifyEventPreviewToken},
  'event-gallery-download-batch':{create:event.createEventGalleryBatchToken,verify:event.verifyEventGalleryBatchToken},
  'digital-order-delivery':{create:digital.createDigitalDeliveryToken,verify:digital.verifyDigitalDeliveryToken},
  'favorites-delivery':{create:favorites.createFavoritesDeliveryToken,verify:favorites.verifyFavoritesDeliveryToken},
 };
}
function signedLegacy(payload){const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${encoded}.${createHmac('sha256',secret).update(encoded).digest('hex')}`;}
function samePayload(actual,expected){assert.equal(JSON.stringify(actual),JSON.stringify(expected));}
function unreadable(token,email){
 assert.match(token,/^ec1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
 assert.equal(token.includes(email),false);assert.equal(token.includes(Buffer.from(email).toString('base64url')),false);
 for(const part of token.split('.'))assert.equal(Buffer.from(part,'base64url').includes(Buffer.from(email)),false);
}

for(const [purpose,{payload,token:legacyToken}] of Object.entries(golden.fixtures)){
 test(`${purpose}: authentic old issued fixture remains valid and new capabilities hide parent metadata`,()=>{
  const api=fixture()[purpose];samePayload(api.verify(legacyToken),payload);
  const first=api.create(payload),second=api.create(payload);assert.notEqual(first,second);
  unreadable(first,payload.viewerEmail||payload.recipientEmail);samePayload(api.verify(first),payload);
  const link=new URL('https://fixture.invalid/image');link.searchParams.set('token',first);
  assert.equal(link.href.includes('parent-legacy'),false);
 });
 test(`${purpose}: new and legacy signatures, expiry and purpose still fail closed`,()=>{
  const api=fixture()[purpose],token=api.create(payload);
  for(const index of [1,2,3]){const parts=token.split('.');parts[index]=(parts[index][0]==='A'?'B':'A')+parts[index].slice(1);assert.throws(()=>api.verify(parts.join('.')));}
  for(const broken of [token+'.extra',legacyToken+'.extra',legacyToken.slice(0,-1)+(legacyToken.endsWith('0')?'1':'0'),token.replace(/^ec1/,'ec2')])assert.throws(()=>api.verify(broken));
  for(const exp of [Date.now()-1,0,Number.NaN,Number.POSITIVE_INFINITY]){const expired={...payload,exp};assert.throws(()=>api.verify(api.create(expired)));assert.throws(()=>api.verify(signedLegacy(expired)));}
  for(const v of [0,2]){const unsupported={...payload,v};assert.throws(()=>api.verify(api.create(unsupported)));assert.throws(()=>api.verify(signedLegacy(unsupported)));}
 });
}

test('all six real verifiers reject capabilities and legacy issued fixtures from every other purpose',()=>{
 const apis=fixture();
 for(const [from,issued]of Object.entries(golden.fixtures))for(const [to,api]of Object.entries(apis))if(from!==to){
  assert.throws(()=>api.verify(apis[from].create(issued.payload)),`${from} -> ${to} encrypted`);
  assert.throws(()=>api.verify(issued.token),`${from} -> ${to} legacy`);
 }
});

test('HKDF/AAD bind exact purpose, version and deployment secret',()=>{
 const payload=golden.fixtures['digital-order-delivery'].payload,options={secret,purpose:'digital-order-delivery'};
 const token=encryptCapability(payload,options);samePayload(decryptCapability(token,options),payload);
 assert.throws(()=>decryptCapability(token,{...options,secret:'different-secret'}));
 assert.throws(()=>decryptCapability(token,{...options,purpose:'favorites-delivery'}));
 assert.throws(()=>decryptCapability(token.replace(/^ec1/,'ec2'),options));
});

test('noncanonical encoding, malformed segment sizes and excess payloads are rejected before parsing',()=>{
 const options={secret,purpose:'favorites-delivery'},token=encryptCapability({email:'parent@example.test'},options),parts=token.split('.');
 const malformed=[token+'.',token+'.extra',parts.map((s,i)=>i===1?s+'=':s).join('.'),parts.map((s,i)=>i===2?s+' ':s).join('.'),
  ['ec1',Buffer.alloc(11).toString('base64url'),parts[2],parts[3]].join('.'),['ec1',parts[1],parts[2],Buffer.alloc(15).toString('base64url')].join('.')];
 const tag=parts[3],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const alternate=tag.slice(0,-1)+alphabet[alphabet.indexOf(tag.at(-1))+1];
 assert.equal(Buffer.from(alternate,'base64url').equals(Buffer.from(tag,'base64url')),true);
 malformed.push([parts[0],parts[1],parts[2],alternate].join('.'));
 for(const value of malformed)assert.throws(()=>decryptCapability(value,options));
 assert.throws(()=>encryptCapability({text:'x'.repeat(MAX_CAPABILITY_PAYLOAD_BYTES)},options));
 assert.throws(()=>decryptCapability('ec1.'+'A'.repeat(MAX_CAPABILITY_PAYLOAD_BYTES*2),options));
 assert.throws(()=>decryptCapability(encryptCapability([],options),options));
 assert.throws(()=>decryptCapability(encryptCapability(null,options),options));
});

test('preview payload limits preserve existing bounds while batches support the full 800-media limit',()=>{
 const apis=fixture(),preview=golden.fixtures['school-gallery-preview'].payload;
 assert.throws(()=>apis['school-gallery-preview'].create({...preview,mediaKey:'x'.repeat(PREVIEW_CAPABILITY_PAYLOAD_BYTES)}));
 const batch={...golden.fixtures['event-gallery-download-batch'].payload,mediaIds:Array.from({length:800},(_,i)=>`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`)};
 const token=apis['event-gallery-download-batch'].create(batch);samePayload(apis['event-gallery-download-batch'].verify(token),batch);
});

test('encrypted school capabilities retain exact legacy-storage/media binding validation',()=>{
 const api=fixture()['school-gallery-preview'],payload=golden.fixtures['school-gallery-preview'].payload;
 const valid={...payload,legacyStorage:{bucket:'photos',key:payload.mediaKey}};
 samePayload(api.verify(api.create(valid)),valid);
 for(const legacyStorage of [{bucket:'public-assets',key:payload.mediaKey},{bucket:'photos',key:'foreign/photo.jpg'}]){
  assert.throws(()=>api.verify(api.create({...payload,legacyStorage})));
  assert.throws(()=>api.verify(signedLegacy({...payload,legacyStorage})));
 }
});

test('expired encrypted sibling carts preserve opaque identity and require that sibling current allowed media',async()=>{
 const schoolId=id(101),owner=id(102),first=id(103),sibling=id(104);
 const firstKey=`schools/${schoolId}/Grade A/First/photo.jpg`,siblingKey=`schools/${schoolId}/Grade B/Sibling/photo.jpg`;
 const h=harness({folderFiles:[firstKey,siblingKey].map(key=>({key,name:'photo.jpg',url:`https://fixture.test/${key}`}))});
 h.tables.schools.push({id:schoolId,photographer_id:owner,local_school_id:null});
 h.tables.students.push({id:first,school_id:schoolId,class_name:'Grade A',folder_name:'First',photo_url:firstKey},
  {id:sibling,school_id:schoolId,class_name:'Grade B',folder_name:'Sibling',photo_url:siblingKey});
 const school=h.load('lib/school-portal-media.ts'),server=h.load('lib/school-order-media.ts'),browser=h.load('lib/event-gallery-media-client.ts');
 const payload={...golden.fixtures['school-gallery-preview'].payload,schoolId,photographerId:owner,mediaKey:siblingKey,exp:Date.now()-60000};
 const token=school.createSchoolMediaToken(payload),opaque=`/api/portal/school-preview/${createHash('sha256').update(siblingKey).digest('hex')}.jpg?token=${token}`;
 const entry={selectedImageUrl:opaque,slots:[{assignedImageUrl:opaque}],retouchSelections:[{imageUrl:opaque,notes:'Keep freckles'}],digitalSelections:[{mediaId:siblingKey,url:opaque}]};
 const currentImages=[{id:firstKey,storagePath:firstKey,url:`https://fixture.test/${firstKey}`}];
 const saved=browser.canonicalEventOrderEntry(entry,currentImages);
 assert.equal(saved.selectedImageUrl,opaque);assert.equal(saved.slots[0].assignedImageUrl,opaque);assert.equal(saved.retouchSelections[0].imageUrl,opaque);
 assert.equal(server.schoolOrderPhotoReference(opaque),siblingKey);
 assert.throws(()=>school.verifySchoolMediaToken(token,'school-gallery-preview'),/Expired/);
 await assert.rejects(server.resolveSchoolOrderMediaReferences(h.service,schoolId,first,owner,[structuredClone(saved)]),/outside/);
 await server.resolveSchoolOrderMediaReferences(h.service,schoolId,sibling,owner,[saved]);
 assert.equal(saved.selectedImageUrl,siblingKey);assert.equal(saved.slots[0].assignedImageUrl,siblingKey);assert.equal(saved.retouchSelections[0].imageUrl,siblingKey);assert.equal(saved.digitalSelections[0].url,siblingKey);
 const changed=token.split('.');changed[2]=(changed[2][0]==='A'?'B':'A')+changed[2].slice(1);
 const tampered=opaque.replace(token,changed.join('.'));
 assert.equal(server.schoolOrderPhotoReference(tampered),null);
 await assert.rejects(server.resolveSchoolOrderMediaReferences(h.service,schoolId,sibling,owner,[{selectedImageUrl:tampered,slots:[]}]),/outside/);
 const download=school.createSchoolMediaToken({...payload,kind:'school-photo-download'});
 assert.equal(server.schoolOrderPhotoReference(opaque.replace(token,download)),null);
 h.tables.students[1].school_id=id(199);
 await assert.rejects(server.resolveSchoolOrderMediaReferences(h.service,schoolId,sibling,owner,[structuredClone(entry)]),/access changed/);
 assert.equal(h.writes.length,0);assert.equal(h.fetched.length,0);
 samePayload(server.schoolOrderPhotoReference(`/api/portal/school-preview/${'a'.repeat(64)}.jpg?token=${golden.fixtures['school-gallery-preview'].token}`),golden.fixtures['school-gallery-preview'].payload.mediaKey);
});
