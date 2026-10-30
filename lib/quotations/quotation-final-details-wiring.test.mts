import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCompanyStyleProductSpecification, resolveProductDimensionSnapshot, resolveProductOriginSnapshot } from "./product-template-snapshot.js";
import { formatBrandOriginSupplier } from "./format-quotation-row.js";

const selector = readFileSync(new URL("../../components/quotations/product-library-selector.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../../app/quotations/actions.ts", import.meta.url), "utf8");
const generator = selector.split("const companyStyleSpecification = buildCompanyStyleProductSpecification({")[1].split("const localSpecification")[0];
test("quotation specification generation does not append brand and origin metadata", () => {
  assert.doesNotMatch(generator, /\b(?:brand|origin):/);
  const source = { default_specification: "Italian leather with 18 mm panels", description: null };
  const copy = structuredClone(source);
  const result = buildCompanyStyleProductSpecification({ accessorySnapshots: [], linkedProductSnapshots: [], selectedOptionSnapshots: [], template: source });
  assert.equal(result, "Italian leather with 18 mm panels.");
  assert.deepEqual(source, copy);
});
test("model dimensions and manufacturer origin resolve from existing inputs", () => {
  assert.equal(resolveProductDimensionSnapshot({ selectedVariantDimension: "120 x 60 cm" }), "120 x 60 cm");
  assert.equal(resolveProductDimensionSnapshot({ selectedVariantDimension: "160 x 80 cm" }), "160 x 80 cm");
  assert.equal(resolveProductOriginSnapshot(null, "Italy"), "Italy");
  assert.equal(formatBrandOriginSupplier({ brandName: "LAS MOBILI", origin: "Italy" }).primaryLine, "LAS MOBILI - Italy");
});
test("local and server save paths use quotation snapshot fields", () => {
  for (const field of ["brand_name_snapshot: quotationBrand", "origin_snapshot: quotationOrigin", "size_snapshot: quotationDimension", "specification_snapshot: savedFinalSpecification"]) assert.ok(selector.includes(field), field);
  for (const field of ["quotation_brand_override", "quotation_origin_override", "quotation_dimension_override"]) assert.ok(selector.includes(`name="${field}"`) && action.includes(`optionalTextValue(formData, "${field}")`), field);
});

test("display consumers use snapshot values and conservative duplicate suppression", () => {
  const builder = readFileSync(new URL("../../components/quotations/local-quotation-builder.tsx", import.meta.url), "utf8");
  const pdf = readFileSync(new URL("../../components/quotations/quotation-pdf-document.tsx", import.meta.url), "utf8");
  const specification = readFileSync(new URL("../../app/quotations/[id]/specification/page.tsx", import.meta.url), "utf8");
  assert.ok(builder.includes("specificationWithoutDuplicateDimension(item.specification_snapshot, item.size_snapshot)"));
  assert.ok(pdf.includes("specificationWithoutDuplicateDimension(item.specification_snapshot, item.size_snapshot)"));
  assert.ok(specification.includes("specificationWithoutDuplicateDimension(item.specification_snapshot, item.size_snapshot)"));
  assert.ok(pdf.includes("brandName: item.brand_name_snapshot"));
  assert.ok(pdf.includes("origin: item.origin_snapshot"));
});


test("Improve retains the target request and suggestion safeguards", () => {
  assert.match(selector, /currentSpecification: specificationForAi\(finalSpecification/);
  assert.match(selector, /keepDimensionLine\(finalSpecification \?\? null, specification\)/);
  assert.match(selector, /check=\{\{/);
});
