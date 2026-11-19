import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirrored = [
  ["app/quotations/actions.ts", "const basePrice = calculationNumber(selectedSize.default_price", "const selectedOptionNames =", "a7452cb3cc9ef4ec7c578c8f8e855ff7d6cfe0f234118f8d01176202adba3c10"],
  ["app/quotations/actions.ts", "const selectedVariantPricingRow = selectedVariantPricing(formData, template.variant_pricing);", "const derivedDesking = isDesking", "2d07d9728e45392024ad480e9d7cf2269659a9d234e4e2c607bb0eba180a9e8d"],
  ["app/quotations/actions.ts", "const selectedOptionPrice = money(", "const matchingLinkedProductsTotal = money(", "d209e978c92f2f98f815ff1c23d3f7ed4a28b840bc2cffdd649a8eca89d21df1"],
  ["app/quotations/actions.ts", "const baseUnitPrice = derivedDesking", "const nonAedCurrencies = Array.from(originalCurrencyTotals.entries())", "c227cab0b6479920ca0033b843aefc3332ac5ebb778e8ae9572289d758ed93e7"],
  ["components/quotations/product-library-selector.tsx", "const requiredComponentTrigger = requiredComponentTriggerKey", "const overriddenRequiredComponents = requiredComponentOverrideReport", "4dd52254f0c30d8a09ae4d98bf95822d97068c3dfeb2530c27d76d6ba67632a9"],
  ["components/quotations/product-library-selector.tsx", "const baseProductPrice =", "const nonAedCurrencies = Array.from(originalCurrencyTotals.keys())", "fd4b670093b4629baed2153ad7efb7d4d72f0d902be32780670883a8b9892099"],
  ["components/quotations/product-library-selector.tsx", "const effectiveSelectedIds = Array.from(groupedOptions.entries())", "const effectiveSelectedNames =", "ff9c38148ff254386fb2136a195c4b6b271cf7c7f461e8977bc4c11426de8c85"],
  ["components/quotations/product-library-selector.tsx", "const selectedPricingAccessories = allAccessoryGroups", "const matchingAccessoryTotal =", "d0566b39ca4f53fbf774a435d4072d8e50e9da7634891ea75d73c3a712cbdfae"],
] as const;

test("review the gallery price mirror when quote source pricing changes", () => {
  for (const [file, start, end, expected] of mirrored) {
    const source = read(`../../../${file}`);
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + 1);
    const message = `${file}: ${start} - gallery-price.ts mirrors this code; update both`;
    assert.ok(from >= 0 && to > from, message);
    assert.equal(createHash("sha256").update(source.slice(from, to).trim()).digest("hex"), expected, message);
  }
});

test("separate gallery price files never use an elevated database client", () => {
  for (const file of ["./gallery-price.ts", "./gallery-price-service.ts", "./gallery-actions.ts"]) {
    assert.doesNotMatch(read(file), /createAdminClient|supabase\/admin|service_role|SUPABASE_SERVICE/i, file);
  }
});
