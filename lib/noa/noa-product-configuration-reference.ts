// GPC-3: a SEPARATE bounded reference for an in-progress Product Library guided configuration -
// deliberately NOT merged into NoaConversationReference (GPC-0's own recommendation: this state is
// structurally different - a template id plus a growing set of row/quantity selections - and
// forcing it into the flat, ≤5-entity conversationReference shape would either break that contract
// or silently truncate real selections). Pure, alias-free (only a type-only import from GPC-1's
// own pure engine, itself alias-free), mirroring noa-conversation-reference.ts's own convention so
// it stays unit-testable with the plain Node test runner.
//
// Every field here is a stable, human-invisible IDENTIFIER only - never a price, total, currency,
// specification, validity flag, or step label. Business facts are re-derived every turn by GPC-1
// from a freshly-reloaded (GPC-2) template; this reference exists only to let the user's PREVIOUS
// selections be re-supplied as engine input, never to be trusted as a business fact itself.
import type { ProductConfigurationSelections } from "../products/product-configuration-state";

// Conservative caps (PART 3) - never silently accept an unbounded map.
export const MAX_ID_LENGTH = 100;
export const MAX_TRIGGER_LENGTH = 1000;
export const MAX_QUANTITY_MAP_ENTRIES = 50;
export const MAX_QUANTITY_VALUE = 999;
export const MAX_SKIPPED_ACCESSORY_GROUP_IDS = 50;

export type NoaProductConfigurationSelections = ProductConfigurationSelections;

export type NoaProductConfigurationReference = {
  templateId: string;
  // Optional state marker (PART 1) - always "configuring" today; reserved for a future terminal
  // marker (e.g. a GPC-4 "completed" state) without needing a second reference shape.
  mode: "configuring";
  selections: NoaProductConfigurationSelections;
};

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function isBoundedQuantity(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= MAX_QUANTITY_VALUE;
}

function isBoundedQuantityMap(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_QUANTITY_MAP_ENTRIES) return false;
  // PART 3: quantities are "finite positive bounded integers" - a zero/negative entry is not a
  // valid stored selection (it simply shouldn't be present), so the whole map is rejected rather
  // than silently coerced.
  return entries.every(([key, entry]) => isBoundedId(key) && isBoundedQuantity(entry, 1));
}

function isBoundedRequiredOverridesMap(value: unknown): value is Record<string, { quantity: number; trigger: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_QUANTITY_MAP_ENTRIES) return false;
  return entries.every(([key, entry]) => {
    if (!isBoundedId(key)) return false;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).length !== 2) return false;
    // A required-companion override quantity may legitimately be 0 (the user unticked it) -
    // required-component-overrides.ts's own documented "untick to 0" semantics, unlike the
    // quantity maps above where a stored entry only ever exists when positive.
    return isBoundedQuantity(record.quantity, 0) && typeof record.trigger === "string" && record.trigger.length > 0 && record.trigger.length <= MAX_TRIGGER_LENGTH;
  });
}

function isBoundedAccessoryGroupIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_SKIPPED_ACCESSORY_GROUP_IDS
    && value.every(isBoundedId)
    && new Set(value).size === value.length;
}

// Exhaustive allow-list of GPC-1's own selection keys (PART 2) - reused verbatim, never a
// superset/subset invented here. Each entry is `[key, validator]`.
const SELECTION_FIELD_VALIDATORS: ReadonlyArray<readonly [keyof NoaProductConfigurationSelections, (value: unknown) => boolean]> = [
  ["variantGroupId", isBoundedId],
  ["subgroupId", isBoundedId],
  ["variantRowId", isBoundedId],
  ["systemRowId", isBoundedId],
  ["systemQuantity", (value) => isBoundedQuantity(value, 1)],
  ["categoryGroupId", isBoundedId],
  ["categoryRowId", isBoundedId],
  ["fabricCategory", isBoundedId],
  ["workstationGroupId", isBoundedId],
  ["deskingSizeId", isBoundedId],
  ["workstationVariantRowId", isBoundedId],
  ["modularQuantities", isBoundedQuantityMap],
  ["accessoryQuantities", isBoundedQuantityMap],
  ["skippedAccessoryGroupIds", isBoundedAccessoryGroupIds],
  ["requiredOverrides", isBoundedRequiredOverridesMap],
  ["quantity", (value) => isBoundedQuantity(value, 1)],
];
const KNOWN_SELECTION_KEYS = new Set(SELECTION_FIELD_VALIDATORS.map(([key]) => key as string));

function isValidSelections(value: unknown): value is NoaProductConfigurationSelections {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // Unknown fields rejected (PART 3) - never silently ignored/stripped.
  if (Object.keys(record).some((key) => !KNOWN_SELECTION_KEYS.has(key))) return false;
  return SELECTION_FIELD_VALIDATORS.every(([key, validate]) => record[key] === undefined || validate(record[key]));
}

// Strict, closed validation for an untrusted, client-round-tripped Product Configuration reference
// - malformed input is simply ignored by the caller (never trusted, never a source of
// authorization or business fact; see noa-orchestrator.ts). Mirrors isNoaConversationReference()'s
// own convention exactly.
export function isNoaProductConfigurationReference(value: unknown): value is NoaProductConfigurationReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["templateId", "mode", "selections"].includes(key))) return false;
  if (!isBoundedId(record.templateId)) return false;
  if (record.mode !== "configuring") return false;
  return isValidSelections(record.selections);
}
