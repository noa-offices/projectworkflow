"use strict";
/**
 * Canonical, provider-independent import contract for future Product Template
 * review flows. This module is intentionally in-memory only: it does not map
 * to the current database payload or alter existing save behaviour.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProductTemplateDraft = exports.PRODUCT_TEMPLATE_DRAFT_MODULAR_ROLES = exports.PRODUCT_TEMPLATE_DRAFT_VERSION = void 0;
exports.isDirectModularGroup = isDirectModularGroup;
exports.draftModularColumns = draftModularColumns;
exports.draftModularRows = draftModularRows;
exports.normalizeProductTemplateDraft = normalizeProductTemplateDraft;
const accessory_conditional_configuration_1 = require("./accessory-conditional-configuration");
exports.PRODUCT_TEMPLATE_DRAFT_VERSION = 1;
const supportedCurrencies = new Set([
    "AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR",
]);
exports.PRODUCT_TEMPLATE_DRAFT_MODULAR_ROLES = ["starter", "intermediate", "terminal"];
/** True when the group prices rows by one direct scalar price instead of category columns. */
function isDirectModularGroup(group) {
    return group.pricingMode === "direct" || (!group.matrix && Array.isArray(group.directRows));
}
/** Category columns for a modular group; always empty for a direct-priced group. */
function draftModularColumns(group) {
    return isDirectModularGroup(group) ? [] : group.matrix?.columns ?? [];
}
/** Every priced row of a modular group, regardless of pricing mode. */
function draftModularRows(group) {
    return isDirectModularGroup(group) ? group.directRows ?? [] : group.matrix?.rows ?? [];
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function error(issues, path, message) {
    issues.errors.push({ path, message });
}
function warning(issues, path, message) {
    issues.warnings.push({ path, message });
}
function nullableText(value, path, issues) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string") {
        error(issues, path, "Expected text or null.");
        return null;
    }
    return value.trim() || null;
}
function requiredId(value, path, issues) {
    const id = nullableText(value, path, issues);
    if (!id)
        error(issues, path, "A stable non-empty id is required.");
    return id ?? "";
}
function nullableFiniteNumber(value, path, issues) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        error(issues, path, "Expected a finite number or null.");
        return null;
    }
    return value;
}
function price(value, path, issues) {
    const normalized = nullableFiniteNumber(value, path, issues);
    if (value === "") {
        warning(issues, path, "Empty price was normalized to unknown (null).");
    }
    return normalized;
}
function currency(value, path, issues) {
    const text = nullableText(value, path, issues);
    if (!text)
        return null;
    const normalized = text.toUpperCase();
    if (!supportedCurrencies.has(normalized)) {
        error(issues, path, "Unsupported currency code.");
        return null;
    }
    return normalized;
}
function array(value, path, issues) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        error(issues, path, "Expected an array.");
        return [];
    }
    return value;
}
function object(value, path, issues) {
    if (value === undefined || value === null)
        return {};
    if (!isRecord(value)) {
        error(issues, path, "Expected an object.");
        return {};
    }
    return value;
}
function requiredObject(value, path, issues) {
    if (!isRecord(value)) {
        error(issues, path, "Expected an object.");
        return {};
    }
    return value;
}
function uniqueIds(ids, path, issues) {
    const seen = new Set();
    ids.forEach((id, index) => {
        if (!id || seen.has(id))
            error(issues, `${path}[${index}].id`, "Duplicate stable id.");
        seen.add(id);
    });
}
function codeList(value, path, issues) {
    const values = array(value, path, issues);
    const codes = [];
    const seen = new Set();
    values.forEach((item, index) => {
        const code = nullableText(item, `${path}[${index}]`, issues);
        if (!code)
            return;
        if (!seen.has(code)) {
            seen.add(code);
            codes.push(code);
        }
    });
    return codes;
}
function references(value, path, issues) {
    return {
        supplierCodes: codeList(value.supplierCodes, `${path}.supplierCodes`, issues),
        referenceCodes: codeList(value.referenceCodes, `${path}.referenceCodes`, issues),
    };
}
function importantRequirements(value, path, issues) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value)) {
        warning(issues, path, "Expected an array.");
        return undefined;
    }
    const requirements = [];
    value.forEach((item, index) => {
        if (typeof item !== "string") {
            warning(issues, `${path}[${index}]`, "Expected a string.");
            return;
        }
        const trimmed = item.trim();
        if (trimmed && !requirements.includes(trimmed))
            requirements.push(trimmed);
    });
    return requirements;
}
function dimensions(value, path, issues) {
    if (value === undefined || value === null)
        return null;
    const source = object(value, path, issues);
    const result = {
        width: nullableFiniteNumber(source.width, `${path}.width`, issues),
        depth: nullableFiniteNumber(source.depth, `${path}.depth`, issues),
        height: nullableFiniteNumber(source.height, `${path}.height`, issues),
        diameter: nullableFiniteNumber(source.diameter, `${path}.diameter`, issues),
        unit: nullableText(source.unit, `${path}.unit`, issues),
        rawText: nullableText(source.rawText, `${path}.rawText`, issues),
    };
    ["width", "depth", "height", "diameter"].forEach((field) => {
        if (result[field] !== null && result[field] < 0) {
            error(issues, `${path}.${field}`, "Dimensions cannot be negative.");
        }
    });
    return Object.values(result).some((entry) => entry !== null) ? result : null;
}
function pricedRow(value, path, issues) {
    const source = object(value, path, issues);
    const requirements = importantRequirements(source.importantRequirements, `${path}.importantRequirements`, issues);
    return {
        id: requiredId(source.id, `${path}.id`, issues),
        label: nullableText(source.label, `${path}.label`, issues),
        displayName: nullableText(source.displayName, `${path}.displayName`, issues),
        dimensions: dimensions(source.dimensions, `${path}.dimensions`, issues),
        currency: currency(source.currency, `${path}.currency`, issues),
        price: price(source.price, `${path}.price`, issues),
        specification: nullableText(source.specification, `${path}.specification`, issues),
        ...(requirements?.length ? { importantRequirements: requirements } : {}),
        ...references(source, path, issues),
    };
}
function matrix(value, path, issues) {
    const source = requiredObject(value, path, issues);
    const columns = array(source.columns, `${path}.columns`, issues).map((column, index) => {
        const item = object(column, `${path}.columns[${index}]`, issues);
        return {
            id: requiredId(item.id, `${path}.columns[${index}].id`, issues),
            label: nullableText(item.label, `${path}.columns[${index}].label`, issues),
        };
    });
    uniqueIds(columns.map((column) => column.id), `${path}.columns`, issues);
    if (!columns.length)
        error(issues, `${path}.columns`, "A price matrix needs at least one column.");
    const columnIds = new Set(columns.map((column) => column.id));
    const rows = array(source.rows, `${path}.rows`, issues).map((row, index) => {
        const item = object(row, `${path}.rows[${index}]`, issues);
        const values = object(item.prices, `${path}.rows[${index}].prices`, issues);
        const prices = {};
        Object.entries(values).forEach(([columnId, value]) => {
            if (!columnIds.has(columnId))
                error(issues, `${path}.rows[${index}].prices.${columnId}`, "Unknown matrix column id.");
            prices[columnId] = price(value, `${path}.rows[${index}].prices.${columnId}`, issues);
        });
        columns.forEach((column) => {
            if (!(column.id in prices))
                error(issues, `${path}.rows[${index}].prices.${column.id}`, "Missing matrix price cell.");
        });
        const unavailableCategoryIds = codeList(item.unavailableCategoryIds, `${path}.rows[${index}].unavailableCategoryIds`, issues).filter((columnId) => {
            if (columnIds.has(columnId))
                return true;
            error(issues, `${path}.rows[${index}].unavailableCategoryIds`, `Unknown matrix column id '${columnId}'.`);
            return false;
        });
        const base = pricedRow({ ...item, price: null }, `${path}.rows[${index}]`, issues);
        return { ...base, prices, unavailableCategoryIds };
    });
    uniqueIds(rows.map((row) => row.id), `${path}.rows`, issues);
    return {
        id: requiredId(source.id, `${path}.id`, issues),
        label: nullableText(source.label, `${path}.label`, issues),
        columns,
        rows,
    };
}
function selection(value, itemIds, path, issues) {
    const source = requiredObject(value, path, issues);
    const mode = nullableText(source.mode, `${path}.mode`, issues);
    const allowedModes = [
        "optional", "choose_one", "choose_multiple", "required_choose_one", "required_choose_at_least_one",
    ];
    if (!mode || !allowedModes.includes(mode))
        error(issues, `${path}.mode`, "Unsupported selection mode.");
    const minSelections = nullableFiniteNumber(source.minSelections, `${path}.minSelections`, issues);
    const maxSelections = nullableFiniteNumber(source.maxSelections, `${path}.maxSelections`, issues);
    const min = minSelections ?? 0;
    const max = maxSelections;
    if (!Number.isInteger(min) || min < 0)
        error(issues, `${path}.minSelections`, "Must be a non-negative integer.");
    if (max !== null && (!Number.isInteger(max) || max < 0))
        error(issues, `${path}.maxSelections`, "Must be a non-negative integer or null.");
    if (max !== null && min > max)
        error(issues, path, "Minimum selections cannot exceed maximum selections.");
    if (mode === "optional" && min !== 0)
        error(issues, path, "Optional groups must have a minimum of zero.");
    if (mode === "choose_one" && (min !== 0 || max !== 1))
        error(issues, path, "Choose one requires min 0 and max 1.");
    if (mode === "required_choose_one" && (min !== 1 || max !== 1))
        error(issues, path, "Required choose one requires min and max of 1.");
    if (mode === "required_choose_at_least_one" && min < 1)
        error(issues, path, "Required choose at least one requires min of 1.");
    const defaultItemIds = array(source.defaultItemIds, `${path}.defaultItemIds`, issues)
        .map((item, index) => nullableText(item, `${path}.defaultItemIds[${index}]`, issues))
        .filter((id) => Boolean(id));
    defaultItemIds.forEach((id, index) => {
        if (!itemIds.has(id))
            error(issues, `${path}.defaultItemIds[${index}]`, "Default item id does not exist in this group.");
    });
    if (new Set(defaultItemIds).size !== defaultItemIds.length)
        error(issues, `${path}.defaultItemIds`, "Default item ids must be unique.");
    if (max !== null && defaultItemIds.length > max)
        error(issues, `${path}.defaultItemIds`, "Default item count exceeds the maximum selection.");
    return { mode: mode && allowedModes.includes(mode) ? mode : "optional", minSelections: min, maxSelections: max, defaultItemIds };
}
function modularComposition(value, path, issues, rows) {
    const source = requiredObject(value, path, issues);
    const minStarters = nullableFiniteNumber(source.minStarters, `${path}.minStarters`, issues) ?? 0;
    const maxStarters = nullableFiniteNumber(source.maxStarters, `${path}.maxStarters`, issues);
    if (!Number.isInteger(minStarters) || minStarters < 0)
        error(issues, `${path}.minStarters`, "Minimum starters must be a non-negative integer.");
    if (maxStarters !== null && (!Number.isInteger(maxStarters) || maxStarters < 1))
        error(issues, `${path}.maxStarters`, "Maximum starters must be a positive integer or null.");
    if (maxStarters !== null && minStarters > maxStarters)
        error(issues, path, "Minimum starters cannot exceed maximum starters.");
    if (minStarters > 0 && !rows.some((row) => row.role === "starter")) {
        error(issues, path, "A composition requiring a starter needs at least one row with role 'starter'.");
    }
    return { minStarters, maxStarters };
}
function applicabilityTarget(value, path, issues) {
    const source = requiredObject(value, path, issues);
    const kind = nullableText(source.kind, `${path}.kind`, issues);
    if (!kind || !accessory_conditional_configuration_1.ACCESSORY_APPLICABILITY_TARGET_KINDS.includes(kind)) {
        error(issues, `${path}.kind`, "Applicability target kind must be base_model, price_matrix, modular, or workstation.");
        return null;
    }
    const groupId = requiredId(source.group_id, `${path}.group_id`, issues);
    const rowId = requiredId(source.row_id, `${path}.row_id`, issues);
    if (!groupId || !rowId)
        return null;
    return { kind: kind, group_id: groupId, row_id: rowId };
}
function applicabilityRule(value, path, issues, itemIds, seenTargetKeys, selectionMode) {
    const source = requiredObject(value, path, issues);
    const target = applicabilityTarget(source.target, `${path}.target`, issues);
    if (!target) {
        error(issues, `${path}.target`, "Applicability rule requires a target with kind, group_id, and row_id identifying the exact applicable row.");
        return null;
    }
    const targetKey = (0, accessory_conditional_configuration_1.accessoryApplicabilityTargetKey)(target);
    if (seenTargetKeys.has(targetKey))
        error(issues, path, "Only one applicability rule is allowed for the same target row.");
    seenTargetKeys.add(targetKey);
    if (typeof source.required !== "boolean")
        error(issues, `${path}.required`, "Required must be true or false.");
    if (source.visible !== undefined && typeof source.visible !== "boolean")
        error(issues, `${path}.visible`, "Visible must be true or false.");
    const allowedItemIds = source.allowed_item_ids === undefined ? undefined : codeList(source.allowed_item_ids, `${path}.allowed_item_ids`, issues).filter((id) => {
        if (itemIds.has(id))
            return true;
        error(issues, `${path}.allowed_item_ids`, `Allowed item id '${id}' does not exist in this option group.`);
        return false;
    });
    const fixedQuantity = source.fixed_quantity === undefined ? undefined : nullableFiniteNumber(source.fixed_quantity, `${path}.fixed_quantity`, issues);
    if (fixedQuantity !== undefined && fixedQuantity !== null && (!Number.isInteger(fixedQuantity) || fixedQuantity <= 0)) {
        error(issues, `${path}.fixed_quantity`, "Fixed quantity must be a positive integer.");
    }
    const scaleWithTargetQuantity = source.scale_with_target_quantity;
    if (scaleWithTargetQuantity !== undefined && typeof scaleWithTargetQuantity !== "boolean") {
        error(issues, `${path}.scale_with_target_quantity`, "Quantity scaling must be boolean.");
    }
    if (scaleWithTargetQuantity === true && (fixedQuantity === undefined || fixedQuantity === null)) {
        error(issues, `${path}.scale_with_target_quantity`, "Quantity scaling requires a fixed quantity.");
    }
    if (scaleWithTargetQuantity === true && target.kind !== "modular") {
        error(issues, `${path}.scale_with_target_quantity`, "Quantity scaling is only supported for modular targets.");
    }
    if (scaleWithTargetQuantity === true && selectionMode === "exactly_one") {
        error(issues, `${path}.scale_with_target_quantity`, "Quantity scaling cannot be combined with exactly-one selection.");
    }
    return {
        target,
        required: source.required === true,
        visible: source.visible !== false,
        ...(allowedItemIds?.length ? { allowed_item_ids: allowedItemIds } : {}),
        ...(fixedQuantity ? { fixed_quantity: fixedQuantity } : {}),
        ...(scaleWithTargetQuantity === true ? { scale_with_target_quantity: true } : {}),
    };
}
function conditionalConfiguration(value, path, issues, itemIds) {
    if (value === undefined)
        return undefined;
    const source = requiredObject(value, path, issues);
    const role = nullableText(source.role, `${path}.role`, issues);
    if (!role || !accessory_conditional_configuration_1.ACCESSORY_CONFIGURATION_ROLES.includes(role)) {
        error(issues, `${path}.role`, "Unknown accessory configuration role.");
    }
    const selectionMode = nullableText(source.selection, `${path}.selection`, issues);
    if (!selectionMode || !accessory_conditional_configuration_1.ACCESSORY_SELECTION_MODES.includes(selectionMode)) {
        error(issues, `${path}.selection`, "Unknown accessory selection mode.");
    }
    const seenTargetKeys = new Set();
    const applicability = array(source.applicability, `${path}.applicability`, issues)
        .map((rule, index) => applicabilityRule(rule, `${path}.applicability[${index}]`, issues, itemIds, seenTargetKeys, selectionMode))
        .filter((rule) => rule !== null);
    return {
        role: (role && accessory_conditional_configuration_1.ACCESSORY_CONFIGURATION_ROLES.includes(role) ? role : "accessory"),
        selection: (selectionMode && accessory_conditional_configuration_1.ACCESSORY_SELECTION_MODES.includes(selectionMode) ? selectionMode : "unrestricted"),
        applicability,
    };
}
function source(value, path, issues) {
    const item = object(value, path, issues);
    const pageNumber = nullableFiniteNumber(item.pageNumber, `${path}.pageNumber`, issues);
    if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1))
        error(issues, `${path}.pageNumber`, "Page number must be a positive integer.");
    return {
        id: requiredId(item.id, `${path}.id`, issues),
        documentName: nullableText(item.documentName, `${path}.documentName`, issues),
        pageNumber,
        region: nullableText(item.region, `${path}.region`, issues),
        rawText: nullableText(item.rawText, `${path}.rawText`, issues),
    };
}
/** Normalizes safe presentation details and reports ordinary validation failures as data. */
function normalizeProductTemplateDraft(input) {
    const issues = { errors: [], warnings: [] };
    const root = object(input, "draft", issues);
    const rawVersion = root.version;
    if (rawVersion !== exports.PRODUCT_TEMPLATE_DRAFT_VERSION) {
        error(issues, "draft.version", rawVersion === undefined ? "Draft version is required." : "Unsupported draft version.");
    }
    const templateInput = requiredObject(root.template, "draft.template", issues);
    const template = {
        templateName: nullableText(templateInput.templateName, "draft.template.templateName", issues),
        templateCode: nullableText(templateInput.templateCode, "draft.template.templateCode", issues),
        itemCode: nullableText(templateInput.itemCode, "draft.template.itemCode", issues),
        internalSelectionName: nullableText(templateInput.internalSelectionName, "draft.template.internalSelectionName", issues),
        description: nullableText(templateInput.description, "draft.template.description", issues),
        specification: nullableText(templateInput.specification, "draft.template.specification", issues),
        origin: nullableText(templateInput.origin, "draft.template.origin", issues),
        supplierName: nullableText(templateInput.supplierName, "draft.template.supplierName", issues),
        dimensions: dimensions(templateInput.dimensions, "draft.template.dimensions", issues),
        ...references(templateInput, "draft.template", issues),
    };
    const pricingInput = requiredObject(root.pricing, "draft.pricing", issues);
    const workstationRows = array(pricingInput.workstationRows, "draft.pricing.workstationRows", issues).map((row, index) => {
        const item = object(row, `draft.pricing.workstationRows[${index}]`, issues);
        const base = pricedRow(item, `draft.pricing.workstationRows[${index}]`, issues);
        const layout = nullableText(item.layoutType, `draft.pricing.workstationRows[${index}].layoutType`, issues);
        if (layout && !["linear", "cluster", "both"].includes(layout))
            error(issues, `draft.pricing.workstationRows[${index}].layoutType`, "Unsupported layout type.");
        return { ...base, additionalPrice: price(item.additionalPrice, `draft.pricing.workstationRows[${index}].additionalPrice`, issues), layoutType: layout };
    });
    uniqueIds(workstationRows.map((row) => row.id), "draft.pricing.workstationRows", issues);
    const baseModelRows = array(pricingInput.baseModelRows, "draft.pricing.baseModelRows", issues)
        .map((row, index) => pricedRow(row, `draft.pricing.baseModelRows[${index}]`, issues));
    uniqueIds(baseModelRows.map((row) => row.id), "draft.pricing.baseModelRows", issues);
    const priceMatrices = array(pricingInput.priceMatrices, "draft.pricing.priceMatrices", issues)
        .map((value, index) => matrix(value, `draft.pricing.priceMatrices[${index}]`, issues));
    uniqueIds(priceMatrices.map((item) => item.id), "draft.pricing.priceMatrices", issues);
    const modularGroups = array(pricingInput.modularGroups, "draft.pricing.modularGroups", issues).map((value, index) => {
        const path = `draft.pricing.modularGroups[${index}]`;
        const item = object(value, path, issues);
        const base = {
            id: requiredId(item.id, `${path}.id`, issues),
            label: nullableText(item.label, `${path}.label`, issues),
            defaultDimensions: dimensions(item.defaultDimensions, `${path}.defaultDimensions`, issues),
            defaultSpecification: nullableText(item.defaultSpecification, `${path}.defaultSpecification`, issues),
        };
        const declaredMode = nullableText(item.pricingMode, `${path}.pricingMode`, issues);
        if (declaredMode && declaredMode !== "matrix" && declaredMode !== "direct") {
            error(issues, `${path}.pricingMode`, 'Modular pricing mode must be "matrix" or "direct".');
        }
        const hasDirectRows = item.directRows !== undefined;
        const hasMatrix = item.matrix !== undefined;
        const direct = declaredMode === "direct" || (!declaredMode && hasDirectRows && !hasMatrix);
        if (direct && hasMatrix) {
            error(issues, path, "A direct-priced modular group cannot also declare a category matrix.");
        }
        if (!direct && hasDirectRows) {
            error(issues, path, "A matrix modular group cannot also declare directRows.");
        }
        if (!direct) {
            return { ...base, ...(declaredMode ? { pricingMode: "matrix" } : {}), matrix: matrix(item.matrix, `${path}.matrix`, issues) };
        }
        const directRows = array(item.directRows, `${path}.directRows`, issues).map((row, rowIndex) => {
            const rowPath = `${path}.directRows[${rowIndex}]`;
            const source = object(row, rowPath, issues);
            const role = nullableText(source.role, `${rowPath}.role`, issues);
            if (role && !exports.PRODUCT_TEMPLATE_DRAFT_MODULAR_ROLES.includes(role)) {
                error(issues, `${rowPath}.role`, 'Modular row role must be "starter", "intermediate", or "terminal".');
            }
            return {
                ...pricedRow(source, rowPath, issues),
                ...(role && exports.PRODUCT_TEMPLATE_DRAFT_MODULAR_ROLES.includes(role) ? { role: role } : {}),
            };
        });
        uniqueIds(directRows.map((row) => row.id), `${path}.directRows`, issues);
        if (!directRows.length)
            error(issues, `${path}.directRows`, "A direct-priced modular group needs at least one row.");
        return {
            ...base,
            pricingMode: "direct",
            directRows,
            ...(item.composition === undefined ? {} : { composition: modularComposition(item.composition, `${path}.composition`, issues, directRows) }),
        };
    });
    uniqueIds(modularGroups.map((item) => item.id), "draft.pricing.modularGroups", issues);
    const optionGroups = array(root.optionGroups, "draft.optionGroups", issues).map((value, index) => {
        const item = object(value, `draft.optionGroups[${index}]`, issues);
        const priceCategories = array(item.priceCategories, `draft.optionGroups[${index}].priceCategories`, issues).map((value, categoryIndex) => { const category = object(value, `draft.optionGroups[${index}].priceCategories[${categoryIndex}]`, issues); return { id: requiredId(category.id, `draft.optionGroups[${index}].priceCategories[${categoryIndex}].id`, issues), label: requiredId(category.label, `draft.optionGroups[${index}].priceCategories[${categoryIndex}].label`, issues) }; });
        uniqueIds(priceCategories.map((category) => category.id), `draft.optionGroups[${index}].priceCategories`, issues);
        const categoryIds = new Set(priceCategories.map((category) => category.id));
        const items = array(item.items, `draft.optionGroups[${index}].items`, issues)
            .map((row, rowIndex) => { const source = object(row, `draft.optionGroups[${index}].items[${rowIndex}]`, issues); const base = pricedRow(source, `draft.optionGroups[${index}].items[${rowIndex}]`, issues); const values = object(source.prices, `draft.optionGroups[${index}].items[${rowIndex}].prices`, issues); const prices = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, price(value, `draft.optionGroups[${index}].items[${rowIndex}].prices.${id}`, issues)])); Object.keys(prices).forEach((id) => { if (!categoryIds.has(id))
            error(issues, `draft.optionGroups[${index}].items[${rowIndex}].prices.${id}`, "Unknown accessory price category."); }); return { ...base, ...(priceCategories.length ? { prices } : {}) }; });
        uniqueIds(items.map((option) => option.id), `draft.optionGroups[${index}].items`, issues);
        const itemIds = new Set(items.map((option) => option.id));
        const configuration = conditionalConfiguration(item.conditionalConfiguration, `draft.optionGroups[${index}].conditionalConfiguration`, issues, itemIds);
        return {
            id: requiredId(item.id, `draft.optionGroups[${index}].id`, issues),
            label: nullableText(item.label, `draft.optionGroups[${index}].label`, issues),
            selection: selection(item.selection, itemIds, `draft.optionGroups[${index}].selection`, issues),
            ...(priceCategories.length ? { priceCategories } : {}),
            items,
            ...(configuration ? { conditionalConfiguration: configuration } : {}),
        };
    });
    uniqueIds(optionGroups.map((group) => group.id), "draft.optionGroups", issues);
    const materialSuggestions = array(root.materialSuggestions, "draft.materialSuggestions", issues).map((value, index) => {
        const item = object(value, `draft.materialSuggestions[${index}]`, issues);
        return { id: requiredId(item.id, `draft.materialSuggestions[${index}].id`, issues), label: nullableText(item.label, `draft.materialSuggestions[${index}].label`, issues), notes: nullableText(item.notes, `draft.materialSuggestions[${index}].notes`, issues), ...references(item, `draft.materialSuggestions[${index}]`, issues) };
    });
    uniqueIds(materialSuggestions.map((item) => item.id), "draft.materialSuggestions", issues);
    const linkedFamilySuggestions = array(root.linkedFamilySuggestions, "draft.linkedFamilySuggestions", issues).map((value, index) => {
        const item = object(value, `draft.linkedFamilySuggestions[${index}]`, issues);
        const defaultQuantity = nullableFiniteNumber(item.defaultQuantity, `draft.linkedFamilySuggestions[${index}].defaultQuantity`, issues);
        return { id: requiredId(item.id, `draft.linkedFamilySuggestions[${index}].id`, issues), templateName: nullableText(item.templateName, `draft.linkedFamilySuggestions[${index}].templateName`, issues), templateCode: nullableText(item.templateCode, `draft.linkedFamilySuggestions[${index}].templateCode`, issues), defaultQuantity, notes: nullableText(item.notes, `draft.linkedFamilySuggestions[${index}].notes`, issues), ...references(item, `draft.linkedFamilySuggestions[${index}]`, issues) };
    });
    uniqueIds(linkedFamilySuggestions.map((item) => item.id), "draft.linkedFamilySuggestions", issues);
    const extractionWarnings = codeList(root.extractionWarnings, "draft.extractionWarnings", issues);
    const confidence = nullableFiniteNumber(root.confidence, "draft.confidence", issues);
    if (confidence !== null && (confidence < 0 || confidence > 1))
        error(issues, "draft.confidence", "Confidence must be between 0 and 1.");
    const sources = array(root.sources, "draft.sources", issues).map((value, index) => source(value, `draft.sources[${index}]`, issues));
    uniqueIds(sources.map((item) => item.id), "draft.sources", issues);
    const draft = {
        version: exports.PRODUCT_TEMPLATE_DRAFT_VERSION,
        template,
        defaultCurrency: currency(root.defaultCurrency, "draft.defaultCurrency", issues),
        pricing: { workstationRows, baseModelRows, priceMatrices, modularGroups },
        optionGroups,
        materialSuggestions,
        linkedFamilySuggestions,
        extractionWarnings,
        confidence,
        sources,
    };
    const valid = issues.errors.length === 0;
    return { valid, errors: issues.errors, warnings: issues.warnings, draft: valid ? draft : null };
}
/** Alias retained for callers that only need validation plus the normalized result. */
exports.validateProductTemplateDraft = normalizeProductTemplateDraft;
