"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDraftBaseModelRows = mapDraftBaseModelRows;
exports.mapDraftBaseModelPricing = mapDraftBaseModelPricing;
const base_model_pricing_groups_1 = require("./base-model-pricing-groups");
const product_template_draft_pricing_routing_1 = require("./product-template-draft-pricing-routing");
function dimensionText(dimension) {
    return dimension?.rawText ?? [dimension?.diameter !== null && dimension?.diameter !== undefined ? `Ø${dimension.diameter}` : null, dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : "");
}
function mapRow(row, price, index) {
    const codes = [...row.supplierCodes, ...row.referenceCodes];
    return { id: row.id, variant_name: row.label ?? row.id, display_name: row.displayName ?? row.label ?? "", supplier_price_list_code: codes[0] ?? "", dimension: dimensionText(row.dimensions), price, currency: row.currency ?? undefined, specification: row.specification ?? "", ...(row.importantRequirements?.length ? { importantRequirements: row.importantRequirements } : {}), is_active: true, sort_order: index };
}
function mapDraftBaseModelRows(draft) {
    const warnings = [];
    const rows = draft.pricing.baseModelRows.map((row, index) => {
        const codes = [...row.supplierCodes, ...row.referenceCodes];
        if (codes.length > 1)
            warnings.push(`Base/Model row '${row.label ?? row.displayName ?? row.id}' contains ${codes.length} supplier codes; only the primary code was applied.`);
        return mapRow(row, row.price, index);
    });
    return { rows, warnings };
}
function mapDraftBaseModelPricing(draft, matrixRouting = {}) {
    const flat = mapDraftBaseModelRows(draft);
    const warnings = [...flat.warnings];
    const rowIds = new Set(flat.rows.map((row) => row.id));
    const groups = (0, product_template_draft_pricing_routing_1.routeDraftPriceMatrices)(draft, matrixRouting).routes.flatMap((route, matrixIndex) => {
        if (route.kind !== "base_model")
            return [];
        const column = route.matrix.columns[0];
        const items = route.matrix.rows.flatMap((row, rowIndex) => {
            if (rowIds.has(row.id)) {
                warnings.push(`Base/Model row '${row.label ?? row.displayName ?? row.id}' was not duplicated from matrix '${route.matrix.label ?? route.matrix.id}' because its stable row ID already exists in baseModelRows.`);
                return [];
            }
            rowIds.add(row.id);
            return [mapRow(row, (0, product_template_draft_pricing_routing_1.directMatrixRowPrice)(row, column) ?? null, rowIndex)];
        });
        return items.length ? [{ id: route.matrix.id, pricing_type: base_model_pricing_groups_1.BASE_MODEL_GROUP_PRICING_TYPE, group_name: route.matrix.label ?? route.matrix.id, is_active: true, sort_order: matrixIndex + (flat.rows.length ? 1 : 0), items }] : [];
    });
    return { groups, rows: flat.rows, warnings };
}
