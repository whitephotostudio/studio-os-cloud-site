import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  CrmEmailError,
  deliverClaimedCrmEmail,
  loadCrmPhotographerById,
  queueTemplatedCrmEmail,
} from "@/lib/crm-email";
import { resendConfigured } from "@/lib/resend";
import { crmUnsubscribeConfigured } from "@/lib/crm-unsubscribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, unknown>;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function authorized(request: NextRequest) {
  const expected = clean(process.env.CRON_SECRET);
  const actual = clean(request.headers.get("authorization"));
  if (!expected || !actual.startsWith("Bearer ")) return false;
  const supplied = actual.slice(7);
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function databaseCycleStatus(value: unknown) {
  const map: Record<string, string> = {
    notContacted: "not_contacted",
    contactDue: "contact_due",
    followUp: "follow_up",
    proposalSent: "proposal_sent",
  };
  const text = clean(value);
  return map[text] ?? text;
}

function localClockReached(timeZone: string, sendLocalTime: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? -1);
    const [targetHour, targetMinute] = sendLocalTime.split(":").map(Number);
    return hour * 60 + minute >= targetHour * 60 + targetMinute;
  } catch {
    return false;
  }
}

function localCalendarDate(timeZone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function shiftedCalendarDate(value: unknown, daysOffset: number) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(daysOffset)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + daysOffset));
  if (!Number.isFinite(shifted.getTime())) return null;
  return shifted.toISOString().slice(0, 10);
}

function localCalendarDateReached(
  timeZone: string,
  targetDate: unknown,
  daysOffset: number,
  now: Date,
) {
  const today = localCalendarDate(timeZone, now);
  const dueDate = shiftedCalendarDate(targetDate, daysOffset);
  return Boolean(today && dueDate && today >= dueDate);
}

function triggerBase(rule: Row, cycle: Row) {
  if (rule.trigger_type === "follow_up_due") {
    return Date.parse(clean(cycle.next_follow_up_at));
  }
  return Number.NaN;
}

function safeConditions(rule: Row, client: Row, cycle: Row) {
  const conditions =
    rule.conditions && typeof rule.conditions === "object" && !Array.isArray(rule.conditions)
      ? (rule.conditions as Row)
      : {};
  const keys = Object.keys(conditions);
  if (
    keys.some(
      (key) =>
        ![
          "clientKinds",
          "cycleStatuses",
          "stopWhenBooked",
          "stopWhenDoNotContact",
        ].includes(key),
    )
  ) {
    return false;
  }
  if (conditions.stopWhenBooked != null && conditions.stopWhenBooked !== true) return false;
  if (
    conditions.stopWhenDoNotContact != null &&
    conditions.stopWhenDoNotContact !== true
  ) {
    return false;
  }
  if (conditions.clientKinds != null) {
    if (!Array.isArray(conditions.clientKinds)) return false;
    if (!conditions.clientKinds.map(clean).includes(clean(client.kind))) return false;
  }
  if (conditions.cycleStatuses != null) {
    if (!Array.isArray(conditions.cycleStatuses)) return false;
    if (!conditions.cycleStatuses.map(databaseCycleStatus).includes(clean(cycle.status))) return false;
  }
  return true;
}

function occurrenceKey(rule: Row, cycle: Row) {
  const triggerValue =
    rule.trigger_type === "booking_season_open"
      ? clean(cycle.target_contact_on)
      : clean(cycle.next_follow_up_at).slice(0, 10);
  return triggerValue ? `${String(rule.id)}:${String(cycle.id)}:${triggerValue}` : null;
}

