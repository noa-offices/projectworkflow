import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import type {
  ProductTemplateDraft,
  ProductTemplateDraftMatrixColumn,
  ProductTemplateDraftMatrixRow,
  ProductTemplateDraftPricedRow,
  ProductTemplateDraftPrice,
  ProductTemplateDraftWorkstationRow,
} from "./product-template-draft";
import { createSmartSetupReviewRouting, type SmartReviewRoute, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";
import type { SmartReviewedPricingSubgroups } from "./smart-product-row-images";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups";

export type ManufacturerPricingType = "base_model" | "workstation" | "category_matrix" | "modular" | "accessory";
export type ManufacturerMatchEvidence = "stable_id" | "supplier_code" | "reference_code";
export type ManufacturerPriceField = "price" | "default_price" | "additional_price";

export type ManufacturerUpdateWorkspace = {
  draft: ProductTemplateDraft;
  plan: SmartSetupReviewRoutingPlan;
  subgroups?: SmartReviewedPricingSubgroups;
};

export type ManufacturerExistingIdentity = {
  pricingType: ManufacturerPricingType;
  groupId: string;
  groupName: string;
  rowId: string;
  subgroupId: string | null;
  subgroupName: string | null;
  displayName: string | null;
  supplierCode: string | null;
};

export type ManufacturerIncomingIdentity = {
  routeKey: string;
  groupId: string;
  rowId: string;
  displayName: string | null;
  supplierCode: string | null;
  referenceCode: string | null;
};

export type ManufacturerPriceDifference = ManufacturerExistingIdentity & {
  columnId?: string;
  columnLabel?: string | null;
  field: ManufacturerPriceField;
  currentValue: ProductTemplateDraftPrice;
  incomingValue: ProductTemplateDraftPrice;
  currentCurrency: string | null;
  incomingCurrency: string | null;
  priceChanged: boolean;
  currencyChanged: boolean;
};

export type ManufacturerNonPriceDifference = ManufacturerExistingIdentity & {
  field: "label" | "displayName" | "specification" | "dimensions" | "currency" | "supplierCodes" | "referenceCodes" | "layoutType";
  currentValue: unknown;
  incomingValue: unknown;
};

export type ManufacturerMatchedItem = {
  status: "MATCHED";
  evidence: ManufacturerMatchEvidence;
  existing: ManufacturerExistingIdentity;
  incoming: ManufacturerIncomingIdentity;
  priceFields: ManufacturerPriceDifference[];
  nonPriceDifferences: ManufacturerNonPriceDifference[];
  context: {
    accessoryRole: NonNullable<SmartReviewRoute["accessory"]>["role"] | null;
    applicabilityRuleCount: number;
  };
};

export type ManufacturerAmbiguousMatch = {
  status: "AMBIGUOUS_MATCH";
  pricingType: ManufacturerPricingType;
  evidence: ManufacturerMatchEvidence;
  matchingValue: string;
  incoming: ManufacturerIncomingIdentity;
  candidates: ManufacturerExistingIdentity[];
};

export type ManufacturerNewCandidate = {
  status: "NEW_CANDIDATE";
  pricingType: ManufacturerPricingType;
  incoming: ManufacturerIncomingIdentity;
  groupName: string;
  proposedDestination: SmartReviewRoute["recommendedDestination"];
  currency: string | null;
  price: ProductTemplateDraftPrice | Record<string, ProductTemplateDraftPrice>;
  row: ReviewRow;
  columns: ProductTemplateDraftMatrixColumn[];
};

export type ManufacturerNotFoundItem = {
  status: "NOT_FOUND_IN_IMPORTED_SOURCE";
  meaning: "not represented in this incoming JSON";
  existing: ManufacturerExistingIdentity;
  displayName: string | null;
  supplierCode: string | null;
};

export type ManufacturerStructuralDifference = {
  pricingType: ManufacturerPricingType;
  kind: "new_column" | "ambiguous_column" | "column_set_mismatch";
  currentGroupId: string | null;
  incomingGroupId: string;
  columnId?: string;
  columnLabel?: string | null;
  detail: string;
};

export type ManufacturerUpdateSection = {
  matchedItems: ManufacturerMatchedItem[];
  ambiguousMatches: ManufacturerAmbiguousMatch[];
  newCandidates: ManufacturerNewCandidate[];
  notFoundInImportedSource: ManufacturerNotFoundItem[];
  structuralDifferences: ManufacturerStructuralDifference[];
};

export type ManufacturerUpdateDiff = {
  sections: Record<ManufacturerPricingType, ManufacturerUpdateSection>;
  summary: {
    matchedItems: number;
    changedPriceFields: number;
    unchangedPriceFields: number;
    newCandidates: number;
    notFoundInImportedSource: number;
    ambiguousMatches: number;
    nonPriceDifferences: number;
    structuralDifferences: number;
  };
  deferredSections: Array<{ section: "materials"; count: number; reason: string }>;
};

type ReviewRow = ProductTemplateDraftPricedRow | ProductTemplateDraftMatrixRow | ProductTemplateDraftWorkstationRow;
type RouteGroup = {
  route: SmartReviewRoute;
  pricingType: ManufacturerPricingType;
  groupId: string;
  rows: ReviewRow[];
  columns: ProductTemplateDraftMatrixColumn[];
};
type RowLocation = { group: RouteGroup; row: ReviewRow; identity: ManufacturerExistingIdentity };

const pricingTypes: ManufacturerPricingType[] = ["base_model", "workstation", "category_matrix", "modular", "accessory"];
const emptySection = (): ManufacturerUpdateSection => ({ matchedItems: [], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] });
const primary = (values: string[]) => values.find((value) => value.trim())?.trim() ?? null;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const rowName = (row: ReviewRow) => row.displayName ?? row.label ?? row.id;
const rowKey = (groupId: string, rowId: string) => `${groupId}\u0000${rowId}`;
const normalizeColumnLabel = (value: string) => {
  const compact = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const category = compact.match(/^cat\s*([a-z0-9]+)$/i);
  return category ? `Cat ${category[1].toUpperCase()}` : compact.split(" ").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
};
const normalizedColumn = (column: ProductTemplateDraftMatrixColumn) => normalizeColumnLabel(column.label ?? column.id);

