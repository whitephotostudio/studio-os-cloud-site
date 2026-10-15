import {createHash} from 'node:crypto';

export const STANDARD_INVENTORY_SCOPE=Object.freeze({projectRef:'bwqhzczxoevouiondjak',platformAccountId:'acct_1TBlT4PxlnWeytFA',
 vercelProjectId:'prj_wlleVTNPMzBXyRMG4NFEFKga3ve8',vercelTeamId:'team_i1VhiUxCf3SZPOKdmecBsu3r'});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const accountId=value=>typeof value==='string'&&/^acct_[A-Za-z0-9]+$/.test(value);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`:JSON.stringify(value);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
const business=value=>typeof value==='string'?value.toLowerCase().replace(/[^a-z0-9]/g,''):'';
const blank=value=>value===null||value===undefined||value==='';
const profileFields='id,user_id,studio_id,created_at,business_country,billing_currency,stripe_connect_country,stripe_account_id,stripe_connected_account_id,stripe_standard_migrated_at,stripe_connect_route_version,billing_email,studio_email,business_name';
const missingTable=new Set(['42P01','PGRST205']),missingColumn=new Set(['42703','PGRST204']);
const fail=message=>{throw new Error(`Standard signup inventory: ${message}`);};
export function assertInventoryEnvironment(env){const s=STANDARD_INVENTORY_SCOPE;
 if(env.VERCEL_ENV!=='production'||env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF!==s.projectRef||env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==`https://${s.projectRef}.supabase.co`||
 env.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID!==s.platformAccountId||!['https://studiooscloud.com','https://www.studiooscloud.com'].includes(env.STUDIO_PAYMENT_EXPECTED_APP_URL?.replace(/\/$/,''))||
 env.VERCEL_PROJECT_ID&&env.VERCEL_PROJECT_ID!==s.vercelProjectId||env.VERCEL_ORG_ID&&env.VERCEL_ORG_ID!==s.vercelTeamId||
 env.STUDIO_STANDARD_WEBHOOK_CONFIGURE||env.STUDIO_CREDIT_WEBHOOK_CONFIGURE==='1'||env.STUDIO_PAYMENT_REFUND_WEBHOOK_ID||
 !/^sk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY||'')||!env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY==='[SENSITIVE]')fail('exact protected production project/platform/app and credentials required.');
}

function metadataMatches(account,profile){const m=account.metadata||{},photoKeys=['photographer_id','photographerId','photographer','photo_id','studio_os_photographer_id','studioos_photographer_id'],userKeys=['user_id','userId','owner_id','owner_user_id','studio_os_user_id'];
 const p=photoKeys.map(k=>m[k]).filter(v=>typeof v==='string'&&v),u=userKeys.map(k=>m[k]).filter(v=>typeof v==='string'&&v);
 for(const value of Object.values(m)){if(value===profile.id&&!p.includes(value))p.push(value);if(value===profile.user_id&&!u.includes(value))u.push(value);}
 return{photo:p.includes(profile.id),user:u.includes(profile.user_id),anyPhoto:p.length>0,anyUser:u.length>0,conflict:p.some(v=>v!==profile.id)||u.some(v=>v!==profile.user_id)};
}
function identity(account){return{emails:[account.email,account.business_profile?.support_email,account.individual?.email,account.company?.email].map(email).filter(Boolean),
 names:[account.business_profile?.name,account.company?.name,account.business_profile?.support_url,account.individual&&[account.individual.first_name,account.individual.last_name].filter(Boolean).join(' ')].map(business).filter(v=>v.length>=3)};}
/** Classification is a read-only candidate list. A later locked SQL grant must
 * recheck the exact owner/state and bind this complete inventory within 5 min. */
