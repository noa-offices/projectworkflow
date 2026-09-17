"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDraftPriceMatricesToCategoryGroups = mapDraftPriceMatricesToCategoryGroups;
const product_template_draft_pricing_routing_1 = require("./product-template-draft-pricing-routing");
function mapDraftPriceMatricesToCategoryGroups(draft, matrixRouting = {}) {
    const routing = (0, product_template_draft_pricing_routing_1.routeDraftPriceMatrices)(draft, matrixRouting);
    const warnings = [...routing.warnings];
    const groups = routing.routes.filter((route) => route.kind === "category_matrix").map((route) => route.matrix).filter((matrix) => {
        const modular = /modular/i.test(matrix.label ?? "");
        if (modular)
            warnings.push(`Price matrix '${matrix.label ?? matrix.id}' was not applied to Finish / Category Pricing because it appears to belong to Modular Pricing.`);
        return !modular;
    }).map((matrix, groupIndex) => {
        const columns = matrix.columns.map((column) => column.label ?? column.id);
        return { id: matrix.id, group_name: matrix.label ?? matrix.id, price_categories: columns, is_active: true, sort_order: groupIndex, items: matrix.rows.map((row, index) => { const codes = [...row.supplierCodes, ...row.referenceCodes]; if (codes.length > 1)
                warnings.push(`Finish row '${row.label ?? row.id}' contains additional supplier codes that were not mapped automatically.`); const dimension = row.dimensions; const text = dimension?.rawText ?? [dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : ""); return { id: row.id, variant_name: row.label ?? row.id, display_name: row.displayName ?? "", supplier_price_list_code: codes[0] ?? "", dimension: text, currency: row.currency ?? undefined, specification: row.specification ?? "", prices: Object.fromEntries(matrix.columns.map((column, columnIndex) => [columns[columnIndex], row.prices[column.id]])), is_active: true, sort_order: index }; }) };
    });
    groups.forEach((group) => draft.pricing.priceMatrices.find((matrix) => matrix.id === group.id)?.rows.forEach((row, index) => {
        if (row.importantRequirements?.length)
            Object.assign(group.items[index], { importantRequirements: row.importantRequirements });
    }));
    return {
        groups: groups.map((group) => {
            const matrix = draft.pricing.priceMatrices.find((item) => item.id === group.id);
            return !matrix ? { ...group, items: group.items.map((item) => ({ ...item, unavailable_categories: [] })) } : {
                ...group,
                items: group.items.map((item, index) => ({
                    ...item,
                    unavailable_categories: (matrix.rows[index]?.unavailableCategoryIds ?? []).flatMap((id) => {
                        const columnIndex = matrix.columns.findIndex((column) => column.id === id);
                        return columnIndex < 0 ? [] : [group.price_categories[columnIndex]];
                    }),
                })),
            };
        }),
        warnings,
    };
}
