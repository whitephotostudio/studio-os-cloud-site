import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectSyncedSchoolProjectCandidate } from "../../lib/school-project-identity.ts";

const routeSource = readFileSync(
  new URL("../../app/api/dashboard/events/desktop-access/route.ts", import.meta.url),
  "utf8",
);

test("desktop school fallback rejects a same-local-id project linked to another campus", () => {
  const match = selectSyncedSchoolProjectCandidate(
    [
      {
        id: "newer-london-row-with-stale-local-link",
        linked_school_id: "cloud-london",
        linked_local_school_id: "local-brampton",
      },
      {
        id: "brampton-project",
        linked_school_id: "cloud-brampton",
        linked_local_school_id: "local-brampton",
      },
    ],
    {
      schoolId: "cloud-brampton",
      localSchoolId: "local-brampton",
    },
  );

  assert.equal(match?.id, "brampton-project");
});

test("desktop access resolves and preserves exact school identity without title matching", () => {
  assert.doesNotMatch(routeSource, /\.ilike\("school_name", title\)/);
  assert.match(
    routeSource,
    /\.from\("schools"\)[\s\S]*?\.eq\("photographer_id", photographerId\)[\s\S]*?\.eq\("local_school_id", localProjectId\)/,
    "declared local school IDs must be resolved inside the signed-in owner",
  );
  assert.ok(
    (routeSource.match(/id,workflow_type,linked_school_id,linked_local_school_id,access_mode/g) ?? [])
      .length >= 2,
    "cloud-ID and local-ID project lookups must load both school links",
  );
  assert.match(
    routeSource,
    /linkedCandidates\.filter\([\s\S]*?clean\(candidate\.workflow_type\) === "school"[\s\S]*?selectSyncedSchoolProjectCandidate/,
    "school fallback must exclude ordinary event rows and validate both links",
  );
  assert.match(
    routeSource,
    /effectiveWorkflowType === "school"[\s\S]*?!selectSyncedSchoolProjectCandidate\(\[existingProjectAccess\]/,
    "an existing school project must reject an incompatible incoming campus",
  );

  const updateStart = routeSource.indexOf("// Update existing project");
  const updateEnd = routeSource.indexOf("if (updateError) throw updateError;", updateStart);
  assert.notEqual(updateStart, -1);
  assert.notEqual(updateEnd, -1);
  const updateBlock = routeSource.slice(updateStart, updateEnd);
  assert.match(
    updateBlock,
    /\.\.\.\(effectiveWorkflowType === "school" && matchedSchoolId[\s\S]*?linked_school_id: existingLinkedSchoolId \|\| matchedSchoolId/,
    "an existing compatible school link must be preserved instead of overwritten",
  );
});

test("ordinary event local IDs do not become school identity or block album renames", () => {
  assert.match(
    routeSource,
    /requestedWorkflowType === "school"[\s\S]*?linkedCandidates\.find\([\s\S]*?clean\(candidate\.workflow_type\) !== "school"/,
    "event fallback must remain separate from school-project selection",
  );
  assert.match(
    routeSource,
    /const projectHasDeclaredSchoolLink =\s*clean\(projectRow\?\.workflow_type\)\.toLowerCase\(\) === "school"/,
  );
  assert.match(
    routeSource,
    /!projectHasDeclaredSchoolLink \|\|[\s\S]*?!clean\(existingCollectionAccess\?\.title\)[\s\S]*?updatePayload\.title = albumName/,
    "event albums must still accept desktop title changes",
  );
});

test("an existing school project cannot be downgraded to an event", () => {
  assert.match(
    routeSource,
    /existingWorkflowType === "school" &&[\s\S]*?requestedWorkflowType === "event"[\s\S]*?status: 409/,
    "an explicit event request must not detach an existing school project",
  );
});

test("a new school project requires an exact local school match", () => {
  assert.match(
    routeSource,
    /effectiveWorkflowType === "school" &&[\s\S]*?!matchedSchoolId &&[\s\S]*?existingWorkflowType !== "school"[\s\S]*?status: 409/,
    "school galleries must not be created without a durable school identity",
  );
});
