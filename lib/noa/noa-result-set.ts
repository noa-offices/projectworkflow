// Phase 1A: provider-neutral conversational scope, not cached business truth or authorization.
// Isolated from current routing. Future capabilities must re-authorize and re-fetch every item.
export const MAX_NOA_RESULT_SETS = 5;
export const MAX_NOA_RESULT_SET_ITEMS = 50;
export const MAX_NOA_STATE_JSON_LENGTH = 65536;
export const NOA_SESSION_IDLE_EXPIRY_MINUTES = 30;

export type NoaResultSetHandle = `rs_${string}`;
export type NoaResultEntityType = "quotation" | "project_file" | "client";
// These are semantic status keys, never SQL. Existing capability calls draft "Pending".
// A later authorized adapter owns mapping to persisted statuses; no adapter exists in 1A.
export const NOA_QUOTATION_SCOPE_STATUSES = ["draft", "sent_to_client", "client_confirmed"] as const;
export type NoaQuotationScopeStatus = typeof NOA_QUOTATION_SCOPE_STATUSES[number];
export type NoaQuotationQuerySpec = {
  capability: "quotation";
  operation: "status_summary" | "status_list";
  filters: { status?: NoaQuotationScopeStatus };
};
export type NoaProjectQuerySpec = {
  capability: "project";
  operation: "list";
  filters: { status?: "active" | "completed" | "cancelled" };
};
export type NoaQuerySpec = NoaQuotationQuerySpec | NoaProjectQuerySpec;

type NoaResultSetBase = { handle: NoaResultSetHandle; createdAt: string };
type NoaEntityItems = {
  client: { id: string };
  quotation: { id: string }; // authorized quotations.id UUID, never a title or client name
  project_file: { orderNo: string }; // existing CO-... identity, not projects.id or display reference
};
type NoaEntityOrListResultSet = {
  [T in NoaResultEntityType]: NoaResultSetBase & { entityType: T } & (
    | { kind: "entity"; count: 1; items: [NoaEntityItems[T]] }
    | {
      kind: "list";
      count: number; // total matching count; items may contain only the first 50 displayed entries
      // Array position IS display order. Never reorder on reload or treat unstored ordinals as known.
      items: NoaEntityItems[T][];
      querySpec?: T extends "quotation" ? NoaQuotationQuerySpec & { operation: "status_list" } : T extends "project_file" ? NoaProjectQuerySpec : never;
    }
  )
}[NoaResultEntityType];
export type NoaAggregateResultSet = NoaResultSetBase & {
  kind: "aggregate";
  entityType: "quotation";
  count: number;
  querySpec: NoaQuotationQuerySpec & { operation: "status_summary" };
  // Counts are conversational observations, not authoritative current business totals.
  // Closed group keys + querySpec permit later drill-down without storing business records.
  groups: Array<{ status: NoaQuotationScopeStatus; count: number }>;
};
export type NoaResultSet = NoaEntityOrListResultSet | NoaAggregateResultSet;

// Contract only: deliberately no registry implementation or generic graph traversal.
export type NoaResultRelation = { kind: "quotation_project_file"; from: "quotation"; to: "project_file" };

export function isNoaStateRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function hasNoaStateKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

export function isNoaStateTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isNoaStateCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isNoaResultSetHandle(value: unknown): value is NoaResultSetHandle {
  return typeof value === "string" && /^rs_[0-9a-f]{32}$/.test(value);
}

// 128 random bits, independent of every business/user/database identifier. No insecure fallback.
export function createNoaResultSetHandle(): NoaResultSetHandle {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `rs_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isNoaQuerySpec(value: unknown): value is NoaQuerySpec {
  if (!isNoaStateRecord(value) || !hasNoaStateKeys(value, ["capability", "operation", "filters"])) return false;
  if (!isNoaStateRecord(value.filters) || !hasNoaStateKeys(value.filters, [], ["status"])) return false;
  const filters = value.filters;
  if (value.capability === "quotation" && (value.operation === "status_summary" || value.operation === "status_list")) {
    return !Object.hasOwn(filters, "status") || NOA_QUOTATION_SCOPE_STATUSES.some((status) => status === filters.status);
  }
  return value.capability === "project" && value.operation === "list"
    && (!Object.hasOwn(filters, "status") || ["active", "completed", "cancelled"].includes(filters.status as string));
}

function itemKey(value: unknown, entityType: NoaResultEntityType): string | null {
  if (!isNoaStateRecord(value)) return null;
  if (entityType === "quotation" || entityType === "client") {
    return hasNoaStateKeys(value, ["id"]) && typeof value.id === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) ? value.id.toLowerCase() : null;
  }
  return hasNoaStateKeys(value, ["orderNo"]) && typeof value.orderNo === "string" && value.orderNo.length <= 64
    && /^CO-\d{3,}(?:-\d+)*$/.test(value.orderNo) ? value.orderNo : null;
}

export function isNoaResultSet(value: unknown): value is NoaResultSet {
  if (!isNoaStateRecord(value) || !isNoaResultSetHandle(value.handle) || !isNoaStateTimestamp(value.createdAt)
    || !isNoaStateCount(value.count)) return false;
  const baseKeys = ["handle", "createdAt", "kind", "entityType", "count"];
  if (value.kind === "aggregate") {
    if (!hasNoaStateKeys(value, [...baseKeys, "querySpec", "groups"]) || value.entityType !== "quotation"
      || !isNoaQuerySpec(value.querySpec) || value.querySpec.capability !== "quotation" || value.querySpec.operation !== "status_summary"
      || !Array.isArray(value.groups) || value.groups.length > NOA_QUOTATION_SCOPE_STATUSES.length) return false;
    const statuses = new Set<string>();
    let count = 0;
    for (const group of value.groups) {
      if (!isNoaStateRecord(group) || !hasNoaStateKeys(group, ["status", "count"]) || !isNoaStateCount(group.count)
        || !NOA_QUOTATION_SCOPE_STATUSES.some((status) => status === group.status) || statuses.has(group.status as string)
        || (value.querySpec.filters.status !== undefined && group.status !== value.querySpec.filters.status)) return false;
      statuses.add(group.status as string);
      count += group.count;
    }
    return Number.isSafeInteger(count) && count === value.count;
  }
  if ((value.kind !== "entity" && value.kind !== "list") || (value.entityType !== "quotation" && value.entityType !== "project_file" && value.entityType !== "client")
    || !hasNoaStateKeys(value, [...baseKeys, "items"], value.kind === "list" ? ["querySpec"] : [])
    || !Array.isArray(value.items) || value.items.length > MAX_NOA_RESULT_SET_ITEMS || value.count < value.items.length) return false;
  if (value.kind === "entity" && (value.count !== 1 || value.items.length !== 1)) return false;
  if (value.kind === "list" && value.count > 0 && value.items.length === 0) return false;
  const keys = Array.from(value.items, (item) => itemKey(item, value.entityType as NoaResultEntityType));
  if (keys.includes(null) || new Set(keys).size !== keys.length) return false;
  if (Object.hasOwn(value, "querySpec")) {
    if (value.entityType === "client") return false;
    if (!isNoaQuerySpec(value.querySpec)) return false;
    if (value.entityType === "quotation") return value.querySpec.capability === "quotation" && value.querySpec.operation === "status_list";
    return value.querySpec.capability === "project";
  }
  return true;
}
