import { projectFileFromLayoutSettings } from "./project-file";

type Quotation = { layout_settings?: unknown; status?: unknown };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function isQuotationLocked(quotation: Quotation) {
  return Boolean(projectFileFromLayoutSettings(quotation.layout_settings));
}

export function quotationLockReason(quotation: Quotation): string | null {
  const project = projectFileFromLayoutSettings(quotation.layout_settings);
  return project ? `Locked: Project ${project.orderNo} was created from this quotation. Create a revision or a variation to change it.` : null;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = record(left), b = record(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => sameValue(a[key], b[key]));
}

// Statuses a locked quotation may still move to. Anything that would make it editable again (draft, review, revision, ready, sent) is refused.
export const lockedQuotationStatuses = new Set(["client_confirmed", "on_hold", "cancelled", "archived", "completed"]);
const operationalFields = new Set(["status", "status_note", "status_updated_at", "status_updated_by", "salesperson_id", "approved_salesperson_id"]);
const operationalLayoutKeys = new Set(["projectCompletedAt", "projectCancelledAt", "folderArchivedAt"]);
const approvalLifecycleKeys = new Set(["approvalStatus", "quotationStatus", "decidedAt", "decidedBy", "decisionNote", "previousApprovalStatus", "cancelledAt", "cancelledReason"]);

/** Full layout replacements must preserve every key except the explicitly permitted execution metadata. */
export function isLockedQuotationUpdateAllowed(quotation: Quotation, patch: Record<string, unknown>) {
  if (!isQuotationLocked(quotation)) return true;
  return Object.entries(patch).every(([key, value]) => {
    if (key === "status") return typeof value === "string" && lockedQuotationStatuses.has(value);
    if (operationalFields.has(key)) return true;
    if (key !== "layout_settings") return false;
    const before = record(quotation.layout_settings), after = record(value);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].every((layoutKey) => {
      if (operationalLayoutKeys.has(layoutKey)) return true;
      if (layoutKey !== "clientApprovalDraft") return sameValue(before[layoutKey], after[layoutKey]);
      const oldDraft = record(before[layoutKey]), newDraft = record(after[layoutKey]);
      return [...new Set([...Object.keys(oldDraft), ...Object.keys(newDraft)])].every((draftKey) => {
        if (draftKey === "quotationStatus") return sameValue(oldDraft[draftKey], newDraft[draftKey]) || lockedQuotationStatuses.has(String(newDraft[draftKey]));
        return approvalLifecycleKeys.has(draftKey) || sameValue(oldDraft[draftKey], newDraft[draftKey]);
      });
    });
  });
}

/** Only the new row loses execution metadata; the source quotation and its pricing rule are preserved. */
export function unlockedQuotationCopyLayoutSettings(layoutSettings: unknown) {
  const copy = { ...record(layoutSettings) };
  for (const key of ["projectFile", "clientApprovalDraft", "projectCompletedAt", "projectCancelledAt", "folderArchivedAt"]) delete copy[key];
  return copy;
}

/** Settings for a copy, revision or option: a locked source loses its Project metadata on the new row; an unlocked source is copied as before. */
export function lockedSourceCopySettings(source: Quotation, copySettings: unknown) {
  return isQuotationLocked(source) ? unlockedQuotationCopyLayoutSettings(copySettings) : copySettings;
}
