import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// The standalone accessory rules and accessory prices moved here from product-library-selector.tsx; gallery-price.ts,
// the server action and the linked-product popup follow the same rules. A change here must be reviewed in all of them.
const source = readFileSync(new URL("./accessory-rule-setup.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hash = (start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from, start);
  return createHash("sha256").update(source.slice(from, to).trim()).digest("hex");
};

test("review gallery-price.ts and app/quotations/actions.ts when the shared accessory rules or prices change", () => {
  assert.equal(hash("export function evaluateAccessoryRules", "/** Target quantities"), "9377281eb0ea6af999c953d2d271ea24ce747a564962123215bebd2785b636ab", "accessory rules changed: update the gallery and server mirrors too");
  assert.equal(hash("export function accessoryPriceLines", "\n}\n"), "7d25d8772518f6757a90471ed933e240fb654bfe6c412bc167a4101b38b7fcc3", "accessory prices changed: update the gallery and server mirrors too");
});

test("the selector uses the shared rules and prices, including the option-item second pass", () => {
  const selector = readFileSync(new URL("../../components/quotations/product-library-selector.tsx", import.meta.url), "utf8");
  assert.ok(selector.includes('from "@/lib/products/accessory-rule-setup"'));
  assert.ok(selector.includes("ordinaryOptionDependentItemIds.has(itemId) ? optionItemRequiredTrigger : requiredComponentTrigger"));
  assert.ok(source.includes("hasOrdinaryOptionItemRules(optionItemGroups)"));
  assert.ok(source.includes("deriveOptionItemTargets({ groups: optionItemGroups, activeQuantities: firstPass.activeQuantities })"));
  assert.ok(source.includes("optionItemPassEnabled ? withoutOrdinaryOptionItemDependentQuantities(optionItemGroups, quantities) : quantities"));
});
