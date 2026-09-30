import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../../" + relativePath, import.meta.url), "utf8");
}

const workspace = source("components/crm/crm-clients-workspace.tsx");
const workspaceStyles = source("components/crm/crm-clients-workspace.module.css");
const sidebar = source("components/dashboard-sidebar.tsx");
const mobileLayout = source("app/m/layout.tsx");
const dashboardPage = source("app/dashboard/clients/page.tsx");
const mobilePage = source("app/m/clients/page.tsx");

test("Clients is reachable from desktop and road navigation", () => {
  assert.match(sidebar, /href: "\/dashboard\/clients"/);
  assert.match(sidebar, /label: "Clients"/);
  assert.match(mobileLayout, /href: "\/m\/clients"/);
  assert.match(mobileLayout, /p\.startsWith\("\/m\/clients"\)/);
  assert.match(dashboardPage, /CrmClientsWorkspace surface="dashboard"/);
  assert.match(mobilePage, /CrmClientsWorkspace surface="mobile"/);
});

test("Clients workspace follows the owner-scoped CRM API contract", () => {
  assert.match(workspace, /fetch\(`\/api\/dashboard\/crm\?mode=index&limit=200&offset=\$\{offset\}`/);
  assert.match(workspace, /if \(!body\.page\.hasMore\) break;/);
  assert.match(workspace, /clientId=\$\{encodeURIComponent\(selectedId\)\}&limit=1/);
  assert.match(workspace, /credentials: "include"/);
  assert.match(workspace, /fetch\("\/api\/dashboard\/crm", \{/);
  assert.match(workspace, /action: "save"/);
  assert.match(workspace, /resource: "task"/);
  assert.match(workspace, /resource: "automationRule"/);
  assert.match(workspace, /emails: arrayOrEmpty<CrmEmailResult>\(source\.emails\)/);
  assert.match(workspace, /activities: arrayOrEmpty<CrmActivity>\(source\.activities\)/);
  assert.match(workspace, /pendingApprovals: numberOrZero\(summary\.pendingApprovals\)/);
  assert.doesNotMatch(workspace, /\bto\s*:/);
});

test("email composer uses saved contacts and approved templates without arbitrary addresses", () => {
  assert.match(workspace, /action: "draftEmail"/);
  assert.match(workspace, /action: "sendEmail"/);
  assert.match(workspace, /contactId: emailState\.contactId/);
  assert.match(workspace, /templateId: emailState\.templateId/);
  assert.match(workspace, /outboxId: emailState\.outboxId/);
  assert.match(workspace, /Server verified/);
  assert.match(workspace, /No approved CRM presets are available yet/);
  assert.match(workspace, /Custom messages must be drafted and reviewed first/);
  assert.match(workspace, /Choose a saved contact/);
  assert.doesNotMatch(workspace, /action: "sendEmail"[\s\S]{0,500}\bto\s*:/);
});

test("all CRM client kinds and annual booking filters are first-class", () => {
  for (const kind of [
    "school",
    "college",
    "university",
    "daycare",
    "montessori",
    "corporate",
    "wedding",
    "event",
    "sports",
    "family",
    "person",
    "nonprofit",
    "other",
  ]) {
    assert.match(workspace, new RegExp('option value="' + kind + '"'));
  }
  assert.match(workspace, /Booked this season/);
  assert.match(workspace, /Not booked/);
  assert.match(workspace, /Follow-up due/);
  assert.match(workspace, /seasonYear/);
});

test("education client types keep school gallery routing and visuals", () => {
  for (const kind of ["school", "college", "university", "daycare", "montessori"]) {
    assert.match(workspace, new RegExp('if \\(normalized === "' + kind + '"\\) return'));
  }
  assert.match(
    workspace,
    /\["school", "college", "university", "daycare", "montessori"\]\.includes/,
  );
  assert.match(workspace, /if \(isSchoolSideClientKind\(client\.kind\)\)/);
  assert.match(workspace, /\{isSchoolSideClientKind\(client\.kind\)/);
  assert.match(workspace, /<option value="college">Colleges<\/option>/);
  assert.match(workspace, /<option value="university">Universities<\/option>/);
  assert.match(workspace, /<option value="daycare">Daycares<\/option>/);
  assert.match(workspace, /<option value="montessori">Montessori schools<\/option>/);
  assert.doesNotMatch(workspace, /client\.kind\s*===\s*["']school["']/);
  assert.doesNotMatch(workspace, /client\.kind\s*!==\s*["']school["']/);
});

test("education clients make one-to-many campuses explicit", () => {
  assert.match(workspace, /const selectedUsesCampusLanguage = !!selectedClient && isSchoolSideClientKind\(selectedClient\.kind\)/);
  assert.match(workspace, /const editorUsesCampusLanguage = isSchoolSideClientKind\(editorLocationKind\)/);
  assert.match(workspace, /Keep every campus under this one/);
  assert.match(workspace, /Each campus can have its own address, phone, timezone, and assigned contacts/);
  assert.match(workspace, /Start with the main campus/);
  assert.match(workspace, /add every other campus under this same client/);
  assert.match(workspace, /editorUsesCampusLanguage \? "Primary campus" : "Primary location"/);
  assert.match(workspace, /editorUsesCampusLanguage \? "Campus name" : "Location name"/);
  assert.match(workspace, /selectedUsesCampusLanguage \? "Add campus" : "Add location"/);
  assert.match(workspace, /locationLabel: isSchoolSideClientKind\(value\) \? "Main campus" : "Main location"/);
  assert.match(
    workspace,
    /isSchoolSideClientKind\(values\.kind\) \? "Main campus" : "Main location"/,
  );
});

test("client search includes every campus and assigned contact, not only the primary records", () => {
  const filterStart = workspace.indexOf("const filteredClients = useMemo");
  const selectedStart = workspace.indexOf("const selectedClient = useMemo", filterStart);
  assert.ok(filterStart >= 0 && selectedStart > filterStart);
  const filterSection = workspace.slice(filterStart, selectedStart);
  assert.match(filterSection, /const clientContacts = payload\.contacts\.filter/);
  assert.match(filterSection, /const clientLocations = payload\.locations\.filter/);
  assert.match(filterSection, /\.\.\.clientContacts\.flatMap/);
  assert.match(filterSection, /\.\.\.clientLocations\.flatMap/);
  assert.match(filterSection, /payload\.locationPhotoSearch/);
  for (const field of [
    "label",
    "addressLine1",
    "addressLine2",
    "city",
    "region",
    "postalCode",
    "phone",
  ]) {
    assert.match(filterSection, new RegExp(`candidate\\.${field}`));
  }
  assert.match(filterSection, /payload\.contacts,/);
  assert.match(filterSection, /payload\.locations,/);
});

test("annual booking views never fall back to a different season", () => {
  assert.match(
    workspace,
    /return rows\.find\(\(cycle\) => cycle\.seasonYear === seasonYear\) \|\| null;/,
  );
  assert.doesNotMatch(
    workspace,
    /rows\.find\(\(cycle\) => cycle\.seasonYear === seasonYear\) \|\| rows\[0\]/,
  );
  assert.match(workspace, /statusFilter === "booked" && !isBookedStatus\(cycle\?\.status\)/);
  assert.match(workspace, /statusFilter === "not_booked" && isBookedStatus\(cycle\?\.status\)/);
  assert.doesNotMatch(workspace, /cycle\?\.status \|\| client\.currentCycleStatus/);
  assert.doesNotMatch(workspace, /selectedCycle\?\.status \|\| selectedClient\.currentCycleStatus/);
  assert.match(workspace, /No " \+ seasonYear \+ " cycle/);
  assert.match(workspace, /No booking cycle exists for \{seasonYear\}/);
  assert.match(workspace, /\{selectedCycle \? "Update" : "Add " \+ seasonYear \+ " season"\}/);
  assert.match(workspace, /mode: selectedCycle \? "edit" : "create"/);
  assert.match(workspace, /recordId: selectedCycle\?\.id \|\| ""/);
  assert.match(workspace, /seasonYear: seasonYear\.toString\(\)/);
  assert.match(workspace, /value=\{recordEditor\.values\.seasonYear\} readOnly/);
});

test("selected-season metrics are derived from exact-year cycles", () => {
  assert.match(workspace, /const seasonSummary = useMemo/);
  assert.match(workspace, /isBookedStatus\(cycleFor\(client\)\?\.status\)/);
  assert.match(workspace, /label: "Booked " \+ seasonYear, value: seasonSummary\.booked/);
  assert.match(workspace, /label: "Still to book", value: seasonSummary\.notBooked/);
});

test("automation modes explain human review and stop rules", () => {
  for (const mode of ["off", "remind", "approve", "autopilot"]) {
    assert.match(workspace, new RegExp(mode + ": \\{"));
  }
  assert.match(workspace, /You control every send/);
  assert.match(workspace, /stop automatically when the client books/);
  assert.match(workspace, /conditions: \{\}/);
  assert.doesNotMatch(workspace, /stopWhenBooked:/);
  assert.doesNotMatch(workspace, /stopWhenDoNotContact:/);
});

test("desktop and mobile layouts expose the complete relationship record", () => {
  for (const heading of [
    "Contacts",
    "Campuses &amp; locations",
    "booking cycle",
    "Agreement",
    "Next follow-up",
    "Timeline",
    "Annual booking assistant",
  ]) {
    assert.match(workspace, new RegExp(heading));
  }
  assert.match(workspaceStyles, /@media \(max-width: 760px\)/);
  assert.match(workspaceStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(workspaceStyles, /max-height: calc\(100dvh/);
  assert.match(workspaceStyles, /grid-template-columns: repeat\(2/);
});

test("batch selection queues only reviewed opted-in saved contacts", () => {
  assert.match(workspace, /selectedClientIds/);
  assert.match(workspace, /Queue email \(review\)/);
  assert.match(workspace, /action: "bulkQueue"/);
  assert.match(workspace, /contactIds: eligibleBatchRows/);
  assert.match(workspace, /marketingConsent\) !== "optedIn"/);
  assert.match(workspace, /This action queues; it does not synchronously blast/);
  assert.match(workspace, /I reviewed this preset and the eligible saved contacts/);
  assert.match(workspace, /\["relationship", "marketing"\]/);
  assert.match(workspace, /limited to 100 eligible contacts/);
});

test("photographers can manage client records from the responsive UI", () => {
  assert.match(workspace, /New client/);
  assert.match(workspace, /Edit client/);
  assert.match(workspace, /Add contact/);
  assert.match(workspace, /"Add campus"/);
  assert.match(workspace, /"Add location"/);
  assert.match(workspace, /resource: "client"/);
  assert.match(workspace, /resource: "location"/);
  assert.match(workspace, /resource: "contact"/);
  assert.match(workspace, /resource: "bookingCycle"/);
  assert.match(workspace, /resource: "agreement"/);
  assert.match(workspace, /Add follow-up task/);
  assert.match(workspace, /Contact name is required/);
});

test("existing tasks and reminders are edited in place and completed history stays manageable", () => {
  assert.match(workspace, /function openTaskEditor\(task\?: CrmTask\)/);
  assert.match(workspace, /mode: task \? "edit" : "create"/);
  assert.match(workspace, /recordId: task\?\.id \|\| ""/);
  assert.match(workspace, /id: recordEditor\.recordId \|\| undefined/);
  assert.match(workspace, /recordEditor\.mode === "create" \? \{ clientId: selectedClient\.id \} : \{\}/);
  assert.match(workspace, /status: values\.status/);
  assert.match(workspace, /values\.status === "completed"/);
  assert.match(workspace, /values\.completedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(workspace, /: null,/);
  assert.match(workspace, /selectedTasks\.length \? selectedTasks\.map/);
  assert.match(workspace, /onClick=\{\(\) => openTaskEditor\(task\)\}/);
  assert.match(workspace, /Edit task & reminder/);
  for (const status of ["open", "snoozed", "completed", "cancelled"]) {
    assert.match(workspace, new RegExp(`<option value="${status}">`));
  }
});

test("one client can manage multiple campuses and multiple assigned contacts", () => {
  assert.match(workspace, /const selectedContacts = useMemo/);
  assert.match(workspace, /contact\.clientId === selectedClient\.id/);
  assert.match(workspace, /const selectedLocations = useMemo/);
  assert.match(workspace, /location\.clientId === selectedClient\.id/);
  assert.match(workspace, /selectedContacts\.map\(\(contact\)/);
  assert.match(workspace, /selectedLocations\.map\(\(location\)/);
  assert.match(workspace, /Campuses &amp; locations/);
  assert.match(workspace, /selectedContacts\.length/);
  assert.match(workspace, /selectedLocations\.length/);
  assert.match(workspace, /onClick=\{\(\) => openContactEditor\(\)\}/);
  assert.match(workspace, /onClick=\{\(\) => openLocationEditor\(\)\}/);
  assert.match(workspace, /onClick=\{\(\) => openContactEditor\(contact\)\}/);
  assert.match(workspace, /onClick=\{\(\) => openLocationEditor\(location\)\}/);
  assert.match(workspace, /"Campus name/);
  assert.match(workspace, /"Location name/);
  assert.match(workspace, /All campuses \/ unassigned/);
  assert.match(workspace, /locationId: nullableText\(values\.locationId\)/);
  assert.match(workspace, /assignedLocation\?\.label/);
  for (const field of [
    "locationLabel",
    "addressLine1",
    "addressLine2",
    "city",
    "region",
    "postalCode",
    "countryCode",
    "locationPhone",
    "timezone",
  ]) {
    assert.match(workspace, new RegExp(`recordEditor\\.values\\.${field}`));
  }
  assert.match(workspace, /action: "delete", resource: "contact"/);
  assert.match(workspace, /action: "delete", resource: "location"/);
  assert.match(workspace, /Reassign " \+ assignedContacts\.length/);
});

test("contact and campus primary changes use the atomic promotion contract", () => {
  const saveStart = workspace.indexOf("async function saveRecordEditor");
  const deleteStart = workspace.indexOf("async function deleteContactRecord", saveStart);
  assert.ok(saveStart >= 0 && deleteStart > saveStart);
  const saveSection = workspace.slice(saveStart, deleteStart);
  assert.equal((saveSection.match(/isPrimary: false/g) || []).length, 2);
  assert.doesNotMatch(saveSection, /isPrimary: values\.isPrimary === "true"/);
  assert.equal((saveSection.match(/const preserveExistingPrimary = values\.originalIsPrimary === "true" && values\.isPrimary === "true"/g) || []).length, 2);
  assert.equal((saveSection.match(/const promoteAfterSave = values\.isPrimary === "true" && values\.originalIsPrimary !== "true"/g) || []).length, 2);
  assert.equal((saveSection.match(/\.\.\.\(preserveExistingPrimary \? \{\} : \{ isPrimary: false \}\)/g) || []).length, 2);
  assert.match(workspace, /async function setPrimaryRecord/);
  assert.match(workspace, /action: "setPrimary"/);
  assert.match(workspace, /resource,[\s\S]*clientId,[\s\S]*id,/);
  assert.match(workspace, /result\.record\?\.isPrimary !== true/);
  assert.match(saveSection, /await setPrimaryRecord\("contact", selectedClient\.id, contactId\)/);
  assert.match(saveSection, /await setPrimaryRecord\("location", selectedClient\.id, locationId\)/);
  assert.match(saveSection, /!isUuid\(contactId\)/);
  assert.match(saveSection, /!isUuid\(locationId\)/);
  assert.match(saveSection, /mode: "edit", recordId: contactId, contactId/);
  assert.match(saveSection, /mode: "edit", recordId: locationId, locationId/);
  assert.match(workspace, /originalIsPrimary: contact\?\.isPrimary \? "true" : "false"/);
  assert.match(workspace, /originalIsPrimary: location\?\.isPrimary \? "true" : "false"/);
  assert.match(workspace, /disabled=\{recordEditor\.values\.originalIsPrimary === "true"\}/);
  assert.match(workspace, /Mark another contact as primary before deleting this primary contact/);
  assert.match(workspace, /Mark another campus as primary before deleting this primary campus/);
});

test("new clients use one atomic idempotent bundle request", () => {
  const bundleStart = workspace.indexOf("async function createClientBundle");
  const editorSaveStart = workspace.indexOf("async function saveRecordEditor", bundleStart);
  assert.ok(bundleStart >= 0 && editorSaveStart > bundleStart);
  const bundleSection = workspace.slice(bundleStart, editorSaveStart);
  assert.equal((workspace.match(/action: "createClientBundle"/g) || []).length, 1);
  assert.equal((bundleSection.match(/await postCrm\(/g) || []).length, 1);
  assert.match(bundleSection, /action: "createClientBundle"/);
  assert.doesNotMatch(bundleSection, /action: "save"/);
  assert.doesNotMatch(bundleSection, /\bclientId\s*:/);
  assert.doesNotMatch(bundleSection, /\blocationId\s*:/);
  assert.doesNotMatch(bundleSection, /\bagreementId\s*:/);
  assert.match(bundleSection, /const bundleRequestKey = clientBundleKeyRef\.current \|\| requestKey\(\)/);
  assert.match(bundleSection, /clientBundleKeyRef\.current = bundleRequestKey/);
  assert.match(bundleSection, /requestKey: bundleRequestKey/);
  assert.match(bundleSection, /!isUuid\(bundle\.clientId\)/);
  assert.match(bundleSection, /!isUuid\(bundle\.locationId\)/);
  assert.match(bundleSection, /!isUuid\(bundle\.contactId\)/);
  assert.match(bundleSection, /!isUuid\(bundle\.bookingCycleId\)/);
  assert.match(workspace, /const clientId = await createClientBundle\(values\);[\s\S]*setSelectedId\(clientId\)/);
});

test("opted-in promotional email requires explicit owner attestation", () => {
  const newEditorStart = workspace.indexOf("function openNewClientEditor");
  const editEditorStart = workspace.indexOf("function openClientEditor", newEditorStart);
  assert.ok(newEditorStart >= 0 && editEditorStart > newEditorStart);
  const newEditorSection = workspace.slice(newEditorStart, editEditorStart);
  assert.match(newEditorSection, /marketingConsent: "unknown"/);
  assert.match(newEditorSection, /consentAttested: "false"/);
  assert.match(workspace, /Opted in — confirmation required/);
  assert.match(workspace, /Promotional email consent confirmation \*/);
  assert.match(workspace, /I confirm this person explicitly agreed to receive promotional email/);
  assert.match(workspace, /choosing Opted in alone is not enough/);
  assert.match(workspace, /values\.marketingConsent === "optedIn" && values\.consentAttested !== "true"/);
  assert.match(workspace, /Confirm that this person agreed to receive promotional email before marking them opted in/);
  assert.match(workspace, /const attestedAt = checked \? new Date\(\)\.toISOString\(\) : ""/);
  assert.match(workspace, /OWNER_ATTESTED_CONSENT_SOURCE = "owner_attested_in_studio_os"/);
});

test("contact saves preserve existing opted-in evidence and clear unknown evidence", () => {
  assert.match(workspace, /consentRecordedAt: clean\(contact\?\.consentRecordedAt\)/);
  assert.match(workspace, /consentSource: clean\(contact\?\.consentSource\)/);
  assert.match(workspace, /const hasExistingConsentEvidence = clean\(contact\?\.marketingConsent\) === "optedIn"/);
  assert.match(workspace, /consentRecordedAt: nullableText\(values\.consentRecordedAt\)/);
  assert.match(workspace, /consentSource: nullableText\(values\.consentSource\)/);
  assert.match(workspace, /marketingConsent,[\s\S]*consentRecordedAt: null,[\s\S]*consentSource: null/);
  assert.equal((workspace.match(/\.\.\.contactConsentPayload\(values\)/g) || []).length, 2);
  const bundleStart = workspace.indexOf("async function createClientBundle");
  const editorSaveStart = workspace.indexOf("async function saveRecordEditor", bundleStart);
  assert.match(workspace.slice(bundleStart, editorSaveStart), /\.\.\.contactConsentPayload\(values\)/);
  assert.match(workspace, /Existing evidence recorded \{formatDate\(recordEditor\.values\.consentRecordedAt, true\)\} will be preserved/);
  assert.match(workspace, /\["contactName", "contactEmail"\]\.includes\(name\)/);
  assert.match(workspace, /consentAttested: "false"/);
});

test("changing normalized contact email requires fresh UI consent evidence", () => {
  assert.match(workspace, /function normalizeEmailIdentity/);
  assert.match(workspace, /return clean\(value\)\.toLowerCase\(\)/);
  assert.match(workspace, /originalContactEmail: normalizeEmailIdentity\(contact\?\.email\)/);
  assert.match(workspace, /normalizeEmailIdentity\(value\) !== current\.values\.originalContactEmail/);
  assert.match(workspace, /emailIdentityChanged \? \{[\s\S]*consentAttested: "false"/);
  assert.match(workspace, /emailIdentityChanged \? \{[\s\S]*consentRecordedAt: ""/);
  assert.match(workspace, /emailIdentityChanged \? \{[\s\S]*consentSource: ""/);
  assert.match(workspace, /emailIdentityChanged \? \{[\s\S]*consentEvidenceExisting: "false"/);
  assert.match(workspace, /originalConsentRecordedAt: clean\(contact\?\.consentRecordedAt\)/);
  assert.match(workspace, /originalConsentSource: clean\(contact\?\.consentSource\)/);
  assert.match(workspace, /returnsToOriginalEmail \? \{[\s\S]*originalConsentRecordedAt/);
});

test("editing a contact preserves explicit do-not-contact state", () => {
  assert.match(workspace, /doNotContact: contact\?\.doNotContact \? "true" : "false"/);
  assert.match(workspace, /doNotContact: values\.doNotContact === "true"/);
  assert.match(workspace, /Blocks one-click and automated email/);
  assert.doesNotMatch(workspace, /doNotContact: false/);
});

test("autopilot uses settled trigger and requires explicit confirmation", () => {
  assert.match(workspace, /triggerType: selectedRule\?\.triggerType \|\| "bookingSeasonOpen"/);
  assert.match(workspace, /actionType: selectedRule\?\.actionType \|\| "emailClient"/);
  assert.match(workspace, /maxRunsPerCycle: 1/);
  assert.doesNotMatch(workspace, /maxRunsPerCycle: selectedRule\?\.maxRunsPerCycle/);
  assert.match(workspace, /confirmAutopilot: automationMode === "autopilot"/);
});

test("approval inbox exposes owned pending messages for explicit review", () => {
  assert.match(workspace, /Email approval inbox/);
  assert.match(workspace, /pendingApprovalEmails/);
  assert.match(workspace, /isPendingApproval\(email\.status\)/);
  assert.match(workspace, /clean\(email\.subject\)/);
  assert.match(workspace, /client\?\.displayName/);
  assert.match(workspace, /clean\(email\.toName\)/);
  assert.match(workspace, /email\.toEmail/);
  assert.match(workspace, /Message preview/);
  assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/);
});

test("approval action queues one owner-scoped outbox row and refreshes", () => {
  assert.match(workspace, /action: "approveEmail"/);
  assert.match(workspace, /outboxId: email\.id/);
  assert.match(workspace, /Approve &amp; queue/);
  assert.match(workspace, /await load\(\)/);
  assert.match(workspace, /This message is no longer waiting for approval/);
});

test("approval inbox and review remain compact on mobile", () => {
  assert.match(workspaceStyles, /\.approvalList/);
  assert.match(workspaceStyles, /\.approvalBodyPreview/);
  assert.match(workspaceStyles, /@media \(max-width: 760px\)[\s\S]*\.approvalList \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(workspaceStyles, /max-height: calc\(100dvh/);
});
