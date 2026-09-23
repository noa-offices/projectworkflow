// Pure, dependency-free helpers shared by the Product Management bulk lifecycle UI
// (components/products/product-management-template-results.tsx,
// components/products/product-management-archive-results.tsx) and the bulk server actions
// (app/products/templates/actions.ts). Kept alias-free (no "@/..." imports) so it can be
// unit tested with the plain Node test runner used elsewhere in lib/.

export type ArchivedTemplateResult = {
  brandName: string | null;
  code: string | null;
  id: string;
  lifecycleStatus: "archived" | "discontinued";
  linked: boolean;
  name: string;
  usedInQuotations: boolean;
};

export type DeleteEligibilityPreview = {
  eligibleCount: number;
  historicalCount: number;
  linkedBlockedCount: number;
};

// Pure so it can be unit tested without mounting the component: keeps only ids that are still
// present in the currently visible (post local-search) result list, so a selection never keeps
// referencing a now-hidden/removed row.
export function pruneSelectionToVisibleIds(selectedIds: Set<string>, visibleIds: string[]): Set<string> {
  const visibleIdSet = new Set(visibleIds);
  const nextSelectedIds = new Set<string>();

  for (const id of selectedIds) {
    if (visibleIdSet.has(id)) {
      nextSelectedIds.add(id);
    }
  }

  return nextSelectedIds.size === selectedIds.size ? selectedIds : nextSelectedIds;
}

// Mirrors the same eligibility rule the server enforces (product_template_linked_families is the
// only hard delete blocker; historical quotation usage is informational only).
export function computeDeleteEligibilityPreview(
  selectedIds: Set<string>,
  templates: ArchivedTemplateResult[],
): DeleteEligibilityPreview {
  let eligibleCount = 0;
  let historicalCount = 0;
  let linkedBlockedCount = 0;

  for (const template of templates) {
    if (!selectedIds.has(template.id)) continue;

    if (template.linked) {
      linkedBlockedCount += 1;
      continue;
    }

    eligibleCount += 1;
    if (template.usedInQuotations) {
      historicalCount += 1;
    }
  }

  return { eligibleCount, historicalCount, linkedBlockedCount };
}

export function buildBulkDeleteConfirmationMessage({
  eligibleCount,
  historicalCount,
  linkedBlockedCount,
}: DeleteEligibilityPreview): string {
  const parts = [`Delete ${eligibleCount} selected template${eligibleCount === 1 ? "" : "s"} permanently?`];

  if (historicalCount > 0) {
    parts.push(
      `${historicalCount} ${historicalCount === 1 ? "is" : "are"} used in historical quotations. Saved quotation snapshots and history will remain, but live source repricing/navigation will no longer be available.`,
    );
  }

  if (linkedBlockedCount > 0) {
    parts.push(`${linkedBlockedCount} linked template${linkedBlockedCount === 1 ? "" : "s"} will be skipped.`);
  }

  return parts.join(" ");
}

export function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function bulkLifecycleResultMessage(successVerb: string, successCount: number, failedCount: number, failedVerb: string) {
  const parts = [`${successVerb} ${pluralize(successCount, "template")}.`];

  if (failedCount > 0) {
    parts.push(`${failedCount} could not be ${failedVerb}.`);
  }

  return parts.join(" ");
}

export function bulkDeleteResultMessage({
  blockedActiveCount,
  blockedLinkedCount,
  deletedCount,
  failedCount,
}: {
  blockedActiveCount: number;
  blockedLinkedCount: number;
  deletedCount: number;
  failedCount: number;
}) {
  const parts = [`Permanently deleted ${pluralize(deletedCount, "template")}.`];

  if (blockedLinkedCount > 0) {
    parts.push(`${pluralize(blockedLinkedCount, "linked template")} skipped.`);
  }

  if (blockedActiveCount > 0) {
    parts.push(`${pluralize(blockedActiveCount, "active template")} skipped.`);
  }

  if (failedCount > 0) {
    parts.push(`${pluralize(failedCount, "template")} failed.`);
  }

  return parts.join(" ");
}
