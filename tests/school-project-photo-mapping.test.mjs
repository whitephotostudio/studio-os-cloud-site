import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAlbumReferenceParts,
  projectAlbumSchoolPhotoReference,
  selectResolvedOwnedProjectSchool,
} from "../lib/school-project-photo-mapping-core.ts";

const projectId = "project-london";
const collectionId = "collection-grad";

test("maps Alice's nested project copy exactly without borrowing Bob's same basename", () => {
  const alice = projectAlbumSchoolPhotoReference({
    storageKey: `projects/${projectId}/albums/${collectionId}/Alice/IMG_0001_preview.jpg`,
    projectId,
    collectionId,
    collectionTitle: "2025 Grad",
  });
  const bob = projectAlbumSchoolPhotoReference({
    storageKey: `projects/${projectId}/albums/${collectionId}/Bob/IMG_0001_preview.jpg`,
    projectId,
    collectionId,
    collectionTitle: "2025 Grad",
  });

  assert.equal(alice, "2025 Grad/Alice/IMG_0001_preview.jpg");
  assert.equal(bob, "2025 Grad/Bob/IMG_0001_preview.jpg");
  assert.notEqual(alice, bob);
});

test("preserves flat or ambiguous manual project uploads", () => {
  for (const [storageKey, collectionTitle] of [
    [`projects/${projectId}/albums/${collectionId}/IMG_0001.jpg`, "2025 Grad"],
    [`projects/${projectId}/albums/${collectionId}/Alice/IMG_0001.jpg`, ""],
    ["projects/another-project/albums/collection-grad/Alice/IMG_0001.jpg", "2025 Grad"],
    ["projects/project-london/albums/another-collection/Alice/IMG_0001.jpg", "2025 Grad"],
  ]) {
    assert.equal(
      projectAlbumSchoolPhotoReference({
        storageKey,
        projectId,
        collectionId,
        collectionTitle,
      }),
      null,
    );
  }
});

test("parses only canonical project album paths", () => {
  assert.deepEqual(
    projectAlbumReferenceParts(
      "projects/project-london/albums/collection-grad/Alice/IMG_0001.jpg",
    ),
    {
      projectId: "project-london",
      collectionId: "collection-grad",
      relativePath: "Alice/IMG_0001.jpg",
    },
  );
  assert.equal(
    projectAlbumReferenceParts("schools/london/2025 Grad/Alice/IMG_0001.jpg"),
    null,
  );
});

test("resolves exact owned cloud and legacy links and rejects ambiguity or conflict", () => {
  const london = {
    id: "cloud-london",
    local_school_id: "local-london",
    photographer_id: "owner-1",
  };
  const londonDuplicateLocal = {
    id: "cloud-london-duplicate",
    local_school_id: "local-london",
    photographer_id: "owner-1",
  };
  const brampton = {
    id: "cloud-brampton",
    local_school_id: "local-brampton",
    photographer_id: "owner-1",
  };

  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "school",
        linked_school_id: london.id,
        linked_local_school_id: london.local_school_id,
      },
      [london, brampton],
      "owner-1",
    )?.id,
    london.id,
  );
  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "school",
        linked_school_id: null,
        linked_local_school_id: london.local_school_id,
      },
      [london, brampton],
      "owner-1",
    )?.id,
    london.id,
  );
  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "school",
        linked_school_id: brampton.id,
        linked_local_school_id: london.local_school_id,
      },
      [london, brampton],
      "owner-1",
    ),
    null,
  );
  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "school",
        linked_school_id: null,
        linked_local_school_id: london.local_school_id,
      },
      [london, londonDuplicateLocal],
      "owner-1",
    ),
    null,
  );
  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "school",
        linked_school_id: london.id,
        linked_local_school_id: null,
      },
      [{ ...london, photographer_id: "another-owner" }],
      "owner-1",
    ),
    null,
  );
  assert.equal(
    selectResolvedOwnedProjectSchool(
      {
        workflow_type: "event",
        linked_school_id: null,
        linked_local_school_id: london.local_school_id,
      },
      [london],
      "owner-1",
    ),
    null,
    "ordinary desktop event local ids are not school identities",
  );
});
