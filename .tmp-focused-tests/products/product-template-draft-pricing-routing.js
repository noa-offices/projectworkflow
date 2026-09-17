"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyDraftPriceMatrix = classifyDraftPriceMatrix;
exports.directMatrixRowPrice = directMatrixRowPrice;
exports.routeDraftPriceMatrices = routeDraftPriceMatrices;
const directPriceLabel = /^(?:(?:direct|list|net|selling|source|unit|standard)\s+)?price(?:\s*\([^)]*\))?$|^(?:AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR)(?:\s+price)?$/i;
const categoryColumnLabel = /\b(?:COM|customer'?s? own material|fabric|leather|upholstery|finish|material|category|grade|cat\s*[a-z0-9])\b/i;
const companionContext = /\b(?:service|support)\s+units?\b|\bcompanion\b|\bmust be completed with\b|\badd[- ]on component\b/i;
function matrixName(matrix) {
    return matrix.label ?? matrix.id;
}
function classifyDraftPriceMatrix(matrix) {
    const name = matrixName(matrix);
    const familyContext = [matrix.label, ...matrix.rows.flatMap((row) => [row.label, row.displayName])].filter(Boolean).join(" ");
    if (companionContext.test(familyContext)) {
        return { kind: "companion", matrix, warning: null };
    }
    if (matrix.columns.length !== 1 || !matrix.rows.length) {
        return { kind: "category_matrix", matrix, warning: null };
    }
    const column = matrix.columns[0];
    const columnLabel = column.label ?? column.id;
    const hasDirectPriceSemantics = directPriceLabel.test(columnLabel) && !categoryColumnLabel.test(columnLabel);
    const rowsLookLikeModels = matrix.rows.every((row) => Boolean(row.label || row.displayName) &&
        row.supplierCodes.length + row.referenceCodes.length > 0 &&
        directMatrixRowPrice(row, column) !== undefined &&
        Object.entries(row.prices).every(([priceColumnId, price]) => priceColumnId === column.id || price === null));
    if (hasDirectPriceSemantics && rowsLookLikeModels) {
        return { kind: "base_model", matrix, warning: null };
    }
    return { kind: "category_matrix", matrix, warning: `One-column price matrix '${name}' was preserved as Category / Matrix Pricing because direct model-price routing could not be confirmed safely.` };
}
function directMatrixRowPrice(row, column) {
    if (Object.prototype.hasOwnProperty.call(row.prices, column.id))
        return row.prices[column.id];
    const entries = Object.entries(row.prices);
    return entries.length === 1 ? entries[0][1] : undefined;
}
function routeDraftPriceMatrices(draft, overrides = {}) {
    const routes = draft.pricing.priceMatrices.map((matrix) => overrides[matrix.id] ? { ...classifyDraftPriceMatrix(matrix), kind: overrides[matrix.id] } : classifyDraftPriceMatrix(matrix));
    return { routes, warnings: routes.flatMap((route) => route.warning ? [route.warning] : []) };
}
