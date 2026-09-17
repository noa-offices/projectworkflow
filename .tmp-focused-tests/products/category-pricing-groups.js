"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCategoryPriceLabel = normalizeCategoryPriceLabel;
exports.isCategoryPricingGroup = isCategoryPricingGroup;
exports.groupedStandardCategoryPricingRows = groupedStandardCategoryPricingRows;
exports.flattenStandardCategoryPricingRows = flattenStandardCategoryPricingRows;
exports.standardCategoryPriceColumns = standardCategoryPriceColumns;
exports.countStandardCategoryPricingRows = countStandardCategoryPricingRows;
const modular_pricing_1 = require("@/lib/products/modular-pricing");
function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
function normalizeCategoryPriceLabel(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return "";
    const compact = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    const match = compact.match(/^cat\s*([a-z0-9]+)$/i);
    if (match) {
        return `Cat ${match[1].toUpperCase()}`;
    }
    return compact
        .split(" ")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" ");
}
function isCategoryPricingGroup(row) {
    if (!row || typeof row !== "object")
        return false;
    return Array.isArray(row.items)
        || typeof row.group_name === "string"
        || Array.isArray(row.price_categories);
}
function isStandardCategoryRow(row) {
    return !isCategoryPricingGroup(row) && !(0, modular_pricing_1.isModularItemPricingRow)(row) && !(0, modular_pricing_1.isModularMetaPricingRow)(row);
}
function groupedStandardCategoryPricingRows(rows) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const groups = sourceRows
        .filter((isCategoryPricingGroup))
        .map((group, index) => {
        const items = (Array.isArray(group.items) ? group.items : [])
            .filter((item) => Boolean(item) && typeof item === "object")
            .filter((item) => !(0, modular_pricing_1.isModularItemPricingRow)(item) && !(0, modular_pricing_1.isModularMetaPricingRow)(item))
            .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order))
            .map((item) => ({
            ...item,
            group_id: group.id ?? `finish-group-${index}`,
            group_name: group.group_name?.trim() || "Finish Category Pricing",
        }));
        const priceCategories = Array.from(new Set([
            ...((group.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
            ...items.flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean)),
        ]));
        return {
            id: group.id ?? `finish-group-${index}`,
            group_name: group.group_name?.trim() || "Finish Category Pricing",
            is_active: group.is_active !== false,
            sort_order: numberValue(group.sort_order ?? index),
            price_categories: priceCategories,
            items,
        };
    })
        .filter((group) => group.group_name || group.items.length);
    const flatRows = sourceRows
        .filter(isStandardCategoryRow)
        .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order))
        .map((item) => ({
        ...item,
        group_id: "finish-category-pricing",
        group_name: "Finish Category Pricing",
    }));
    if (flatRows.length) {
        groups.push({
            id: "finish-category-pricing",
            group_name: "Finish Category Pricing",
            is_active: true,
            sort_order: groups.length,
            price_categories: Array.from(new Set(flatRows.flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean)))),
            items: flatRows,
        });
    }
    return groups.sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}
function flattenStandardCategoryPricingRows(rows) {
    return groupedStandardCategoryPricingRows(rows)
        .flatMap((group) => group.items)
        .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}
function standardCategoryPriceColumns(rows) {
    const columns = [];
    groupedStandardCategoryPricingRows(rows).forEach((group) => {
        (group.price_categories ?? []).forEach((category) => {
            const normalized = normalizeCategoryPriceLabel(category);
            if (normalized && !columns.includes(normalized)) {
                columns.push(normalized);
            }
        });
        group.items.forEach((item) => {
            Object.keys(item.prices ?? {}).forEach((category) => {
                const normalized = normalizeCategoryPriceLabel(category);
                if (normalized && !columns.includes(normalized)) {
                    columns.push(normalized);
                }
            });
        });
    });
    return columns;
}
function countStandardCategoryPricingRows(rows) {
    return groupedStandardCategoryPricingRows(rows).reduce((count, group) => count + group.items.length, 0);
}
