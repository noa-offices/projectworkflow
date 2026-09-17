"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkstationPricingContractError = exports.LEGACY_WORKSTATION_GROUP_NAME = exports.LEGACY_WORKSTATION_GROUP_ID = exports.WORKSTATION_GROUP_PRICING_TYPE = void 0;
exports.isWorkstationPricingGroupRecord = isWorkstationPricingGroupRecord;
exports.workstationPricingRowId = workstationPricingRowId;
exports.normalizeWorkstationPricing = normalizeWorkstationPricing;
exports.workstationPricingGroups = workstationPricingGroups;
exports.flattenWorkstationPricingRows = flattenWorkstationPricingRows;
exports.findWorkstationPricingRow = findWorkstationPricingRow;
exports.serializeWorkstationPricingGroups = serializeWorkstationPricingGroups;
exports.hasMeaningfulWorkstationPricingData = hasMeaningfulWorkstationPricingData;
exports.hasExplicitWorkstationPricingGroupStructure = hasExplicitWorkstationPricingGroupStructure;
const workstation_pricing_state_1 = require("./workstation-pricing-state");
exports.WORKSTATION_GROUP_PRICING_TYPE = "workstation_group";
exports.LEGACY_WORKSTATION_GROUP_ID = "legacy-workstation-main";
exports.LEGACY_WORKSTATION_GROUP_NAME = "Workstation Pricing";
class WorkstationPricingContractError extends Error {
    issues;
    constructor(issues) {
        super(issues.map((issue) => issue.message).join(" ") || "Workstation pricing data is invalid.");
        this.name = "WorkstationPricingContractError";
        this.issues = issues;
    }
}
exports.WorkstationPricingContractError = WorkstationPricingContractError;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function cloneRow(row) {
    return { ...row };
}
function isWorkstationPricingGroupRecord(value) {
    return isRecord(value) && value.pricing_type === exports.WORKSTATION_GROUP_PRICING_TYPE;
}
function workstationPricingRowId(row, fallbackIndex) {
    return typeof row.id === "string" && row.id ? row.id : `size-${fallbackIndex}`;
}
function normalizeWorkstationPricing(input) {
    if (!Array.isArray(input)) {
        return {
            groups: [],
            issues: [{
                    code: "invalid_root",
                    message: "Workstation pricing must use an array root.",
                    path: "desking_size_pricing",
                }],
            sourceKind: "invalid",
        };
    }
    if (!input.length)
        return { groups: [], issues: [], sourceKind: "empty" };
    const issues = [];
    const explicitGroups = [];
    const legacyRows = [];
    const explicitGroupIds = new Set();
    input.forEach((entry, entryIndex) => {
        const path = `desking_size_pricing[${entryIndex}]`;
        if (!isRecord(entry)) {
            issues.push({
                code: "invalid_root_record",
                message: `Workstation pricing entry ${entryIndex + 1} must be an object.`,
                path,
            });
            return;
        }
        if (!isWorkstationPricingGroupRecord(entry)) {
            if (typeof entry.pricing_type === "string" && entry.pricing_type) {
                issues.push({
                    code: "unsupported_pricing_type",
                    message: `Workstation pricing entry ${entryIndex + 1} has an unsupported pricing type.`,
                    path: `${path}.pricing_type`,
                });
                return;
            }
            legacyRows.push(cloneRow(entry));
            return;
        }
        const groupId = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!groupId) {
            issues.push({
                code: "invalid_group_id",
                message: `Workstation pricing group ${entryIndex + 1} requires a stable id.`,
                path: `${path}.id`,
            });
        }
        else if (explicitGroupIds.has(groupId)) {
            issues.push({
                code: "duplicate_group_id",
                message: `Workstation pricing group id '${groupId}' is duplicated.`,
                path: `${path}.id`,
            });
        }
        else {
            explicitGroupIds.add(groupId);
        }
        if (!Array.isArray(entry.items)) {
            issues.push({
                code: "invalid_group_items",
                message: `Workstation pricing group '${groupId || entryIndex + 1}' must contain an items array.`,
                path: `${path}.items`,
            });
        }
        const items = (Array.isArray(entry.items) ? entry.items : []).flatMap((item, itemIndex) => {
            if (!isRecord(item) || isWorkstationPricingGroupRecord(item)) {
                issues.push({
                    code: "invalid_group_row",
                    message: `Workstation pricing group '${groupId || entryIndex + 1}' contains an invalid row.`,
                    path: `${path}.items[${itemIndex}]`,
                });
                return [];
            }
            return [cloneRow(item)];
        });
        explicitGroups.push({
            id: groupId,
            pricing_type: exports.WORKSTATION_GROUP_PRICING_TYPE,
            group_name: typeof entry.group_name === "string" && entry.group_name.trim()
                ? entry.group_name
                : exports.LEGACY_WORKSTATION_GROUP_NAME,
            is_active: entry.is_active !== false,
            sort_order: finiteNumber(entry.sort_order, entryIndex),
            items,
            ...(Array.isArray(entry.subgroups) ? { subgroups: entry.subgroups.flatMap((subgroup) => isRecord(subgroup) && typeof subgroup.id === "string" && typeof subgroup.subgroup_name === "string" && Array.isArray(subgroup.row_ids) ? [{ id: subgroup.id, subgroup_name: subgroup.subgroup_name, sort_order: finiteNumber(subgroup.sort_order, 0), is_active: subgroup.is_active !== false, row_ids: subgroup.row_ids.filter((id) => typeof id === "string") }] : []) } : {}),
            isSyntheticLegacyGroup: false,
        });
    });
    if (legacyRows.length && explicitGroupIds.has(exports.LEGACY_WORKSTATION_GROUP_ID)) {
        issues.push({
            code: "duplicate_group_id",
            message: `Workstation pricing group id '${exports.LEGACY_WORKSTATION_GROUP_ID}' conflicts with the synthesized legacy group.`,
            path: "desking_size_pricing",
        });
    }
    const groups = legacyRows.length
        ? [{
                id: exports.LEGACY_WORKSTATION_GROUP_ID,
                pricing_type: exports.WORKSTATION_GROUP_PRICING_TYPE,
                group_name: exports.LEGACY_WORKSTATION_GROUP_NAME,
                is_active: true,
                sort_order: 0,
                items: legacyRows,
                isSyntheticLegacyGroup: true,
            }, ...explicitGroups]
        : explicitGroups;
    const sourceKind = issues.length && !groups.length
        ? "invalid"
        : legacyRows.length && explicitGroups.length
            ? "mixed"
            : legacyRows.length
                ? "legacy"
                : "grouped";
    return { groups, issues, sourceKind };
}
function validWorkstationPricing(input) {
    const normalized = normalizeWorkstationPricing(input);
    if (normalized.issues.length)
        throw new WorkstationPricingContractError(normalized.issues);
    return normalized;
}
function workstationPricingGroups(input) {
    return validWorkstationPricing(input).groups;
}
function flattenWorkstationPricingRows(input, options = {}) {
    return validWorkstationPricing(input).groups
        .filter((group) => !options.activeGroupsOnly || group.is_active)
        .flatMap((group) => group.items.map(cloneRow));
}
function findWorkstationPricingRow(input, selection) {
    const groupId = selection.groupId?.trim();
    const groups = validWorkstationPricing(input).groups.filter((group) => group.is_active && (!groupId || group.id === groupId));
    const rowId = selection.rowId?.trim();
    if (rowId) {
        const matches = groups.flatMap((group) => group.items.flatMap((row, index) => {
            const effectiveRow = row.id ? row : { ...row, id: `${group.id}-size-${index}` };
            return effectiveRow.is_active !== false && effectiveRow.id === rowId ? [{ group, row: effectiveRow }] : [];
        }));
        return matches.length === 1 ? { ...matches[0], matchedBy: "id" } : null;
    }
    const legacyLabel = selection.legacyLabel?.trim();
    if (!legacyLabel)
        return null;
    const matches = groups.flatMap((group) => group.items.flatMap((row) => (row.is_active !== false && typeof row.label === "string" && row.label.trim() === legacyLabel
        ? [{ group, row }]
        : [])));
    return matches.length === 1 ? { ...matches[0], matchedBy: "label" } : null;
}
function serializeWorkstationPricingGroups(groups) {
    const normalized = validWorkstationPricing(groups);
    return normalized.groups.map((group) => ({
        id: group.id,
        pricing_type: exports.WORKSTATION_GROUP_PRICING_TYPE,
        group_name: group.group_name,
        is_active: group.is_active,
        sort_order: group.sort_order,
        items: group.items.map(cloneRow),
        ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
    }));
}
function hasMeaningfulWorkstationPricingData(input) {
    return (0, workstation_pricing_state_1.hasMeaningfulWorkstationPricing)(flattenWorkstationPricingRows(input));
}
function hasExplicitWorkstationPricingGroupStructure(input) {
    return validWorkstationPricing(input).groups.some((group) => !group.isSyntheticLegacyGroup);
}
