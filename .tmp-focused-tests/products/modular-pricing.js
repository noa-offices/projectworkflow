"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULAR_ROLES = exports.DIRECT_MODULAR_PRICING_MODE = exports.MODULAR_GROUP_PRICING_TYPE = exports.MODULAR_META_PRICING_TYPE = exports.MODULAR_ITEM_PRICING_TYPE = void 0;
exports.isDirectModularPricingGroup = isDirectModularPricingGroup;
exports.modularRowRole = modularRowRole;
exports.modularCompositionRule = modularCompositionRule;
exports.isModularItemPricingRow = isModularItemPricingRow;
exports.isModularMetaPricingRow = isModularMetaPricingRow;
exports.isModularGroupPricingRow = isModularGroupPricingRow;
exports.modularPricingDefaultsFromRows = modularPricingDefaultsFromRows;
exports.modularItemPricingRows = modularItemPricingRows;
exports.modularItemPricingGroups = modularItemPricingGroups;
exports.standardCategoryPricingRows = standardCategoryPricingRows;
exports.MODULAR_ITEM_PRICING_TYPE = "modular_item";
exports.MODULAR_META_PRICING_TYPE = "modular_meta";
exports.MODULAR_GROUP_PRICING_TYPE = "modular_group";
/** Opt-in marker: the group prices rows by one scalar `price`, not category columns. */
exports.DIRECT_MODULAR_PRICING_MODE = "direct";
exports.MODULAR_ROLES = ["starter", "intermediate", "terminal"];
/** Direct-priced modular groups are opt-in; every legacy group stays matrix-priced. */
function isDirectModularPricingGroup(group) {
    return group?.modular_pricing_mode === exports.DIRECT_MODULAR_PRICING_MODE;
}
function modularRowRole(row) {
    const role = typeof row?.modular_role === "string" ? row.modular_role : "";
    return exports.MODULAR_ROLES.includes(role) ? role : null;
}
/** Normalized starter cardinality for a direct-priced composition group. */
function modularCompositionRule(group) {
    if (!isDirectModularPricingGroup(group))
        return null;
    const composition = group?.modular_composition;
    if (!composition)
        return null;
    const min = Number(composition.min_starters);
    const max = composition.max_starters === null || composition.max_starters === undefined ? null : Number(composition.max_starters);
    return {
        minStarters: Number.isInteger(min) && min >= 0 ? min : 0,
        maxStarters: max !== null && Number.isInteger(max) && max >= 1 ? max : null,
    };
}
function isModularItemPricingRow(row) {
    return row?.pricing_type === exports.MODULAR_ITEM_PRICING_TYPE;
}
function isModularMetaPricingRow(row) {
    return row?.pricing_type === exports.MODULAR_META_PRICING_TYPE;
}
function isModularGroupPricingRow(row) {
    return row?.pricing_type === exports.MODULAR_GROUP_PRICING_TYPE;
}
function modularPricingDefaultsFromRows(rows) {
    const metaRow = (Array.isArray(rows) ? rows : []).find((row) => isModularMetaPricingRow(row)) ?? null;
    return {
        defaultDimension: typeof metaRow?.modular_default_dimension === "string" && metaRow.modular_default_dimension.trim()
            ? metaRow.modular_default_dimension.trim()
            : null,
        defaultSpecification: typeof metaRow?.modular_default_specification === "string" && metaRow.modular_default_specification.trim()
            ? metaRow.modular_default_specification.trim()
            : null,
    };
}
function modularItemPricingRows(rows) {
    return (Array.isArray(rows) ? rows : []).flatMap((row) => {
        if (isModularItemPricingRow(row)) {
            return [row];
        }
        if (isModularGroupPricingRow(row)) {
            return (Array.isArray(row.items) ? row.items : []).filter((item) => isModularItemPricingRow(item) || !item?.pricing_type).map((item) => ({
                ...item,
                pricing_type: exports.MODULAR_ITEM_PRICING_TYPE,
            }));
        }
        return [];
    });
}
function modularItemPricingGroups(rows) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const explicitGroups = sourceRows
        .filter((row) => isModularGroupPricingRow(row))
        .map((group, groupIndex) => ({
        ...group,
        id: typeof group.id === "string" && group.id ? group.id : `modular-group-${groupIndex}`,
        group_name: typeof group.group_name === "string" && group.group_name.trim()
            ? group.group_name.trim()
            : "Modular Items",
        is_active: group.is_active !== false,
        pricing_type: exports.MODULAR_GROUP_PRICING_TYPE,
        items: (Array.isArray(group.items) ? group.items : []).filter((item) => isModularItemPricingRow(item) || !item?.pricing_type).map((item) => ({
            ...item,
            pricing_type: exports.MODULAR_ITEM_PRICING_TYPE,
        })),
    }));
    if (explicitGroups.length) {
        return explicitGroups;
    }
    const flatRows = sourceRows.filter((row) => isModularItemPricingRow(row));
    if (!flatRows.length) {
        return [];
    }
    return [{
            id: "modular-group-default",
            group_name: "Modular Items",
            is_active: true,
            pricing_type: exports.MODULAR_GROUP_PRICING_TYPE,
            items: flatRows,
        }];
}
function standardCategoryPricingRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => !isModularItemPricingRow(row) && !isModularMetaPricingRow(row) && !isModularGroupPricingRow(row));
}
