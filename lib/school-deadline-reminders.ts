import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarDateInputValue } from "@/lib/calendar-dates";
import { normalizeEventGallerySettings, type GalleryVisitorEmailTemplate, type SchoolVisitorDeadlineReminderSettings } from "@/lib/event-gallery-settings";
import { hasAcceptedCurrentAgreement } from "@/lib/require-agreement";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { loadSchoolVisitorData } from "@/lib/school-visitor-audience";
import { buildSchoolDeadlineReminderAudience } from "@/lib/school-deadline-reminder-audience";
import { loadSchoolDeadlineReminderPhotoClasses } from "@/lib/school-deadline-reminder-photo-classes";
import { DEFAULT_SCHOOL_VISITOR_FILTERS, isSchoolVisitorClassRangeValid } from "@/lib/school-visitor-filters";
import { sendSchoolVisitorEmailBatch, SchoolVisitorEmailConflict, type SchoolVisitorEmailOutcome } from "@/lib/school-visitor-email-batch";
import { resendConfigured } from "@/lib/resend";

const RUN_TYPE = "school_deadline_reminder_run";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const esc = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const uuidFor = (value: unknown) => { const digest=hash(value);return `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`; };

type School = { id: string; photographer_id: string; school_name: string | null; order_due_date: string | null; status: string | null; expiration_date?: string | null; gallery_settings: unknown };
type Photographer = { id: string; user_id: string; business_name: string | null; studio_email: string | null; billing_email: string | null; subscription_status?: string | null; is_platform_admin?: boolean | null; trial_starts_at?: string | null; trial_ends_at?: string | null; created_at?: string | null };
type RunPayload = {
  schoolId: string; deadline: string; reminderDate: string; timeZone: string;
  requestId: string; template: GalleryVisitorEmailTemplate; settings: SchoolVisitorDeadlineReminderSettings;
  recipients: string[]; cursor: number; outcomes: SchoolVisitorEmailOutcome[];
  lastAttemptAt: string | null; completedAt: string | null; message: string | null;
  leaseToken?: string | null; leaseUntil?: number | null; summarySentAt?: string | null;
  revision?: string;
  summaryMessage?: string | null;
  nextAttemptAt?: number | null; summaryNextAttemptAt?: number | null;
  final?: boolean;
};
type Run = { dedupe_key: string; status: string; payload: RunPayload };

