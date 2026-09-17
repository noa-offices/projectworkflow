"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasMeaningfulWorkstationPricing = hasMeaningfulWorkstationPricing;
function hasMeaningfulWorkstationPricing(rows) {
    return (rows ?? []).some((row) => Boolean(row.label?.trim() || row.base_supplier_price_list_code?.trim() ||
        row.additional_supplier_price_list_code?.trim() || row.default_dimension?.trim() ||
        row.specification?.trim() || row.length || row.depth || row.height ||
        row.default_price !== null && row.default_price !== undefined ||
        row.additional_price !== null && row.additional_price !== undefined));
}
