import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveProductConfigurationState } from "./product-configuration-state.js";

// product-configuration-loader.server.ts has "server-only" + "@/..." aliases, neither resolvable
// by Node's plain ESM resolver outside the Next.js build (and "server-only" itself throws when
// imported outside a server bundling context) - source-level wiring/safety checks, the same
// convention every lib/noa/*.server.ts file in this repo already uses.

const loaderSource = readFileSync("lib/products/product-configuration-loader.server.ts", "utf8");
const builderPageSource = readFileSync("app/quotations/[id]/builder/page.tsx", "utf8");

// ── Test 1: auth before DB access ────────────────────────────────────────────────────────────

test("1. requireProductLibraryManager() is called and awaited before any Supabase query", () => {
  const authIndex = loaderSource.indexOf("await requireProductLibraryManager();");
  const firstQueryIndex = loaderSource.indexOf(".from(\"product_templates\")");
  assert.ok(authIndex >= 0 && firstQueryIndex >= 0 && authIndex < firstQueryIndex);
});

// ── Test 2: user-scoped Supabase client only ─────────────────────────────────────────────────

test("2. uses the normal user-scoped Supabase client - never an admin/service-role client", () => {
  assert.ok(loaderSource.includes('import { createClient } from "@/lib/supabase/server";'));
  assert.ok(!/createAdminClient|service_role|SUPABASE_SERVICE_ROLE/i.test(loaderSource));
  assert.ok(!loaderSource.includes("profileId") && !loaderSource.includes("userId"));
});

// ── Test 3: query constrained by template id ─────────────────────────────────────────────────

test("3. the template query is filtered by the requested id, single row only", () => {
  assert.ok(loaderSource.includes('.eq("id", templateId)'));
  assert.ok(loaderSource.includes(".maybeSingle<TemplateRow>()"));
});

// ── Test 4: select includes all four configuration JSON fields ─────────────────────────────────

test("4. TEMPLATE_SELECT includes all four configuration JSON columns", () => {
  for (const column of ["variant_pricing", "category_pricing", "accessory_pricing", "desking_size_pricing"]) {
    assert.ok(loaderSource.includes(column), column);
  }
});

// ── Test 5: no images/image_settings ─────────────────────────────────────────────────────────

test("5. no image/reference/AI-setup/audit fields are ever selected", () => {
  const selectStart = loaderSource.indexOf("const TEMPLATE_SELECT =");
  const selectEnd = loaderSource.indexOf(";", selectStart);
  const selectText = loaderSource.slice(selectStart, selectEnd);
  assert.ok(!/image|reference_image|proposed_image|image_settings|created_at|price_check|price_notes/i.test(selectText));
});

// ── Test 6: brand query constrained to one brand id ──────────────────────────────────────────

test("6. the brand query is filtered by the template's own brand_id, single row only", () => {
  assert.ok(loaderSource.includes('.eq("id", template.brand_id)'));
  assert.ok(loaderSource.includes(".maybeSingle<BrandRow>()"));
});

// ── Tests 7-10: DB row -> GPC-1 mapping, field-by-field ──────────────────────────────────────

test("7-8. mapToTemplateInput renames default_unit_price -> defaultUnitPrice (and every other field) without recalculating it", () => {
  const fnStart = loaderSource.indexOf("function mapToTemplateInput");
  const fnEnd = loaderSource.indexOf("\n// PART 2:", fnStart);
  const fnBody = loaderSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("defaultUnitPrice: template.default_unit_price,"));
  assert.ok(fnBody.includes("templateName: template.template_name,"));
  assert.ok(fnBody.includes("internalSelectionName: template.internal_selection_name,"));
  assert.ok(fnBody.includes("itemCode: template.item_code,"));
  assert.ok(fnBody.includes("templateCode: template.template_code,"));
  assert.ok(fnBody.includes("supplierName: template.supplier_name,"));
  assert.ok(fnBody.includes("defaultSpecification: template.default_specification,"));
  assert.ok(!/[+\-*/]\s*template\.default_unit_price|template\.default_unit_price\s*[+\-*/]/.test(fnBody));
});

test("9. variant/category/accessory/desking JSON are passed through unchanged - no parsing/normalizing", () => {
  const fnStart = loaderSource.indexOf("function mapToTemplateInput");
  const fnEnd = loaderSource.indexOf("\n// PART 2:", fnStart);
  const fnBody = loaderSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("variantPricing: template.variant_pricing,"));
  assert.ok(fnBody.includes("categoryPricing: template.category_pricing,"));
  assert.ok(fnBody.includes("accessoryPricing: template.accessory_pricing,"));
  assert.ok(fnBody.includes("deskingSizePricing: template.desking_size_pricing,"));
  assert.ok(!/JSON\.parse|JSON\.stringify/.test(fnBody));
});

