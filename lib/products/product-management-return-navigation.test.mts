import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/products/templates/page.tsx", "utf8");
const actions = readFileSync("app/products/templates/actions.ts", "utf8");
const filterBar = readFileSync("components/products/product-management-filter-bar.tsx", "utf8");
const results = readFileSync("components/products/product-management-template-results.tsx", "utf8");
const priceHistoryOnDeleteMigration = readFileSync(
  "supabase/migrations/106_quotation_item_price_history_template_on_delete_set_null.sql",
  "utf8",
);

function permanentlyDeleteProductTemplateBody() {
  const start = actions.indexOf("export async function permanentlyDeleteProductTemplate(formData: FormData)");
  const end = actions.indexOf("\nexport async function deactivateProductTemplate", start);
  return actions.slice(start, end);
}

// Part A: the Management filter bar and results list are pure prop-driven presentational components -
// they never build their own template edit/open URLs. Both editHref/openHref (results list) and
// addTemplateHref (filter bar) arrive fully built from page.tsx's templatesHref(params, ...), which
// preserves manage/panelBrand/panelMain/panelSub/q/brand/main/sub/priceStatus by carrying forward
// whatever is already in `params` unless a key is explicitly overridden.
test("Product Management results list and filter bar receive hrefs as props, never construct their own template URLs", () => {
  assert.equal(filterBar.includes("templatesHref"), false, "filter bar must not duplicate URL-building logic already owned by page.tsx");
  assert.equal(results.includes("templatesHref"), false, "results list must not duplicate URL-building logic already owned by page.tsx");
  assert.ok(filterBar.includes("addTemplateHref: string;"), "filter bar renders the addTemplateHref prop it is given");
  assert.ok(results.includes("editHref: string;") && results.includes("openHref: string;"), "results list renders the editHref/openHref props it is given");
});

test("Product Management template edit/open hrefs are built via templatesHref(params, ...), preserving current context", () => {
  assert.ok(page.includes("function buildManagementTemplateResult(template: ProductTemplate)"));
  const start = page.indexOf("function buildManagementTemplateResult(template: ProductTemplate)");
  const end = page.indexOf("\n  }\n", start);
  const body = page.slice(start, end);
  assert.match(body, /editHref: templatesHref\(params, \{\s*template: template\.id,\s*editTemplate: template\.id,\s*addTemplate: null,\s*\}\)/);
  assert.match(body, /openHref: templatesHref\(params, \{\s*template: template\.id,\s*editTemplate: null,\s*addTemplate: null,\s*\}\)/);
});

test("templatesHref preserves manage, panelBrand, and every other Product Management filter param, without forcing manage when absent", () => {
  const start = page.indexOf("function templatesHref(");
  const end = page.indexOf("\n}\n", start);
  const body = page.slice(start, end);
  ["manage", "q", "brand", "main", "sub", "panelBrand", "panelMain", "panelSub", "priceStatus", "template", "addTemplate", "editTemplate"].forEach((key) => {
    assert.ok(body.includes(`"${key}"`), `Expected templatesHref to preserve param: ${key}`);
  });
  // templatesHref only sets a key when an explicit update is given; otherwise it falls through to
  // stringParam(params[key]) - so it never injects manage=1 on its own, and never drops it either.
  assert.match(body, /updatedValue === undefined \? stringParam\(params\[key\]\) : updatedValue/);
});

test("Product Management filter bar navigation always sets manage=1 and preserves panelBrand/panelMain/panelSub by copying the existing query string", () => {
  assert.ok(filterBar.includes('const next = new URLSearchParams(searchParams.toString());'), "filter bar navigation must start from the current query string, preserving panelBrand/panelMain/panelSub");
  assert.ok(filterBar.includes('next.set("manage", "1");'));
});

