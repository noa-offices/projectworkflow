import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";
import { LEGACY_BASE_MODEL_GROUP_ID, baseModelPricingGroups } from "./base-model-pricing-groups";
import { LEGACY_WORKSTATION_GROUP_ID, workstationPricingGroups } from "./workstation-pricing-groups";

export type PricingGroupReferenceScope = {
  groupId: string;
  pricingType: ProductTemplateGroupReferenceType;
  templateId: string;
};

type PersistedFinishCategoryGroup = {
  group_name?: unknown;
  id?: unknown;
  items?: unknown;
  price_categories?: unknown;
  pricing_type?: unknown;
};

function isRecord(value: unknown): value is PersistedFinishCategoryGroup {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function persistedFinishCategoryGroupIds(rows?: unknown[] | null) {
  return persistedPricingGroupIds(rows, "finish_category");
}

export function persistedPricingGroupIds(
  rows: unknown[] | null | undefined,
  pricingType: "finish_category" | "modular" | "accessory",
) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .filter(isRecord)
      .filter((row) => {
        if (pricingType === "modular") return row.pricing_type === "modular_group";
        if (pricingType === "accessory") return Array.isArray(row.items) || typeof row.group_name === "string";
        return row.pricing_type !== "modular_group"
          && (Array.isArray(row.items)
            || Array.isArray(row.price_categories)
            || typeof row.group_name === "string");
      })
      .flatMap((row) => typeof row.id === "string" && row.id.trim() ? [row.id] : []),
  );
}

export function pricingGroupReferenceScope(
  templateId: string,
  pricingType: ProductTemplateGroupReferenceType,
  groupId: string,
): PricingGroupReferenceScope {
  return { templateId, pricingType, groupId };
}

export function pricingGroupReferenceAvailability({
  groupId,
  persistedGroupIds,
  templateIsPersisted,
}: {
  groupId: string;
  persistedGroupIds: ReadonlySet<string>;
  templateIsPersisted: boolean;
}) {
  if (!templateIsPersisted) {
    return {
      available: false,
      message: "Save the Product Template once before adding group reference images.",
    };
  }

  if (!persistedGroupIds.has(groupId)) {
    return {
      available: false,
      message: "Save the Product Template before adding reference images to this new group.",
    };
  }

  return { available: true, message: null };
}

export const finishCategoryReferenceScope = (templateId: string, groupId: string) =>
  pricingGroupReferenceScope(templateId, "finish_category", groupId);

export const finishCategoryReferenceAvailability = pricingGroupReferenceAvailability;

export function persistedWorkstationPricingGroupIds(rows: unknown) {
  return new Set(
    workstationPricingGroups(rows ?? [])
      .filter((group) => !group.isSyntheticLegacyGroup)
      .map((group) => group.id),
  );
}

export function persistedBaseModelPricingGroupIds(rows: unknown) {
  return new Set(
    baseModelPricingGroups(rows ?? [])
      .filter((group) => !group.isSyntheticLegacyGroup)
      .map((group) => group.id),
  );
}

export function baseModelPricingGroupReferenceAvailability({
  groupId,
  persistedGroupIds,
  templateIsPersisted,
}: {
  groupId: string;
  persistedGroupIds: ReadonlySet<string>;
  templateIsPersisted: boolean;
}) {
  if (!templateIsPersisted) {
    return {
      available: false,
      message: "Save the Product Template once before adding group reference images.",
    };
  }
  if (!persistedGroupIds.has(groupId)) {
    return {
      available: false,
      message: groupId === LEGACY_BASE_MODEL_GROUP_ID
        ? "Save the Product Template before adding reference images to this Base / Model group."
        : "Save the Product Template before adding reference images to this new group.",
    };
  }
  return { available: true, message: null };
}

export function workstationPricingGroupReferenceAvailability({
  groupId,
  persistedGroupIds,
  templateIsPersisted,
}: {
  groupId: string;
  persistedGroupIds: ReadonlySet<string>;
  templateIsPersisted: boolean;
}) {
  if (!templateIsPersisted) {
    return {
      available: false,
      message: "Save the Product Template once before adding group reference images.",
    };
  }
  if (!persistedGroupIds.has(groupId)) {
    return {
      available: false,
      message: groupId === LEGACY_WORKSTATION_GROUP_ID
        ? "Save the Product Template before adding reference images to this Workstation group."
        : "Save the Product Template before adding reference images to this new group.",
    };
  }
  return { available: true, message: null };
}
