"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDraftOptionGroupsToAccessories = mapDraftOptionGroupsToAccessories;
const product_template_draft_pricing_routing_1 = require("./product-template-draft-pricing-routing");
const smart_product_review_routing_1 = require("./smart-product-review-routing");
function mapReviewedRule(rule) {
    const target = (0, smart_product_review_routing_1.smartReviewRuleTarget)(rule);
    return {
        ...(rule.target && target ? { target } : { base_model_group_id: rule.baseModelGroupId, base_model_row_id: rule.baseModelRowId }),
        required: rule.required,
        visible: rule.visible !== false,
        ...(rule.allowedItemIds ? { allowed_item_ids: rule.allowedItemIds } : {}),
        ...(rule.fixedQuantity !== undefined ? { fixed_quantity: rule.fixedQuantity } : {}),
        ...(rule.scaleWithTargetQuantity === true ? { scale_with_target_quantity: true } : {}),
    };
}
function primaryCode(row, warnings, itemKind) {
    const codes = [...row.supplierCodes, ...row.referenceCodes];
    if (codes.length > 1)
        warnings.push(`${itemKind} '${row.label ?? row.displayName ?? row.id}' contains additional supplier/reference codes; only the primary code was applied.`);
    return codes[0] ?? "";
}
function mapItem(row, price, index, warnings, itemKind) {
    const dimension = row.dimensions?.rawText?.trim();
    return { id: row.id, item_name: row.displayName ?? row.label ?? row.id, supplier_price_list_code: primaryCode(row, warnings, itemKind), price, ...("prices" in row && row.prices ? { prices: row.prices } : {}), currency: row.currency ?? undefined, ...(dimension ? { dimension } : {}), specification: row.specification ?? "", ...(row.importantRequirements?.length ? { importantRequirements: row.importantRequirements } : {}), is_active: true, sort_order: index };
}
function topAccessContext(value) {
    return /\btop[- ]?access\b/i.test(value);
}
function explicitRequirement(specification, kind) {
    if (!specification)
        return false;
    if (!/\balways complete with\b/i.test(specification))
        return false;
    return kind === "top"
        ? /\b1\s+top[- ]?access\b/i.test(specification)
        : /\b1\s+(?:support\s+)?service unit\b/i.test(specification);
}
function selectionConfiguration(group) {
    const optionalExactlyOne = group.selection.mode === "optional" && group.selection.minSelections === 0 && group.selection.maxSelections === 1;
    if (!optionalExactlyOne)
        return undefined;
    return { role: topAccessContext(group.label ?? "") ? "conditional_option" : "accessory", selection: "exactly_one", applicability: [] };
}
function selectionIsSafe(group) {
    const { defaultItemIds, maxSelections, minSelections, mode } = group.selection;
    if (defaultItemIds.length)
        return false;
    if (mode === "optional" && minSelections === 0 && (maxSelections === null || maxSelections === 1))
        return true;
    return (mode === "choose_multiple" && minSelections === 0 && maxSelections === null) ||
        (mode === "required_choose_at_least_one" && minSelections === 1 && maxSelections === null);
}
function reviewedConfiguration(route) {
    const accessory = route?.accessory;
    if (!accessory)
        return undefined;
    if (accessory.role === "accessory" && accessory.selection === "optional_multiple" && !accessory.rules.length) {
        return undefined;
    }
    const reviewedContract = (0, smart_product_review_routing_1.smartReviewSelectionContract)(accessory.selection);
    return {
        role: accessory.role,
        selection: reviewedContract.selection,
        applicability: accessory.rules.map(mapReviewedRule),
    };
}
function mapDraftOptionGroupsToAccessories(draft, reviewedPlan) {
    const warnings = [];
    const errors = [];
    const optionGroups = draft.optionGroups.flatMap((group, groupIndex) => {
        const reviewedRoute = reviewedPlan?.routes.find((route) => route.key === `option:${group.id}`);
        if (reviewedPlan && reviewedRoute?.destination !== "accessory")
            return [];
        if (!selectionIsSafe(group)) {
            errors.push(`Option group '${group.label ?? group.id}' was not applied because its selection rule cannot be represented safely by Accessory Pricing.`);
            return [];
        }
        const reviewedContract = reviewedRoute?.accessory ? (0, smart_product_review_routing_1.smartReviewSelectionContract)(reviewedRoute.accessory.selection) : null;
        const configuration = reviewedConfiguration(reviewedRoute) ?? group.conditionalConfiguration ?? selectionConfiguration(group);
        return [{
                id: group.id,
                group_name: reviewedRoute?.groupName ?? group.label ?? group.id,
                ...(group.priceCategories?.length ? { price_categories: group.priceCategories } : {}),
                group_is_required: reviewedContract?.required ?? group.selection.mode === "required_choose_at_least_one",
                is_active: true,
                sort_order: groupIndex,
                ...(configuration ? { conditional_configuration: configuration } : {}),
                items: group.items.map((item, itemIndex) => mapItem(item, item.price, itemIndex, warnings, "Accessory item")),
            }];
    });
    const matrixOverrides = reviewedPlan ? (0, smart_product_review_routing_1.smartReviewMatrixOverrides)(reviewedPlan) : {};
    const routing = (0, product_template_draft_pricing_routing_1.routeDraftPriceMatrices)(draft, matrixOverrides);
    const companionGroups = routing.routes.flatMap((route, routeIndex) => {
        if (route.kind !== "companion")
            return [];
        const reviewedRoute = reviewedPlan?.routes.find((item) => item.key === `matrix:${route.matrix.id}`);
        const column = route.matrix.columns[0];
        if (!column)
            return [];
        return [{
                id: route.matrix.id,
                group_name: reviewedRoute?.groupName ?? route.matrix.label ?? route.matrix.id,
                group_is_required: reviewedRoute?.accessory ? (0, smart_product_review_routing_1.smartReviewSelectionContract)(reviewedRoute.accessory.selection).required : false,
                is_active: true,
                sort_order: optionGroups.length + routeIndex,
                conditional_configuration: reviewedRoute?.accessory ? { role: reviewedRoute.accessory.role, selection: (0, smart_product_review_routing_1.smartReviewSelectionContract)(reviewedRoute.accessory.selection).selection, applicability: reviewedRoute.accessory.rules.map(mapReviewedRule) } : { role: "companion", selection: "exactly_one", applicability: [] },
                items: route.matrix.rows.map((item, itemIndex) => mapItem(item, (0, product_template_draft_pricing_routing_1.directMatrixRowPrice)(item, column) ?? null, itemIndex, warnings, "Companion item")),
            }];
    });
    const groups = [...optionGroups, ...companionGroups];
    if (reviewedPlan)
        return { groups, warnings, errors };
    const topGroup = groups.find((group) => group.conditional_configuration?.role === "conditional_option" && topAccessContext(group.group_name));
    const companionGroup = groups.find((group) => group.conditional_configuration?.role === "companion");
    const requirements = routing.routes.flatMap((route) => route.kind === "base_model" ? route.matrix.rows.map((row) => ({ groupId: route.matrix.id, rowId: row.id, specification: row.specification })) : []);
    const applyRules = (group, kind) => {
        if (!group?.conditional_configuration)
            return;
        const applicability = requirements.filter((item) => explicitRequirement(item.specification, kind)).map((item) => ({ base_model_group_id: item.groupId, base_model_row_id: item.rowId, required: true, visible: true }));
        if (applicability.length)
            group.conditional_configuration.applicability = applicability;
        else
            warnings.push(`${group.group_name} was imported without automatic model rules because no explicit matching requirement language was found. Use Conditional Rules to configure it manually.`);
    };
    applyRules(topGroup, "top");
    applyRules(companionGroup, "service");
    return { groups, warnings, errors };
}
