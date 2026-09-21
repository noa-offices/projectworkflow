import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { applySmartAdditionalJson, type SmartAdditionalGroupDecision } from "./smart-product-additional-json.js";
import { assignNewRowsToNativeFamilies } from "./smart-product-base-model-auto-subgroups.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { canonicalSubgroupsForSmartSetupApply } from "./smart-product-row-images.js";

const form = readFileSync("components/products/product-template-form.tsx", "utf8");
const smart = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
const staged = readFileSync("components/products/staged-pricing-row-reference-image.tsx", "utf8");

const empty = { desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]", currency: "AED" };
const savedNative = (extra: Record<string, unknown> = {}) => JSON.stringify([
  { id: "comby", pricing_type: "base_model_group", group_name: "COMBY", is_active: true, sort_order: 0, subgroups: [{ id: "auto-sigma-q-desk", subgroup_name: "SIGMA_Q Desk", sort_order: 0, is_active: true, row_ids: ["d1", "d2"] }], items: [{ id: "sys", variant_name: "Base", role: "system_base", price: 100, currency: "AED", sort_order: 0 }, { id: "d1", variant_name: "Desk D70 W120 SIGMA_Q for Comby - Plain Top", price: 10, currency: "AED", sort_order: 1, ...extra }, { id: "d2", variant_name: "Desk D80 W120 SIGMA_Q for Comby - Plain Top", price: 11, currency: "AED", sort_order: 2 }] },
  { id: "p58", pricing_type: "base_model_group", group_name: "P58", is_active: true, sort_order: 1, items: [{ id: "p1", variant_name: "P58 Base", role: "system_base", price: 50, currency: "AED", sort_order: 0 }] },
]);

// ---- entry / seed ----
test("1-3: existing templates get a direct Edit in Smart Setup entry that skips the scope dialog and does not open Add More", () => {
  assert.ok(form.includes('{template?.id && submitMode === "update" ? <section'), "entry only for existing templates in update mode");
  assert.ok(form.includes('<SmartProductJsonImport mode="edit_existing"'));
  assert.ok(form.includes('buttonLabel="Edit in Smart Setup"'));
  assert.ok(smart.includes("const openImporter = () => { if (editMode) { const workspace = loadInitialWorkspace?.(); if (workspace) startGeneralImport(workspace, false); return; }"));
  assert.ok(smart.includes("setAddMoreOpen(openAddMore)"));
  assert.ok(smart.includes("openAddMore = true"), "import mode keeps opening Add More exactly as before");
});

test("4-5: the workspace seeds from the CURRENT (unsaved) form state, not a reloaded database copy", () => {
  assert.ok(form.includes("function currentSmartWorkspace() { const snapshot = currentFormSnapshot();"));
  assert.ok(form.includes("const data = new FormData(form);"));
  const unsaved = productTemplateFormSmartWorkspace({ ...empty, template_name: "Edited unsaved name", variant_pricing: JSON.stringify([{ id: "a", variant_name: "A", price: 999, currency: "AED" }]) });
  assert.equal(unsaved.draft.template.templateName, "Edited unsaved name");
  assert.equal(unsaved.draft.pricing.baseModelRows[0].price, 999);
});

// ---- edit-mode UI ----
test("6-11: edit-mode header, hidden Source QA/PDF/crop/source count, Back to Template and Save Changes", () => {
  assert.ok(smart.includes('Editing: {templateName || "Product Template"}'));
  assert.ok(smart.includes('{editMode ? "Editing saved template data" : `Imported JSON sources: ${importCount}`}'));
  assert.ok(smart.includes("{props.editMode ? null : <SourceQaPanel"));
  assert.ok(smart.includes("{props.editMode ? null : <ExtractionCoverageCard"));
  assert.ok(smart.includes("<SmartSetupCropAvailableContext.Provider value={!editMode}>"));
  assert.ok(staged.includes("{cropAvailable ? <button"), "per-row Crop from PDF link is hidden without a PDF");
  assert.ok(smart.includes('>Back to Template</button>'));
  assert.ok(smart.includes('{editMode ? "Save Changes" : "Apply to Product Template"}'));
  assert.ok(smart.includes("+ Add More JSON"), "Add More JSON stays available");
});