function pricingType(route: SmartReviewRoute): ManufacturerPricingType | null {
  return route.destination === "base_model" || route.destination === "workstation" || route.destination === "category_matrix" || route.destination === "modular" || route.destination === "accessory" ? route.destination : null;
}

function groupId(route: SmartReviewRoute) {
  if (route.key === "base_model:rows") return LEGACY_BASE_MODEL_GROUP_ID;
  if (route.key === "workstation:rows") return LEGACY_WORKSTATION_GROUP_ID;
  return route.sourceId;
}

function rowsAndColumns(draft: ProductTemplateDraft, route: SmartReviewRoute) {
  if (route.sourceKind === "workstation") return { rows: draft.pricing.workstationRows, columns: [] };
  if (route.sourceKind === "base_model") return { rows: draft.pricing.baseModelRows, columns: [] };
  if (route.sourceKind === "matrix") { const matrix = draft.pricing.priceMatrices.find((item) => item.id === route.sourceId); return { rows: matrix?.rows ?? [], columns: matrix?.columns ?? [] }; }
  if (route.sourceKind === "modular") { const matrix = draft.pricing.modularGroups.find((item) => item.id === route.sourceId)?.matrix; return { rows: matrix?.rows ?? [], columns: matrix?.columns ?? [] }; }
  return { rows: draft.optionGroups.find((item) => item.id === route.sourceId)?.items ?? [], columns: [] };
}

function routeGroups(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan): RouteGroup[] {
  return plan.routes.flatMap((route) => {
    const type = pricingType(route);
    if (!type) return [];
    const content = rowsAndColumns(draft, route);
    return [{ route, pricingType: type, groupId: groupId(route), ...content }];
  });
}

function primaryCodes(group: RouteGroup) {
  return new Set(group.rows.flatMap((row) => [primary(row.supplierCodes), primary(row.referenceCodes)]).filter((value): value is string => Boolean(value)));
}

