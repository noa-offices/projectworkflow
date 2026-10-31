import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedPricingVersion, pricingConflictMessage } from "./pricing-write-version";

const read = (path: string) => readFileSync(path, "utf8");
const productSelect = (source: string) => source.match(/\.from\("product_templates"\)\s*\.select\(\s*"([^"]+)"/)?.[1] ?? "";

test("a template without pricing_version can never be saved: the form sends an empty token and the action reports 'changed'", () => {
  // product-template-form.tsx sends `template.pricing_version ?? ""`; a template loaded without the column therefore sends "".
  assert.match(read("components/products/product-template-form.tsx"), /name="expected_pricing_version" value=\{template\.pricing_version \?\? ""\}/);
  assert.equal(expectedPricingVersion(""), null);
  assert.equal(expectedPricingVersion(undefined), null);
  assert.equal(pricingConflictMessage, "This Product Template changed. Reload before saving.");
  // Both save paths used by Edit Template and Smart Setup stop on a missing token with that same message.
  const actions = read("app/products/templates/actions.ts");
  assert.match(actions, /const expectedVersion = expectedPricingVersion\(formData\.get\("expected_pricing_version"\)\);\s*if \(expectedVersion === null\) return \{ ok: false, message: pricingConflictMessage \};/);
  // With the version present, the token is accepted as number or text.
  assert.equal(expectedPricingVersion(5), "5");
  assert.equal(expectedPricingVersion("5"), "5");
});

test("every page that feeds the Product Library in the quotation builder loads pricing_version", () => {
  for (const page of ["app/quotations/[id]/local-builder/page.tsx", "app/quotations/[id]/builder/page.tsx"]) {
    const columns = productSelect(read(page)).split(",");
    assert.ok(columns.includes("pricing_version"), `${page} must select pricing_version`);
    assert.ok(columns.includes("variant_pricing") && columns.includes("accessory_pricing"), `${page} is the Product Library template loader`);
  }
});

test("after a successful save the returned template carries the new version, so the next save works too", () => {
  const actions = read("app/products/templates/actions.ts");
  assert.match(actions, /const productLibraryTemplateSelect =\s*"creation_legacy,pricing_version,/);
  assert.match(actions, /template: await fetchProductLibraryTemplateForClient\(supabase, id\)/);
});
