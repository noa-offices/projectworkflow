import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mirrored = [
  ["app/quotations/actions.ts", "const basePrice = calculationNumber(selectedSize.default_price", "const selectedOptionNames =", "a7452cb3cc9ef4ec7c578c8f8e855ff7d6cfe0f234118f8d01176202adba3c10"],
  ["app/quotations/actions.ts", "const selectedVariantPricingRow = selectedVariantPricing(formData, template.variant_pricing);", "const derivedDesking = isDesking", "c9f460f4aa0fe6f51d665509b087e6985b5c285c90ff1d3d7a21735f84edfcc2"],
  ["app/quotations/actions.ts", "const selectedOptionPrice = money(", "const matchingLinkedProductsTotal = money(", "d209e978c92f2f98f815ff1c23d3f7ed4a28b840bc2cffdd649a8eca89d21df1"],
  ["app/quotations/actions.ts", "const baseUnitPrice = derivedDesking", "const nonAedCurrencies = Array.from(originalCurrencyTotals.entries())", "e37334068c9d35d7a5514ff97dce310eaaefac3b586ecb8d9b1923e7851d88e8"],
  ["components/quotations/product-library-selector.tsx", "const requiredComponentTrigger = requiredComponentTriggerKey", "const overriddenRequiredComponents = requiredComponentOverrideReport", "4dd52254f0c30d8a09ae4d98bf95822d97068c3dfeb2530c27d76d6ba67632a9"],
  ["components/quotations/product-library-selector.tsx", "const baseProductPrice =", "const nonAedCurrencies = Array.from(originalCurrencyTotals.keys())", "189a179b953432cec57964c2ee0fce8e04e783ee5b6edf60ff0b2fdd7edd7a0e"],
  ["components/quotations/product-library-selector.tsx", "const effectiveSelectedIds = Array.from(groupedOptions.entries())", "const effectiveSelectedNames =", "ff9c38148ff254386fb2136a195c4b6b271cf7c7f461e8977bc4c11426de8c85"],
  ["components/quotations/product-library-selector.tsx", "const selectedPricingAccessories = allAccessoryGroups", "const matchingAccessoryTotal =", "d0566b39ca4f53fbf774a435d4072d8e50e9da7634891ea75d73c3a712cbdfae"],
  // One pricing mode per line (modularInUse): the lines below decide when modular pricing applies and when a Base / Model or Price Matrix choice prices the line.
  ["app/quotations/actions.ts", "const modularInUse = usesModularPricing && modularGroups.some", "const configuredDimensionInput =", "9c8e0c52c6ae656146bd836498060b8e4ae2e5545e4ca3a9c3e08c050b3a5e5a"],
  ["app/quotations/actions.ts", "// Neither mode used: a modular template needs a modular item", "// Opt-in one-way-only (modular_excludes_base_models)", "527e28a1cca61fa5902ed6991cf528a07557e922d72fe6e4ceafca37e6fbfeaa"],
  ["components/quotations/product-library-selector.tsx", "const modularInUse = usesModularPricing && selectedModularItems.length > 0;", "const modularCompositionIssue = validateModularCompositionGroups(", "547be78a59490706e338b1e75fda3455c9057c6dfbe0aac02057c7d92121b645"],
  ["components/quotations/product-library-selector.tsx", "const previewUnitPrice =", "const selectedLinkedProducts = templateLinkedFamilies", "69255097dbc58a67575655c211047b8f771767de4251c774ef64f83fb7282379"],
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
