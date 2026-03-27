export type WorkflowType = "school" | "event";

export function getProjectLabels(workflowType: WorkflowType) {
  if (workflowType === "school") {
    return {
      projectSingle: "School Project",
      projectPlural: "School Projects",
      collectionSingle: "Class",
      collectionPlural: "Classes",
      gallerySingle: "Gallery",
      galleryPlural: "Galleries",
      subjectSingle: "Student",
      subjectPlural: "Students",
      createCollection: "Create Class",
      createGallery: "Create Gallery",
    };
  }

  return {
    projectSingle: "Event Project",
    projectPlural: "Event Projects",
    collectionSingle: "Album",
    collectionPlural: "Albums",
    gallerySingle: "Gallery",
    galleryPlural: "Galleries",
    subjectSingle: "Person",
    subjectPlural: "People",
    createCollection: "Create Album",
    createGallery: "Create Gallery",
  };
}