"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessoryPricingContractError = void 0;
exports.parseAccessoryPricingJson = parseAccessoryPricingJson;
const currencies_1 = require("../currencies");
const accessory_conditional_configuration_1 = require("./accessory-conditional-configuration");
const base_model_pricing_groups_1 = require("./base-model-pricing-groups");
const category_pricing_groups_1 = require("./category-pricing-groups");
const modular_pricing_1 = require("./modular-pricing");
const workstation_pricing_groups_1 = require("./workstation-pricing-groups");
const nullable_pricing_1 = require("./nullable-pricing");
class AccessoryPricingContractError extends Error {
    issues;
    constructor(issues) {
        super(`Accessory Pricing validation failed: ${issues[0]?.message ?? "Invalid accessory pricing data."}`);
        this.issues = issues;
        this.name = "AccessoryPricingContractError";
    }
}
exports.AccessoryPricingContractError = AccessoryPricingContractError;
function normalizeItem(row, index) {
    const importantRequirements = Array.isArray(row.importantRequirements) ? Array.from(new Set(row.importantRequirements.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))) : [];
    return {
        ...row,
        id: typeof row.id === "string" && row.id ? row.id : `add-on-${index}`,
        item_name: typeof row.item_name === "string" ? row.item_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        price: (0, nullable_pricing_1.parseNullablePricingNumber)(row.price),
        ...(row.prices && typeof row.prices === "object" && !Array.isArray(row.prices) ? { prices: Object.fromEntries(Object.entries(row.prices).map(([id, value]) => [id, (0, nullable_pricing_1.parseNullablePricingNumber)(value)])) } : {}),
        ...(Array.isArray(row.unavailable_price_categories) ? { unavailable_price_categories: Array.from(new Set(row.unavailable_price_categories.filter((value) => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))) } : {}),
        currency: (0, currencies_1.normalizeCurrency)(typeof row.currency === "string" ? row.currency : currencies_1.defaultCurrency),
        ...(typeof row.dimension === "string" && row.dimension.trim() ? { dimension: row.dimension.trim() } : {}),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        ...(importantRequirements.length ? { importantRequirements } : {}),
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
    };
}
function meaningfulItem(row) {
    return Boolean(row.item_name || row.supplier_price_list_code || row.price !== null || row.specification);
}
function normalizeGroups(groups) {
    const groupedRows = groups.filter((row) => row.group_name || row.items);
    const flatRows = groups.filter((row) => !row.group_name && !row.items);
    const normalized = groupedRows.map((row, index) => ({
        ...row,
        id: typeof row.id === "string" && row.id ? row.id : `add-on-group-${index}`,
        group_name: typeof row.group_name === "string" && row.group_name.trim() ? row.group_name.trim() : "Accessories",
        group_is_required: row.group_is_required === true,
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
        ...(Array.isArray(row.price_categories) ? { price_categories: row.price_categories.flatMap((category) => typeof category?.id === "string" && category.id.trim() && typeof category?.label === "string" && category.label.trim() ? [{ id: category.id.trim(), label: category.label.trim() }] : []) } : {}),
        items: (row.items ?? []).map(normalizeItem).filter(meaningfulItem),
    }));
    if (flatRows.length) {
        normalized.push({
            id: "accessories",
            group_name: "Accessories",
            group_is_required: false,
            sort_order: normalized.length,
            is_active: true,
            items: flatRows.map(normalizeItem).filter(meaningfulItem),
        });
    }
    return normalized.filter((group) => group.items.length);
}
/** Builds a stable identity set from an already-normalized group/row list, exact group_id+row_id match only. */
function identitySet(groups) {
    const ids = new Set();
    groups.forEach((group) => {
        const groupId = typeof group.id === "string" ? group.id : null;
        if (!groupId)
            return;
        (group.items ?? []).forEach((row) => {
            const rowId = typeof row.id === "string" ? row.id : null;
            if (rowId)
                ids.add(identityKey(groupId, rowId));
        });
    });
    return ids;
}
function identityKey(groupId, rowId) {
    return groupId + "\u0000" + rowId;
}
const targetKindLabels = {
    base_model: "Base/Model",
    price_matrix: "Price Matrix",
    modular: "Modular",
    workstation: "Workstation",
};
const targetKindIssueCodes = {
    base_model: "unknown_base_model_reference",
    price_matrix: "unknown_price_matrix_reference",
    modular: "unknown_modular_reference",
    workstation: "unknown_workstation_reference",
};
function pricingTargetReferenceIssues(groups, baseModelPricing, categoryPricing, workstationPricing) {
    const normalizedCategoryPricing = Array.isArray(categoryPricing) ? categoryPricing : [];
    // Each target kind resolves against its own authoritative pricing source, reusing the same
    // helpers already used by the Smart Setup target-choice picker and Product Library - never a
    // shared "matrix" bucket that structurally excludes Modular (Matrix or Direct) rows.
    const identitySetForKind = {
        base_model: identitySet((0, base_model_pricing_groups_1.baseModelPricingGroups)(baseModelPricing)),
        price_matrix: identitySet((0, category_pricing_groups_1.groupedStandardCategoryPricingRows)(normalizedCategoryPricing)),
        modular: identitySet((0, modular_pricing_1.modularItemPricingGroups)(normalizedCategoryPricing)),
        workstation: identitySet((0, workstation_pricing_groups_1.workstationPricingGroups)(Array.isArray(workstationPricing) ? workstationPricing : [])),
    };
    const issues = [];
    groups.forEach((group, groupIndex) => {
        group.conditional_configuration?.applicability.forEach((rule, ruleIndex) => {
            const target = (0, accessory_conditional_configuration_1.resolveAccessoryApplicabilityTarget)(rule);
            if (!target)
                return;
            const exists = identitySetForKind[target.kind].has(identityKey(target.group_id, target.row_id));
            if (!exists) {
                issues.push({
                    code: targetKindIssueCodes[target.kind],
                    message: `${targetKindLabels[target.kind]} reference '${target.group_id} / ${target.row_id}' does not exist in the submitted pricing data.`,
                    path: `accessory_pricing[${groupIndex}].conditional_configuration.applicability[${ruleIndex}]`,
                });
            }
        });
    });
    return issues;
}
function parseAccessoryPricingJson(rawValue, baseModelPricing = [], categoryPricing = [], workstationPricing = []) {
    if (!rawValue)
        return [];
    let raw;
    try {
        raw = JSON.parse(rawValue);
    }
    catch {
        throw new AccessoryPricingContractError([{ code: "invalid_root", message: "Accessory Pricing JSON is invalid.", path: "accessory_pricing" }]);
    }
    const parsed = (0, accessory_conditional_configuration_1.parseAccessoryConfigurationGroups)(raw);
    if (!parsed.valid)
        throw new AccessoryPricingContractError(parsed.issues);
    const normalized = normalizeGroups(parsed.groups);
    const normalizedContract = (0, accessory_conditional_configuration_1.parseAccessoryConfigurationGroups)(normalized);
    const issues = [...normalizedContract.issues, ...pricingTargetReferenceIssues(normalizedContract.groups, baseModelPricing, categoryPricing, workstationPricing)];
    if (issues.length)
        throw new AccessoryPricingContractError(issues);
    return (0, accessory_conditional_configuration_1.serializeAccessoryConfigurationGroups)(normalizedContract.groups);
}
