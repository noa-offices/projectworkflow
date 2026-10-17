import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { optionGroupRelationshipType, optionItemRelationshipType, optionItemRolePatch, SMART_OPTION_RELATIONSHIP_LABELS } from "../../lib/products/smart-product-option-relationships.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply } from "../../lib/products/smart-product-review-routing.js";
import { mapDraftOptionGroupsToAccessories } from "../../lib/products/product-template-draft-accessory-adapter.js";
import { applySmartAdditionalJson } from "../../lib/products/smart-product-additional-json.js";
import type { ProductTemplateDraft } from "../../lib/products/product-template-draft.js";

const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");

// Exercise the actual pure role controls without loading unrelated server actions
// and PDF/image tooling imported by the full review dialog.
function roleControls() {
  const ast = ts.createSourceFile("review.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["OptionItemRoleControl", "AccessoryItemRolesEditor"]);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
  assert.equal(functions.length, 2, "the shared role control must have an Advanced Setup item-list consumer");
  const badges = ast.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === "roleBadgeClass"));
  assert.ok(badges);
  const code = ts.transpileModule([badges, ...functions].map((node) => node.getText(ast)).join("\n") + "\nexport { AccessoryItemRolesEditor };", {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { AccessoryItemRolesEditor?: (props: Record<string, unknown>) => ReactElement } = {};
  runInNewContext(code, { exports, React: { createElement }, optionGroupRelationshipType, optionItemRelationshipType, optionItemRolePatch, SMART_OPTION_RELATIONSHIP_LABELS });
  return exports.AccessoryItemRolesEditor!;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") return elements((element.type as (props: unknown) => ReactNode)(element.props));
  return [element, ...elements(element.props.children as ReactNode)];
}

const item = (id: string) => ({ id, label: id, displayName: `Accessory ${id}`, supplierCodes: [`SKU-${id}`], referenceCodes: [], dimensions: null, currency: "EUR" as const, price: 25, specification: "Original specification" });

test("category and scalar tables retain essential controls and applicability review without a duplicate role editor", () => {
  const category = source.slice(source.indexOf("function SmartAccessoryRowsEditor"), source.indexOf("function SmartScalarAccessoryRowsEditor"));
  const scalar = source.slice(source.indexOf("function SmartScalarAccessoryRowsEditor"), source.indexOf("function PricedRowsEditor"));
  for (const table of [category, scalar]) {
    assert.equal(table.includes("<OptionItemRoleControl"), false);
    for (const retained of ["AccessoryReviewNotice", "StructuralSupportCompatibilityControl", "supplierCodes", "formatDraftDimensions", "Edit / Details", "specification", "nullableReviewNumber"]) assert.ok(table.includes(retained), retained);
  }
  const advanced = source.slice(source.indexOf("const advancedContent ="), source.indexOf("const dependentLabel ="));
  assert.ok(advanced.includes("<AccessoryItemRolesEditor"));
  assert.equal((source.match(/<AccessoryItemRolesEditor\b/g) ?? []).length, 1);
  assert.ok(source.includes("{advancedSetupOpen ? <div className=\"mt-2\">{controls}{advancedContent}</div> : null}"));
  assert.ok(source.includes("{dependencyWarning}{compactConfigurationSummary}"), "group requirement summary stays outside Advanced Setup");
});

test("Advanced Setup uses the original role patch for every role, scopes edits by item ID and preserves group configuration through Apply and Add More JSON", () => {
  const Editor = roleControls();
  for (const categoryPriced of [false, true]) {
    for (const role of ["normal", "companion", "structural_support"] as const) {
      const original = { ...item("a"), role: "structural_support" as const, compatibleTargets: [{ kind: "base_model" as const, group_id: "models", row_id: "desk" }], ...(categoryPriced ? { price: null, prices: { cat: 25 } } : {}) };
      const rows = [original, item("b")];
      let changed = rows as ProductTemplateDraft["optionGroups"][number]["items"];
      const rendered = elements(Editor({ rows, onChange: (next: typeof changed) => { changed = next; } }));
      assert.ok(rendered.some((element) => element.props.children === "Accessory a"));
      assert.ok(rendered.some((element) => element.props.children === "SKU-a"));
      const select = rendered.find((element) => element.type === "select" && element.props["aria-label"] === "Role for Accessory a");
      assert.ok(select);
      assert.equal(select.props.value, "structural_support");
      assert.deepEqual(elements(select.props.children as ReactNode).filter((element) => element.type === "option").map((element) => element.props.value), ["normal", "companion", "structural_support"]);
      (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: role } });
      assert.deepEqual({ ...changed[0] }, { ...original, ...optionItemRolePatch(role) });
      assert.equal(changed[1], rows[1]);
      assert.equal(original.role, "structural_support");

      const configuration = { role: "companion" as const, selection: "exactly_one" as const, applicability: [{ target: { kind: "base_model" as const, group_id: "models", row_id: "desk" }, required: true, visible: true, fixed_quantity: 1 }] };
      const draft: ProductTemplateDraft = {
        version: 1, template: { templateName: "Product", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR",
        pricing: { workstationRows: [], baseModelRows: [{ ...item("desk"), groupId: "models", groupLabel: "Models" }], priceMatrices: [], modularGroups: [] },
        optionGroups: [{ id: "accessories", label: "Required companions", selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] }, conditionalConfiguration: configuration, items: changed, ...(categoryPriced ? { priceCategories: [{ id: "cat", label: "Category" }] } : {}) }], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], sources: [], confidence: null,
      };
      const plan = createSmartSetupReviewRouting(draft);
      const incoming = structuredClone(draft);
      incoming.optionGroups[0].items = [item("c")];
      const merged = applySmartAdditionalJson(draft, plan, incoming, { "option:accessories": { action: "merge", destination: "accessory", targetKey: "option:accessories", duplicateChoices: {} } });
      assert.deepEqual(merged.draft.optionGroups[0].items[0], { ...changed[0] });
      assert.deepEqual(merged.draft.optionGroups[0].conditionalConfiguration, configuration);
      const applied = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(merged.draft, merged.plan), merged.plan).groups[0];
      assert.equal(applied.group_is_required, true);
      assert.deepEqual(applied.conditional_configuration, configuration);
      assert.equal(applied.items[0].role, role === "normal" ? undefined : role);
      if (role === "structural_support") assert.deepEqual(applied.items[0].compatible_targets, original.compatibleTargets);
    }
  }
});
