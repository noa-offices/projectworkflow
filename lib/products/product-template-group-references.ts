import { baseModelPricingGroups } from "./base-model-pricing-groups";
import { workstationPricingGroups } from "./workstation-pricing-groups";

export const PRODUCT_TEMPLATE_GROUP_REFERENCE_TYPES = [
  "workstation",
  "base_model",
  "finish_category",
  "modular",
  "accessory",
] as const;

export type ProductTemplateGroupReferenceType =
  (typeof PRODUCT_TEMPLATE_GROUP_REFERENCE_TYPES)[number];

export type ProductTemplateGroupReferenceRow = {
  id: string;
  template_id: string;
  pricing_type: ProductTemplateGroupReferenceType;
  group_id: string;
  storage_path: string;
  display_order: number;
  caption: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductTemplateGroupReferencePreview = {
  id: string;
  pricingType: ProductTemplateGroupReferenceType;
  groupId: string;
  storagePath: string;
  previewUrl: string | null;
  caption: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

type PricingRecord = Record<string, unknown>;

export type ProductTemplateGroupReferencePricing = {
  categoryPricing: unknown;
  accessoryPricing: unknown;
  deskingSizePricing?: unknown;
  variantPricing?: unknown;
};

export type ProductTemplatePersistedPricing = {
  accessoryPricing: unknown;
  categoryPricing: unknown;
  deskingSizePricing: unknown;
  variantPricing: unknown;
};

export type CleanupResult<T> = {
  value: T;
  cleanupWarning: string | null;
};

const pricingTypeSet = new Set<string>(PRODUCT_TEMPLATE_GROUP_REFERENCE_TYPES);
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export const PRODUCT_TEMPLATE_GROUP_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is PricingRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredPricingRows(value: unknown): PricingRecord[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
    throw new Error("Product Template pricing data is invalid.");
  }

  if (!value.length) return [];
  return value as PricingRecord[];
}

function hasStoredId(row: PricingRecord, groupId: string) {
  return typeof row.id === "string" && row.id === groupId;
}

export function productTemplateGroupReferenceScopeKey(
  pricingType: ProductTemplateGroupReferenceType,
  groupId: string,
) {
  return `${pricingType}\u0000${groupId}`;
}

export function persistedProductTemplatePricingGroupScopeKeys({
  accessoryPricing,
  categoryPricing,
  deskingSizePricing,
  variantPricing,
}: ProductTemplatePersistedPricing) {
  const scopes = new Set<string>();
  const add = (pricingType: ProductTemplateGroupReferenceType, groups: PricingRecord[]) => {
    groups.forEach((group) => {
      if (typeof group.id === "string" && group.id.trim()) {
        scopes.add(productTemplateGroupReferenceScopeKey(pricingType, group.id));
      }
    });
  };

  add("workstation", workstationPricingGroups(deskingSizePricing ?? [])
    .filter((group) => !group.isSyntheticLegacyGroup));
  add("base_model", baseModelPricingGroups(variantPricing ?? [])
    .filter((group) => !group.isSyntheticLegacyGroup));

  const categories = requiredPricingRows(categoryPricing);
  add("finish_category", categories.filter((group) =>
    group.pricing_type !== "modular_group"
    && (Array.isArray(group.items) || Array.isArray(group.price_categories) || typeof group.group_name === "string"),
  ));
  add("modular", categories.filter((group) => group.pricing_type === "modular_group"));
  add("accessory", requiredPricingRows(accessoryPricing).filter((group) =>
    Array.isArray(group.items) || typeof group.group_name === "string",
  ));
  return scopes;
}

export function staleProductTemplateGroupReferences(
  references: ProductTemplateGroupReferenceRow[],
  persistedScopeKeys: ReadonlySet<string>,
) {
  return references.filter((reference) => !persistedScopeKeys.has(
    productTemplateGroupReferenceScopeKey(reference.pricing_type, reference.group_id),
  ));
}

export async function reconcileStaleProductTemplateGroupReferences({
  deleteReference,
  deleteStorageObject,
  onReferenceDeleteError,
  onStorageDeleteError,
  persistedScopeKeys,
  references,
}: {
  deleteReference: (reference: ProductTemplateGroupReferenceRow) => Promise<void>;
  deleteStorageObject: (reference: ProductTemplateGroupReferenceRow) => Promise<void>;
  onReferenceDeleteError: (reference: ProductTemplateGroupReferenceRow, error: unknown) => void;
  onStorageDeleteError: (reference: ProductTemplateGroupReferenceRow, error: unknown) => void;
  persistedScopeKeys: ReadonlySet<string>;
  references: ProductTemplateGroupReferenceRow[];
}) {
  let removedCount = 0;
  for (const reference of staleProductTemplateGroupReferences(references, persistedScopeKeys)) {
    try {
      await deleteReference(reference);
    } catch (error) {
      onReferenceDeleteError(reference, error);
      continue;
    }
    removedCount += 1;
    try {
      await deleteStorageObject(reference);
    } catch (error) {
      onStorageDeleteError(reference, error);
    }
  }
  return removedCount;
}

export function isProductTemplateGroupReferenceType(
  value: string,
): value is ProductTemplateGroupReferenceType {
  return pricingTypeSet.has(value);
}

export function requireProductTemplateGroupReferenceType(
  value: string,
): ProductTemplateGroupReferenceType {
  if (!isProductTemplateGroupReferenceType(value)) {
    throw new Error("Select a valid pricing type.");
  }
  return value;
}

export function assertProductTemplatePricingGroupExists({
  accessoryPricing,
  categoryPricing,
  deskingSizePricing,
  groupId,
  pricingType,
  variantPricing,
}: ProductTemplateGroupReferencePricing & {
  groupId: string;
  pricingType: ProductTemplateGroupReferenceType;
}) {
  if (!groupId.trim()) throw new Error("Pricing group id is required.");

  if (pricingType === "workstation") {
    const exists = workstationPricingGroups(deskingSizePricing ?? []).some((group) =>
      !group.isSyntheticLegacyGroup && hasStoredId(group, groupId),
    );
    if (!exists) throw new Error("Workstation pricing group no longer exists.");
    return;
  }
  if (pricingType === "base_model") {
    const exists = baseModelPricingGroups(variantPricing ?? []).some((group) =>
      !group.isSyntheticLegacyGroup && hasStoredId(group, groupId),
    );
    if (!exists) throw new Error("Base / Model pricing group no longer exists.");
    return;
  }

  if (pricingType === "accessory") {
    const groups = requiredPricingRows(accessoryPricing);
    const exists = groups.some((group) =>
      hasStoredId(group, groupId)
      && (Array.isArray(group.items) || typeof group.group_name === "string"),
    );
    if (!exists) throw new Error("Accessory pricing group no longer exists.");
    return;
  }

  const categoryRows = requiredPricingRows(categoryPricing);

  if (pricingType === "modular") {
    const exists = categoryRows.some((group) =>
      hasStoredId(group, groupId) && group.pricing_type === "modular_group",
    );
    if (!exists) throw new Error("Modular pricing group no longer exists.");
    return;
  }

  const exists = categoryRows.some((group) =>
    hasStoredId(group, groupId)
    && group.pricing_type !== "modular_group"
    && (Array.isArray(group.items)
      || Array.isArray(group.price_categories)
      || typeof group.group_name === "string"),
  );
  if (!exists) throw new Error("Finish / Category pricing group no longer exists.");
}

export function normalizeProductTemplateGroupReferenceCaption(value?: string | null) {
  const caption = value?.trim() ?? "";
  return caption || null;
}

export function safeProductTemplateGroupReferenceFilename(
  filename: string,
  mimeType: string,
) {
  const extension = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "image";
  const basename = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${basename || "image"}.${extension}`;
}

function assertSafePathSegment(value: string, label: string) {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

export function productTemplateGroupReferencePath({
  filename,
  groupId,
  mimeType,
  pricingType,
  referenceId,
  templateId,
}: {
  filename: string;
  groupId: string;
  mimeType: string;
  pricingType: ProductTemplateGroupReferenceType;
  referenceId: string;
  templateId: string;
}) {
  assertSafePathSegment(templateId, "Product Template id");
  assertSafePathSegment(groupId, "Pricing group id");
  assertSafePathSegment(referenceId, "Reference id");
  return `product-template-references/${templateId}/${pricingType}/${groupId}/${referenceId}-${safeProductTemplateGroupReferenceFilename(filename, mimeType)}`;
}

export function validateProductTemplateGroupReferenceFile(file: File) {
  if (!allowedImageTypes.has(file.type)) {
    throw new Error("Reference image must be PNG, JPEG, or WebP.");
  }
  if (file.size <= 0) throw new Error("Reference image is empty.");
  if (file.size > PRODUCT_TEMPLATE_GROUP_REFERENCE_MAX_BYTES) {
    throw new Error("Reference image must be 5MB or smaller.");
  }
}

export function nextProductTemplateGroupReferenceDisplayOrder(
  displayOrders: Array<number | null | undefined>,
) {
  const validOrders = displayOrders.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return validOrders.length ? Math.max(...validOrders) + 1 : 0;
}

export function compareProductTemplateGroupReferences(
  left: Pick<ProductTemplateGroupReferenceRow, "id" | "display_order" | "created_at">,
  right: Pick<ProductTemplateGroupReferenceRow, "id" | "display_order" | "created_at">,
) {
  return left.display_order - right.display_order
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
}

export function productTemplateGroupReferencePreview(
  row: ProductTemplateGroupReferenceRow,
  previewUrl: string | null,
): ProductTemplateGroupReferencePreview {
  return {
    id: row.id,
    pricingType: row.pricing_type,
    groupId: row.group_id,
    storagePath: row.storage_path,
    previewUrl,
    caption: row.caption,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function uploadReferenceWithCompensation<T>({
  cleanupUploadedObject,
  persistReference,
  uploadObject,
}: {
  cleanupUploadedObject: () => Promise<void>;
  persistReference: () => Promise<T>;
  uploadObject: () => Promise<void>;
}) {
  await uploadObject();
  try {
    return await persistReference();
  } catch (error) {
    let cleanupFailed = false;
    try {
      await cleanupUploadedObject();
    } catch {
      cleanupFailed = true;
    }
    throw new Error(
      cleanupFailed
        ? "Reference image could not be saved. Storage cleanup also failed."
        : "Reference image could not be saved.",
      { cause: error },
    );
  }
}

export async function replaceReferenceWithCompensation<T>({
  cleanupNewObject,
  deleteOldObject,
  updateReference,
  uploadNewObject,
}: {
  cleanupNewObject: () => Promise<void>;
  deleteOldObject: () => Promise<void>;
  updateReference: () => Promise<T>;
  uploadNewObject: () => Promise<void>;
}): Promise<CleanupResult<T>> {
  await uploadNewObject();

  let value: T;
  try {
    value = await updateReference();
  } catch (error) {
    let cleanupFailed = false;
    try {
      await cleanupNewObject();
    } catch {
      cleanupFailed = true;
    }
    throw new Error(
      cleanupFailed
        ? "Reference image could not be replaced. New-object cleanup also failed."
        : "Reference image could not be replaced.",
      { cause: error },
    );
  }

  try {
    await deleteOldObject();
    return { value, cleanupWarning: null };
  } catch {
    return {
      value,
      cleanupWarning: "Reference was replaced, but old Storage cleanup could not be completed.",
    };
  }
}

export async function removeReferenceWithCleanup<T>({
  deleteReference,
  deleteStorageObject,
}: {
  deleteReference: () => Promise<T>;
  deleteStorageObject: () => Promise<void>;
}): Promise<CleanupResult<T>> {
  const value = await deleteReference();
  try {
    await deleteStorageObject();
    return { value, cleanupWarning: null };
  } catch {
    return {
      value,
      cleanupWarning: "Reference was removed, but Storage cleanup could not be completed.",
    };
  }
}
