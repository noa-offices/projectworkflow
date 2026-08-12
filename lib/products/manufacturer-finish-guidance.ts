import type { ProductTemplateDraft } from "./product-template-draft";

export type ManufacturerFinishGuidance = ProductTemplateDraft["materialSuggestions"][number];

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export function normalizeManufacturerFinishGuidance(value: unknown): ManufacturerFinishGuidance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>; const label = text(record.label); const notes = text(record.notes);
    if (!label && !notes) return [];
    return [{ id: text(record.id) ?? `guidance-${index + 1}`, label, notes, supplierCodes: strings(record.supplierCodes), referenceCodes: strings(record.referenceCodes) }];
  });
}

export function manufacturerFinishGuidanceFromForm(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  try { return normalizeManufacturerFinishGuidance(JSON.parse(value)); } catch { return []; }
}

export function mergeManufacturerFinishGuidance(current: ManufacturerFinishGuidance[], incoming: ManufacturerFinishGuidance[]) {
  const keys = new Set(current.flatMap((item) => [item.id, item.supplierCodes[0], item.referenceCodes[0]].filter(Boolean)));
  return [...current, ...incoming.filter((item) => {
    const itemKeys = [item.id, item.supplierCodes[0], item.referenceCodes[0]].filter(Boolean);
    if (itemKeys.some((key) => keys.has(key))) return false;
    itemKeys.forEach((key) => keys.add(key)); return true;
  })];
}