function incomingComparisonGroups(currentGroups: RouteGroup[], incomingGroups: RouteGroup[]) {
  return incomingGroups.map((incomingGroup) => {
    const exact = currentGroups.filter((group) => group.groupId === incomingGroup.groupId);
    const incomingCodes = primaryCodes(incomingGroup);
    const overlapping = currentGroups.filter((group) => {
      const currentCodes = primaryCodes(group);
      return [...incomingCodes].some((code) => currentCodes.has(code));
    });
    const candidates = exact.length === 1 ? exact : overlapping.length === 1 ? overlapping : [];
    if (candidates.length !== 1) return incomingGroup;
    return { ...incomingGroup, pricingType: candidates[0].pricingType, groupId: candidates[0].groupId };
  });
}

function subgroup(subgroups: SmartReviewedPricingSubgroups | undefined, routeKey: string, rowId: string) {
  return subgroups?.[routeKey]?.find((item) => item.row_ids.includes(rowId)) ?? null;
}

function incomingIdentity(group: RouteGroup, row: ReviewRow): ManufacturerIncomingIdentity {
  return { routeKey: group.route.key, groupId: group.groupId, rowId: row.id, displayName: rowName(row), supplierCode: primary(row.supplierCodes), referenceCode: primary(row.referenceCodes) };
}

function existingIdentity(group: RouteGroup, row: ReviewRow, subgroups?: SmartReviewedPricingSubgroups): ManufacturerExistingIdentity {
  const currentSubgroup = subgroup(subgroups, group.route.key, row.id);
  return { pricingType: group.pricingType, groupId: group.groupId, groupName: group.route.groupName, rowId: row.id, subgroupId: currentSubgroup?.id ?? null, subgroupName: currentSubgroup?.subgroup_name?.trim() || null, displayName: rowName(row), supplierCode: primary(row.supplierCodes) };
}

function evidenceCandidates(locations: RowLocation[], incoming: ReviewRow): { evidence: ManufacturerMatchEvidence; value: string; candidates: RowLocation[] } | null {
  const evidence: Array<[ManufacturerMatchEvidence, string | null, (row: ReviewRow) => string | null]> = [
    ["stable_id", incoming.id || null, (row) => row.id || null],
    ["supplier_code", primary(incoming.supplierCodes), (row) => primary(row.supplierCodes)],
    ["reference_code", primary(incoming.referenceCodes), (row) => primary(row.referenceCodes)],
  ];
  for (const [kind, value, read] of evidence) {
    if (!value) continue;
    const candidates = locations.filter(({ row }) => read(row) === value);
    if (candidates.length) return { evidence: kind, value, candidates };
  }
  return null;
}

function nonPriceDifferences(existing: RowLocation, incoming: ReviewRow): ManufacturerNonPriceDifference[] {
  const fields: Array<[ManufacturerNonPriceDifference["field"], unknown, unknown]> = [
    ["label", existing.row.label, incoming.label], ["displayName", existing.row.displayName, incoming.displayName],
    ["specification", existing.row.specification, incoming.specification], ["dimensions", existing.row.dimensions, incoming.dimensions],
    ["currency", existing.row.currency, incoming.currency], ["supplierCodes", existing.row.supplierCodes, incoming.supplierCodes],
    ["referenceCodes", existing.row.referenceCodes, incoming.referenceCodes],
  ];
  if ("layoutType" in existing.row && "layoutType" in incoming) fields.push(["layoutType", existing.row.layoutType, incoming.layoutType]);
  return fields.flatMap(([field, currentValue, incomingValue]) => equal(currentValue, incomingValue) ? [] : [{ ...existing.identity, field, currentValue, incomingValue }]);
}

function priceDifference(existing: RowLocation, incoming: ReviewRow, field: ManufacturerPriceField, currentValue: ProductTemplateDraftPrice, incomingValue: ProductTemplateDraftPrice, column?: ProductTemplateDraftMatrixColumn): ManufacturerPriceDifference {
  return { ...existing.identity, field, ...(column ? { columnId: column.id, columnLabel: column.label } : {}), currentValue, incomingValue, currentCurrency: existing.row.currency, incomingCurrency: incoming.currency, priceChanged: currentValue !== incomingValue, currencyChanged: existing.row.currency !== incoming.currency };
}

