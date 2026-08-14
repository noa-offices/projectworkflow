import type { ProductTemplateDraft, ProductTemplateDraftMatrixRow, ProductTemplateDraftPricedRow } from "./product-template-draft";
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
  if (route.sourceKind === "base_model") return draft.pricing.baseModelRows;
  if (route.sourceKind === "matrix") return draft.pricing.priceMatrices.find((group) => group.id === route.sourceId)?.rows ?? [];
  if (route.sourceKind === "modular") return draft.pricing.modularGroups.find((group) => group.id === route.sourceId)?.matrix.rows ?? [];
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

function compatible(currentDraft: ProductTemplateDraft, incomingDraft: ProductTemplateDraft, current: SmartReviewRoute, incoming: SmartReviewRoute) {
  if (current.sourceKind !== incoming.sourceKind) return false;
  if (current.sourceKind !== "matrix" && current.sourceKind !== "modular") return true;
  const columns = (draft: ProductTemplateDraft, route: SmartReviewRoute) => route.sourceKind === "matrix"
    ? draft.pricing.priceMatrices.find((group) => group.id === route.sourceId)?.columns.map((column) => column.id) ?? []
    : draft.pricing.modularGroups.find((group) => group.id === route.sourceId)?.matrix.columns.map((column) => column.id) ?? [];
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
  const best = candidates[0];
  if (!best) return { classification: "NEW_GROUP", recommendedAction: "add", bestMatch: null, evidence: { matchingItems: 0, incomingItems: incomingRows.length, newItems: incomingRows.length, differences: 0, text: "No strong existing-group match found." } };
  const newItems = incomingRows.length - best.matchingItems;
  const sufficientlyStrongExact = incomingRows.length > 0 && best.matchingItems === incomingRows.length && best.differences === 0 && (best.exactName || incomingRows.length > 1 || normalizedCodes(incomingRows[0]).size > 1);
  if (sufficientlyStrongExact) return { classification: "EXACT_DUPLICATE", recommendedAction: "skip", bestMatch: best.target, evidence: { matchingItems: best.matchingItems, incomingItems: incomingRows.length, newItems, differences: 0, text: `${best.matchingItems}/${incomingRows.length} incoming items already exist in '${best.target.groupName}'. No commercial differences detected.` } };
  const matrixWithNewRows = (incomingRoute.sourceKind === "matrix" || incomingRoute.sourceKind === "modular") && incomingRows.length > 0 && newItems > 0;
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

function mergeRows<T extends ReviewRow>(existing: T[], incoming: T[], choices: Record<string, "existing" | "incoming">) {
  const result = [...existing];
  incoming.forEach((row) => {
    const current = duplicateRow(result, row);
    if (!current) result.push(row);
    else if (choices[row.id] === "incoming") result[result.indexOf(current)] = { ...row, id: current.id } as T;
  });
  return result;
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
  const incomingPlan = createSmartSetupReviewRouting(incomingDraft);
  const groupIds = new Set(plan.routes.map((route) => route.sourceId));

  incomingPlan.routes.forEach((incomingRoute) => {
    const decision = decisions[incomingRoute.key];
    if (!decision || decision.action === "skip") return;
    if (decision.action === "merge" && decision.targetKey) {
      const target = plan.routes.find((route) => route.key === decision.targetKey);
      if (!target || !compatible(draft, incomingDraft, target, incomingRoute)) return;
      if (target.sourceKind === "workstation") draft.pricing.workstationRows = mergeRows(draft.pricing.workstationRows, incomingDraft.pricing.workstationRows, decision.duplicateChoices);
      else if (target.sourceKind === "base_model") draft.pricing.baseModelRows = mergeRows(draft.pricing.baseModelRows, incomingDraft.pricing.baseModelRows, decision.duplicateChoices);
      else if (target.sourceKind === "matrix") {
        const existing = draft.pricing.priceMatrices.find((group) => group.id === target.sourceId);
        const incoming = incomingDraft.pricing.priceMatrices.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming) existing.rows = mergeRows(existing.rows, incoming.rows, decision.duplicateChoices);
      } else if (target.sourceKind === "modular") {
        const existing = draft.pricing.modularGroups.find((group) => group.id === target.sourceId);
        const incoming = incomingDraft.pricing.modularGroups.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming) existing.matrix.rows = mergeRows(existing.matrix.rows, incoming.matrix.rows, decision.duplicateChoices);
      } else {
        const existing = draft.optionGroups.find((group) => group.id === target.sourceId);
        const incoming = incomingDraft.optionGroups.find((group) => group.id === incomingRoute.sourceId);
        if (existing && incoming) existing.items = mergeRows(existing.items, incoming.items, decision.duplicateChoices);
      }
      target.rowCount = routeRows(draft, target).length;
      return;
    }

    if (incomingRoute.sourceKind === "workstation") draft.pricing.workstationRows = mergeRows(draft.pricing.workstationRows, incomingDraft.pricing.workstationRows, decision.duplicateChoices);
    else if (incomingRoute.sourceKind === "base_model") draft.pricing.baseModelRows = mergeRows(draft.pricing.baseModelRows, incomingDraft.pricing.baseModelRows, decision.duplicateChoices);
    else {
      const sourceId = uniqueGroupId(incomingRoute.sourceId, groupIds); groupIds.add(sourceId);
      if (incomingRoute.sourceKind === "matrix") { const group = structuredClone(incomingDraft.pricing.priceMatrices.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.pricing.priceMatrices.push(group); }
      else if (incomingRoute.sourceKind === "modular") { const group = structuredClone(incomingDraft.pricing.modularGroups.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.pricing.modularGroups.push(group); }
      else { const group = structuredClone(incomingDraft.optionGroups.find((item) => item.id === incomingRoute.sourceId)!); group.id = sourceId; draft.optionGroups.push(group); }
      const route = { ...structuredClone(incomingRoute), key: `${incomingRoute.sourceKind}:${sourceId}`, sourceId, destination: decision.destination };
      if (route.destination === "accessory" && !route.accessory) route.accessory = { role: "accessory", selection: "optional_multiple", rules: [] };
      plan.routes.push(route);
    }
    const flatRoute = plan.routes.find((route) => route.key === incomingRoute.key);
    if (flatRoute) flatRoute.rowCount = routeRows(draft, flatRoute).length;
    else if (incomingRoute.sourceKind === "workstation" || incomingRoute.sourceKind === "base_model") plan.routes.push({ ...structuredClone(incomingRoute), destination: decision.destination });
  });

  draft.materialSuggestions = mergeSupplemental(draft.materialSuggestions, incomingDraft.materialSuggestions);
  draft.linkedFamilySuggestions = mergeSupplemental(draft.linkedFamilySuggestions, incomingDraft.linkedFamilySuggestions);
  draft.extractionWarnings = [...new Set([...draft.extractionWarnings, ...incomingDraft.extractionWarnings])];
  draft.sources = mergeSupplemental(draft.sources, incomingDraft.sources);
  return { draft, plan };
}
