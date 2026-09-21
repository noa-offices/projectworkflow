import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync("components/products/product-template-form.tsx", "utf8");
const importer = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
const cardStart = form.indexOf('{template?.id && submitMode === "update" ? <section');
const card = form.slice(cardStart, form.indexOf("</section> : null}", cardStart));

test("1: update mode with a saved template id renders the dedicated Edit in Smart Setup card", () => {
  assert.ok(cardStart > 0);
  assert.ok(card.includes("EDIT IN SMART SETUP"));
  assert.ok(card.includes('buttonLabel="Edit in Smart Setup"'));
  assert.ok(card.includes("Open this saved Product Template in Smart Setup to review pricing groups, accessories, and add more JSON. No PDF required."));
});

test("2: create mode does not render it and keeps Import & Review JSON", () => {
  assert.ok(card.startsWith('{template?.id && submitMode === "update"'));
  assert.equal(form.split('buttonLabel="Edit in Smart Setup"').length - 1, 1, "single entry, gated");
  assert.ok(form.includes('<SmartProductJsonImport buttonLabel="Import & Review JSON" onRequestApply={requestSmartDraftApply} />'));
});

test("3-5: it opens edit_existing, passes the template name and seeds from currentSmartWorkspace()", () => {
  assert.ok(card.includes('mode="edit_existing"'));
  assert.ok(card.includes("templateName={template.template_name}"));
  assert.ok(card.includes("loadInitialWorkspace={currentSmartWorkspace}"));
  assert.ok(card.includes("onRequestApply={requestSaveSmartChanges}"));
});

test("6-7: edit mode bypasses the scope dialog and does not auto-open Add More JSON", () => {
  const open = importer.slice(importer.indexOf("const openImporter = () => {"));
  const editBranch = open.slice(0, open.indexOf("return; }") + 9);
  assert.ok(editBranch.includes("startGeneralImport(workspace, false)"));
  assert.equal(editBranch.includes("setScopeOpen"), false);
  assert.equal(/addMore|AddMore|additional/i.test(editBranch), false);
});

test("8: the section is open by default for a saved template, and the import/update flow is unchanged", () => {
  assert.ok(form.includes('smartSetup: Boolean(template?.id) && submitMode === "update",'));
  assert.ok(form.includes('buttonLabel="Update Existing Template" loadInitialWorkspace={currentSmartWorkspace} onApplyManufacturerFields={applyManufacturerFields}'));
});