export function classifySignupInventory({accounts,profiles,owners,histories}){
 const eligible=[],excluded=[],knownProfiles=new Set(profiles.map(p=>p.id));
 const unresolvedAccounts=accounts.filter(a=>!profiles.some(p=>{const match=metadataMatches(a,p);return match.photo&&match.user&&!match.conflict||
  p.stripe_account_id===a.id||p.stripe_connected_account_id===a.id;})&&!histories.registry.some(r=>r.stripe_account_id===a.id&&knownProfiles.has(r.photographer_id)));
 for(const p of profiles){let reason=null;const owner=owners.get(p.user_id),confirmed=Date.parse(owner?.email_confirmed_at||owner?.confirmed_at||''),profileEmails=[p.billing_email,p.studio_email,owner?.email].map(email).filter(Boolean),profileNames=[p.business_name,p.inventory_studio_name,owner?.user_metadata?.full_name].map(business).filter(v=>v.length>=3);
  if(p.stripe_account_id||p.stripe_connected_account_id)reason='existing_account';
  else if(!uuid(p.id)||!uuid(p.user_id)||!owner||owner.id!==p.user_id||!email(owner.email)||!Number.isFinite(confirmed)||confirmed>Date.now()+30000||owner.deleted_at||owner.banned_until&&(!Number.isFinite(Date.parse(owner.banned_until))||Date.parse(owner.banned_until)>Date.now()))reason='owner_identity_unverified';
  else if(p.stripe_account_history_required===true)reason='history_required';
  else if(!blank(p.stripe_connect_country))reason='uncertain_legacy_creation';
  else if(!blank(p.stripe_standard_migrated_at)||p.stripe_connect_route_version!==0)reason='existing_payment_history';
  else if(!['cad','usd'].includes((p.billing_currency||'cad').toLowerCase())||p.business_country&&!['CA','US'].includes(p.business_country))reason='unsupported_country_or_currency';
  else if(!Number.isFinite(Date.parse(p.created_at))||Date.parse(p.created_at)>Date.now()+30000)reason='enrollment_date_unverified';
  else if(['registry','intents','bindings','signups'].some(k=>histories[k].some(r=>r.photographer_id===p.id))||histories.orders.some(o=>o.photographer_id===p.id&&(o.stripe_checkout_session_id||o.stripe_payment_intent_id||o.stripe_payment_account_binding_id||o.status==='checkout_starting')))reason='existing_payment_history';
  if(!reason){const matched=accounts.filter(a=>{const m=metadataMatches(a,p),i=identity(a);return m.photo||m.user||i.emails.some(v=>profileEmails.includes(v))||i.names.some(v=>profileNames.includes(v));});
   if(matched.length)reason='provider_account_or_identity_match';else if(unresolvedAccounts.length)reason='unattributed_provider_account';}
  if(reason)excluded.push({photographerId:p.id,actorUserId:p.user_id,reason});else eligible.push({photographerId:p.id,actorUserId:p.user_id});
 }
 const exclusionReasonCounts={};for(const row of excluded)exclusionReasonCounts[row.reason]=(exclusionReasonCounts[row.reason]||0)+1;
 return{eligible,excluded,exclusionReasonCounts,unattributedProviderAccountCount:unresolvedAccounts.length};
}

