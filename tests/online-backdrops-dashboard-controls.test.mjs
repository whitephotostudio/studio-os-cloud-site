import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const page = ts.createSourceFile('backdrops.tsx', readFileSync(new URL('../app/dashboard/backdrops/page.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers = [];
function visit(node) {
  if(ts.isFunctionDeclaration(node) && ['loadOnlineDefault','saveOnlineDefault'].includes(node.name?.text)) handlers.push(node.getText(page));
  ts.forEachChild(node,visit);
}
visit(page);
assert.equal(handlers.length,2);
function fixture(responses) {
  const requests=[];
  const context={exports:{},onlineBackdropsEnabled:null,savingOnlineDefault:false,onlineDefaultNotice:'',
    async fetch(url, options={}) { requests.push({url,...options}); const r=responses.shift(); if(r instanceof Error) throw r; return Response.json(r.body,{status:r.status??200}); },
  };
  for(const key of ['onlineBackdropsEnabled','savingOnlineDefault','onlineDefaultNotice']) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`]=v=>context[key]=v;
  }
  const compiled=ts.transpileModule(`${handlers.join('\n')}\nexports.load=loadOnlineDefault;exports.save=saveOnlineDefault;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,context);
  return {context,requests,...context.exports};
}
test('studio toggle displays confirmed save, then loads persisted Off in a reopened panel',async()=>{
  const f=fixture([{body:{onlineBackdropsEnabled:true}},{body:{onlineBackdropsEnabled:false}}]);
  assert.equal(await f.load(),true); await f.save();
  assert.equal(f.context.onlineBackdropsEnabled,false);
  assert.equal(f.context.savingOnlineDefault,false);
  assert.match(f.context.onlineDefaultNotice,/Saved.*Off/);
  assert.deepEqual(JSON.parse(f.requests[1].body),{onlineBackdropsEnabled:false,expectedOnlineBackdropsEnabled:true});
  const reopened=fixture([{body:{onlineBackdropsEnabled:false}}]);await reopened.load();
  assert.equal(reopened.context.onlineBackdropsEnabled,false);
});
test('failed reads disable the studio switch and never fabricate On or successful reload',async()=>{
  const f=fixture([{body:{onlineBackdropsEnabled:true}},{status:409,body:{error:'Changed'}},{status:503,body:{error:'Unavailable'}}]);
  await f.load(); await f.save();
  assert.equal(f.context.onlineBackdropsEnabled,null);
  assert.doesNotMatch(f.context.onlineDefaultNotice,/latest value is loaded|Saved/);
  assert.equal(f.context.savingOnlineDefault,false);
  await f.save();assert.equal(f.requests.length,3);
});
test('stale studio window loads actual value and does not retry an unwanted toggle automatically',async()=>{
  const f=fixture([{body:{onlineBackdropsEnabled:true}},{status:409,body:{error:'Changed'}},{body:{onlineBackdropsEnabled:false}}]);
  await f.load();await f.save();
  assert.equal(f.context.onlineBackdropsEnabled,false);
  assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);
  assert.match(f.context.onlineDefaultNotice,/latest value is loaded/);
});