// ---- save bridge ----
test("12-16: Save Changes applies the reviewed state, waits for the explicit commit signal, then submits the SAME update form once", () => {
  assert.ok(form.includes("const response = requestIncrementalSmartDraftApply(draft, routingPlan, confirmed, images, subgroupAssignments, subgroupImages, sourcePdfMeta);"));
  assert.ok(form.includes("const tracker = createSmartSaveTracker(lastApplyVersionsRef.current);"));
  assert.ok(form.includes("if (pending?.tracker.committed(section, version)) setSmartSaveReady(pending.id);"));
  assert.ok(form.includes("onReplacementCommitted={notifyReplacementCommitted}"));
  assert.ok(form.includes('pricingRef.current?.closest("form")?.requestSubmit();'));
  assert.equal(form.split("requestSubmit()").length - 1, 1, "requestSubmit is called from exactly one place");
  assert.ok(form.includes('<input type="hidden" name="id" value={templateId} />'));
  assert.ok(form.includes('const baseSubmitAction = onSubmitAction ?? (submitMode === "update" ? updateProductTemplate : createProductTemplate);'));
  assert.ok(form.includes('onRequestApply={requestSaveSmartChanges}') && form.includes('mode="edit_existing"'));
});

// ---- round trip through the reopened workspace ----
test("17-18: an edited row price and a renamed family persist through Apply and reopen", () => {
  const ws = productTemplateFormSmartWorkspace({ ...empty, variant_pricing: savedNative() });
  const draft: ProductTemplateDraft = structuredClone(ws.draft);
  draft.pricing.baseModelRows.find((row) => row.id === "d1")!.price = 12;
  const subgroups = { ...ws.subgroups, "base_model_group:comby": ws.subgroups["base_model_group:comby"].map((entry) => ({ ...entry, subgroup_name: "Renamed family" })) };
  const applied = mapDraftBaseModelPricing(draft);
  assert.equal(applied.groups[0].items.find((item) => item.id === "d1")?.price, 12);
  const assigned = canonicalSubgroupsForSmartSetupApply(draft, ws.plan, subgroups);
  assert.deepEqual(assigned.find((entry) => entry.groupId === "comby")?.subgroups.map((entry) => [entry.id, entry.subgroup_name, entry.row_ids]), [["auto-sigma-q-desk", "Renamed family", ["d1", "d2"]]]);
  // reopen from the saved result keeps the edit
  const saved = JSON.stringify(applied.groups.map((group) => ({ ...group, subgroups: assigned.find((entry) => entry.groupId === group.id)?.subgroups })));
  const reopened = productTemplateFormSmartWorkspace({ ...empty, variant_pricing: saved });
  assert.equal(reopened.draft.pricing.baseModelRows.find((row) => row.id === "d1")?.price, 12);
  assert.equal(reopened.subgroups["base_model_group:comby"][0].subgroup_name, "Renamed family");
});

test("19-20: an accessory role edit persists and native System groups keep id/label/role", () => {
  const ws = productTemplateFormSmartWorkspace({ ...empty, variant_pricing: savedNative(), accessory_pricing: JSON.stringify([{ id: "kit", group_name: "Kit", group_is_required: false, sort_order: 0, items: [{ id: "k1", item_name: "K1", price: 1, sort_order: 0 }] }]) });
  const plan = structuredClone(ws.plan);
  const route = plan.routes.find((entry) => entry.key === "option:kit")!;
  route.accessory = { role: "companion", selection: "required_exactly_one", rules: [{ target: { kind: "base_model", group_id: "comby", row_id: "sys" }, required: true, visible: true, fixedQuantity: 1 }] };
  const accessory = mapDraftOptionGroupsToAccessories(ws.draft, plan);
  assert.equal(accessory.groups[0].conditional_configuration?.role, "companion");
  assert.equal(accessory.groups[0].conditional_configuration?.applicability[0].target?.group_id, "comby");
  const groups = mapDraftBaseModelPricing(ws.draft).groups;
  assert.deepEqual(groups.map((group) => [group.id, group.group_name]), [["comby", "COMBY"], ["p58", "P58"]]);
  assert.equal((groups[0].items[0] as { role?: string }).role, "system_base");
});