export async function verifyStandardSignupInventory(env=process.env,fetcher=fetch,report=console.log){
 if(env.STUDIO_STANDARD_SIGNUP_INVENTORY_VERIFY!=='1')return;
 assertInventoryEnvironment(env);const s=STANDARD_INVENTORY_SCOPE,startedAt=new Date().toISOString(),requests=[];
 const request=async(url,{provider='db',range}={})=>{const response=await fetcher(url,{method:'GET',headers:provider==='stripe'?{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':'2025-06-30.basil'}:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,...(range?{Range:range,Prefer:'count=exact'}:{})},redirect:'error',signal:AbortSignal.timeout(20000)});
  requests.push({method:'GET',provider,status:response.status});let data;try{data=await response.json();}catch{fail('provider response was not complete JSON.');}if(!response.ok){const error=new Error('Standard signup inventory: GET failed; provider details withheld.');if(provider==='db'&&(missingTable.has(data?.code)||missingColumn.has(data?.code)))error.code=data.code;throw error;}return{data,headers:response.headers};};
 const stripe=path=>request('https://api.stripe.com/v1/'+path,{provider:'stripe'}).then(r=>r.data);
 const platform=await stripe('account'),balance=await stripe('balance');if(platform.id!==s.platformAccountId||balance.object!=='balance'||balance.livemode!==true)fail('exact live platform balance proof failed.');
 const scanAccounts=async()=>{const startedAt=new Date().toISOString(),accounts=[],seenAccounts=new Set();let cursor=null,complete=false;const pageHashes=[];
 for(let page=0;page<100;page++){const result=await stripe('accounts?limit=100'+(cursor?'&starting_after='+encodeURIComponent(cursor):''));if(result.object!=='list'||!Array.isArray(result.data)||typeof result.has_more!=='boolean')fail('account pagination is incomplete.');pageHashes.push(hash(result));for(const a of result.data){if(a.object!=='account'||!accountId(a.id)||a.livemode===false||seenAccounts.has(a.id))fail('account inventory identity/mode or repeated ID differs.');seenAccounts.add(a.id);accounts.push(a);}if(!result.has_more){complete=true;break;}const next=result.data.at(-1)?.id;if(!next||next===cursor)fail('account pagination cursor stalled.');cursor=next;}
 if(!complete)fail('account pagination exceeded the bounded audit without completing.');return{accounts,pageHashes,startedAt,completedAt:new Date().toISOString()};};
 const firstPass=await scanAccounts(),accounts=firstPass.accounts;
 const db=async(table,fields)=>{const rows=[],ids=new Set();let total=null,finished=false;
  for(let page=0;page<100;page++){const offset=rows.length,{data,headers}=await request(`https://${s.projectRef}.supabase.co/rest/v1/${table}?select=${fields}&order=${['photographers','orders','studios'].includes(table)?'id.asc':'photographer_id.asc,id.asc'}`,{range:`${offset}-${offset+999}`});if(!Array.isArray(data))fail('database list response is incomplete.');const text=headers?.get?.('content-range'),match=typeof text==='string'&&text.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/);if(!match)fail('exact database pagination count unavailable.');const count=Number(match[3]);if(data.length&&(Number(match[1])!==offset||Number(match[2])-Number(match[1])+1!==data.length||Number(match[2])>=count))fail('database range response differs.');if(!Number.isSafeInteger(count)||total!==null&&count!==total)fail('database pagination changed while reading.');total=count;for(const row of data){if(typeof row.id!=='string'||!row.id)fail('database row primary identity unavailable.');const token=row.id;if(ids.has(token))fail('database pagination repeated a primary identity.');ids.add(token);rows.push(row);}if(rows.length>=total){if(rows.length!==total)fail('database pagination count differs.');finished=true;break;}if(!data.length)fail('database pagination ended before exact count.');}
  if(!finished)fail('database pagination did not complete.');return rows;};
 let signups=[],newSchemaAbsent=false;try{signups=await db('photographer_stripe_standard_signups','id,photographer_id,status');}catch(error){if(!missingTable.has(error.code))throw error;newSchemaAbsent=true;}
 let profiles;try{profiles=await db('photographers',profileFields+',stripe_account_history_required');if(newSchemaAbsent)fail('new history marker exists without its signup table.');}catch(error){if(!newSchemaAbsent||!missingColumn.has(error.code))throw error;profiles=await db('photographers',profileFields);}
 const studios=await db('studios','id,name');for(const p of profiles)p.inventory_studio_name=studios.find(studio=>studio.id===p.studio_id)?.name||null;
 const histories={signups,registry:await db('photographer_stripe_accounts','id,photographer_id,stripe_account_id,livemode,status'),intents:await db('photographer_stripe_standard_intents','id,photographer_id'),bindings:await db('order_payment_accounts','id,photographer_id'),orders:await db('orders','id,photographer_id,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_account_binding_id')};
 const owners=new Map();for(const p of profiles){if(p.stripe_account_id||p.stripe_connected_account_id||!uuid(p.user_id)||owners.has(p.user_id))continue;const {data}=await request(`https://${s.projectRef}.supabase.co/auth/v1/admin/users/${p.user_id}`);if(data?.id!==p.user_id)fail('exact owner Auth identity unverified.');owners.set(p.user_id,data);}
 const classified=classifySignupInventory({accounts,profiles,owners,histories});
 const finalPass=await scanAccounts(),sort=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 if(canonical(sort(firstPass.accounts))!==canonical(sort(finalPass.accounts)))fail('provider inventory changed during database/owner correlation; rerun the complete audit.');
 if(Date.now()-Date.parse(firstPass.startedAt)>4*60*1000)fail('provider inventory proof exceeded four minutes; correlation cannot reset its timestamp.');
 const ownerIdentitySha256=hash([...owners.values()].map(o=>({id:o.id,email:email(o.email),businessIdentity:business(o.user_metadata?.full_name),emailConfirmedAt:o.email_confirmed_at||null,confirmedAt:o.confirmed_at||null,deletedAt:o.deleted_at||null,bannedUntil:o.banned_until||null})).sort((a,b)=>a.id.localeCompare(b.id)));
 const verifiedAt=firstPass.startedAt,providerInventorySha256=hash(sort(accounts)),profileStateSha256=hash({profiles,histories,ownerIdentitySha256});
 const proof={check:'stripe-standard-signup-inventory',ok:true,auditStartedAt:startedAt,auditUtc:verifiedAt,platformAccountId:s.platformAccountId,projectRef:s.projectRef,
  providerInventorySha256,providerInventoryStartedAt:firstPass.startedAt,providerInventoryCompletedAt:finalPass.completedAt,providerPasses:2,providerPageResponseHashesSha256:hash([firstPass.pageHashes,finalPass.pageHashes]),providerPageCount:firstPass.pageHashes.length+finalPass.pageHashes.length,profileStateSha256,ownerIdentitySha256,paginationComplete:true,providerAccountCount:accounts.length,profileCount:profiles.length,
  eligibleProfileCount:classified.eligible.length,eligibleChunkCount:Math.ceil(classified.eligible.length/10),exclusionReasonCounts:classified.exclusionReasonCounts,
  eligibilityIsGrant:false,atomicProviderDatabaseSnapshot:false,requiresFreshLockedGrantWithinFiveMinutes:true,databaseMutations:0,financialMutations:0};
 const emit=row=>{const line=JSON.stringify(row);if(Buffer.byteLength(line)>3500)fail('audit receipt would be truncated.');report(line);};emit(proof);for(let i=0;i<classified.eligible.length;i+=10)emit({check:'stripe-standard-signup-inventory-eligible',auditUtc:verifiedAt,providerInventorySha256,profileStateSha256,chunk:i/10+1,paginationComplete:true,profiles:classified.eligible.slice(i,i+10)});
 // Raw account/customer/contact data and credentials never leave this helper.
 return proof;
}