export function schoolDeadlineReminderCalendar(value: string | null | undefined, timeZone: string, now = new Date()) {
  const deadline = calendarDateInputValue(value);
  const parsed = new Date(`${deadline}T00:00:00Z`);
  if (!deadline || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==deadline) return null;
  const reminderDate = new Date(parsed.getTime()-86_400_000).toISOString().slice(0,10);
  const parts=new Map(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(now).map(part=>[part.type,part.value]));
  const today=`${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const hour=Number(parts.get("hour"));
  return { deadline, reminderDate, today, hour, due: today===reminderDate&&hour>=9, missed: today>reminderDate };
}

function counts(payload: RunPayload) {
  const accepted=payload.outcomes.filter(row=>row.status==="sent").length;
  const failed=payload.outcomes.filter(row=>row.status==="failed").length;
  const excluded=payload.outcomes.filter(row=>row.status==="excluded").length;
  return { accepted, failed, excluded, pending: Math.max(0,payload.recipients.length-accepted-failed-excluded) };
}

async function suppressedSchoolReminderEmails(service:SupabaseClient,photographerId:string) {
  const emails=new Set<string>();
  for(const table of ["crm_email_suppressions","crm_contacts"]){
    for(let offset=0;;offset+=500){
      let query=service.from(table).select(table==="crm_contacts"?"id,email":"id,email_normalized")
        .eq("photographer_id",photographerId);
      query=table==="crm_contacts"?query.eq("do_not_contact",true):query.is("lifted_at",null);
      const {data,error}=await query.order("id").range(offset,offset+499);
      // Older installations without the CRM module have no CRM suppression
      // rows. A present module that cannot be read must fail closed.
      if(error){if(error.code==="42P01")break;throw error;}
      for(const value of data??[]){const row=value as Record<string,unknown>;const email=text(row.email_normalized??row.email).toLowerCase();if(email)emails.add(email);}
      if((data??[]).length<500)break;
    }
  }
  return emails;
}

export async function loadSchoolDeadlineReminderStatus(service: SupabaseClient, photographerId: string, schoolId: string, deadline?: string) {
  const {data,error}=await service.from("project_email_deliveries").select("payload,status")
    .eq("photographer_id",photographerId).eq("email_type",RUN_TYPE).contains("payload",{schoolId,...(deadline?{deadline}:{})})
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;if(!data)return null;
  const payload=data.payload as RunPayload;
  return { deadline:payload.deadline,...counts(payload),lastAttemptAt:payload.lastAttemptAt,
    completedAt:payload.completedAt,message:[payload.message,payload.summaryMessage].filter(Boolean).join(" ")||null,summarySentAt:payload.summarySentAt??null };
}

async function readRun(service:SupabaseClient,key:string,photographerId:string) {
  const {data,error}=await service.from("project_email_deliveries").select("dedupe_key,status,payload")
    .eq("dedupe_key",key).eq("photographer_id",photographerId).maybeSingle<Run>();
  if(error)throw error;return data;
}

async function replaceRun(service:SupabaseClient,run:Run,photographerId:string,payload:RunPayload,status=run.status) {
  let update=service.from("project_email_deliveries").update({payload:{...payload,revision:randomUUID()},status,sent_at:new Date().toISOString()})
    .eq("dedupe_key",run.dedupe_key).eq("photographer_id",photographerId);
  update=run.payload.revision?update.eq("payload->>revision",run.payload.revision):update.is("payload->>revision",null);
  const {data,error}=await update.select("dedupe_key,status,payload").maybeSingle<Run>();
  if(error)throw error;return data;
}

function reminderEmail(template:GalleryVisitorEmailTemplate,photographer:Photographer,deadline?:string) {
  const business=text(photographer.business_name)||"Your Photographer";
  const deadlineLine=deadline?`Orders are due tomorrow (${new Date(`${deadline}T00:00:00Z`).toLocaleDateString("en-US",{timeZone:"UTC",month:"long",day:"numeric",year:"numeric"})}).`:"";
  return {subject:template.subject,fromName:business,replyTo:text(photographer.studio_email)||text(photographer.billing_email)||null,
    text:`${template.headline}\n\n${deadlineLine?`${deadlineLine}\n\n`:""}${template.message}\n\n${business}`,
    html:`<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif"><main style="max-width:600px;margin:40px auto;background:#fff"><div style="background:#111;color:#fff;text-align:center;padding:32px;font-size:24px;font-weight:800">${esc(business)}</div><h1 style="padding:24px 40px 0;font-size:22px">${esc(template.headline)}</h1>${deadlineLine?`<p style="padding:0 40px;font-weight:700">${esc(deadlineLine)}</p>`:""}<div style="padding:0 40px 32px;white-space:pre-wrap;line-height:1.6">${esc(template.message)}</div><footer style="padding:20px 40px;background:#f5f5f5;text-align:center;color:#777">${esc(business)}</footer></main></body></html>`};
}

async function notifyPhotographer(service:SupabaseClient,school:School,photographer:Photographer,run:Run,now:Date,onWork?:()=>void) {
  if(run.payload.summarySentAt)return run;
  if(run.payload.summaryNextAttemptAt&&run.payload.summaryNextAttemptAt>now.getTime())return run;
  const recipient=text(photographer.studio_email)||text(photographer.billing_email);
  const {accepted,failed,pending,excluded}=counts(run.payload);
  if(!recipient)return await replaceRun(service,run,photographer.id,{...run.payload,summaryMessage:"Add a studio or billing email to receive the photographer result report."})??run;
  const template={subject:`Deadline reminder report · ${text(school.school_name)||"School gallery"}`,
    headline:"Your deadline reminder results",
    message:`Order deadline: ${run.payload.deadline}\nAccepted by the email provider: ${accepted}\nFailed: ${failed}\nUnconfirmed or not sent: ${pending}\nExcluded after an order, contact, or photo availability change: ${excluded}\n\n${run.payload.message||"The reminder batch is complete."}\n\nAccepted means the provider received the email. Delivery and bounces are separate.`};
  onWork?.();
  const result=await sendSchoolVisitorEmailBatch(service,{photographerId:photographer.id,schoolId:school.id,
    requestId:uuidFor([run.dedupe_key,"photographer-summary",recipient.toLowerCase()]),audienceFingerprint:hash([run.dedupe_key,template]),
    recipients:[recipient.toLowerCase()],offset:0,...template,email:{...reminderEmail(template,photographer),tags:[{name:"type",value:"school-deadline-summary"},{name:"school_id",value:school.id}]},
    namespace:"school-deadline-campaign",emailType:"school-deadline-summary",maxAttempts:1});
  if(result.paused||result.sent!==1)return await replaceRun(service,run,photographer.id,{...run.payload,
    summaryNextAttemptAt:now.getTime()+(result.retryAfterMs??3_600_000),summaryMessage:`Photographer result report is pending: ${result.message||result.outcomes[0]?.error||"Check the studio email address."}`})??run;
  return await replaceRun(service,run,photographer.id,{...run.payload,summarySentAt:now.toISOString(),summaryMessage:null,summaryNextAttemptAt:null})??run;
}

