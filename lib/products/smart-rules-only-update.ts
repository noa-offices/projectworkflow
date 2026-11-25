// "Update Rules from JSON": takes only the accessory group rules from a ProductTemplateDraft into the review workspace.
// The rules themselves are applied and validated by the Add More JSON code; this file picks the groups, shows what
// differs, and copies back nothing but the rule fields (and any new items the rules need). Saves nothing.
import { resolveAccessoryApplicabilityTarget, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import { draftBaseModelGroupLabel, draftBaseModelGroupRows, draftUngroupedBaseModelRows } from "./base-model-draft-groups";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import { applySmartGroupRulesUpdate } from "./smart-additional-rules-update";
import { applySmartAdditionalJson, smartAdditionalDuplicateRows, smartAdditionalRulesReport, type SmartAdditionalGroupDecision } from "./smart-product-additional-json";
import { draftModularRows, type ProductTemplateDraft, type ProductTemplateDraftOptionGroup, type ProductTemplateDraftPricedRow } from "./product-template-draft";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter";
import { createSmartSetupReviewRouting, type SmartReviewRoute, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";

export type SmartRulesOnlyChange = {
  key: string;
  targetKey: string;
  name: string;
  targetsBefore: number;
  targetsAfter: number;
  settingChanges: string[];
  addedTargets: string[];
  removedTargets: string[];
  itemListChanges: number;
  ruleSettingChanges: number;
  neededItems: Array<{ id: string; name: string }>;
};
export type SmartRulesOnlyIgnored = {
  id: string;
  name: string;
  /** A hint only, from shared item codes. Nothing is matched until the user picks it. */
  suggestion: { groupId: string; name: string; sharedItems: number } | null;
};
export type SmartRulesOnlyPlan = { changes: SmartRulesOnlyChange[]; unchangedCount: number; ignored: SmartRulesOnlyIgnored[]; availableGroups: Array<{ groupId: string; name: string }> };
/** incoming group id -> existing group id, chosen by the user for a group that matched neither by id nor by name. */
export type SmartRulesOnlyManualMatches = Readonly<Record<string, string>>;
export type SmartRulesOnlyChoice = { apply: boolean; addItems: boolean };

type Workspace = { draft: ProductTemplateDraft; plan: SmartSetupReviewRoutingPlan };

const normalizedName = (value: string) => value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rowName = (row: ProductTemplateDraftPricedRow | { id: string; displayName: string | null; label: string | null; supplierCodes: string[] }) => {
  const name = row.displayName ?? row.label ?? row.id;
  const code = row.supplierCodes[0];
  return code && !name.includes(code) ? `${name} (${code})` : name;
};

type Match = { incoming: ProductTemplateDraftOptionGroup; incomingRoute: SmartReviewRoute; group: ProductTemplateDraftOptionGroup; route: SmartReviewRoute; itemIds: Record<string, string>; neededIds: Set<string> };

/** By id first, then by exact normalised name; after those, only what the user picked. */
function matchGroups(current: Workspace, incoming: ProductTemplateDraft, manual: SmartRulesOnlyManualMatches) {
  const incomingRoutes = createSmartSetupReviewRouting(incoming).routes.filter((route) => route.sourceKind === "option");
  const existing = current.plan.routes.flatMap((route) => {
    const group = route.sourceKind === "option" && route.destination === "accessory" ? current.draft.optionGroups.find((item) => item.id === route.sourceId) : undefined;
    return group ? [{ group, route }] : [];
  });
  const claimed = new Set<string>();
  const found = new Map<string, (typeof existing)[number]>();
  const claim = (incomingId: string, candidates: typeof existing) => {
    if (candidates.length !== 1 || claimed.has(candidates[0]!.group.id)) return;
    claimed.add(candidates[0]!.group.id);
    found.set(incomingId, candidates[0]!);
  };
  incoming.optionGroups.forEach((item) => claim(item.id, existing.filter((entry) => entry.group.id === item.id)));
  incoming.optionGroups.filter((item) => !found.has(item.id)).forEach((item) => {
    const name = normalizedName(item.label ?? "");
    if (name) claim(item.id, existing.filter((entry) => !claimed.has(entry.group.id) && normalizedName(entry.route.groupName) === name));
  });

  const automatic = new Set(claimed);
  const manualCandidates = existing.filter((entry) => !automatic.has(entry.group.id));
  const unmatched = incoming.optionGroups.filter((item) => !found.has(item.id));
  unmatched.forEach((item) => claim(item.id, manualCandidates.filter((entry) => entry.group.id === manual[item.id])));

  const availableGroups = manualCandidates.map((entry) => ({ groupId: entry.group.id, name: entry.route.groupName }));
  // Listed even after the user picked a group, so the choice stays visible and can be undone.
  const notFound = unmatched.map((item): SmartRulesOnlyIgnored => {
    const incomingRoute = incomingRoutes.find((route) => route.sourceId === item.id);
    const scored = incomingRoute ? manualCandidates.map((entry) => ({ groupId: entry.group.id, name: entry.route.groupName, sharedItems: smartAdditionalDuplicateRows(current.draft, incoming, incomingRoute, entry.route).length })).filter((entry) => entry.sharedItems > 0).sort((a, b) => b.sharedItems - a.sharedItems) : [];
    return { id: item.id, name: item.label ?? item.id, suggestion: scored[0] && scored[0].sharedItems !== scored[1]?.sharedItems ? scored[0] : null };
  });
  const paired = incoming.optionGroups.flatMap((item) => {
    const target = found.get(item.id);
    const incomingRoute = incomingRoutes.find((route) => route.sourceId === item.id);
    if (!target || !incomingRoute) return [];
    // The same item matching Add More JSON uses (id, supplier code, reference code).
    const itemIds = Object.fromEntries(smartAdditionalDuplicateRows(current.draft, incoming, incomingRoute, target.route).map((entry) => [entry.key, entry.existing.id]));
    return [{ incoming: item, incomingRoute, ...target, itemIds }];
  });

  const matches: Match[] = paired.map((match) => {
    const referenced = new Set<string>([...match.incoming.selection.defaultItemIds, ...(match.incoming.conditionalConfiguration?.applicability ?? []).flatMap((rule) => rule.allowed_item_ids ?? [])]);
    paired.forEach((other) => other.incoming.conditionalConfiguration?.applicability.forEach((rule) => {
      if (rule.target?.kind === "option_item" && rule.target.group_id === match.incoming.id) referenced.add(rule.target.row_id);
    }));
    return { ...match, neededIds: new Set(match.incoming.items.filter((item) => referenced.has(item.id) && !match.itemIds[item.id]).map((item) => item.id)) };
  });
  return { matches, ignored: notFound, availableGroups };
}

/**
 * The incoming JSON reduced to the matched groups, each with only its already-saved items and the new items the rules
 * need. A rule pointing at another matched group's item follows that group to its saved ids.
 */
function rulesOnlyIncoming(incoming: ProductTemplateDraft, matches: Match[]): ProductTemplateDraft {
  return {
    ...incoming,
    optionGroups: matches.map((match) => ({
      ...match.incoming,
      items: match.incoming.items.filter((item) => match.itemIds[item.id] || match.neededIds.has(item.id)),
      ...(match.incoming.conditionalConfiguration ? { conditionalConfiguration: { ...match.incoming.conditionalConfiguration, applicability: match.incoming.conditionalConfiguration.applicability.map((rule) => {
        const other = rule.target?.kind === "option_item" ? matches.find((candidate) => candidate !== match && candidate.incoming.id === rule.target!.group_id) : undefined;
        return other ? { ...rule, target: { kind: "option_item" as const, group_id: other.group.id, row_id: other.itemIds[rule.target!.row_id] ?? rule.target!.row_id } } : rule;
      }) } } : {}),
    })),
  };
}

/** A group exactly as Save Changes would write it, reduced to its rule fields. */
function savedRules(draft: ProductTemplateDraft, group: ProductTemplateDraftOptionGroup, route: SmartReviewRoute) {
  const saved = mapDraftOptionGroupsToAccessories({ ...draft, optionGroups: [group] }, { routes: [route] }).groups.find((item) => item.id === group.id);
  const configuration = saved?.conditional_configuration;
  const targets = new Map((configuration?.applicability ?? []).flatMap((rule) => {
    const target = resolveAccessoryApplicabilityTarget(rule);
    return target ? [[`${target.kind}\u0000${target.group_id}\u0000${target.row_id}`, {
      target,
      items: JSON.stringify(rule.allowed_item_ids ? [...rule.allowed_item_ids].sort() : null),
      settings: JSON.stringify([rule.required, rule.visible !== false, rule.fixed_quantity ?? null, rule.scale_with_target_quantity === true]),
    }] as const] : [];
  }));
  return { name: saved?.group_name ?? route.groupName, required: saved?.group_is_required === true, defaults: [...(saved?.default_item_ids ?? [])].sort(), role: configuration?.role ?? "accessory", selection: configuration?.selection ?? "unrestricted", targets };
}

function targetName(draft: ProductTemplateDraft, target: AccessoryApplicabilityTarget): string | null {
  const named = (groupName: string, rows: ReadonlyArray<Parameters<typeof rowName>[0]>) => {
    const row = rows.find((item) => item.id === target.row_id);
    return row ? `${groupName}: ${rowName(row)}` : null;
  };
  if (target.kind === "base_model") {
    if (target.group_id === LEGACY_BASE_MODEL_GROUP_ID) return named("Base / Model", draftUngroupedBaseModelRows(draft.pricing));
    const rows = draftBaseModelGroupRows(draft.pricing, target.group_id);
    if (rows.length) return named(draftBaseModelGroupLabel(draft.pricing, target.group_id), rows);
  }
  if (target.kind === "base_model" || target.kind === "price_matrix") {
    const matrix = draft.pricing.priceMatrices.find((item) => item.id === target.group_id);
    return matrix ? named(matrix.label ?? matrix.id, matrix.rows) : null;
  }
  if (target.kind === "modular") {
    const group = draft.pricing.modularGroups.find((item) => item.id === target.group_id);
    return group ? named(group.label ?? group.id, draftModularRows(group)) : null;
  }
  if (target.kind === "workstation") return named("Workstation", draft.pricing.workstationRows);
  const group = draft.optionGroups.find((item) => item.id === target.group_id);
  return group ? named(group.label ?? group.id, group.items) : null;
}

const words = (value: string) => value.replaceAll("_", " ");
const yesNo = (value: boolean) => value ? "yes" : "no";

function describeChange(current: Workspace, match: Match, trimmed: ProductTemplateDraftOptionGroup): SmartRulesOnlyChange | null {
  const before = savedRules(current.draft, match.group, match.route);
  const group = structuredClone(match.group);
  const route = structuredClone(match.route);
  const added = trimmed.items.filter((item) => match.neededIds.has(item.id));
  group.items.push(...structuredClone(added));
  const itemIds = Object.fromEntries(trimmed.items.map((item) => [item.id, match.itemIds[item.id] ?? item.id]));
  // Two items matching one is reported when applying; the preview still has to show the difference.
  const unique = Object.fromEntries(Object.entries(itemIds).filter(([, id], index, all) => all.findIndex((entry) => entry[1] === id) === index));
  const update = applySmartGroupRulesUpdate({ group, route, incoming: trimmed, incomingRoute: match.incomingRoute, finalIds: unique });

  const base = { key: match.incomingRoute.key, targetKey: match.route.key, name: match.route.groupName, neededItems: added.map((item) => ({ id: item.id, name: rowName(item) })), targetsBefore: before.targets.size };
  if (update.errors.length) {
    // No rules in the JSON: only a difference in name or required setting is worth showing (and it cannot be applied).
    const incomingRequired = trimmed.selection.minSelections > 0;
    const sameWithoutRules = !before.targets.size && normalizedName(match.incomingRoute.groupName) === normalizedName(before.name) && incomingRequired === before.required;
    if (sameWithoutRules) return null;
    return { ...base, targetsAfter: 0, settingChanges: ["The JSON has no rules for this group."], addedTargets: [], removedTargets: [], itemListChanges: 0, ruleSettingChanges: 0 };
  }

  const after = savedRules(current.draft, group, route);
  const settingChanges = [
    ...(before.name !== after.name ? [`Name: "${before.name}" -> "${after.name}"`] : []),
    ...(before.required !== after.required ? [`Required: ${yesNo(before.required)} -> ${yesNo(after.required)}`] : []),
    ...(before.selection !== after.selection ? [`Selection: ${words(before.selection)} -> ${words(after.selection)}`] : []),
    ...(before.role !== after.role ? [`Type: ${words(before.role)} -> ${words(after.role)}`] : []),
    ...(JSON.stringify(before.defaults) !== JSON.stringify(after.defaults) ? [`Default items: ${before.defaults.join(", ") || "none"} -> ${after.defaults.join(", ") || "none"}`] : []),
  ];
  const label = (target: AccessoryApplicabilityTarget) => targetName(current.draft, target) ?? `${target.group_id} / ${target.row_id}`;
  const addedTargets = [...after.targets].filter(([key]) => !before.targets.has(key)).map(([, entry]) => label(entry.target));
  const removedTargets = [...before.targets].filter(([key]) => !after.targets.has(key)).map(([, entry]) => label(entry.target));
  const shared = [...after.targets].flatMap(([key, entry]) => before.targets.has(key) ? [{ was: before.targets.get(key)!, now: entry }] : []);
  const itemListChanges = shared.filter(({ was, now }) => was.items !== now.items).length;
  const ruleSettingChanges = shared.filter(({ was, now }) => was.settings !== now.settings).length;
  if (!settingChanges.length && !addedTargets.length && !removedTargets.length && !itemListChanges && !ruleSettingChanges) return null;
  return { ...base, targetsAfter: after.targets.size, settingChanges, addedTargets, removedTargets, itemListChanges, ruleSettingChanges };
}

function analyse(current: Workspace, incoming: ProductTemplateDraft, manual: SmartRulesOnlyManualMatches) {
  const { matches, ignored, availableGroups } = matchGroups(current, incoming, manual);
  const reduced = rulesOnlyIncoming(incoming, matches);
  const described = matches.map((match, index) => ({ match, change: describeChange(current, match, reduced.optionGroups[index]!) }));
  return { reduced, ignored, availableGroups, described, changed: described.flatMap((entry) => entry.change ? [{ match: entry.match, change: entry.change }] : []) };
}

export function planSmartRulesOnlyUpdate(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, incoming: ProductTemplateDraft, manual: SmartRulesOnlyManualMatches = {}): SmartRulesOnlyPlan {
  const { changed, described, ignored, availableGroups } = analyse({ draft, plan }, incoming, manual);
  return { changes: changed.map((entry) => entry.change), unchangedCount: described.length - changed.length, ignored, availableGroups };
}

export const defaultSmartRulesOnlyChoices = (report: SmartRulesOnlyPlan): Record<string, SmartRulesOnlyChoice> =>
  Object.fromEntries(report.changes.map((change) => [change.key, { apply: true, addItems: true }]));

/** Rows the incoming rules point at that this template does not have. Pricing rows cannot change here. */
function unknownRowErrors(current: Workspace, selected: Array<{ match: Match; change: SmartRulesOnlyChange }>) {
  return selected.flatMap(({ match, change }) => (match.incoming.conditionalConfiguration?.applicability ?? []).flatMap((rule) => {
    const target = resolveAccessoryApplicabilityTarget(rule);
    return target && target.kind !== "option_item" && !targetName(current.draft, target) ? [`"${change.name}" points to a row that is not in this template: ${target.group_id} / ${target.row_id}.`] : [];
  }));
}

/**
 * Checks the ticked groups and, when everything is valid, returns a new workspace. `workspace` is null when there is
 * nothing to apply or anything is invalid. The inputs are never changed.
 */
export function applySmartRulesOnlyUpdate(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, incoming: ProductTemplateDraft, choices: Record<string, SmartRulesOnlyChoice>, manual: SmartRulesOnlyManualMatches = {}) {
  const current = { draft, plan };
  const { changed, reduced } = analyse(current, incoming, manual);
  const selected = changed.filter(({ change }) => choices[change.key]?.apply);
  const nothing = { workspace: null as Workspace | null, updatedCount: 0, unnamed: {} as Record<string, number> };
  if (!selected.length) return { ...nothing, errors: [] as string[] };

  const missing = selected.flatMap(({ change }) => change.neededItems.length && !choices[change.key]!.addItems
    ? [`"${change.name}" needs ${change.neededItems.length} new item${change.neededItems.length === 1 ? "" : "s"} (${change.neededItems.map((item) => item.name).join(", ")}). Tick "Also add these ${change.neededItems.length} items", or untick this group.`]
    : []);
  const decisions: Record<string, SmartAdditionalGroupDecision> = Object.fromEntries(selected.map(({ change }) => [change.key, { action: "merge", destination: "accessory", targetKey: change.targetKey, duplicateChoices: {}, updateRules: true }]));
  const report = smartAdditionalRulesReport(draft, plan, reduced, decisions);
  const unnamed = Object.fromEntries(Object.entries(report.previews).map(([key, preview]) => [key, preview.unnamedExisting]));
  const errors = [...new Set([...missing, ...unknownRowErrors(current, selected), ...report.errors])];
  if (errors.length) return { ...nothing, unnamed, errors };

  const merged = applySmartAdditionalJson(draft, plan, reduced, decisions);
  const updated = new Set(selected.map(({ match }) => match.group.id));
  // Copy back only the rule fields and the added items, so nothing else the merge touches can change.
  const workspace: Workspace = structuredClone({
    draft: { ...draft, optionGroups: draft.optionGroups.map((group) => {
      if (!updated.has(group.id)) return group;
      const next = merged.draft.optionGroups.find((item) => item.id === group.id)!;
      const savedIds = new Set(group.items.map((item) => item.id));
      return { ...group, label: next.label, selection: next.selection, conditionalConfiguration: next.conditionalConfiguration, items: [...group.items, ...next.items.filter((item) => !savedIds.has(item.id))] };
    }) },
    plan: { ...plan, routes: plan.routes.map((route) => {
      if (route.sourceKind !== "option" || !updated.has(route.sourceId)) return route;
      const next = merged.plan.routes.find((item) => item.key === route.key)!;
      return { ...route, groupName: next.groupName, sourceName: next.sourceName, accessory: next.accessory, rowCount: next.rowCount };
    }) },
  });
  return { workspace, updatedCount: updated.size, unnamed, errors };
}