function scalarPrice(row: ReviewRow, group: RouteGroup) {
  if ((group.route.sourceKind === "matrix" || group.route.sourceKind === "modular") && "prices" in row && group.columns.length === 1) return row.prices[group.columns[0].id] ?? null;
  if ("price" in row) return row.price;
  return null;
}

function compareMatrixPrices(existing: RowLocation, incomingGroup: RouteGroup, incoming: ReviewRow, structural: ManufacturerStructuralDifference[]) {
  if (!("prices" in existing.row) || !("prices" in incoming)) return [];
  const currentRow = existing.row;
  const incomingRow = incoming;
  const currentByLabel = new Map<string, ProductTemplateDraftMatrixColumn[]>();
  existing.group.columns.forEach((column) => { const label = normalizedColumn(column); currentByLabel.set(label, [...(currentByLabel.get(label) ?? []), column]); });
  const incomingLabels = incomingGroup.columns.map(normalizedColumn);
  if (!equal([...currentByLabel.keys()], incomingLabels)) structural.push({ pricingType: existing.group.pricingType, kind: "column_set_mismatch", currentGroupId: existing.group.groupId, incomingGroupId: incomingGroup.groupId, detail: "Existing and incoming normalized column sets or order differ." });
  return incomingGroup.columns.flatMap((incomingColumn) => {
    const candidates = currentByLabel.get(normalizedColumn(incomingColumn)) ?? [];
    if (candidates.length !== 1) {
      structural.push({ pricingType: existing.group.pricingType, kind: candidates.length ? "ambiguous_column" : "new_column", currentGroupId: existing.group.groupId, incomingGroupId: incomingGroup.groupId, columnId: incomingColumn.id, columnLabel: incomingColumn.label, detail: candidates.length ? "Incoming column label matches multiple existing columns." : "Incoming column is not present in the existing matrix." });
      return [];
    }
    const currentColumn = candidates[0];
    return [priceDifference(existing, incoming, "price", currentRow.prices[currentColumn.id] ?? null, incomingRow.prices[incomingColumn.id] ?? null, currentColumn)];
  });
}

function comparePrices(existing: RowLocation, incomingGroup: RouteGroup, incoming: ReviewRow, structural: ManufacturerStructuralDifference[]) {
  if (existing.group.pricingType === "workstation" && "additionalPrice" in existing.row && "additionalPrice" in incoming && "price" in existing.row && "price" in incoming) {
    return [priceDifference(existing, incoming, "default_price", existing.row.price, incoming.price), priceDifference(existing, incoming, "additional_price", existing.row.additionalPrice, incoming.additionalPrice)];
  }
  if ((existing.group.pricingType === "category_matrix" || existing.group.pricingType === "modular") && "prices" in existing.row && "prices" in incoming) return compareMatrixPrices(existing, incomingGroup, incoming, structural);
  return [priceDifference(existing, incoming, "price", scalarPrice(existing.row, existing.group), scalarPrice(incoming, incomingGroup))];
}