test("10. a null JSON column is passed through as-is (undefined/null), the exact fallback GPC-1 already accepts", () => {
  const state = resolveProductConfigurationState({
    id: "tmpl-null-json",
    templateName: "No Configuration Data",
    currency: "AED",
    defaultUnitPrice: 500,
    variantPricing: null,
    categoryPricing: null,
    accessoryPricing: null,
    deskingSizePricing: null,
  });
  assert.equal(state.price.base, 500);
  assert.equal(state.nextRequiredStep, null);
  assert.equal(state.steps.length, 1); // quantity only
});

// ── Test 11: template not found ──────────────────────────────────────────────────────────────

test("11. a missing template row returns a deterministic not_found result, never a throw", () => {
  assert.ok(loaderSource.includes('if (!template) return { ok: false, reason: "not_found" };'));
});

// ── Test 12: brand name/origin/default currency mapping ─────────────────────────────────────

test("12. brand.name maps into template.brandName; brand.origin/default_currency are selected but never override template.currency without proof", () => {
  assert.ok(loaderSource.includes("mapToTemplateInput(template, brand.name)"));
  assert.ok(loaderSource.includes("brandName,"));
  // No documented brand-currency fallback exists in the current selector/builder page (verified
  // during inspection: brand.default_currency is selected there but never read/used as a
  // template-currency fallback) - GPC-2 does not invent one either.
  assert.ok(!/brand\.default_currency/.test(loaderSource.slice(loaderSource.indexOf("function mapToTemplateInput"))));
});

// ── Test 13: no full-library fetch ───────────────────────────────────────────────────────────

test("13. never queries all product_templates, all brands, or all categories", () => {
  assert.equal((loaderSource.match(/\.from\("product_templates"\)/g) ?? []).length, 1);
  assert.equal((loaderSource.match(/\.from\("brands"\)/g) ?? []).length, 1);
  assert.ok(!loaderSource.includes('.from("product_categories")'));
  // No .order()/.limit() anywhere - both queries are single-row lookups via .eq(id) + .maybeSingle().
  assert.ok(!loaderSource.includes(".order("));
  assert.ok(!loaderSource.includes(".limit("));
  assert.ok(loaderSource.includes(".maybeSingle<TemplateRow>()") && loaderSource.includes(".maybeSingle<BrandRow>()"));
});

// ── Test 14: no linked child-template loading ────────────────────────────────────────────────

test("14. does not query product_template_linked_families or any child template", () => {
  assert.ok(!loaderSource.includes("product_template_linked_families"));
  assert.ok(!loaderSource.includes("linked_template_id"));
});

// ── Test 15: no price/specification calculation in the loader ───────────────────────────────

test("15. the loader never calculates a configured price/specification/dimension - GPC-1 remains the sole evaluator", () => {
  // Excludes comment lines: the file's own header prose references resolveProductConfigurationState()
  // by name (explaining why it's NOT called here) - only actual code lines matter for this check.
  const codeOnly = loaderSource.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!codeOnly.includes("resolveProductConfigurationState"));
  assert.ok(!/roundSourceAmount|sameCurrencyUnitSum|baseModelPriceOrDefault/.test(codeOnly));
});

// ── Lifecycle semantics: reused from the existing builder-page query, not invented ──────────

test("lifecycle usability check matches the existing 'available to configure' query exactly (is_active && lifecycle_status === 'active')", () => {
  assert.ok(loaderSource.includes('return template.is_active && template.lifecycle_status === "active";'));
  assert.ok(builderPageSource.includes('.eq("is_active", true)') && builderPageSource.includes('.eq("lifecycle_status", "active")'));
});

// ── PART 12 (optional): engine smoke test with a minimal loader-shaped fixture ──────────────

test("engine smoke test: a minimal loader-shaped ProductConfigurationTemplateInput is accepted by resolveProductConfigurationState", () => {
  const state = resolveProductConfigurationState({
    id: "tmpl-smoke",
    templateName: "MONOLITH",
    internalSelectionName: null,
    itemCode: "MNLT-01",
    templateCode: "MNLT",
    supplierName: "Acme",
    brandName: "Acme Furniture",
    origin: "Italy",
    currency: "AED",
    defaultUnitPrice: 1200,
    defaultSpecification: "Executive desk",
    description: null,
    variantPricing: [],
    categoryPricing: [],
    accessoryPricing: [],
    deskingSizePricing: [],
  });
  assert.equal(state.price.base, 1200);
  assert.equal(state.price.currency, "AED");
  assert.equal(state.nextRequiredStep, null);
});
