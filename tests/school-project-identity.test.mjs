import assert from "node:assert/strict";
import test from "node:test";

import {
  schoolProjectIdentityPriority,
  selectSyncedSchoolProjectCandidate,
} from "../lib/school-project-identity.ts";

const london = {
  schoolId: "cloud-london",
  localSchoolId: "local-london",
};

test("rejects a historical school project when either explicit link belongs to another campus", () => {
  assert.equal(
    schoolProjectIdentityPriority(
      {
        id: "shared-project",
        linked_school_id: "cloud-london",
        linked_local_school_id: "local-brampton",
      },
      london,
    ),
    0,
  );
  assert.equal(
    schoolProjectIdentityPriority(
      {
        id: "shared-project",
        linked_school_id: "cloud-brampton",
        linked_local_school_id: "local-london",
      },
      london,
    ),
    0,
  );
});

test("prefers the exact local identity without borrowing a conflicting linked project", () => {
  const match = selectSyncedSchoolProjectCandidate(
    [
      {
        id: "stale-shared-project",
        linked_school_id: "cloud-london",
        linked_local_school_id: "local-brampton",
      },
      {
        id: "london-project",
        linked_school_id: "cloud-london",
        linked_local_school_id: "local-london",
      },
      {
        id: "legacy-cloud-only-project",
        linked_school_id: "cloud-london",
        linked_local_school_id: null,
      },
    ],
    london,
  );

  assert.equal(match?.id, "london-project");
});

test("keeps a manually curated campus project when both identities agree", () => {
  assert.equal(
    schoolProjectIdentityPriority(
      {
        id: "london-project-with-manual-cover",
        linked_school_id: " CLOUD-LONDON ",
        linked_local_school_id: "LOCAL-LONDON",
      },
      london,
    ),
    3,
  );
});