async function createReminderTask(input: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  client: Row;
  contact: Row | null;
  cycle: Row;
  rule: Row;
  occurrence: string;
}) {
  const dedupeKey = `crm:${input.occurrence}`;
  const { data, error } = await input.service
    .from("crm_tasks")
    .upsert(
      {
        photographer_id: input.photographerId,
        client_id: input.client.id,
        contact_id: input.contact?.id ?? null,
        booking_cycle_id: input.cycle.id,
        automation_rule_id: input.rule.id,
        kind: "follow_up",
        title: `Review ${clean(input.rule.name)} for ${clean(input.client.display_name)}`.slice(0, 300),
        notes: "Created by CRM reminder automation. No client email was sent.",
        due_at: new Date().toISOString(),
        status: "open",
        priority: 1,
        dedupe_key: dedupeKey,
      },
      { onConflict: "photographer_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  const insertedId = (data?.[0] as { id?: string } | undefined)?.id;
  if (insertedId) return insertedId;
  const { data: existing, error: existingError } = await input.service
    .from("crm_tasks")
    .select("id")
    .eq("photographer_id", input.photographerId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) throw new Error("CRM reminder task could not be resolved.");
  return String(existing.id);
}

async function recordAutomationRun(input: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  ruleId: string;
  clientId: string;
  bookingCycleId: string;
  occurrence: string;
  outcome: "reminder" | "pending_approval" | "queued";
  taskId?: string | null;
  outboxId?: string | null;
}) {
  const { data, error } = await input.service
    .from("crm_automation_runs")
    .insert({
      photographer_id: input.photographerId,
      automation_rule_id: input.ruleId,
      client_id: input.clientId,
      booking_cycle_id: input.bookingCycleId,
      task_id: input.taskId ?? null,
      outbox_id: input.outboxId ?? null,
      occurrence_key: input.occurrence,
      outcome: input.outcome,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return false;
  if (error) throw error;
  return Boolean(data?.id);
}

async function runRules(service: ReturnType<typeof createDashboardServiceClient>, now: Date) {
  const { data: rulesData, error: rulesError } = await service
    .from("crm_automation_rules")
    .select("*")
    .eq("enabled", true)
    .neq("mode", "off")
    .limit(500);
  if (rulesError) throw rulesError;
  const rules = (rulesData ?? []) as Row[];
  if (!rules.length) return { checked: 0, reminders: 0, pendingApproval: 0, queued: 0, skipped: 0 };

  const photographerIds = [...new Set(rules.map((row) => String(row.photographer_id)))];
  const ruleIds = rules.map((row) => String(row.id));
  const [clientsResult, cyclesResult, contactsResult, automationRunsResult] =
    await Promise.all([
      service
        .from("crm_clients")
        .select("id,photographer_id,display_name,kind,archived_at")
        .in("photographer_id", photographerIds)
        .is("archived_at", null)
        .limit(5000),
      service
        .from("crm_booking_cycles")
        .select("*")
        .in("photographer_id", photographerIds)
        .not("status", "in", '("booked","completed","lost","skipped")')
        .limit(10000),
      service
        .from("crm_contacts")
        .select("id,photographer_id,client_id,email,is_primary,do_not_contact,archived_at")
        .in("photographer_id", photographerIds)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .limit(10000),
      service
        .from("crm_automation_runs")
        .select("automation_rule_id,booking_cycle_id")
        .in("automation_rule_id", ruleIds)
        .limit(10000),
    ]);
  for (const result of [clientsResult, cyclesResult, contactsResult, automationRunsResult]) {
    if (result.error) throw result.error;
  }

  const clients = (clientsResult.data ?? []) as Row[];
  const cycles = (cyclesResult.data ?? []) as Row[];
  const contacts = (contactsResult.data ?? []) as Row[];
  const runCounts = new Map<string, number>();
  for (const row of (automationRunsResult.data ?? []) as Row[]) {
    const key = `${String(row.automation_rule_id)}:${String(row.booking_cycle_id)}`;
    runCounts.set(key, (runCounts.get(key) ?? 0) + 1);
  }
  const photographerCache = new Map<string, Awaited<ReturnType<typeof loadCrmPhotographerById>>>();
  let reminders = 0;
  let pendingApproval = 0;
  let queued = 0;
  let skipped = 0;

  for (const rule of rules) {
    const trigger = clean(rule.trigger_type);
    if (!['booking_season_open', 'follow_up_due'].includes(trigger)) {
      skipped += 1;
      continue;
    }
    const timeZone = clean(rule.timezone) || "America/Toronto";
    if (!localClockReached(timeZone, clean(rule.send_local_time) || "09:00:00", now)) continue;
    const ownedClients = clients.filter(
      (client) =>
        client.photographer_id === rule.photographer_id &&
        (!rule.client_id || client.id === rule.client_id),
    );
    for (const client of ownedClients) {
      const clientCycles = cycles.filter((cycle) => cycle.client_id === client.id);
      for (const cycle of clientCycles) {
        if (!safeConditions(rule, client, cycle)) {
          skipped += 1;
          continue;
        }
        const daysOffset = Number(rule.days_offset ?? 0);
        const dueReached =
          trigger === "booking_season_open"
            ? localCalendarDateReached(
                timeZone,
                cycle.target_contact_on,
                daysOffset,
                now,
              )
            : (() => {
                const base = triggerBase(rule, cycle);
                const due = base + daysOffset * 86_400_000;
                return Number.isFinite(due) && due <= now.getTime();
              })();
        if (!dueReached) continue;
        const runKey = `${String(rule.id)}:${String(cycle.id)}`;
        if ((runCounts.get(runKey) ?? 0) >= Number(rule.max_runs_per_cycle ?? 1)) continue;
        const occurrence = occurrenceKey(rule, cycle);
        if (!occurrence) {
          skipped += 1;
          continue;
        }
        const contact =
          contacts.find((item) => item.client_id === client.id && item.is_primary === true) ??
          contacts.find((item) => item.client_id === client.id && clean(item.email)) ??
          null;
        if (contact?.do_not_contact === true) {
          skipped += 1;
          continue;
        }
        const mode = clean(rule.mode);
        const actionType = clean(rule.action_type);
        if (mode === "remind" || actionType !== "email_client") {
          const taskId = await createReminderTask({
            service,
            photographerId: String(rule.photographer_id),
            client,
            contact,
            cycle,
            rule,
            occurrence,
          });
          if (await recordAutomationRun({
            service,
            photographerId: String(rule.photographer_id),
            ruleId: String(rule.id),
            clientId: String(client.id),
            bookingCycleId: String(cycle.id),
            occurrence,
            outcome: "reminder",
            taskId,
          })) {
            reminders += 1;
            runCounts.set(runKey, (runCounts.get(runKey) ?? 0) + 1);
          }
          continue;
        }
        if (!contact || !rule.template_id) {
          skipped += 1;
          continue;
        }
        if (mode === "autopilot" && (!rule.autopilot_approved_at || !rule.autopilot_approved_by)) {
          skipped += 1;
          continue;
        }
        const photographerId = String(rule.photographer_id);
        let photographer = photographerCache.get(photographerId);
        if (photographer === undefined) {
          photographer = await loadCrmPhotographerById(service, photographerId);
          photographerCache.set(photographerId, photographer);
        }
        if (!photographer) {
          skipped += 1;
          continue;
        }
        try {
          const row = await queueTemplatedCrmEmail({
            service,
            photographer,
            contactId: String(contact.id),
            clientId: String(client.id),
            bookingCycleId: String(cycle.id),
            templateId: String(rule.template_id),
            requestKey: `automation:${occurrence}`,
            automationRuleId: String(rule.id),
            deliveryMode: mode === "autopilot" ? "autopilot" : "approval",
            requireExplicitConsent: mode === "autopilot",
          });
          if (row) {
            const recorded = await recordAutomationRun({
              service,
              photographerId,
              ruleId: String(rule.id),
              clientId: String(client.id),
              bookingCycleId: String(cycle.id),
              occurrence,
              outcome: mode === "autopilot" ? "queued" : "pending_approval",
              outboxId: String(row.id),
            });
            if (recorded) {
              if (mode === "autopilot") queued += 1;
              else pendingApproval += 1;
              runCounts.set(runKey, (runCounts.get(runKey) ?? 0) + 1);
            }
          }
        } catch (error) {
          if (error instanceof CrmEmailError) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }
    }
  }
  return { checked: rules.length, reminders, pendingApproval, queued, skipped };
}

async function processQueue(service: ReturnType<typeof createDashboardServiceClient>) {
  if (!resendConfigured()) {
    return { claimed: 0, processed: 0, paused: "provider_not_configured" };
  }
  const workerId = `cron:${randomUUID()}`;
  const { data, error } = await service.rpc("crm_claim_email_batch", {
    p_worker: workerId,
    p_limit: 25,
    p_allow_non_transactional: crmUnsubscribeConfigured(),
  });
  if (error) throw error;
  const claimed = (Array.isArray(data) ? data : []) as Row[];
  const photographerCache = new Map<string, Awaited<ReturnType<typeof loadCrmPhotographerById>>>();
  await Promise.all(
    [...new Set(claimed.map((row) => String(row.photographer_id)))].map(
      async (photographerId) => {
        photographerCache.set(
          photographerId,
          await loadCrmPhotographerById(service, photographerId),
        );
      },
    ),
  );
  let processed = 0;
  for (let offset = 0; offset < claimed.length; offset += 5) {
    await Promise.all(
      claimed.slice(offset, offset + 5).map(async (row) => {
        const photographer = photographerCache.get(String(row.photographer_id));
        if (!photographer) {
          const { error: finishError } = await service.rpc("crm_finish_email_attempt", {
            p_outbox_id: row.id,
            p_worker: workerId,
            p_succeeded: false,
            p_provider_message_id: null,
            p_error_message: "Photographer profile not found.",
            p_retry_at: null,
            p_metadata: {},
          });
          if (finishError) throw finishError;
          return;
        }
        await deliverClaimedCrmEmail({ service, photographer, row, workerId });
        processed += 1;
      }),
    );
  }
  return { claimed: claimed.length, processed };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  try {
    const service = createDashboardServiceClient();
    const automation = await runRules(service, new Date());
    const delivery = await processQueue(service);
    return NextResponse.json({ ok: true, automation, delivery });
  } catch (error) {
    console.error("[cron:crm-automation]", error);
    return NextResponse.json(
      { ok: false, message: "CRM automation run failed." },
      { status: 500 },
    );
  }
}