async function stepSchool(service:SupabaseClient,schoolId:string,options:{now:Date;onWork?:()=>void;runKey?:string}) {
  const {data:school,error:schoolError}=await service.from("schools")
    .select("id,photographer_id,school_name,order_due_date,status,expiration_date,gallery_settings").eq("id",schoolId).maybeSingle<School>();
  if(schoolError)throw schoolError;if(!school?.photographer_id)return false;
  const normalized=normalizeEventGallerySettings(school.gallery_settings), settings=normalized.visitorDeadlineReminder;
  const calendar=settings?schoolDeadlineReminderCalendar(school.order_due_date,settings.timeZone,options.now):null;
  if(!options.runKey&&(!settings?.enabled||!calendar||(!calendar.due&&!calendar.missed)))return false;
  const {data:photographer,error:photographerError}=await service.from("photographers")
    .select("id,user_id,business_name,studio_email,billing_email,subscription_status,is_platform_admin,trial_starts_at,trial_ends_at,created_at")
    .eq("id",school.photographer_id).maybeSingle<Photographer>();
  if(photographerError)throw photographerError;if(!photographer)return false;
  const key=options.runKey??`school-deadline-reminder:${hash([photographer.id,school.id,calendar!.deadline])}`;
  let run=await readRun(service,key,photographer.id);
  if(run?.payload.final||run?.payload.completedAt){await notifyPhotographer(service,school,photographer,run,options.now,options.onWork);return false;}
  if(run&&(!settings?.enabled||!calendar||run.payload.deadline!==calendar.deadline)){
    if(run.payload.leaseUntil&&run.payload.leaseUntil>options.now.getTime())return false;
    const stopped=await replaceRun(service,run,photographer.id,{...run.payload,final:true,leaseToken:null,leaseUntil:null,
      message:!settings?.enabled?"Automatic reminders were turned off. The earlier run has ended without sending its remaining contacts.":
        "The order deadline changed. The earlier reminder run has ended without sending its remaining contacts."},"cancelled");
    if(stopped)await notifyPhotographer(service,school,photographer,stopped,options.now,options.onWork);return false;
  }
  if(!settings?.enabled||!calendar||(!calendar.due&&!calendar.missed))return false;
  if(!run){
    const template=normalized.visitorEmailTemplate;
    if(!template?.subject.trim()||!template.headline.trim()||!template.message.trim())return false;
    const filters={...DEFAULT_SCHOOL_VISITOR_FILTERS,classMode:settings.classMode==="range"?"range" as const:"single" as const,classFrom:settings.classFrom,classTo:settings.classTo};
    if(settings.classMode==="range"&&!isSchoolVisitorClassRangeValid(settings.classFrom,settings.classTo))return false;
    const photoClasses=calendar.missed?null:await loadSchoolDeadlineReminderPhotoClasses(service,school.id);
    // Do not freeze an empty run before photographs are published: uploads
    // later on this same reminder day should still be eligible to start.
    if(!calendar.missed&&!photoClasses?.size)return false;
    const data=calendar.missed?null:await loadSchoolVisitorData(service,school.id);
    const recipients=data?buildSchoolDeadlineReminderAudience(data,filters,photoClasses!).map(row=>row.email):[];
    const payload:RunPayload={schoolId:school.id,...calendar,timeZone:settings.timeZone,requestId:randomUUID(),revision:randomUUID(),template,settings,
      recipients,cursor:0,outcomes:[],lastAttemptAt:null,completedAt:null,
      message:calendar.missed?"The day-before reminder window was missed. No late reminder was sent.":null,final:calendar.missed};
    const {error}=await service.from("project_email_deliveries").upsert({photographer_id:photographer.id,recipient_email:recipients[0]||text(photographer.studio_email)||"reminder-status@studiooscloud.com",
      email_type:RUN_TYPE,dedupe_key:key,status:calendar.missed?"missed":"pending",subject:template.subject,payload},
      {onConflict:"dedupe_key",ignoreDuplicates:true});
    if(error)throw error;run=await readRun(service,key,photographer.id);if(!run)throw Error("Reminder run could not be saved.");
  }
  if(run.payload.final||run.payload.completedAt){await notifyPhotographer(service,school,photographer,run,options.now,options.onWork);return false;}
  if(calendar.due&&run.payload.nextAttemptAt&&run.payload.nextAttemptAt>options.now.getTime()){
    if(calendar.hour===23){const paused=await replaceRun(service,run,photographer.id,{...run.payload,final:true,
      message:"The provider pause lasts beyond the remaining reminder window. The batch ended with the results shown here."},"blocked");
      if(paused)await notifyPhotographer(service,school,photographer,paused,options.now,options.onWork);}
    return false;
  }
  if(run.payload.leaseUntil&&run.payload.leaseUntil>options.now.getTime())return false;
  const claimed=await replaceRun(service,run,photographer.id,{...run.payload,leaseToken:randomUUID(),leaseUntil:options.now.getTime()+75_000,lastAttemptAt:options.now.toISOString()},"processing");
  if(!claimed)return false;run=claimed;
  try{
    if(calendar.missed){
      const missed=await replaceRun(service,run,photographer.id,{...run.payload,leaseToken:null,leaseUntil:null,final:true,
        message:"The reminder window ended before all emails could be confirmed. No late reminder will be sent."},"missed");
      if(missed)await notifyPhotographer(service,school,photographer,missed,options.now,options.onWork);return false;
    }
    if(!hasActiveSubscription(photographer)||!photographer.user_id||!await hasAcceptedCurrentAgreement({service,userId:photographer.user_id}))throw Error("The photographer's subscription or current agreement does not allow automatic sending.");
    if(["inactive","closed","pre_release","prerelease","archived","deleted"].includes(text(school.status).toLowerCase().replaceAll("-","_")))throw Error("The school gallery is not active for reminders.");
    const expiration=calendarDateInputValue(school.expiration_date);
    if(expiration&&calendar.today>expiration)throw Error("The school gallery expired before the reminder could be sent.");
    if(JSON.stringify(normalized.visitorEmailTemplate)!==JSON.stringify(run.payload.template))throw new SchoolVisitorEmailConflict("The saved reminder text changed after this batch started. Review the earlier run before sending another reminder.");
    const frozen=settings;
    const filters={...DEFAULT_SCHOOL_VISITOR_FILTERS,classMode:frozen.classMode==="range"?"range" as const:"single" as const,classFrom:frozen.classFrom,classTo:frozen.classTo};
    // Full, freshly paged orders are loaded before every chunk, including
    // pending/cancelled/refunded orders. Any order suppresses that contact.
    const [data,photoClasses,suppressed]=await Promise.all([
      loadSchoolVisitorData(service,school.id),loadSchoolDeadlineReminderPhotoClasses(service,school.id),
      suppressedSchoolReminderEmails(service,photographer.id),
    ]);
    const eligible=new Set(buildSchoolDeadlineReminderAudience(data,filters,photoClasses).map(row=>row.email).filter(email=>!suppressed.has(email)));
    const excludedRecipients=run.payload.recipients.filter(email=>!eligible.has(email));
    if(run.payload.recipients.length)options.onWork?.();
    const result=run.payload.recipients.length?await sendSchoolVisitorEmailBatch(service,{photographerId:photographer.id,schoolId:school.id,
      requestId:run.payload.requestId,audienceFingerprint:hash([key,run.payload.recipients,run.payload.template]),
      recipients:run.payload.recipients,offset:run.payload.cursor,...run.payload.template,email:{...reminderEmail(run.payload.template,photographer,run.payload.deadline),tags:[{name:"type",value:"school-deadline-reminder"},{name:"school_id",value:school.id}]},
      excludedRecipients,namespace:"school-deadline-campaign",emailType:"school-deadline-reminder",maxAttempts:1}):null;
    const outcomes=new Map(run.payload.outcomes.map(row=>[row.recipientEmail,row]));
    for(const row of result?.outcomes??[])outcomes.set(row.recipientEmail,row);
    const complete=!result||(!result.paused&&result.nextOffset===null);
    const final=complete||result?.retryAllowed===false||calendar.hour===23&&result?.paused;
    const payload={...run.payload,outcomes:[...outcomes.values()],cursor:result?.nextOffset??run.payload.recipients.length,
      nextAttemptAt:result?.paused?options.now.getTime()+(result.retryAfterMs??3_600_000):null,
      leaseToken:null,leaseUntil:null,completedAt:complete?options.now.toISOString():null,final,
      message:result?.paused?result.message??"The provider could not confirm this batch. The next hourly run will retry safely.":
        complete?"The day-before reminder batch is complete.":"The next reminder batch is scheduled to continue."};
    const saved=await replaceRun(service,run,photographer.id,payload,complete?"completed":final?"blocked":"pending");
    if(!saved)return false;
    if(final)await notifyPhotographer(service,school,photographer,saved,options.now,options.onWork);
    return !result?.paused&&!complete;
  }catch(error){
    const final=error instanceof SchoolVisitorEmailConflict;
    const saved=await replaceRun(service,run,photographer.id,{...run.payload,leaseToken:null,leaseUntil:null,final,
      message:error instanceof Error?error.message:"Automatic reminder sending is unavailable."},final?"blocked":"pending");
    if(saved&&final)await notifyPhotographer(service,school,photographer,saved,options.now,options.onWork);
    return false;
  }
}

