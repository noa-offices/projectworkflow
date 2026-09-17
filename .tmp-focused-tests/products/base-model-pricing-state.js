"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasMeaningfulBaseModelPricing = hasMeaningfulBaseModelPricing;
function hasMeaningfulBaseModelPricing(rows) {
    return (rows ?? []).some((row) => Boolean(row.variant_name?.trim() || row.display_name?.trim() ||
        row.supplier_price_list_code?.trim() || row.dimension?.trim() ||
        row.specification?.trim() || row.price !== null && row.price !== undefined));
}
