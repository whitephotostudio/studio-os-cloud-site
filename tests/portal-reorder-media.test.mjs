import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../app/parents/[pin]/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
function find(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('studio-os-reorder-pending'))effect=node.arguments[0].getText(ast);ts.forEachChild(node,find);}find(ast);assert.ok(effect);
function run({loading=false,backdrops=[]}={}){const writes=[],removed=[],cart=[];const key='schools/school/Class/Child/pose.jpg',preview='/api/portal/school-preview/key.jpg?token=fresh';const snapshot=[{packageId:'pkg',quantity:2,selectedImageUrl:key,slots:[{label:'5x7',assignedImageUrl:key}],retouchSelections:[{imageUrl:key,notes:'Preserve freckles'}],digitalSelections:[{mediaId:key,url:key}],orientation:'portrait'}];const store=new Map([['studio-os-reorder-pending','order'],['studio-os-reorder:order',JSON.stringify(snapshot)]]);
 const scope={loading,photographerId:'owner',packages:[{id:'pkg',name:'Print',price_cents:1200}],backdrops,isSchoolMode:true,currentLane:null,images:[{id:key,storagePath:key,previewUrl:preview,url:preview}],reorderHydratedRef:{current:null},window:{sessionStorage:{getItem:key=>store.get(key)||null,removeItem:key=>{removed.push(key);store.delete(key);}}},crypto:{randomUUID:()=> 'new-item'},getCategory:()=> 'print',setCartItems:change=>cart.push(...change([]))};for(const name of ['BackdropPickerOpen','DrawerOpen','DrawerView','ActiveSlotIndex'])scope['set'+name]=value=>writes.push([name,value]);
 const js=ts.transpileModule(`(${effect})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(js,scope);return{cart,writes,removed,key,preview};}

test('a loaded empty school backdrop catalog restores ordinary print/retouch choices using authorized previews',()=>{const result=run();assert.equal(result.cart.length,1);const entry=result.cart[0];assert.equal(entry.quantity,2);assert.equal(entry.packageSubtotalCents,2400);assert.equal(entry.selectedImageUrl,result.preview);assert.equal(entry.slots[0].assignedImageUrl,result.preview);assert.equal(entry.retouchSelections[0].imageUrl,result.preview);assert.equal(entry.retouchSelections[0].notes,'Preserve freckles');assert.equal(entry.digitalSelections[0].url,result.preview);assert.equal(entry.backdrop,null);assert.equal(result.removed.length,2);assert.deepEqual(Array.from(result.writes[1]),['DrawerOpen',true]);});

test('reorder waits for the current gallery load rather than consuming a stale preview/catalog snapshot',()=>{const result=run({loading:true});assert.equal(result.cart.length,0);assert.equal(result.removed.length,0);});