export function compareManufacturerUpdate(current: ManufacturerUpdateWorkspace, incomingDraft: ProductTemplateDraft, incomingPlan: SmartSetupReviewRoutingPlan = createSmartSetupReviewRouting(incomingDraft)): ManufacturerUpdateDiff {
  const sections = Object.fromEntries(pricingTypes.map((type) => [type, emptySection()])) as Record<ManufacturerPricingType, ManufacturerUpdateSection>;
  const currentGroups = routeGroups(current.draft, current.plan);
  const incomingGroups = incomingComparisonGroups(currentGroups, routeGroups(incomingDraft, incomingPlan));
  const matchedCurrent = new Set<string>();
  const scopedCurrentGroups = new Set<string>();

  incomingGroups.forEach((incomingGroup) => {
    const section = sections[incomingGroup.pricingType];
    const compatibleGroups = currentGroups.filter((group) => group.pricingType === incomingGroup.pricingType);
    const exactGroups = compatibleGroups.filter((group) => group.groupId === incomingGroup.groupId);
    const candidateGroups = exactGroups.length ? exactGroups : compatibleGroups;
    exactGroups.forEach((group) => scopedCurrentGroups.add(`${group.pricingType}\u0000${group.groupId}`));
    const locations = candidateGroups.flatMap((group) => group.rows.map((row) => ({ group, row, identity: existingIdentity(group, row, current.subgroups) })));

    incomingGroup.rows.forEach((incoming) => {
      const identity = incomingIdentity(incomingGroup, incoming);
      const evidence = evidenceCandidates(locations, incoming);
      if (!evidence) {
        section.newCandidates.push({ status: "NEW_CANDIDATE", pricingType: incomingGroup.pricingType, incoming: identity, groupName: incomingGroup.route.groupName, proposedDestination: incomingGroup.route.recommendedDestination, currency: incoming.currency, price: "prices" in incoming ? { ...incoming.prices } : incoming.price, row: structuredClone(incoming), columns: structuredClone(incomingGroup.columns) });
        return;
      }
      if (evidence.candidates.length !== 1) {
        evidence.candidates.forEach((candidate) => matchedCurrent.add(rowKey(candidate.group.groupId, candidate.row.id)));
        section.ambiguousMatches.push({ status: "AMBIGUOUS_MATCH", pricingType: incomingGroup.pricingType, evidence: evidence.evidence, matchingValue: evidence.value, incoming: identity, candidates: evidence.candidates.map((candidate) => candidate.identity) });
        return;
      }
      const existing = evidence.candidates[0];
      matchedCurrent.add(rowKey(existing.group.groupId, existing.row.id));
      scopedCurrentGroups.add(`${existing.group.pricingType}\u0000${existing.group.groupId}`);
      const differences = nonPriceDifferences(existing, incoming);
      section.matchedItems.push({ status: "MATCHED", evidence: evidence.evidence, existing: existing.identity, incoming: identity, priceFields: comparePrices(existing, incomingGroup, incoming, section.structuralDifferences), nonPriceDifferences: differences, context: { accessoryRole: existing.group.route.accessory?.role ?? null, applicabilityRuleCount: existing.group.route.accessory?.rules.length ?? 0 } });
    });
  });

  currentGroups.forEach((group) => {
    if (!scopedCurrentGroups.has(`${group.pricingType}\u0000${group.groupId}`)) return;
    group.rows.forEach((row) => {
      if (matchedCurrent.has(rowKey(group.groupId, row.id))) return;
      sections[group.pricingType].notFoundInImportedSource.push({ status: "NOT_FOUND_IN_IMPORTED_SOURCE", meaning: "not represented in this incoming JSON", existing: existingIdentity(group, row, current.subgroups), displayName: rowName(row), supplierCode: primary(row.supplierCodes) });
    });
  });

  const allSections = pricingTypes.map((type) => sections[type]);
  const matched = allSections.flatMap((section) => section.matchedItems);
  const priceFields = matched.flatMap((item) => item.priceFields);
  return {
    sections,
    summary: {
      matchedItems: matched.length,
      changedPriceFields: priceFields.filter((field) => field.priceChanged).length,
      unchangedPriceFields: priceFields.filter((field) => !field.priceChanged).length,
      newCandidates: allSections.reduce((count, section) => count + section.newCandidates.length, 0),
      notFoundInImportedSource: allSections.reduce((count, section) => count + section.notFoundInImportedSource.length, 0),
      ambiguousMatches: allSections.reduce((count, section) => count + section.ambiguousMatches.length, 0),
      nonPriceDifferences: matched.reduce((count, item) => count + item.nonPriceDifferences.length, 0),
      structuralDifferences: allSections.reduce((count, section) => count + section.structuralDifferences.length, 0),
    },
    deferredSections: incomingDraft.materialSuggestions.length ? [{ section: "materials", count: incomingDraft.materialSuggestions.length, reason: "Persisted Materials / Finishes are outside the U1 form-workspace comparison." }] : [],
  };
}
