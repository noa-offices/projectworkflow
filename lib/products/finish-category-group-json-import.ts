import type { ProductTemplateDraft } from "./product-template-draft";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter";

export type FinishCategoryGroupImportCandidate = {
  id: string;
  label: string;
  group: ReturnType<typeof mapDraftPriceMatricesToCategoryGroups>["groups"][number];
};

export function getFinishCategoryGroupImportCandidates(draft: ProductTemplateDraft) {
  const mapped = mapDraftPriceMatricesToCategoryGroups(draft);
  return {
    candidates: mapped.groups.map((group) => ({
      id: group.id,
      label: group.group_name,
      group,
    })),
    warnings: mapped.warnings,
  };
}

export function replaceFinishCategoryGroup<T extends { id?: string; is_active?: boolean; sort_order?: number }>(
  groups: T[],
  targetGroupId: string,
  importedGroup: T,
) {
  return groups.map((group) => group.id === targetGroupId
    ? { ...importedGroup, id: group.id, is_active: group.is_active, sort_order: group.sort_order }
    : group);
}
