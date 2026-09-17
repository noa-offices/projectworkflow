"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBaseModelPricingGroup = createBaseModelPricingGroup;
exports.updateBaseModelPricingGroup = updateBaseModelPricingGroup;
exports.removeBaseModelPricingGroup = removeBaseModelPricingGroup;
exports.addBaseModelPricingRow = addBaseModelPricingRow;
exports.updateBaseModelPricingRow = updateBaseModelPricingRow;
exports.removeBaseModelPricingRow = removeBaseModelPricingRow;
exports.replaceWholeTemplateBaseModelRows = replaceWholeTemplateBaseModelRows;
exports.replaceWholeTemplateBaseModelPricing = replaceWholeTemplateBaseModelPricing;
exports.shouldApplyBaseModelReplacement = shouldApplyBaseModelReplacement;
const base_model_pricing_groups_1 = require("./base-model-pricing-groups");
function createBaseModelPricingGroup(id, sortOrder, groupName = base_model_pricing_groups_1.LEGACY_BASE_MODEL_GROUP_NAME) {
    return { id, pricing_type: base_model_pricing_groups_1.BASE_MODEL_GROUP_PRICING_TYPE, group_name: groupName, is_active: true, sort_order: sortOrder, items: [] };
}
function updateBaseModelPricingGroup(groups, groupId, patch) {
    return groups.map((group) => group.id === groupId ? { ...group, ...patch } : group);
}
function removeBaseModelPricingGroup(groups, groupId) {
    return groups.filter((group) => group.id !== groupId);
}
function addBaseModelPricingRow(groups, groupId, row) {
    return groups.map((group) => group.id === groupId ? { ...group, items: [...group.items, row] } : group);
}
function updateBaseModelPricingRow(groups, groupId, rowIndex, patch) {
    return groups.map((group) => group.id === groupId
        ? { ...group, items: group.items.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) }
        : group);
}
function removeBaseModelPricingRow(groups, groupId, rowIndex) {
    return groups.map((group) => group.id === groupId
        ? (() => { const items = group.items.filter((_, index) => index !== rowIndex); const rowIds = new Set(items.flatMap((row) => typeof row.id === "string" ? [row.id] : [])); return { ...group, items, subgroups: group.subgroups?.map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => rowIds.has(id)) })) }; })()
        : group);
}
function replaceWholeTemplateBaseModelRows(groups, rows, replacementGroupId) {
    if (groups.length === 1) {
        const rowIds = new Set(rows.flatMap((row) => typeof row.id === "string" ? [row.id] : []));
        return [{ ...groups[0], items: rows, subgroups: groups[0].subgroups?.map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => rowIds.has(id)) })) }];
    }
    return [{ ...createBaseModelPricingGroup(replacementGroupId, 0), items: rows }];
}
function replaceWholeTemplateBaseModelPricing(groups, rows, additionalGroups, replacementGroupId) {
    if (!additionalGroups.length)
        return replaceWholeTemplateBaseModelRows(groups, rows, replacementGroupId);
    const flatGroups = rows.length ? replaceWholeTemplateBaseModelRows(groups, rows, replacementGroupId) : [];
    return [...flatGroups, ...additionalGroups];
}
function shouldApplyBaseModelReplacement(replacementVersion, appliedVersion) {
    return replacementVersion !== undefined && replacementVersion !== appliedVersion;
}