test("the Add/Edit ProductTemplateForm returnTo props reuse templatesHref, so Management context (including manage=1) survives into return_to", () => {
  assert.match(page, /returnTo=\{returnTo \|\| templatesHref\(params, \{ addTemplate: "1" \}\)\}/);
  assert.match(page, /returnTo=\{returnTo \|\| withHash\(\s*templatesHref\(params, \{\s*template: template\.id,\s*editTemplate: template\.id,\s*addTemplate: null,\s*\}\),/);
});

// Part B: createProductTemplate's success redirect now merges onto the validated return_to origin
// instead of hardcoding Management, using the same safe pathWithParams/returnPath helpers already used
// for every other redirect in this file (no new/weakened validation, no unvalidated string concatenation).
test("createProductTemplate success no longer hardcodes manage=1/panelBrand and instead merges onto returnPath(formData)", () => {
  const start = actions.indexOf("export async function createProductTemplate(formData: FormData)");
  const end = actions.indexOf("\nexport async function updateProductTemplate", start);
  const body = actions.slice(start, end);
  assert.equal(/`\/products\/templates\?manage=1&panelBrand=/.test(body), false, "the hardcoded Management-origin success redirect string must be gone");
  assert.match(body, /pathWithParams\(returnPath\(formData\), \{\s*addTemplate: null,\s*template: template\.id,\s*editTemplate: template\.id,\s*\}\)/);
  assert.ok(body.includes("#template-${template.id}-materials"), "the materials anchor must still be appended for the newly created template");
  assert.ok(body.includes("redirectWithMessageToPath(\n    createdTemplatePath,"));
});

test("returnPath/pathWithParams (the safe internal-path helpers) are unchanged and still reused, not duplicated", () => {
  assert.equal(actions.split("function returnPath(formData: FormData, fallback = \"/products/templates\")").length - 1, 1, "returnPath must remain the single, unmodified safe-path validator");
  assert.match(actions, /function returnPath\(formData: FormData, fallback = "\/products\/templates"\) \{\n  const value = textValue\(formData, "return_to"\);\n  if \(!value \|\| !value\.startsWith\("\/"\) \|\| value\.startsWith\("\/\/"\)\) \{\n    return fallback;/, "external and protocol-relative return_to values must still fall back, never redirect externally");
});

// /products/manage: dedicated canonical Management route.
test("app/products/manage/page.tsx renders ProductTemplatesPage with manage forced on, and never redirects back to /products/templates", () => {
  const manageRoute = readFileSync("app/products/manage/page.tsx", "utf8");
  assert.ok(manageRoute.includes("ProductTemplatesPage"));
  assert.match(manageRoute, /manage: "1"/);
  assert.equal(manageRoute.includes("redirect("), false, "the /products/manage route itself must render directly, never redirect, to avoid a redirect loop with the legacy /products/management alias");
});

test("app/products/management/page.tsx remains the sole legacy alias, redirecting once to /products/manage", () => {
  const legacyRoute = readFileSync("app/products/management/page.tsx", "utf8");
  assert.match(legacyRoute, /redirect\("\/products\/manage"\)/);
});

// templatesHref: canonical base-path branching.
test("templatesHref routes to /products/manage (manage=1 omitted) once the resolved manage value is \"1\", and to /products/templates otherwise", () => {
  const start = page.indexOf("function templatesHref(");
  const end = page.indexOf("\n}\n", start);
  const body = page.slice(start, end);
  assert.match(body, /const isManagementHref = next\.get\("manage"\) === "1";/);
  assert.match(body, /if \(isManagementHref\) \{\s*next\.delete\("manage"\);\s*\}/);
  assert.match(body, /const basePath = isManagementHref \? "\/products\/manage" : "\/products\/templates";/);
  assert.match(body, /return `\$\{basePath\}\$\{query \? `\?\$\{query\}` : ""\}`;/);
});

test("templatesHref preserves panelBrand/panelMain/panelSub alongside the /products/manage base path (Management brand/category/subcategory views)", () => {
  // The param-preservation loop (manage, q, brand, main, sub, panelBrand, panelMain, panelSub,
  // priceStatus, template, addTemplate, editTemplate) runs identically regardless of which base path is
  // chosen afterward - so every non-manage param, including panelBrand/panelMain/panelSub, survives onto
  // /products/manage exactly as it did onto /products/templates?manage=1 before this change.
  const start = page.indexOf("function templatesHref(");
  const loopStart = page.indexOf("for (const key of [", start);
  const loopEnd = page.indexOf("] as const)", loopStart);
  const loopKeys = page.slice(loopStart, loopEnd);
  ["panelBrand", "panelMain", "panelSub"].forEach((key) => {
    assert.ok(loopKeys.includes(`"${key}"`), `Expected the preserved-param loop to include: ${key}`);
  });
  const branchStart = page.indexOf("const isManagementHref", start);
  assert.ok(branchStart > loopEnd, "the base-path branch must run after all params (including panelBrand/panelMain/panelSub) are already collected into `next`");
});

test("buildManagementTemplateResult's editHref/openHref and the Add Template href resolve through templatesHref, so they land on /products/manage once manage=1 is set", () => {
  assert.match(page, /editHref: templatesHref\(params, \{\s*template: template\.id,\s*editTemplate: template\.id,\s*addTemplate: null,\s*\}\)/);
  assert.match(page, /addTemplateHref=\{templatesHref\(params, \{ addTemplate: "1" \}\)\}/);
  // Neither call overrides "manage", so both resolve the base path from whatever manage already is in
  // params - Management context in, /products/manage out; Library context in, /products/templates out.
});

test("the Management list back-link (managementBackHref) is the canonical templatesHref output directly, with no separate /products/management detour", () => {
  assert.match(page, /const managementBackHref = managementListHref;/);
  assert.equal(page.includes('managementListHref === "/products/templates?manage=1"'), false, "the old string comparison against the pre-canonical URL must be gone");
});

// Part 2: archive/discontinue/restore/permanent-delete return_to.
["archiveProductTemplate", "markProductTemplateDiscontinued", "restoreProductTemplate", "permanentlyDeleteProductTemplate"].forEach((actionName) => {
  test(`${actionName} reads returnPath(formData) and redirects via redirectWithMessageToPath, never the context-blind redirectWithMessage`, () => {
    const start = actions.indexOf(`export async function ${actionName}(formData: FormData)`);
    assert.ok(start >= 0, `Expected to find ${actionName}`);
    const nextExport = actions.indexOf("\nexport async function ", start + 1);
    const body = actions.slice(start, nextExport >= 0 ? nextExport : undefined);
    assert.match(body, /const redirectPath = returnPath\(formData\);/, `${actionName} must compute redirectPath from returnPath(formData)`);
    assert.ok(body.includes("redirectWithMessageToPath(redirectPath,") || body.includes("redirectWithMessageToPath(\n      redirectPath,"), `${actionName} must redirect via redirectWithMessageToPath(redirectPath, ...)`);
    assert.equal(/redirectWithMessage\(["'`]/.test(body), false, `${actionName} must no longer call the context-blind redirectWithMessage(...)`);
  });
});

