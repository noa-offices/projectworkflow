"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNullablePricingNumber = parseNullablePricingNumber;
exports.hasExplicitPricingNumber = hasExplicitPricingNumber;
exports.resolveInheritedPricingCurrency = resolveInheritedPricingCurrency;
/** Shared JSON-pricing semantics: null means unknown; zero remains explicit. */
function parseNullablePricingNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string" && !value.trim())
        return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}
function hasExplicitPricingNumber(value) {
    return value !== null && value !== undefined;
}
function resolveInheritedPricingCurrency({ brandCurrency, fallbackCurrency, normalizeCurrency, rowCurrency, templateCurrency, }) {
    const firstDefined = [rowCurrency, templateCurrency, brandCurrency]
        .find((value) => typeof value === "string" && value.trim());
    return firstDefined ? normalizeCurrency(firstDefined) : fallbackCurrency;
}
