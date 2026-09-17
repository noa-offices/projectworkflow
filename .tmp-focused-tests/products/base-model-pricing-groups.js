"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBaseModelPricingGroups = exports.BaseModelPricingContractError = exports.LEGACY_BASE_MODEL_GROUP_NAME = exports.LEGACY_BASE_MODEL_GROUP_ID = exports.BASE_MODEL_GROUP_PRICING_TYPE = void 0;
exports.isBaseModelPricingGroupRecord = isBaseModelPricingGroupRecord;
exports.normalizeBaseModelPricing = normalizeBaseModelPricing;
exports.baseModelPricingGroups = baseModelPricingGroups;
exports.flattenBaseModelPricingRows = flattenBaseModelPricingRows;
exports.serializeBaseModelPricingGroups = serializeBaseModelPricingGroups;
exports.hasMeaningfulBaseModelPricingData = hasMeaningfulBaseModelPricingData;
exports.hasExplicitBaseModelPricingGroupStructure = hasExplicitBaseModelPricingGroupStructure;
const base_model_pricing_state_1 = require("./base-model-pricing-state");
exports.BASE_MODEL_GROUP_PRICING_TYPE = "base_model_group";
exports.LEGACY_BASE_MODEL_GROUP_ID = "legacy-base-model-main";
exports.LEGACY_BASE_MODEL_GROUP_NAME = "Base / Model Pricing";
class BaseModelPricingContractError extends Error {
    issues;
    constructor(issues) {
        super(issues.map((issue) => issue.message).join(" ") || "Base / Model pricing data is invalid.");
        this.name = "BaseModelPricingContractError";
        this.issues = issues;
    }
}
exports.BaseModelPricingContractError = BaseModelPricingContractError;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneRow(row) {
    return { ...row };
}
function validOptionalString(value) {
    return value === undefined || typeof value === "string";
}
function rowValueIssue(row) {
    const stringFields = [
        "id", "variant_name", "display_name", "supplier_price_list_code",
        "dimension", "currency", "specification",
    ];
    if (stringFields.some((field) => !validOptionalString(row[field])))
        return true;
    if (row.price !== undefined && row.price !== null && (typeof row.price !== "number" || !Number.isFinite(row.price)))
        return true;
    if (row.is_active !== undefined && typeof row.is_active !== "boolean")
        return true;
    if (row.sort_order !== undefined && (typeof row.sort_order !== "number" || !Number.isFinite(row.sort_order)))
        return true;
    return false;
}
function normalizedSubgroups(value, rowIds, path, issues) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        issues.push({ code: "invalid_subgroup", message: "Base / Model pricing subgroups must use an array.", path });
        return [];
    }
    const subgroupIds = new Set();
    const assignedRows = new Set();
    return value.flatMap((entry, index) => {
        const subgroupPath = `${path}[${index}]`;
        if (!isRecord(entry)) {
            issues.push({ code: "invalid_subgroup", message: "Base / Model pricing contains an invalid subgroup.", path: subgroupPath });
            return [];
        }
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id || typeof entry.subgroup_name !== "string" || typeof entry.sort_order !== "number" || !Number.isFinite(entry.sort_order) || typeof entry.is_active !== "boolean" || !Array.isArray(entry.row_ids) || entry.row_ids.some((rowId) => typeof rowId !== "string" || !rowId)) {
            issues.push({ code: "invalid_subgroup", message: "Base / Model pricing contains malformed subgroup metadata.", path: subgroupPath });
            return [];
        }
        if (subgroupIds.has(id)) {
            issues.push({ code: "duplicate_subgroup_id", message: `Base / Model subgroup id '${id}' is duplicated.`, path: `${subgroupPath}.id` });
            return [];
        }
        subgroupIds.add(id);
        const rowIdsForSubgroup = [];
        for (const rowId of entry.row_ids) {
            if (!rowIds.has(rowId)) {
                issues.push({ code: "unknown_subgroup_row", message: `Base / Model subgroup '${entry.subgroup_name}' references a row that does not exist in its parent group.`, path: `${subgroupPath}.row_ids` });
                continue;
            }
            if (assignedRows.has(rowId)) {
                issues.push({ code: "duplicate_subgroup_membership", message: `Base / Model row '${rowId}' belongs to more than one subgroup.`, path: `${subgroupPath}.row_ids` });
                continue;
            }
            assignedRows.add(rowId);
            rowIdsForSubgroup.push(rowId);
        }
        return [{ id, subgroup_name: entry.subgroup_name, sort_order: entry.sort_order, is_active: entry.is_active, row_ids: rowIdsForSubgroup }];
    });
}
function isBaseModelPricingGroupRecord(value) {
    return isRecord(value) && value.pricing_type === exports.BASE_MODEL_GROUP_PRICING_TYPE;
}
function normalizeBaseModelPricing(input) {
    if (!Array.isArray(input)) {
        return {
            groups: [],
            issues: [{ code: "invalid_root", message: "Base / Model pricing must use an array root.", path: "variant_pricing" }],
            sourceKind: "invalid",
        };
    }
    if (!input.length)
        return { groups: [], issues: [], sourceKind: "empty" };
    const issues = [];
    const explicitGroups = [];
    const legacyRows = [];
    const explicitGroupIds = new Set();
    const addRow = (value, path, target) => {
        if (!isRecord(value) || isBaseModelPricingGroupRecord(value) ||
            (typeof value.pricing_type === "string" && Boolean(value.pricing_type))) {
            issues.push({ code: "invalid_group_row", message: "Base / Model pricing contains an invalid row.", path });
            return;
        }
        if (rowValueIssue(value)) {
            issues.push({ code: "invalid_row_value", message: "Base / Model pricing contains a malformed row value.", path });
            return;
        }
        target.push(cloneRow(value));
    };
    input.forEach((entry, entryIndex) => {
        const path = `variant_pricing[${entryIndex}]`;
        if (!isRecord(entry)) {
            issues.push({ code: "invalid_root_record", message: `Base / Model pricing entry ${entryIndex + 1} must be an object.`, path });
            return;
        }
        if (!isBaseModelPricingGroupRecord(entry)) {
            if (typeof entry.pricing_type === "string" && entry.pricing_type) {
                issues.push({ code: "unsupported_pricing_type", message: `Base / Model pricing entry ${entryIndex + 1} has an unsupported pricing type.`, path: `${path}.pricing_type` });
                return;
            }
            addRow(entry, path, legacyRows);
            return;
        }
        const groupId = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!groupId) {
            issues.push({ code: "invalid_group_id", message: `Base / Model pricing group ${entryIndex + 1} requires a stable id.`, path: `${path}.id` });
        }
        else if (explicitGroupIds.has(groupId)) {
            issues.push({ code: "duplicate_group_id", message: `Base / Model pricing group id '${groupId}' is duplicated.`, path: `${path}.id` });
        }
        else {
            explicitGroupIds.add(groupId);
        }
        if (!Array.isArray(entry.items)) {
            issues.push({ code: "invalid_group_items", message: `Base / Model pricing group '${groupId || entryIndex + 1}' must contain an items array.`, path: `${path}.items` });
        }
        if (typeof entry.group_name !== "string" || typeof entry.is_active !== "boolean" ||
            typeof entry.sort_order !== "number" || !Number.isFinite(entry.sort_order)) {
            issues.push({ code: "invalid_group_metadata", message: `Base / Model pricing group '${groupId || entryIndex + 1}' has invalid metadata.`, path });
        }
        const items = [];
        if (Array.isArray(entry.items))
            entry.items.forEach((item, itemIndex) => addRow(item, `${path}.items[${itemIndex}]`, items));
        const rowIds = new Set(items.flatMap((item) => typeof item.id === "string" && item.id ? [item.id] : []));
        const subgroups = normalizedSubgroups(entry.subgroups, rowIds, `${path}.subgroups`, issues);
        explicitGroups.push({
            id: groupId,
            pricing_type: exports.BASE_MODEL_GROUP_PRICING_TYPE,
            group_name: typeof entry.group_name === "string" ? entry.group_name : exports.LEGACY_BASE_MODEL_GROUP_NAME,
            is_active: entry.is_active !== false,
            sort_order: typeof entry.sort_order === "number" && Number.isFinite(entry.sort_order) ? entry.sort_order : entryIndex,
            items,
            ...(subgroups.length ? { subgroups } : {}),
            isSyntheticLegacyGroup: false,
        });
    });
    if (legacyRows.length && explicitGroupIds.has(exports.LEGACY_BASE_MODEL_GROUP_ID)) {
        issues.push({
            code: "duplicate_group_id",
            message: `Base / Model pricing group id '${exports.LEGACY_BASE_MODEL_GROUP_ID}' conflicts with the synthesized legacy group.`,
            path: "variant_pricing",
        });
    }
    const groups = legacyRows.length
        ? [{
                id: exports.LEGACY_BASE_MODEL_GROUP_ID,
                pricing_type: exports.BASE_MODEL_GROUP_PRICING_TYPE,
                group_name: exports.LEGACY_BASE_MODEL_GROUP_NAME,
                is_active: true,
                sort_order: 0,
                items: legacyRows,
                isSyntheticLegacyGroup: true,
            }, ...explicitGroups]
        : explicitGroups;
    const sourceKind = issues.length && !groups.length ? "invalid"
        : legacyRows.length && explicitGroups.length ? "mixed"
            : legacyRows.length ? "legacy" : "grouped";
    return { groups, issues, sourceKind };
}
exports.normalizeBaseModelPricingGroups = normalizeBaseModelPricing;
function validBaseModelPricing(input) {
    const normalized = normalizeBaseModelPricing(input);
    if (normalized.issues.length)
        throw new BaseModelPricingContractError(normalized.issues);
    return normalized;
}
function baseModelPricingGroups(input) {
    return validBaseModelPricing(input).groups;
}
function flattenBaseModelPricingRows(input, options = {}) {
    return validBaseModelPricing(input).groups
        .filter((group) => !options.activeGroupsOnly || group.is_active)
        .flatMap((group) => group.items.map(cloneRow));
}
function serializeBaseModelPricingGroups(groups) {
    const normalized = validBaseModelPricing(groups);
    return normalized.groups.map((group) => ({
        id: group.id,
        pricing_type: exports.BASE_MODEL_GROUP_PRICING_TYPE,
        group_name: group.group_name,
        is_active: group.is_active,
        sort_order: group.sort_order,
        items: group.items.map(cloneRow),
        ...(group.subgroups?.length ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
    }));
}
function hasMeaningfulBaseModelPricingData(input) {
    return (0, base_model_pricing_state_1.hasMeaningfulBaseModelPricing)(flattenBaseModelPricingRows(input));
}
function hasExplicitBaseModelPricingGroupStructure(input) {
    return validBaseModelPricing(input).groups.some((group) => !group.isSyntheticLegacyGroup);
}