// Part 3: Product Management action forms submit return_to.
test("Product Management row action forms (mark checked, archive, discontinue) all submit a return_to hidden field sourced from the row's returnTo prop", () => {
  assert.match(results, /function TemplateRowActions\(\{\s*editHref,\s*openHref,\s*returnTo,\s*templateId,/);
  const formBlocks = results.split('<form action={').slice(1);
  const relevantForms = formBlocks.filter((block) => block.startsWith("markTemplatePriceChecked") || block.startsWith("archiveProductTemplate") || block.startsWith("markProductTemplateDiscontinued"));
  assert.equal(relevantForms.length, 3, "expected exactly 3 row action forms: mark checked, archive, discontinue");
  relevantForms.forEach((block) => {
    assert.ok(block.includes('<input type="hidden" name="return_to" value={returnTo} />'), "every row action form must submit return_to");
  });
});

test("mark-checked form specifically submits return_to (Part 4: no change to markTemplatePriceChecked's own action logic)", () => {
  const start = results.indexOf("<form action={markTemplatePriceChecked}");
  const end = results.indexOf("</form>", start);
  const block = results.slice(start, end);
  assert.ok(block.includes('<input type="hidden" name="return_to" value={returnTo} />'));
  assert.equal(actions.includes("export async function markTemplatePriceChecked(formData: FormData) {\n  await markProductTemplatePriceChecked(\n    textValue(formData, \"id\"),\n    optionalTextValue(formData, \"price_check_note\"),\n    returnPath(formData),\n  );\n}"), true, "markTemplatePriceChecked's own action logic must remain unchanged - it already read returnPath(formData)");
});

test("ProductManagementTemplateResults threads its returnTo prop into every row's TemplateRowActions, and page.tsx supplies managementListHref at every call site", () => {
  assert.match(results, /returnTo,\s*searchPlaceholder,\s*showCount = true,\s*templates,\s*\}: ProductManagementTemplateResultsProps/);
  assert.match(results, /<TemplateRowActions\s*editHref=\{template\.editHref\}\s*openHref=\{template\.openHref\}\s*returnTo=\{returnTo\}\s*templateId=\{template\.id\}\s*\/>/);
  assert.equal(page.split("<ProductManagementTemplateResults").length - 1, page.split("returnTo={managementListHref}").length - 1, "every <ProductManagementTemplateResults> call site must pass returnTo={managementListHref}");
});

// Part 6: create/update untouched.
test("updateProductTemplate is unchanged: still redirects to returnPath(formData) directly", () => {
  const start = actions.indexOf("export async function updateProductTemplate(formData: FormData)");
  const end = actions.indexOf("\nexport async function updateProductTemplateForQuotationModal", start);
  const body = actions.slice(start, end);
  assert.match(body, /const redirectPath = returnPath\(formData\);/);
  assert.match(body, /redirectWithMessageToPath\(redirectPath, templateSavedMessage\("Product template updated\."/);
});

test("createProductTemplate still merges its success redirect onto returnPath(formData) via pathWithParams (unchanged from the prior fix)", () => {
  const start = actions.indexOf("export async function createProductTemplate(formData: FormData)");
  const end = actions.indexOf("\nexport async function updateProductTemplate", start);
  const body = actions.slice(start, end);
  assert.match(body, /pathWithParams\(returnPath\(formData\), \{\s*addTemplate: null,\s*template: template\.id,\s*editTemplate: template\.id,\s*\}\)/);
});

// Part 5: /products/templates?manage=1 stays a supported legacy alias, no forced compatibility redirect.
test("no forced /products/templates?manage=1 compatibility redirect was introduced in page.tsx or actions.ts", () => {
  assert.equal(page.includes('redirect(pathWithParams("/products/manage"'), false, "no new compatibility redirect out of /products/templates?manage=1 should exist yet");
  assert.equal(actions.includes('redirect("/products/manage")'), false, "actions.ts must not redirect to /products/manage on its own");
});

// Permanent delete: allow deletion of archived/discontinued templates used in quotations while
// preserving all historical quotation data.

// Part 8 (migration safety): quotation_item_price_history.source_template_id -> product_templates
// must use ON DELETE SET NULL, never CASCADE, and must never delete or recreate the table/rows.
test("the new migration sets quotation_item_price_history.source_template_id to ON DELETE SET NULL, never CASCADE, and never drops the table or deletes rows", () => {
  assert.match(priceHistoryOnDeleteMigration, /quotation_item_price_history/);
  assert.match(priceHistoryOnDeleteMigration, /source_template_id/);
  assert.match(priceHistoryOnDeleteMigration, /references public\.product_templates \(id\)/);
  assert.match(priceHistoryOnDeleteMigration, /on delete set null/i);
  assert.equal(/on delete cascade/i.test(priceHistoryOnDeleteMigration), false, "quotation price-history rows must never cascade-delete when the source template is deleted");
  assert.equal(/drop table/i.test(priceHistoryOnDeleteMigration), false, "the table must not be recreated");
  assert.equal(/^\s*delete from/im.test(priceHistoryOnDeleteMigration), false, "the migration must never delete existing rows");
});

// CASE 3/4: the lifecycle guard (active templates blocked) and the linked-family hard blocker survive
// unchanged.
test("permanentlyDeleteProductTemplate still blocks active templates and still hard-blocks on linked families", () => {
  const body = permanentlyDeleteProductTemplateBody();
  assert.match(body, /if \(template\.is_active \|\| template\.lifecycle_status === "active"\) \{/, "CASE 4: the active-lifecycle guard must remain unchanged");
  assert.match(body, /\.from\("product_template_linked_families"\)/);
  assert.match(body, /if \(\(linkedFamilyCount \?\? 0\) > 0\) \{/, "CASE 3: linked-family usage must still hard-block permanent deletion, unaffected by quotation usage");
});

// CASE 1: quotation usage is no longer a hard blocker; the function no longer counts/blocks on
// quotation_items at all.
test("permanentlyDeleteProductTemplate no longer counts or blocks on quotation_items usage", () => {
  const body = permanentlyDeleteProductTemplateBody();
  assert.equal(body.includes('.from("quotation_items")'), false, "CASE 1: the quotation_items dependency check must be removed entirely");
  assert.equal(body.includes("quotationItemCount"), false);
  assert.equal(body.includes("used in existing quotations"), false, "the old combined quotation/linked-family blocker message must be gone");
});

// CASE 1/5: quotation_item_price_history rows are detached (source_template_id -> null), never
// deleted, before the product_templates row is removed - and if that detach fails, the delete aborts.
test("permanentlyDeleteProductTemplate nulls quotation_item_price_history.source_template_id before deleting the template, and aborts on failure", () => {
  const body = permanentlyDeleteProductTemplateBody();
  const detachMatch = /\.from\("quotation_item_price_history"\)\s*\.update\(\{ source_template_id: null \}\)\s*\.eq\("source_template_id", id\)/.exec(body);
  assert.ok(detachMatch, "CASE 5: quotation_item_price_history.source_template_id must be explicitly nulled");
  const deleteIndex = body.indexOf('.from("product_templates").delete()');
  assert.ok(deleteIndex > detachMatch.index, "the price-history detach must run before the product_templates delete");
  assert.match(body, /if \(priceHistoryDetachError\) \{/, "a failed detach must be checked");
  const abortIndex = body.indexOf("if (priceHistoryDetachError) {");
  assert.ok(abortIndex < deleteIndex, "the abort-on-failure check must run before the product_templates delete");
  const priceHistoryBlockStart = body.indexOf('.from("quotation_item_price_history")');
  const nextFromCall = body.indexOf(".from(", priceHistoryBlockStart + 1);
  const priceHistoryStatement = body.slice(priceHistoryBlockStart, nextFromCall);
  assert.equal(priceHistoryStatement.includes(".delete()"), false, "quotation_item_price_history rows must never be deleted, only detached");
});

// CASE 2: quotation_items snapshot fields, source_component_data, and commercial fields are never
// written by this function - only the FK's own ON DELETE SET NULL behavior (already audited as safe)
// touches quotation_items.source_template_id, which this function does not update directly.
test("permanentlyDeleteProductTemplate never writes to quotation_items or its snapshot/commercial columns", () => {
  const body = permanentlyDeleteProductTemplateBody();
  assert.equal(body.includes('.from("quotation_items")'), false);
  [
    "specification_snapshot",
    "item_name_snapshot",
    "item_code_snapshot",
    "brand_name_snapshot",
    "finish_selections_snapshot",
    "selected_options_snapshot",
    "internal_components_snapshot",
    "source_component_data",
  ].forEach((field) => {
    assert.equal(body.includes(field), false, `CASE 2: permanentlyDeleteProductTemplate must never reference/mutate ${field}`);
  });
});

// CASE 6: UI state - quotation usage alone is a warning (permanent delete stays available); a linked
// product family remains the sole hard blocker.
test("Archive/Discontinued UI: quotation usage warns (delete available), linked-family usage still hard-blocks", () => {
  assert.equal(page.includes("const deleteBlocked = isUsedInQuotations || isLinked;"), false, "quotation usage must no longer factor into deleteBlocked");
  const deleteBlockedOccurrences = page.split("const deleteBlocked = isLinked;").length - 1;
  assert.equal(deleteBlockedOccurrences, 2, "both the Archive and Discontinued lists must gate deleteBlocked on isLinked only");
  assert.equal(page.split("Linked to product families - cannot delete").length - 1, 2, "the hard-blocker label must remain for linked families in both lists");
  assert.equal(page.includes("Used in quotations - cannot delete"), false, "quotation usage must no longer render as a hard-blocker label");
  const warningOccurrences = page.split("Used in historical quotations. Permanent deletion will preserve saved quotation snapshots, but live source repricing and source navigation will no longer be available.").length - 1;
  assert.equal(warningOccurrences, 2, "both lists must show the quotation-usage warning when not linked");
  const confirmOccurrences = page.split("Continue with permanent deletion?").length - 1;
  assert.equal(confirmOccurrences, 2, "both lists must require the stronger confirmation copy when quotation usage is present");
});

// Part 6 (source repricing untouched): useCurrentSourcePriceForQuotationItem keeps its existing
// safe null-source-template handling unchanged.
test("useCurrentSourcePriceForQuotationItem is unchanged: still reports a friendly message when source_template_id is null, never throws", () => {
  const quotationsActions = readFileSync("app/quotations/actions.ts", "utf8");
  assert.match(quotationsActions, /if \(!item\.source_template_id\) \{\s*redirectWithMessage\(redirectPath, "Line item has no linked source template\."\);\s*\}/);
});
