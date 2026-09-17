"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBaseModelPricingJson = parseBaseModelPricingJson;
const currencies_1 = require("../currencies");
const nullable_pricing_1 = require("./nullable-pricing");
const base_model_pricing_groups_1 = require("./base-model-pricing-groups");
function normalizeServerBaseModelRow(row, index) {
    const importantRequirements = Array.isArray(row.importantRequirements) ? Array.from(new Set(row.importantRequirements.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))) : [];
    return {
        ...row,
        id: typeof row.id === "string" && row.id ? row.id : `variant-${index}`,
        variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
        display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        price: (0, nullable_pricing_1.parseNullablePricingNumber)(row.price),
        currency: (0, currencies_1.normalizeCurrency)(typeof row.currency === "string" ? row.currency : currencies_1.defaultCurrency),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        ...(importantRequirements.length ? { importantRequirements } : {}),
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
    };
}
function meaningfulRow(row) {
    return Boolean(row.variant_name || row.display_name || row.supplier_price_list_code ||
        row.dimension || row.price !== null || row.specification);
}
function parseBaseModelPricingJson(rawValue) {
    if (!rawValue)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(rawValue);
    }
    catch {
        throw new base_model_pricing_groups_1.BaseModelPricingContractError([{
                code: "invalid_root",
                message: "Base / Model pricing JSON is invalid.",
                path: "variant_pricing",
            }]);
    }
    const normalized = (0, base_model_pricing_groups_1.normalizeBaseModelPricing)(parsed);
    if (normalized.issues.length)
        throw new base_model_pricing_groups_1.BaseModelPricingContractError(normalized.issues);
    const groups = normalized.groups.map((group) => ({
        ...group,
        items: group.items.map(normalizeServerBaseModelRow).filter(meaningfulRow),
    }));
    if (normalized.sourceKind === "legacy")
        return groups[0]?.items ?? [];
    return (0, base_model_pricing_groups_1.serializeBaseModelPricingGroups)(groups);
}
