"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMART_REVIEW_DESTINATIONS = void 0;
exports.reorderSmartSetupReviewRoutes = reorderSmartSetupReviewRoutes;
exports.createSmartSetupReviewRouting = createSmartSetupReviewRouting;
exports.smartReviewSelectionContract = smartReviewSelectionContract;
exports.smartReviewRuleTarget = smartReviewRuleTarget;
exports.validateSmartSetupReviewRouting = validateSmartSetupReviewRouting;
exports.smartSetupRoutingSummary = smartSetupRoutingSummary;
exports.smartReviewMatrixOverrides = smartReviewMatrixOverrides;
exports.draftForSmartSetupReviewApply = draftForSmartSetupReviewApply;
const accessory_conditional_configuration_1 = require("./accessory-conditional-configuration");
const product_template_draft_1 = require("./product-template-draft");
const product_template_draft_pricing_routing_1 = require("./product-template-draft-pricing-routing");
const base_model_pricing_groups_1 = require("./base-model-pricing-groups");
exports.SMART_REVIEW_DESTINATIONS = ["base_model", "workstation", "category_matrix", "modular", "accessory", "skip"];
function reorderSmartSetupReviewRoutes(plan, key, direction) {
    const index = plan.routes.findIndex((route) => route.key === key);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= plan.routes.length)
        return plan;
    const routes = [...plan.routes];
    [routes[index], routes[target]] = [routes[target], routes[index]];
    return { ...plan, routes };
}
function explicitRequirement(specification, kind) {
    if (!specification || !/\balways complete with\b/i.test(specification))
        return false;
    return kind === "top" ? /\b1\s+top[- ]?access\b/i.test(specification) : /\b1\s+(?:support\s+)?service unit\b/i.test(specification);
}
function sourceSelectionDefaults(selection) {
    if (!selection)
        return null;
    const exactlyOne = selection.maxSelections === 1;
    if (selection.minSelections === 0) {
        return {
            role: "accessory",
            selection: exactlyOne ? "optional_exactly_one" : selection.mode === "choose_multiple" ? "multiple" : "optional_multiple",
            rules: [],
        };
    }
    return {
        role: "companion",
        selection: exactlyOne ? "required_exactly_one" : "required_at_least_one",
        rules: [],
    };
}
function accessoryDefaults(name, selection) {
    const sourceDefaults = sourceSelectionDefaults(selection);
    if (sourceDefaults)
        return sourceDefaults;
    const top = /\btop[- ]?access\b/i.test(name);
    const service = /\b(?:service|support)\s+units?\b/i.test(name);
    return { role: service ? "companion" : top ? "conditional_option" : "accessory", selection: service || top ? "required_exactly_one" : "optional_multiple", rules: [] };
}
function reviewedAccessoryConfiguration(group) {
    const configuration = group.conditionalConfiguration;
    if (!configuration)
        return null;
    const required = configuration.applicability.some((rule) => rule.required);
    const selection = configuration.selection === "exactly_one" ? (required ? "required_exactly_one" : "optional_exactly_one")
        : configuration.selection === "at_least_one" ? "required_at_least_one"
            : configuration.selection === "choose_multiple" ? "multiple" : "optional_multiple";
    return { role: configuration.role, selection, rules: configuration.applicability.map((rule) => ({
            ...(rule.target ? { target: rule.target } : { baseModelGroupId: rule.base_model_group_id, baseModelRowId: rule.base_model_row_id }),
            required: rule.required,
            visible: rule.visible,
            ...(rule.allowed_item_ids ? { allowedItemIds: rule.allowed_item_ids } : {}),
            ...(rule.fixed_quantity !== undefined ? { fixedQuantity: rule.fixed_quantity } : {}),
            ...(rule.scale_with_target_quantity === true ? { scaleWithTargetQuantity: true } : {}),
        })) };
}
function createSmartSetupReviewRouting(draft) {
    const matrixRoutes = draft.pricing.priceMatrices.map((matrix) => {
        const recommendation = (0, product_template_draft_pricing_routing_1.classifyDraftPriceMatrix)(matrix);
        const recommendedDestination = recommendation.kind === "base_model" ? "base_model" : recommendation.kind === "companion" ? "accessory" : "category_matrix";
        const oneColumn = matrix.columns.length === 1;
        return { key: `matrix:${matrix.id}`, sourceId: matrix.id, sourceKind: "matrix", sourceName: matrix.label ?? matrix.id, groupName: matrix.label ?? matrix.id, rowCount: matrix.rows.length, columnCount: matrix.columns.length, recommendedDestination, destination: recommendedDestination, supportedDestinations: [...(oneColumn ? ["base_model", "category_matrix", "accessory"] : ["category_matrix"]), "skip"], ...(recommendedDestination === "accessory" ? { accessory: accessoryDefaults(matrix.label ?? matrix.id) } : {}) };
    });
    const optionRoutes = draft.optionGroups.map((group) => ({ key: `option:${group.id}`, sourceId: group.id, sourceKind: "option", sourceName: group.label ?? group.id, groupName: group.label ?? group.id, rowCount: group.items.length, columnCount: null, recommendedDestination: "accessory", destination: "accessory", supportedDestinations: ["accessory", "skip"], accessory: reviewedAccessoryConfiguration(group) ?? accessoryDefaults(group.label ?? group.id, group.selection) }));
    const routes = [
        ...(draft.pricing.workstationRows.length ? [{ key: "workstation:rows", sourceId: "workstationRows", sourceKind: "workstation", sourceName: "Workstation Pricing", groupName: "Workstation Pricing", rowCount: draft.pricing.workstationRows.length, columnCount: null, recommendedDestination: "workstation", destination: "workstation", supportedDestinations: ["workstation", "skip"] }] : []),
        ...(draft.pricing.baseModelRows.length ? [{ key: "base_model:rows", sourceId: "baseModelRows", sourceKind: "base_model", sourceName: "Base / Model Pricing", groupName: "Base / Model Pricing", rowCount: draft.pricing.baseModelRows.length, columnCount: null, recommendedDestination: "base_model", destination: "base_model", supportedDestinations: ["base_model", "skip"] }] : []),
        ...matrixRoutes,
        ...draft.pricing.modularGroups.map((group) => ({ key: `modular:${group.id}`, sourceId: group.id, sourceKind: "modular", sourceName: group.label ?? group.id, groupName: group.label ?? group.id, rowCount: (0, product_template_draft_1.draftModularRows)(group).length, columnCount: (0, product_template_draft_1.draftModularColumns)(group).length, recommendedDestination: "modular", destination: "modular", supportedDestinations: ["modular", "skip"] })),
        ...optionRoutes,
    ];
    const baseModels = [
        ...draft.pricing.baseModelRows.map((row) => ({ groupId: base_model_pricing_groups_1.LEGACY_BASE_MODEL_GROUP_ID, rowId: row.id, specification: row.specification })),
        ...draft.pricing.priceMatrices.flatMap((matrix) => matrixRoutes.find((route) => route.sourceId === matrix.id)?.destination === "base_model" ? matrix.rows.map((row) => ({ groupId: matrix.id, rowId: row.id, specification: row.specification })) : []),
    ];
    routes.forEach((route) => {
        if (!route.accessory || !["conditional_option", "companion"].includes(route.accessory.role))
            return;
        // Draft-supplied applicability wins: this legacy specification heuristic exists only to
        // invent rules for groups that arrived without any, and must never overwrite an extracted
        // conditionalConfiguration (targets, allowed_item_ids, fixed_quantity, quantity scaling).
        if (route.accessory.rules.length)
            return;
        const kind = route.accessory.role === "companion" ? "service" : "top";
        route.accessory.rules = baseModels.filter((model) => explicitRequirement(model.specification, kind)).map((model) => ({ baseModelGroupId: model.groupId, baseModelRowId: model.rowId, required: true, fixedQuantity: 1 }));
    });
    return { routes };
}
function smartReviewSelectionContract(selection) {
    if (selection === "optional_exactly_one")
        return { selection: "exactly_one", required: false };
    if (selection === "required_exactly_one")
        return { selection: "exactly_one", required: true };
    if (selection === "required_at_least_one")
        return { selection: "at_least_one", required: true };
    if (selection === "multiple")
        return { selection: "choose_multiple", required: false };
    return { selection: "unrestricted", required: false };
}
function smartReviewRuleTarget(rule) {
    if (rule.target)
        return rule.target;
    return rule.baseModelGroupId && rule.baseModelRowId
        ? { kind: "base_model", group_id: rule.baseModelGroupId, row_id: rule.baseModelRowId }
        : null;
}
function validateSmartSetupReviewRouting(draft, plan) {
    const errors = [];
    const routeKeys = new Set(plan.routes.map((route) => route.key));
    if (routeKeys.size !== plan.routes.length)
        errors.push("Duplicate reviewed routing groups were found.");
    const modelTargets = new Set([
        ...(plan.routes.find((route) => route.key === "base_model:rows")?.destination === "base_model" ? draft.pricing.baseModelRows.map((row) => (0, accessory_conditional_configuration_1.accessoryApplicabilityTargetKey)({ kind: "base_model", group_id: base_model_pricing_groups_1.LEGACY_BASE_MODEL_GROUP_ID, row_id: row.id })) : []),
        ...draft.pricing.priceMatrices.flatMap((matrix) => {
            const destination = plan.routes.find((route) => route.key === `matrix:${matrix.id}`)?.destination;
            const kind = destination === "base_model" ? "base_model" : destination === "category_matrix" ? "price_matrix" : null;
            return kind ? matrix.rows.map((row) => (0, accessory_conditional_configuration_1.accessoryApplicabilityTargetKey)({ kind, group_id: matrix.id, row_id: row.id })) : [];
        }),
        ...draft.pricing.modularGroups.flatMap((group) => plan.routes.find((route) => route.key === `modular:${group.id}`)?.destination === "modular"
            ? (0, product_template_draft_1.draftModularRows)(group).map((row) => (0, accessory_conditional_configuration_1.accessoryApplicabilityTargetKey)({ kind: "modular", group_id: group.id, row_id: row.id }))
            : []),
    ]);
    plan.routes.forEach((route) => {
        if (!route.supportedDestinations.includes(route.destination))
            errors.push(`${route.sourceName} cannot be applied to the selected destination.`);
        if (route.destination !== "skip" && !route.groupName.trim())
            errors.push(`${route.sourceName} requires a destination group name.`);
        if (route.destination !== "accessory")
            return;
        if (!route.accessory)
            errors.push(`${route.sourceName} requires Accessory / Configuration settings.`);
        const itemIds = new Set(route.sourceKind === "option"
            ? draft.optionGroups.find((group) => group.id === route.sourceId)?.items.map((item) => item.id) ?? []
            : draft.pricing.priceMatrices.find((matrix) => matrix.id === route.sourceId)?.rows.map((row) => row.id) ?? []);
        const ruleKeys = new Set();
        route.accessory?.rules.forEach((rule) => {
            const target = smartReviewRuleTarget(rule);
            const key = target ? (0, accessory_conditional_configuration_1.accessoryApplicabilityTargetKey)(target) : "";
            if (!target)
                errors.push(`${route.sourceName} has an incomplete applicable model target.`);
            if (ruleKeys.has(key))
                errors.push(`${route.sourceName} has a duplicate applicable model rule.`);
            if (key)
                ruleKeys.add(key);
            if (target && !modelTargets.has(key))
                errors.push(`${route.sourceName} references a row not routed to Base / Model, Category / Matrix, or Modular Pricing.`);
            if (rule.fixedQuantity !== undefined && (!Number.isInteger(rule.fixedQuantity) || rule.fixedQuantity <= 0))
                errors.push(`${route.sourceName} has an invalid fixed quantity.`);
            if (rule.scaleWithTargetQuantity === true && rule.fixedQuantity === undefined)
                errors.push(`${route.sourceName} quantity scaling requires a fixed quantity.`);
            if (rule.scaleWithTargetQuantity === true && target?.kind !== "modular")
                errors.push(`${route.sourceName} quantity scaling is only supported for Modular targets.`);
            if (route.accessory?.selection === "required_exactly_one" && rule.scaleWithTargetQuantity !== true && rule.fixedQuantity !== undefined && rule.fixedQuantity !== 1)
                errors.push(`${route.sourceName} must use fixed quantity 1 for Required / Exactly One.`);
            if (route.accessory?.selection === "required_exactly_one" && rule.scaleWithTargetQuantity === true)
                errors.push(`${route.sourceName} quantity scaling cannot use Required / Exactly One.`);
            if (rule.allowedItemIds?.length === 0)
                errors.push(`${route.sourceName} requires at least one allowed item when Specific Items is selected.`);
            if (rule.allowedItemIds?.some((id) => !itemIds.has(id)))
                errors.push(`${route.sourceName} has an allowed item that is not part of the reviewed group.`);
        });
    });
    return { errors, valid: errors.length === 0 };
}
function smartSetupRoutingSummary(plan) {
    return exports.SMART_REVIEW_DESTINATIONS.map((destination) => ({ destination, count: plan.routes.filter((route) => route.destination === destination).length }));
}
function smartReviewMatrixOverrides(plan) {
    return Object.fromEntries(plan.routes.filter((route) => route.sourceKind === "matrix").map((route) => [route.sourceId, route.destination === "base_model" ? "base_model" : route.destination === "category_matrix" ? "category_matrix" : route.destination === "accessory" ? "companion" : "skip"]));
}
function draftForSmartSetupReviewApply(draft, plan) {
    const route = (key) => plan.routes.find((item) => item.key === key);
    const ordered = (items, sourceKind) => plan.routes.filter((item) => item.sourceKind === sourceKind).flatMap((item) => items.find((entry) => entry.id === item.sourceId) ?? []);
    return {
        ...draft,
        pricing: {
            ...draft.pricing,
            workstationRows: route("workstation:rows")?.destination === "workstation" ? draft.pricing.workstationRows : [],
            baseModelRows: route("base_model:rows")?.destination === "base_model" ? draft.pricing.baseModelRows : [],
            priceMatrices: ordered(draft.pricing.priceMatrices, "matrix").map((matrix) => ({ ...matrix, label: route(`matrix:${matrix.id}`)?.groupName ?? matrix.label })),
            modularGroups: ordered(draft.pricing.modularGroups, "modular").filter((group) => route(`modular:${group.id}`)?.destination === "modular").map((group) => ({ ...group, label: route(`modular:${group.id}`)?.groupName ?? group.label })),
        },
        optionGroups: ordered(draft.optionGroups, "option").filter((group) => route(`option:${group.id}`)?.destination === "accessory").map((group) => ({ ...group, label: route(`option:${group.id}`)?.groupName ?? group.label })),
    };
}