export async function deliverSchoolDeadlineReminders(service:SupabaseClient,options:{now?:Date;budgetMs?:number}={}) {
  if(!resendConfigured())throw Error("School reminder email sending is not configured.");
  const discoveryNow=options.now??new Date(), stopAt=Date.now()+(options.budgetMs??45_000);
  const earliest=new Date(discoveryNow.getTime()-86_400_000).toISOString().slice(0,10);
  const latest=new Date(discoveryNow.getTime()+3*86_400_000).toISOString().slice(0,10);
  const work=new Map<string,{schoolId:string;runKey:string}>();
  for(let offset=0;Date.now()<stopAt-15_000;offset+=500){
    const {data,error}=await service.from("schools").select("id,photographer_id,order_due_date,gallery_settings")
      .contains("gallery_settings",{visitorDeadlineReminder:{enabled:true}}).not("order_due_date","is",null)
      .gte("order_due_date",earliest).lte("order_due_date",`${latest}T23:59:59Z`)
      .order("id").range(offset,offset+499);
    if(error)throw error;
    for(const row of data??[]){const settings=normalizeEventGallerySettings(row.gallery_settings).visitorDeadlineReminder;
      if(settings?.enabled){const calendar=schoolDeadlineReminderCalendar(row.order_due_date,settings.timeZone,discoveryNow);
        if(calendar?.due||calendar?.missed){const runKey=`school-deadline-reminder:${hash([row.photographer_id,row.id,calendar.deadline])}`;
          work.set(runKey,{schoolId:row.id,runKey});}}}
    if((data??[]).length<500)break;
  }
  // Resume earlier incomplete runs even after an outage crossed the date
  // boundary, so owners get a final report without a late customer email.
  for(let offset=0;Date.now()<stopAt-15_000;offset+=500){
    const {data,error}=await service.from("project_email_deliveries").select("payload,dedupe_key")
      .eq("email_type",RUN_TYPE).in("status",["pending","processing","blocked","missed","completed","cancelled"])
      .is("payload->>summarySentAt",null)
      .order("id").range(offset,offset+499);
    if(error)throw error;for(const row of data??[]){const payload=row.payload as RunPayload;
      if(!payload.summarySentAt)work.set(row.dedupe_key,{schoolId:payload.schoolId,runKey:row.dedupe_key});}
    if((data??[]).length<500)break;
  }
  const queue=[...work.values()];let processed=0,errors=0;
  while(queue.length&&Date.now()<stopAt-15_000){
    const item=queue.shift()!,schoolId=item.schoolId;
    let continues=false,worked=false;
    try{continues=await stepSchool(service,schoolId,{now:options.now??new Date(),runKey:item.runKey,onWork:()=>{worked=true;}});if(continues)queue.push(item);processed++;}
    catch(error){errors++;console.error("[school-deadline-reminders] School reminder requires retry.",{schoolId,error:error instanceof Error?error.message:"Unavailable"});}
    // One request per second leaves room for other email workflows on the
    // shared provider account. Every following hour resumes durable work.
    if(worked&&queue.length&&Date.now()<stopAt-16_000)await new Promise(resolve=>setTimeout(resolve,1000));
  }
  return {schools:new Set([...work.values()].map(item=>item.schoolId)).size,processed,errors,deferred:queue.length};
}
