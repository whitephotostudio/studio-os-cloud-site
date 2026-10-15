import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);

/** Run actual client handlers with only Auth/status transport and browser shell substituted. */
function client(path,{currency='usd',creditCurrency='cad',interval='month'}={}){
 const slots=[],effects=[],requests=[];let index=0,dirty=false,tree;
 const browser={location:{href:'http://localhost:55430/pricing',search:''}};
 const jsx=(type,props)=>({type,props});
 const react={useState(initial){const i=index++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},useRef(initial){const i=index++;slots[i]??={value:{current:initial}};return slots[i].value;},useMemo(factory,deps=[]){const i=index++;if(!slots[i]||deps.some((v,n)=>v!==slots[i].deps[n]))slots[i]={value:factory(),deps};return slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);},useEffect(fn,deps=[]){const i=index++;if(!slots[i]||deps.some((v,n)=>v!==slots[i].deps[n])){slots[i]={deps};effects.push(fn);}}};
 const status={ok:true,creditBalance:0,creditCurrency,billingCatalog:{currency,creditPacks:[{id:'pack',code:'background_credits_250',name:'250 credits',credits:250,priceCents:4000}]},premiumCloudAvailable:true};
 const overrides={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'next/link':'link','next/navigation':{useRouter:()=>({push:href=>{browser.location.href=href;}})},'lucide-react':require('lucide-react'),'@/components/site-header':{SiteHeader:'header'},'@/components/site-footer':{SiteFooter:'footer'},'@/components/marketing/Reveal':{Reveal:'reveal'},'@/lib/supabase/client':{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic-auth'}}})}})}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','exports','process','window','fetch',code)(name=>{if(name in overrides)return overrides[name];assert.ok(name.startsWith('@/lib/'),'unexpected dependency '+name);return load(name.slice(2)+'.ts');},exports,{env:{STUDIO_GALLERY_PRICING_V3_ENABLED:'1',STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:'1'}},browser,async(url,options)=>{requests.push({url,options});assert.equal(url,'/api/stripe/status','no billing or provider calls permitted');return Response.json(status);});return exports;}
 const Page=load(path).default??load(path).PricingPageClient;const props=path==='components/pricing-page-client.tsx'?{catalog:load('lib/studio-pricing.ts').getPricingCatalogSnapshot(currency),initialInterval:interval}:{};
 function nodes(n){if(n==null||typeof n==='boolean')return[];if(Array.isArray(n))return n.flatMap(nodes);return typeof n==='object'?[n,...nodes(n.props?.children)]:[n];}
 function render(){dirty=false;index=0;tree=Page(props);while(effects.length)effects.shift()();}render();
 return{requests,browser,nodes:()=>nodes(tree),text:()=>nodes(tree).filter(n=>typeof n==='string'||typeof n==='number').join(' ').replace(/\s+/g,' '),flush:async()=>{for(let i=0;i<12;i++){await new Promise(setImmediate);if(dirty)render();}}};
}

test('manual public selector carries a validated country and cadence without changing billing or calling a provider',()=>{
 const f=client('components/pricing-page-client.tsx',{currency:'usd',interval:'year'});
 const select=f.nodes().find(n=>n.type==='select'&&n.props['aria-label']==='Subscription pricing country');
 assert.equal(select.props.value,'US');select.props.onChange({target:{value:'AU'}});assert.equal(f.browser.location.href,'/pricing?country=AU&interval=year');
 select.props.onChange({target:{value:'javascript:untrusted'}});assert.equal(f.browser.location.href,'/pricing?country=AU&interval=year');assert.deepEqual(f.requests,[]);
});
for(const currency of ['usd','aud','gbp'])test(`actual credits status refresh keeps CAD packs alongside a ${currency} subscription`,async()=>{
 const f=client('app/credits/page.tsx',{currency});await f.flush();assert.equal(f.requests.length,1);assert.match(f.text(),/Credit packs are billed in CAD/);assert.ok(f.text().includes(new Intl.NumberFormat(undefined,{style:'currency',currency:'CAD'}).format(40)+' CAD'));assert.doesNotMatch(f.text(),new RegExp('40.00 '+currency.toUpperCase()));
});
