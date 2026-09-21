import { draftModularColumns, draftModularRows, isDirectModularGroup, type ProductTemplateDraft, type ProductTemplateDraftBaseModelRow, type ProductTemplateDraftMatrixRow, type ProductTemplateDraftPricedRow } from "./product-template-draft";
import { baseModelGroupRouteKey, draftBaseModelGroupLabel, draftBaseModelGroupRows, draftUngroupedBaseModelRows, replaceDraftBaseModelScopeRows } from "./base-model-draft-groups";
import { fillNullPricedRowCurrenciesFromDefault } from "./smart-product-review";
import { createSmartSetupReviewRouting, type SmartReviewDestination, type SmartReviewRoute, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";

export type SmartAdditionalGroupAction = "add" | "merge" | "skip";
export type SmartAdditionalGroupClassification = "EXACT_DUPLICATE" | "LIKELY_EXISTING_GROUP" | "POSSIBLE_MATCH" | "NEW_GROUP";
export type SmartAdditionalGroupDecision = {
  action: SmartAdditionalGroupAction;
  destination: SmartReviewDestination;
  targetKey: string | null;
  duplicateChoices: Record<string, "existing" | "incoming">;
};
export type SmartAdditionalGroupEvidence = { matchingItems: number; incomingItems: number; newItems: number; differences: number; text: string };
export type SmartAdditionalGroupMatch = { classification: SmartAdditionalGroupClassification; recommendedAction: SmartAdditionalGroupAction; bestMatch: SmartReviewRoute | null; evidence: SmartAdditionalGroupEvidence };
export type SmartAdditionalGroup = { route: SmartReviewRoute; compatibleTargets: SmartReviewRoute[]; match: SmartAdditionalGroupMatch };

type ReviewRow = ProductTemplateDraftPricedRow | ProductTemplateDraftMatrixRow;

function duplicateRow<T extends ReviewRow>(existing: T[], incoming: T) {
  const evidence = new Set([incoming.id, incoming.supplierCodes.find(Boolean), incoming.referenceCodes.find(Boolean)].filter((value): value is string => Boolean(value)));
  return existing.find((row) => [row.id, row.supplierCodes.find(Boolean), row.referenceCodes.find(Boolean)].some((value) => value && evidence.has(value)));
}

function routeRows(draft: ProductTemplateDraft, route: SmartReviewRoute): ReviewRow[] {
  if (route.sourceKind === "workstation") return draft.pricing.workstationRows;
  if (route.sourceKind === "base_model") return draftUngroupedBaseModelRows(draft.pricing);
  if (route.sourceKind === "base_model_group") return draftBaseModelGroupRows(draft.pricing, route.sourceId);
  if (route.sourceKind === "matrix") return draft.pricing.priceMatrices.find((group) => group.id === route.sourceId)?.rows ?? [];
  if (route.sourceKind === "modular") return draft.pricing.modularGroups.filter((group) => group.id === route.sourceId).flatMap((group) => draftModularRows(group));
  return draft.optionGroups.find((group) => group.id === route.sourceId)?.items ?? [];
}

function normalizedText(value: string) { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizedCodes(row: ReviewRow) { return new Set([...row.supplierCodes, ...row.referenceCodes].map((code) => code.trim().toLocaleUpperCase()).filter(Boolean)); }
function hasIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>) { return [...left].some((value) => right.has(value)); }
function strongRowMatch(existing: ReviewRow, incoming: ReviewRow) {
  const existingCodes = normalizedCodes(existing); const incomingCodes = normalizedCodes(incoming);
  if (existingCodes.size && incomingCodes.size) return hasIntersection(existingCodes, incomingCodes);
  return Boolean(existing.id && incoming.id && existing.id === incoming.id);
}

function comparedDifferences(current: ReviewRow, incoming: ReviewRow) {
  return [
    ["price", "price" in current ? current.price : current.prices, "price" in incoming ? incoming.price : incoming.prices],
    ["specification", current.specification, incoming.specification], ["dimensions", current.dimensions, incoming.dimensions],
    ["supplier codes", current.supplierCodes, incoming.supplierCodes], ["reference codes", current.referenceCodes, incoming.referenceCodes],
    ["currency", current.currency, incoming.currency], ["display name", current.displayName, incoming.displayName],
  ].filter(([, existingValue, incomingValue]) => JSON.stringify(existingValue) !== JSON.stringify(incomingValue)).map(([field]) => field as string);
}

/** Deterministic wrong-target gate: same sourceKind, and for matrix/modular, identical category column shape. Exported for targeted (group-level) import UI to validate an incoming route against one explicitly selected target route. */
export function compatible(currentDraft: ProductTemplateDraft, incomingDraft: ProductTemplateDraft, current: SmartReviewRoute, incoming: SmartReviewRoute) {
  if (current.sourceKind !== incoming.sourceKind) return false;
  if (current.sourceKind !== "matrix" && current.sourceKind !== "modular") return true;
  const columns = (draft: ProductTemplateDraft, route: SmartReviewRoute) => route.sourceKind === "matrix"
    ? draft.pricing.priceMatrices.find((group) => group.id === route.sourceId)?.columns.map((column) => column.id) ?? []
    : draft.pricing.modularGroups.filter((group) => group.id === route.sourceId).flatMap((group) => draftModularColumns(group).map((column) => column.id));
  return JSON.stringify(columns(currentDraft, current)) === JSON.stringify(columns(incomingDraft, incoming));
}

export function smartAdditionalJsonGroups(currentDraft: ProductTemplateDraft, currentPlan: SmartSetupReviewRoutingPlan, incomingDraft: ProductTemplateDraft) {
  const incomingPlan = createSmartSetupReviewRouting(incomingDraft);
  return incomingPlan.routes.map((route): SmartAdditionalGroup => {
    const compatibleTargets = currentPlan.routes.filter((target) => compatible(currentDraft, incomingDraft, target, route));
    return { route, compatibleTargets, match: classifySmartAdditionalGroup(currentDraft, incomingDraft, route, compatibleTargets) };
  });
}

export function classifySmartAdditionalGroup(currentDraft: ProductTemplateDraft, incomingDraft: ProductTemplateDraft, incomingRoute: SmartReviewRoute, compatibleTargets: SmartReviewRoute[]): SmartAdditionalGroupMatch {
  const incomingRows = routeRows(incomingDraft, incomingRoute);
  const incomingName = normalizedText(incomingRoute.groupName);
  const candidates = compatibleTargets.map((target, index) => {
    const existingRows = routeRows(currentDraft, target);
    const matched = incomingRows.flatMap((incoming) => {
      const existing = existingRows.find((row) => strongRowMatch(row, incoming));
      return existing ? [{ existing, incoming, differences: comparedDifferences(existing, incoming) }] : [];
    });
    const matchingItems = matched.length; const differences = matched.reduce((count, item) => count + item.differences.length, 0);
    const exactName = incomingName.length > 0 && incomingName === normalizedText(target.groupName);
    const similarName = exactName || (incomingName.length > 2 && normalizedText(target.groupName).includes(incomingName)) || (normalizedText(target.groupName).length > 2 && incomingName.includes(normalizedText(target.groupName)));
    return { target, matchingItems, differences, exactName, similarName, index };
  }).sort((left, right) => right.matchingItems - left.matchingItems || Number(right.exactName) - Number(left.exactName) || Number(right.similarName) - Number(left.similarName) || Math.abs(incomingRows.length - routeRows(currentDraft, left.target).length) - Math.abs(incomingRows.length - routeRows(currentDraft, right.target).length) || left.index - right.index);
  // Native Base/Model groups match by exact group id, never by label alone.
  const sameGroupCandidate = incomingRoute.sourceKind === "base_model_group" ? candidates.find((candidate) => candidate.target.sourceId === incomingRoute.sourceId) : undefined;
  const best = sameGroupCandidate ?? candidates[0];
  if (!best) return { classification: "NEW_GROUP", recommendedAction: "add", bestMatch: null, evidence: { matchingItems: 0, incomingItems: incomingRows.length, newItems: incomingRows.length, differences: 0, text: "No strong existing-group match found." } };
  const newItems = incomingRows.length - best.matchingItems;
  const sufficientlyStrongExact = incomingRows.length > 0 && best.matchingItems === incomingRows.length && best.differences === 0 && (best.exactName || incomingRows.length > 1 || normalizedCodes(incomingRows[0]).size > 1);
  if (sufficientlyStrongExact) return { classification: "EXACT_DUPLICATE", recommendedAction: "skip", bestMatch: best.target, evidence: { matchingItems: best.matchingItems, incomingItems: incomingRows.length, newItems, differences: 0, text: `${best.matchingItems}/${incomingRows.length} incoming items already exist in '${best.target.groupName}'. No commercial differences detected.` } };
  const matrixWithNewRows = (incomingRoute.sourceKind === "matrix" || incomingRoute.sourceKind === "modular" || Boolean(sameGroupCandidate)) && incomingRows.length > 0 && newItems > 0;
  if (best.matchingItems > 0 || matrixWithNewRows) {
    const differenceText = best.differences ? `; ${best.differences} commercial difference${best.differences === 1 ? "" : "s"} detected` : "";
    const newText = newItems ? `${best.matchingItems} existing item${best.matchingItems === 1 ? "" : "s"} + ${newItems} new item${newItems === 1 ? "" : "s"} detected` : `${best.matchingItems}/${incomingRows.length} incoming items already exist`;
    return { classification: "LIKELY_EXISTING_GROUP", recommendedAction: "merge", bestMatch: best.target, evidence: { matchingItems: best.matchingItems, incomingItems: incomingRows.length, newItems, differences: best.differences, text: `${newText} in '${best.target.groupName}'${differenceText}.` } };
  }
  if (best.similarName) return { classification: "POSSIBLE_MATCH", recommendedAction: "add", bestMatch: best.target, evidence: { matchingItems: 0, incomingItems: incomingRows.length, newItems: incomingRows.length, differences: 0, text: `Possible name match with '${best.target.groupName}'; no strong supplier/reference-code overlap found.` } };
  return { classification: "NEW_GROUP", recommendedAction: "add", bestMatch: null, evidence: { matchingItems: 0, incomingItems: incomingRows.length, newItems: incomingRows.length, differences: 0, text: "No strong existing-group match found." } };
}

export function smartAdditionalDuplicateRows(currentDraft: ProductTemplateDraft, incomingDraft: ProductTemplateDraft, incomingRoute: SmartReviewRoute, targetRoute: SmartReviewRoute) {
  const existing = routeRows(currentDraft, targetRoute);
  return routeRows(incomingDraft, incomingRoute).flatMap((incoming) => {
    const current = duplicateRow(existing, incoming);
    const fields = current ? comparedDifferences(current, incoming) : [];
    return current ? [{ key: incoming.id, existing: current, incoming, fields }] : [];
  });
}

/**
 * Smart Setup applicability-review metadata (optionGroups[].items only) must
 * never be silently dropped by duplicate consolidation: if either side of a
 * kept-existing duplicate carries reviewStatus "needs_review", the merged row
 * keeps that status and the clearest non-empty reviewReason. Rows without
 * these fields (workstation/base-model/matrix/modular rows) are unaffected.
 */
function mergedAccessoryReviewMetadata<T extends ReviewRow>(existing: T, incoming: T): T {
  const existingReview = existing as unknown as { reviewStatus?: "confirmed" | "needs_review"; reviewReason?: string };
  const incomingReview = incoming as unknown as { reviewStatus?: "confirmed" | "needs_review"; reviewReason?: string };
  if (existingReview.reviewStatus !== "needs_review" && incomingReview.reviewStatus !== "needs_review") return existing;
  const reason = existingReview.reviewReason?.trim() || incomingReview.reviewReason?.trim() || undefined;
  return { ...existing, reviewStatus: "needs_review", ...(reason ? { reviewReason: reason } : {}) } as T;
}

/** Returns the merged rows plus the ids of rows that were genuinely new (not a duplicate of any existing row). */
function mergeRows<T extends ReviewRow>(existing: T[], incoming: T[], choices: Record<string, "existing" | "incoming">) {
  const result = [...existing];
  const addedIds: string[] = [];
  incoming.forEach((row) => {
    const current = duplicateRow(result, row);
    if (!current) { result.push(row); addedIds.push(row.id); }
    else if (choices[row.id] === "incoming") result[result.indexOf(current)] = mergedAccessoryReviewMetadata({ ...row, id: current.id } as T, current);
    else result[result.indexOf(current)] = mergedAccessoryReviewMetadata(current, row);
  });
  return { rows: result, addedIds };
}

/**
 * Merges incoming Base/Model rows into ONE target scope (a native group, or the ungrouped flat rows when
 * targetGroupId is null) and splices the result back, leaving every other group's rows untouched.
 * Incoming rows are always retagged to the target scope, so a duplicate can never silently move groups,
 * and rows whose id already exists in another scope are skipped (row ids are unique across baseModelRows).
 */
function mergeBaseModelScope(draft: ProductTemplateDraft, incomingRows: ProductTemplateDraftBaseModelRow[], targetGroupId: string | null, choices: Record<string, "existing" | "incoming">) {
  const inScope = (row: ProductTemplateDraftBaseModelRow) => targetGroupId ? row.groupId === targetGroupId : !row.groupId;
  const all = draft.pricing.baseModelRows;
  const existing = all.filter(inScope);
  const outsideIds = new Set(all.filter((row) => !inScope(row)).map((row) => row.id));
  const label = targetGroupId ? draftBaseModelGroupLabel(draft.pricing, targetGroupId) : undefined;
  const retagged = incomingRows.filter((row) => !outsideIds.has(row.id)).map((row) => {
    const next: ProductTemplateDraftBaseModelRow = { ...row };
    delete next.groupId;
    delete next.groupLabel;
    if (targetGroupId && label) { next.groupId = targetGroupId; next.groupLabel = label; }
    return next;
  });
  const skipped = incomingRows.length - retagged.length;
  if (skipped) draft.extractionWarnings = [...draft.extractionWarnings, `${skipped} incoming Base / Model row${skipped === 1 ? " was" : "s were"} skipped because the row id already exists in another Base / Model group.`];
  const merged = mergeRows(existing, retagged, choices);
  draft.pricing.baseModelRows = replaceDraftBaseModelScopeRows(all, targetGroupId, merged.rows);
  return merged;
}

function uniqueGroupId(base: string, existing: Set<string>) {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function mergeSupplemental<T extends { id: string; supplierCodes?: string[]; referenceCodes?: string[] }>(current: T[], incoming: T[]) {
  const keys = new Set(current.flatMap((item) => [item.id, item.supplierCodes?.[0], item.referenceCodes?.[0]].filter((value): value is string => Boolean(value))));
  const additions = incoming.filter((item) => {
    const itemKeys = [item.id, item.supplierCodes?.[0], item.referenceCodes?.[0]].filter((value): value is string => Boolean(value));
    if (itemKeys.some((key) => keys.has(key))) return false;
    itemKeys.forEach((key) => keys.add(key)); return true;
  });
  return [...current, ...additions];
}

export function applySmartAdditionalJson(currentDraft: ProductTemplateDraft, currentPlan: SmartSetupReviewRoutingPlan, incomingDraft: ProductTemplateDraft, decisions: Record<string, SmartAdditionalGroupDecision>) {
  const draft = structuredClone(currentDraft);
  const plan = structuredClone(currentPlan);
  const preparedIncomingDraft = fillNullPricedRowCurrenciesFromDefault(incomingDraft);
  const incomingPlan = createSmartSetupReviewRouting(preparedIncomingDraft);
  const groupIds = new Set(plan.routes.map((route) => route.sourceId));
  // Reports only genuinely new row ids (never duplicates/conflict-resolved existing rows), keyed
  // by the final destination route key, so callers (e.g. targeted Base/Model subgroup import) can
  // append exactly the newly inserted rows to review-only presentation metadata after a merge.
  const addedRowsByTarget: Record<string, string[]> = {};
  const recordAdded = (key: string, addedIds: string[]) => { if (addedIds.length) addedRowsByTarget[key] = [...(addedRowsByTarget[key] ?? []), ...addedIds]; };

  incomingPlan.routes.forEach((incomingRoute) => {
    const decision = decisions[incomingRoute.key];
    if (!decision || decision.action === "skip") return;
    if (decision.action === "merge" && decision.targetKey) {
      const target = plan.routes.find((route) => route.key === decision.targetKey);
      if (!target || !compatible(draft, preparedIncomingDraft, target, incomingRoute)) return;
      if (target.sourceKind === "workstation") { const merged = mergeRows(draft.pricing.workstationRows, preparedIncomingDraft.pricing.workstationRows, decision.duplicateChoices); draft.pricing.workstationRows = merged.rows; recordAdded(target.key, merged.addedIds); }
      else if (target.sourceKind === "base_model") { const merged = mergeBaseModelScope(draft, routeRows(preparedIncomingDraft, incomingRoute) as ProductTemplateDraftBaseModelRow[], null, decision.duplicateChoices); recordAdded(target.key, merged.addedIds); }
      else if (target.sourceKind === "base_model_group") { const merged = mergeBaseModelScope(draft, routeRows(preparedIncomingDraft, incomingRoute) as ProductTemplateDraftBaseModelRow[], target.sourceId, decision.duplicateChoices); recordAdded(target.key, merged.addedIds); }
      else if (target.sourceKind === "matrix") {
        const existing = draft.pricing.priceMatrices.find((group) => group.id === target.sourceId);
        const incoming = preparedIncomingDraft.pricing.priceMatrices.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming) { const merged = mergeRows(existing.rows, incoming.rows, decision.duplicateChoices); existing.rows = merged.rows; recordAdded(target.key, merged.addedIds); }
      } else if (target.sourceKind === "modular") {
        const existing = draft.pricing.modularGroups.find((group) => group.id === target.sourceId);
        const incoming = preparedIncomingDraft.pricing.modularGroups.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming && isDirectModularGroup(existing) && isDirectModularGroup(incoming)) {
          const merged = mergeRows(existing.directRows ?? [], incoming.directRows ?? [], decision.duplicateChoices); existing.directRows = merged.rows; recordAdded(target.key, merged.addedIds);
        } else if (existing?.matrix && incoming?.matrix) {
          const merged = mergeRows(existing.matrix.rows, incoming.matrix.rows, decision.duplicateChoices); existing.matrix.rows = merged.rows; recordAdded(target.key, merged.addedIds);
        }
      } else {
        const existing = draft.optionGroups.find((group) => group.id === target.sourceId);
        const incoming = preparedIncomingDraft.optionGroups.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming) { const merged = mergeRows(existing.items, incoming.items, decision.duplicateChoices); existing.items = merged.rows; recordAdded(target.key, merged.addedIds); }
      }
      target.rowCount = routeRows(draft, target).length;
      return;
    }

    if (incomingRoute.sourceKind === "workstation") { const merged = mergeRows(draft.pricing.workstationRows, preparedIncomingDraft.pricing.workstationRows, decision.duplicateChoices); draft.pricing.workstationRows = merged.rows; recordAdded(incomingRoute.key, merged.addedIds); }
    else if (incomingRoute.sourceKind === "base_model") { const merged = mergeBaseModelScope(draft, routeRows(preparedIncomingDraft, incomingRoute) as ProductTemplateDraftBaseModelRow[], null, decision.duplicateChoices); recordAdded(incomingRoute.key, merged.addedIds); }
    else if (incomingRoute.sourceKind === "base_model_group") {
      // New native group: append its rows under a unique group id, never touching other groups or flat rows.
      const sourceId = uniqueGroupId(incomingRoute.sourceId, groupIds); groupIds.add(sourceId);
      const existingRowIds = new Set(draft.pricing.baseModelRows.map((row) => row.id));
      const label = draftBaseModelGroupLabel(preparedIncomingDraft.pricing, incomingRoute.sourceId);
      const rows = routeRows(preparedIncomingDraft, incomingRoute).filter((row) => !existingRowIds.has(row.id)).map((row) => ({ ...row, groupId: sourceId, groupLabel: label }) as ProductTemplateDraftBaseModelRow);
      const skipped = incomingRoute.rowCount - rows.length;
      if (skipped > 0) draft.extractionWarnings = [...draft.extractionWarnings, `${skipped} incoming Base / Model row${skipped === 1 ? " was" : "s were"} skipped because the row id already exists in another Base / Model group.`];
      draft.pricing.baseModelRows = [...draft.pricing.baseModelRows, ...rows];
      const newRouteKey = baseModelGroupRouteKey(sourceId);
      recordAdded(newRouteKey, rows.map((row) => row.id));
      plan.routes.push({ ...structuredClone(incomingRoute), key: newRouteKey, sourceId, rowCount: rows.length, destination: decision.destination });
      return;
    }
    else {
      const sourceId = uniqueGroupId(incomingRoute.sourceId, groupIds); groupIds.add(sourceId);
      const newRouteKey = `${incomingRoute.sourceKind}:${sourceId}`;
      if (incomingRoute.sourceKind === "matrix") { const group = structuredClone(preparedIncomingDraft.pricing.priceMatrices.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.pricing.priceMatrices.push(group); recordAdded(newRouteKey, group.rows.map((row) => row.id)); }
      else if (incomingRoute.sourceKind === "modular") { const group = structuredClone(preparedIncomingDraft.pricing.modularGroups.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.pricing.modularGroups.push(group); recordAdded(newRouteKey, draftModularRows(group).map((row) => row.id)); }
      else { const group = structuredClone(preparedIncomingDraft.optionGroups.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.optionGroups.push(group); recordAdded(newRouteKey, group.items.map((item) => item.id)); }
      const route = { ...structuredClone(incomingRoute), key: newRouteKey, sourceId, destination: decision.destination };
      if (route.destination === "accessory" && !route.accessory) route.accessory = { role: "accessory", selection: "optional_multiple", rules: [] };
      plan.routes.push(route);
    }
    const flatRoute = plan.routes.find((route) => route.key === incomingRoute.key);
    if (flatRoute) flatRoute.rowCount = routeRows(draft, flatRoute).length;
    else if (incomingRoute.sourceKind === "workstation" || incomingRoute.sourceKind === "base_model") plan.routes.push({ ...structuredClone(incomingRoute), destination: decision.destination });
  });

  draft.materialSuggestions = mergeSupplemental(draft.materialSuggestions, preparedIncomingDraft.materialSuggestions);
  draft.linkedFamilySuggestions = mergeSupplemental(draft.linkedFamilySuggestions, preparedIncomingDraft.linkedFamilySuggestions);
  draft.extractionWarnings = [...new Set([...draft.extractionWarnings, ...preparedIncomingDraft.extractionWarnings])];
  draft.sources = mergeSupplemental(draft.sources, preparedIncomingDraft.sources);
  return { draft, plan, addedRowsByTarget };
}
