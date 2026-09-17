"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESSORY_APPLICABILITY_TARGET_KINDS = exports.ACCESSORY_SELECTION_MODES = exports.ACCESSORY_CONFIGURATION_ROLES = void 0;
exports.resolveAccessoryApplicabilityTarget = resolveAccessoryApplicabilityTarget;
exports.accessoryApplicabilityTargetKey = accessoryApplicabilityTargetKey;
exports.parseAccessoryConfigurationGroups = parseAccessoryConfigurationGroups;
exports.serializeAccessoryConfigurationGroups = serializeAccessoryConfigurationGroups;
exports.evaluateAccessoryConfigurationForModel = evaluateAccessoryConfigurationForModel;
exports.ACCESSORY_CONFIGURATION_ROLES = ["accessory", "conditional_option", "companion"];
exports.ACCESSORY_SELECTION_MODES = ["unrestricted", "exactly_one", "at_least_one", "choose_multiple"];
exports.ACCESSORY_APPLICABILITY_TARGET_KINDS = ["base_model", "price_matrix", "modular", "workstation"];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function addIssue(issues, code, path, message) {
    issues.push({ code, path, message });
}
function resolveAccessoryApplicabilityTarget(rule) {
    if (rule.target && exports.ACCESSORY_APPLICABILITY_TARGET_KINDS.includes(rule.target.kind) && rule.target.group_id && rule.target.row_id) {
        return rule.target;
    }
    if (rule.base_model_group_id && rule.base_model_row_id) {
        return { kind: "base_model", group_id: rule.base_model_group_id, row_id: rule.base_model_row_id };
    }
    return null;
}
function accessoryApplicabilityTargetKey(target) {
    return `${target.kind}\u0000${target.group_id}\u0000${target.row_id}`;
}
function parseAccessoryConfigurationGroups(value) {
    const issues = [];
    if (!Array.isArray(value)) {
        addIssue(issues, "invalid_root", "accessory_pricing", "Accessory pricing must be an array.");
        return { groups: [], issues, valid: false };
    }
    const groups = value.flatMap((rawGroup, groupIndex) => {
        const path = `accessory_pricing[${groupIndex}]`;
        if (!isRecord(rawGroup)) {
            addIssue(issues, "invalid_group", path, "Accessory group must be an object.");
            return [];
        }
        const rawItems = rawGroup.items;
        const items = Array.isArray(rawItems)
            ? rawItems.flatMap((item, itemIndex) => {
                if (!isRecord(item)) {
                    addIssue(issues, "invalid_item", `${path}.items[${itemIndex}]`, "Accessory item must be an object.");
                    return [];
                }
                return [{ ...item }];
            })
            : [];
        if (rawItems !== undefined && !Array.isArray(rawItems)) {
            addIssue(issues, "invalid_items", `${path}.items`, "Accessory group items must be an array.");
        }
        const itemIdsForSubgroups = new Set(items.flatMap((item) => typeof item.id === "string" && item.id.trim() ? [item.id] : []));
        const assignedItemIds = new Set();
        const subgroups = Array.isArray(rawGroup.subgroups) ? rawGroup.subgroups.flatMap((rawSubgroup, subgroupIndex) => {
            const subgroupPath = `${path}.subgroups[${subgroupIndex}]`;
            if (!isRecord(rawSubgroup) || typeof rawSubgroup.id !== "string" || !rawSubgroup.id.trim() || typeof rawSubgroup.subgroup_name !== "string" || !Array.isArray(rawSubgroup.row_ids)) {
                addIssue(issues, "invalid_subgroup", subgroupPath, "Subgroup requires an ID, name, and member IDs.");
                return [];
            }
            const rowIds = rawSubgroup.row_ids.flatMap((value, memberIndex) => {
                if (typeof value !== "string" || !itemIdsForSubgroups.has(value)) {
                    addIssue(issues, "unknown_subgroup_member", `${subgroupPath}.row_ids[${memberIndex}]`, "Subgroup member must identify an item in its parent group.");
                    return [];
                }
                if (assignedItemIds.has(value)) {
                    addIssue(issues, "duplicate_subgroup_member", `${subgroupPath}.row_ids[${memberIndex}]`, "An item may belong to at most one subgroup.");
                    return [];
                }
                assignedItemIds.add(value);
                return [value];
            });
            return [{ id: rawSubgroup.id, subgroup_name: rawSubgroup.subgroup_name, sort_order: Number.isFinite(Number(rawSubgroup.sort_order)) ? Number(rawSubgroup.sort_order) : subgroupIndex, is_active: rawSubgroup.is_active !== false, row_ids: rowIds }];
        }) : [];
        if (rawGroup.subgroups !== undefined && !Array.isArray(rawGroup.subgroups))
            addIssue(issues, "invalid_subgroups", `${path}.subgroups`, "Subgroups must be an array.");
        const group = { ...rawGroup, ...(rawItems !== undefined ? { items } : {}), ...(rawGroup.subgroups !== undefined ? { subgroups } : {}) };
        const rawConfiguration = rawGroup.conditional_configuration;
        if (rawConfiguration === undefined)
            return [group];
        if (!isRecord(rawConfiguration)) {
            addIssue(issues, "malformed_configuration", `${path}.conditional_configuration`, "Conditional configuration must be an object.");
            return [group];
        }
        if (typeof rawGroup.id !== "string" || !rawGroup.id.trim()) {
            addIssue(issues, "missing_group_id", `${path}.id`, "A conditional accessory group requires a persisted group ID.");
        }
        const role = rawConfiguration.role;
        if (typeof role !== "string" || !exports.ACCESSORY_CONFIGURATION_ROLES.includes(role)) {
            addIssue(issues, "unknown_role", `${path}.conditional_configuration.role`, "Unknown accessory configuration role.");
        }
        const selection = rawConfiguration.selection;
        if (typeof selection !== "string" || !exports.ACCESSORY_SELECTION_MODES.includes(selection)) {
            addIssue(issues, "invalid_cardinality", `${path}.conditional_configuration.selection`, "Unknown accessory selection mode.");
        }
        const itemIds = new Set();
        items.forEach((item, itemIndex) => {
            const itemId = typeof item.id === "string" ? item.id.trim() : "";
            if (!itemId) {
                addIssue(issues, "missing_item_id", `${path}.items[${itemIndex}].id`, "Conditional accessory items require persisted IDs.");
            }
            else if (itemIds.has(itemId)) {
                addIssue(issues, "duplicate_item_id", `${path}.items[${itemIndex}].id`, `Accessory item ID '${itemId}' is duplicated.`);
            }
            else {
                itemIds.add(itemId);
            }
        });
        const rawRules = rawConfiguration.applicability;
        if (!Array.isArray(rawRules)) {
            addIssue(issues, "malformed_applicability", `${path}.conditional_configuration.applicability`, "Applicability must be an array.");
            return [group];
        }
        const ruleKeys = new Set();
        rawRules.forEach((rawRule, ruleIndex) => {
            const rulePath = `${path}.conditional_configuration.applicability[${ruleIndex}]`;
            if (!isRecord(rawRule)) {
                addIssue(issues, "malformed_rule", rulePath, "Applicability rule must be an object.");
                return;
            }
            const legacyGroupId = typeof rawRule.base_model_group_id === "string" ? rawRule.base_model_group_id.trim() : "";
            const legacyRowId = typeof rawRule.base_model_row_id === "string" ? rawRule.base_model_row_id.trim() : "";
            const rawTarget = rawRule.target;
            let target = null;
            if (rawTarget !== undefined) {
                if (!isRecord(rawTarget)) {
                    addIssue(issues, "malformed_applicability_target", `${rulePath}.target`, "Applicability target must be an object.");
                }
                else {
                    const kind = rawTarget.kind;
                    const groupId = typeof rawTarget.group_id === "string" ? rawTarget.group_id.trim() : "";
                    const rowId = typeof rawTarget.row_id === "string" ? rawTarget.row_id.trim() : "";
                    if (typeof kind !== "string" || !exports.ACCESSORY_APPLICABILITY_TARGET_KINDS.includes(kind))
                        addIssue(issues, "invalid_applicability_target_kind", `${rulePath}.target.kind`, "Applicability target kind must be Base/Model, Price Matrix, Modular, or Workstation.");
                    if (!groupId)
                        addIssue(issues, "missing_applicability_target_group_id", `${rulePath}.target.group_id`, "Applicability target group ID is required.");
                    if (!rowId)
                        addIssue(issues, "missing_applicability_target_row_id", `${rulePath}.target.row_id`, "Applicability target row ID is required.");
                    if (typeof kind === "string" && exports.ACCESSORY_APPLICABILITY_TARGET_KINDS.includes(kind) && groupId && rowId)
                        target = { kind: kind, group_id: groupId, row_id: rowId };
                }
            }
            else {
                if (!legacyGroupId)
                    addIssue(issues, "missing_base_model_group_id", `${rulePath}.base_model_group_id`, "Base/Model group ID is required.");
                if (!legacyRowId)
                    addIssue(issues, "missing_base_model_row_id", `${rulePath}.base_model_row_id`, "Base/Model row ID is required.");
                if (legacyGroupId && legacyRowId)
                    target = { kind: "base_model", group_id: legacyGroupId, row_id: legacyRowId };
            }
            if (target) {
                const ruleKey = accessoryApplicabilityTargetKey(target);
                if (ruleKeys.has(ruleKey))
                    addIssue(issues, "duplicate_applicability_rule", rulePath, "Only one applicability rule is allowed for the same pricing group and row.");
                ruleKeys.add(ruleKey);
            }
            if (typeof rawRule.required !== "boolean")
                addIssue(issues, "invalid_required", `${rulePath}.required`, "Required must be boolean.");
            if (typeof rawRule.visible !== "boolean")
                addIssue(issues, "invalid_visible", `${rulePath}.visible`, "Visible must be boolean.");
            if (rawRule.allowed_item_ids !== undefined) {
                if (!Array.isArray(rawRule.allowed_item_ids)) {
                    addIssue(issues, "invalid_allowed_item_ids", `${rulePath}.allowed_item_ids`, "Allowed item IDs must be an array.");
                }
                else {
                    const allowedIds = new Set();
                    rawRule.allowed_item_ids.forEach((allowedId, allowedIndex) => {
                        const id = typeof allowedId === "string" ? allowedId.trim() : "";
                        if (!id)
                            addIssue(issues, "invalid_allowed_item_id", `${rulePath}.allowed_item_ids[${allowedIndex}]`, "Allowed item ID must be non-empty text.");
                        else if (allowedIds.has(id))
                            addIssue(issues, "duplicate_allowed_item_id", `${rulePath}.allowed_item_ids[${allowedIndex}]`, `Allowed item ID '${id}' is duplicated.`);
                        else if (!itemIds.has(id))
                            addIssue(issues, "unknown_allowed_item_id", `${rulePath}.allowed_item_ids[${allowedIndex}]`, `Allowed item ID '${id}' does not exist in this group.`);
                        allowedIds.add(id);
                    });
                }
            }
            if (rawRule.fixed_quantity !== undefined && (!Number.isInteger(rawRule.fixed_quantity) || Number(rawRule.fixed_quantity) <= 0)) {
                addIssue(issues, "invalid_fixed_quantity", `${rulePath}.fixed_quantity`, "Fixed quantity must be a positive integer.");
            }
            const scaled = rawRule.scale_with_target_quantity === true;
            if (rawRule.scale_with_target_quantity !== undefined && typeof rawRule.scale_with_target_quantity !== "boolean") {
                addIssue(issues, "invalid_quantity_scaling", `${rulePath}.scale_with_target_quantity`, "Quantity scaling must be boolean.");
            }
            if (scaled && rawRule.fixed_quantity === undefined) {
                addIssue(issues, "invalid_quantity_scaling", `${rulePath}.scale_with_target_quantity`, "Quantity scaling requires a fixed quantity.");
            }
            if (scaled && target && target.kind !== "modular") {
                addIssue(issues, "invalid_quantity_scaling", `${rulePath}.scale_with_target_quantity`, "Quantity scaling is only supported for modular targets.");
            }
            if (scaled && selection === "exactly_one") {
                addIssue(issues, "invalid_cardinality", `${rulePath}.scale_with_target_quantity`, "Quantity scaling cannot be combined with exactly-one selection.");
            }
            if (selection === "exactly_one" && !scaled && rawRule.fixed_quantity !== undefined && rawRule.fixed_quantity !== 1) {
                addIssue(issues, "invalid_cardinality", `${rulePath}.fixed_quantity`, "Exactly-one selection requires a fixed quantity of one.");
            }
        });
        return [group];
    });
    return { groups, issues, valid: issues.length === 0 };
}
function serializeAccessoryConfigurationGroups(groups) {
    return groups.map((group) => ({
        ...group,
        ...(group.items ? { items: group.items.map((item) => ({ ...item })) } : {}),
        ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
        ...(group.conditional_configuration
            ? {
                conditional_configuration: {
                    ...group.conditional_configuration,
                    applicability: group.conditional_configuration.applicability.map((rule) => ({
                        ...rule,
                        ...(rule.allowed_item_ids ? { allowed_item_ids: [...rule.allowed_item_ids] } : {}),
                    })),
                },
            }
            : {}),
    }));
}
function groupFailure(groupId, role, staleItemIds, message) {
    return { allowedItemIds: [], fixedQuantity: null, groupId, maxSelections: null, minSelections: 0, required: false, role, selectedItemIds: [], selectedQuantity: 0, staleItemIds, valid: false, validationCode: "invalid_configuration", validationMessage: message, visible: false };
}
function evaluateAccessoryConfigurationForModel({ accessoryGroups, baseModelGroupId, baseModelRowId, selectedModelTarget, selectedModelTargets, selectedModelTargetQuantities, selectedQuantitiesByGroupId = {}, }) {
    const parsed = parseAccessoryConfigurationGroups(accessoryGroups);
    const groupedEntries = parsed.groups
        .map((group, sourceIndex) => ({ group, sourceIndex }))
        .filter(({ group }) => group.group_name !== undefined || group.items !== undefined);
    const legacyFlatItems = parsed.groups
        .filter((group) => group.group_name === undefined && group.items === undefined)
        .map((group) => ({ ...group }));
    if (legacyFlatItems.length) {
        groupedEntries.push({
            group: { id: "accessories", group_name: "Accessories", group_is_required: false, items: legacyFlatItems },
            sourceIndex: -1,
        });
    }
    const evaluations = groupedEntries.map(({ group, sourceIndex }, groupIndex) => {
        const groupId = typeof group.id === "string" && group.id ? group.id : `accessory-group-${groupIndex}`;
        const quantities = selectedQuantitiesByGroupId[groupId] ?? {};
        const selectedIds = Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([id]) => id);
        const groupIssues = sourceIndex < 0 ? [] : parsed.issues.filter((issue) => issue.path.startsWith(`accessory_pricing[${sourceIndex}]`));
        const configuration = group.conditional_configuration;
        const role = configuration && exports.ACCESSORY_CONFIGURATION_ROLES.includes(configuration.role) ? configuration.role : "accessory";
        if (groupIssues.length)
            return groupFailure(groupId, role, selectedIds, groupIssues[0].message);
        const allItemIds = (group.items ?? []).filter((item) => item.is_active !== false).map((item) => item.id).filter((id) => Boolean(id));
        const legacyTarget = selectedModelTarget ?? (baseModelGroupId && baseModelRowId
            ? { kind: "base_model", group_id: baseModelGroupId, row_id: baseModelRowId }
            : null);
        const targets = [...new Map([...(selectedModelTargets ?? []), ...(legacyTarget ? [legacyTarget] : [])].map((target) => [accessoryApplicabilityTargetKey(target), target])).values()];
        const targetKeys = new Set(targets.map(accessoryApplicabilityTargetKey));
        const matchingRules = configuration?.applicability.filter((rule) => {
            const target = resolveAccessoryApplicabilityTarget(rule);
            return target ? targetKeys.has(accessoryApplicabilityTargetKey(target)) : false;
        }) ?? [];
        const visibleRules = matchingRules.filter((rule) => rule.visible);
        const requiresMatchingRule = Boolean(configuration && (configuration.role !== "accessory" || configuration.applicability.length));
        const visible = group.is_active !== false && (!requiresMatchingRule || visibleRules.length > 0);
        const requiredRules = visibleRules.filter((rule) => rule.required);
        const required = visible && (matchingRules.length ? requiredRules.length > 0 : group.group_is_required === true);
        const allowedByRule = visibleRules.map((rule) => rule.allowed_item_ids === undefined ? allItemIds : allItemIds.filter((id) => rule.allowed_item_ids?.includes(id)));
        const allowedItemIds = visible
            ? visibleRules.length ? [...new Set(allowedByRule.flat())] : allItemIds
            : [];
        const allowedSet = new Set(allowedItemIds);
        const staleItemIds = selectedIds.filter((id) => !allowedSet.has(id));
        const eligibleSelections = selectedIds.filter((id) => allowedSet.has(id));
        const selectedQuantity = eligibleSelections.reduce((total, id) => total + Number(quantities[id]), 0);
        const selection = configuration?.selection ?? (group.group_is_required ? "at_least_one" : "unrestricted");
        const minSelections = required ? 1 : 0;
        const maxSelections = selection === "exactly_one" ? 1 : null;
        const scaledRules = visibleRules.filter((rule) => rule.scale_with_target_quantity === true && rule.fixed_quantity !== undefined);
        const staticFixedQuantities = [...new Set(visibleRules.flatMap((rule) => rule.scale_with_target_quantity === true || rule.fixed_quantity === undefined ? [] : [rule.fixed_quantity]))];
        // Scaled rules are additive across every selected modular row: Σ(fixed_quantity × selected row quantity).
        const scaledTotal = scaledRules.reduce((total, rule) => {
            const target = resolveAccessoryApplicabilityTarget(rule);
            const selectedUnits = target ? Number(selectedModelTargetQuantities?.[accessoryApplicabilityTargetKey(target)] ?? 1) : 1;
            const units = Number.isFinite(selectedUnits) && selectedUnits > 0 ? Math.trunc(selectedUnits) : 1;
            return total + Number(rule.fixed_quantity) * units;
        }, 0);
        const fixedQuantities = scaledRules.length ? [...staticFixedQuantities, scaledTotal] : staticFixedQuantities;
        const fixedQuantity = scaledRules.length
            ? (staticFixedQuantities.length ? null : scaledTotal)
            : fixedQuantities.length === 1 ? fixedQuantities[0] : null;
        const requiredAllowedSets = requiredRules.map((rule) => new Set(rule.allowed_item_ids === undefined ? allItemIds : allItemIds.filter((id) => rule.allowed_item_ids?.includes(id))));
        const requiredIntersection = requiredAllowedSets.length ? [...requiredAllowedSets[0]].filter((id) => requiredAllowedSets.every((set) => set.has(id))) : [];
        const incompatibleRequiredRules = selection === "exactly_one" && requiredAllowedSets.length > 1 && requiredIntersection.length === 0;
        const missingRequiredRule = requiredAllowedSets.some((set) => !eligibleSelections.some((id) => set.has(id)));
        let validationCode = null;
        let validationMessage = null;
        if (staleItemIds.length) {
            validationCode = "stale_selection";
            validationMessage = "One or more selected items are not applicable to the selected product configuration.";
        }
        else if (incompatibleRequiredRules) {
            validationCode = "conflicting_required_rules";
            validationMessage = "Selected product rows require incompatible exactly-one accessory choices.";
        }
        else if (fixedQuantities.length > 1) {
            validationCode = "conflicting_fixed_quantity";
            validationMessage = "Selected product rows require conflicting fixed quantities for this accessory group.";
        }
        else if (eligibleSelections.length < minSelections || missingRequiredRule) {
            validationCode = "required_selection_missing";
            validationMessage = "Select the required applicable item for every selected product row.";
        }
        else if (maxSelections !== null && eligibleSelections.length > maxSelections) {
            validationCode = "too_many_selections";
            validationMessage = "Select no more than one item from this group.";
        }
        else if (selection === "exactly_one" && eligibleSelections.length === 1 && selectedQuantity !== 1) {
            validationCode = "invalid_exact_quantity";
            validationMessage = "Exactly-one selection requires one physical unit.";
        }
        else if (fixedQuantity !== null && (eligibleSelections.length > 0 || required) && selectedQuantity !== fixedQuantity) {
            validationCode = "fixed_quantity_mismatch";
            validationMessage = `Selected quantity must equal ${fixedQuantity}.`;
        }
        return { allowedItemIds, fixedQuantity, groupId, maxSelections, minSelections, required, role, selectedItemIds: eligibleSelections, selectedQuantity, staleItemIds, valid: validationCode === null, validationCode, validationMessage, visible };
    });
    const blockingRequirements = evaluations.filter((group) => !group.valid).map((group) => ({ code: group.validationCode ?? "invalid", groupId: group.groupId, message: group.validationMessage ?? "Invalid accessory configuration." }));
    return { blockingRequirements, groups: evaluations, issues: parsed.issues, valid: parsed.valid && blockingRequirements.length === 0 };
}
