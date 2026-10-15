import {
  normalizeGalleryVisitorEmailTemplate,
  type GalleryVisitorEmailTemplate,
} from "@/lib/event-gallery-settings";

export type SchoolVisitorEmailTemplate = GalleryVisitorEmailTemplate;

function settingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readSchoolVisitorEmailTemplate(settings: unknown): SchoolVisitorEmailTemplate | null {
  return normalizeGalleryVisitorEmailTemplate(settingsObject(settings).visitorEmailTemplate);
}

/** Merge into the raw document so saving a draft cannot reset gallery settings. */
export function mergeSchoolVisitorEmailTemplate(settings: unknown, template: SchoolVisitorEmailTemplate) {
  return { ...settingsObject(settings), visitorEmailTemplate: { ...template } };
}