// ---- Add More JSON on a reopened workspace ----
const incoming = (rows: Array<Record<string, unknown>>) => {
  const result = normalizeProductTemplateDraft({ version: 1, template: { templateName: "T" }, defaultCurrency: "AED", pricing: { workstationRows: [], baseModelRows: rows, priceMatrices: [], modularGroups: [] }, optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [] });
  assert.ok(result.draft, JSON.stringify(result.errors));
  return result.draft as ProductTemplateDraft;
};
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, label: null, displayName: name, price: 5, currency: "AED", supplierCodes: [`C-${id}`], referenceCodes: [], ...extra });
const merge: SmartAdditionalGroupDecision = { action: "merge", destination: "base_model", targetKey: "base_model_group:comby", duplicateChoices: {} };

test("22-25: Add More JSON merges into the reopened workspace (no original JSON), touches only the target group, and new rows join families", () => {
  const ws = productTemplateFormSmartWorkspace({ ...empty, variant_pricing: savedNative() });
  const add = incoming([row("d3", "Desk D70 W140 SIGMA_Q for Comby - Plain Top", { groupId: "comby", groupLabel: "COMBY" }), row("d4", "Desk D80 W140 SIGMA_Q for Comby - Plain Top", { groupId: "comby", groupLabel: "COMBY" })]);
  const result = applySmartAdditionalJson(ws.draft, ws.plan, add, { "base_model_group:comby": merge });
  assert.deepEqual(result.draft.pricing.baseModelRows.filter((entry) => entry.groupId === "comby").map((entry) => entry.id), ["sys", "d1", "d2", "d3", "d4"]);
  assert.deepEqual(result.draft.pricing.baseModelRows.filter((entry) => entry.groupId === "p58").map((entry) => entry.id), ["p1"]);
  const families = assignNewRowsToNativeFamilies(ws.subgroups["base_model_group:comby"], result.draft.pricing.baseModelRows.filter((entry) => entry.groupId === "comby"), result.addedRowsByTarget["base_model_group:comby"]);
  assert.deepEqual(families.map((entry) => [entry.id, entry.row_ids]), [["auto-sigma-q-desk", ["d1", "d2", "d3", "d4"]]]);
  assert.ok(createSmartSetupReviewRouting(result.draft).routes.some((entry) => entry.key === "base_model_group:comby"));
});

test("Add More assignment leaves system rows, existing assignments and lone unmatched rows alone; targeted import supports native group keys", () => {
  const existing = [{ id: "fam", subgroup_name: "SIGMA_Q Desk", sort_order: 0, is_active: true, row_ids: ["d1"] }];
  const rows = [row("d1", "Desk D70 W120 SIGMA_Q for Comby - Plain Top"), row("s2", "Base", { role: "system_base" }), row("x1", "Bench D145 W120 SIGMA_L for Comby - Plain Tops"), row("d5", "Desk D90 W120 SIGMA_Q for Comby - Plain Top")];
  const next = assignNewRowsToNativeFamilies(existing, rows, ["d1", "s2", "x1", "d5"]);
  assert.deepEqual(next.map((entry) => entry.row_ids), [["d1", "d5"]]);
  assert.ok(smart.includes('addMoreTarget.targetRouteKey.startsWith("base_model_group:")'));
});

// ---- backward compatibility ----
test("26-28: create/import workflow, Source QA in import mode and the quick-edit save path are unchanged", () => {
  assert.ok(smart.includes('mode = "import"'));
  assert.ok(smart.includes("<SourceQaPanel draft={props.draft}"), "Source QA still renders outside edit mode");
  assert.ok(form.includes('<SmartProductJsonImport buttonLabel="Import & Review JSON" onRequestApply={requestSmartDraftApply} />'));
  assert.ok(form.includes("action={submitWithPendingImages}"));
  assert.ok(smart.includes("Apply to Product Template"));
});
