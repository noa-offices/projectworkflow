import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canApproveBrandPrices } from "./brand-price-permissions";
import { canConfirmCoverage, coverageChoices } from "./supplier-coverage-popup";
import type { SupplierSourceDefinitionSummary } from "./supplier-price-contracts";

const definition = (id: string, name: string, extra: Partial<SupplierSourceDefinitionSummary> = {}): SupplierSourceDefinitionSummary => ({ id, name, profileId: null, isActive: true, confirmedFamilyCount: 2, latestSource: null, ...extra });

test("the popup lists only active definitions by name and never pre-selects one", () => {
  const choices = coverageChoices([definition("b", "LAS Furniture"), definition("c", "Old", { isActive: false }), definition("a", "LAS Chairs", { latestSource: { id: "s", title: "2026 list", receivedAt: null } })]);
  assert.deepEqual(choices.map((choice) => choice.name), ["LAS Chairs", "LAS Furniture"]);
  assert.match(choices[0].detail, /2026 list/);
  assert.match(choices[1].detail, /no price list imported yet/);
  assert.equal(canConfirmCoverage(choices, "", false), false);
});

test("confirm needs an offered choice and is blocked while busy", () => {
  const choices = coverageChoices([definition("a", "LAS Chairs")]);
  assert.equal(canConfirmCoverage(choices, "a", false), true);
  assert.equal(canConfirmCoverage(choices, "a", true), false);
  assert.equal(canConfirmCoverage(choices, "other", false), false);
});

test("only Supplier price editors may add coverage; other roles get the read-only note", () => {
  assert.equal(canApproveBrandPrices("procurement_manager", "active"), true);
  assert.equal(canApproveBrandPrices("procurement_manager", "disabled"), false);
  assert.equal(canApproveBrandPrices("sales_designer", "active"), false);
  const action = readFileSync("components/quotations/supplier-coverage-popup-actions.ts", "utf8");
  assert.match(action, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.match(action, /throw Error\("Brand price approver permission required\."\)/);
  const popup = readFileSync("components/quotations/supplier-coverage-popup.tsx", "utf8");
  assert.match(popup, /allowed !== true/);
  assert.match(popup, /Ask a Supplier price manager/);
});

test("the popup uses the existing action, stays in place and the badge no longer links away", () => {
  const popup = readFileSync("components/quotations/supplier-coverage-popup.tsx", "utf8");
  assert.match(popup, /assignFamilyToSupplierSource\(choice\.id, templateId\)/);
  assert.doesNotMatch(popup, /router|window\.location|<Link/);
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /<SupplierCoverageAction brandId=\{template\.brand_id\} templateId=\{template\.id\}/);
  assert.doesNotMatch(selector, /<Link href=\{supplierPresentation\.actionHref\}/);
});
