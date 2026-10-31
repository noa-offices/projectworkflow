import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { buildPriceLines, priceLineLimit } from "./supplier-price-lines";

const target = (key: string, template_id: string, price: number | null, extra: Partial<PriceTarget> = {}) => ({ key, template_id, template_name: "T", brand_id: "b", architecture: "a", group_id: "g", row_id: "r", column_id: "c", dimension: "", price_field: "unit_price", physical_field: "unit_price", code: key, raw_code: key.toUpperCase(), price, currency: "AED", pricing_version: "1", label: "Base", ...extra }) as PriceTarget;
const source = (price: number | null, currency = "AED") => ({ key: "s", code: "x", price_field: "unit_price", dimension: "", finishes: [], price, currency, row_keys: [], issues: [] }) as PriceMatch["source"];
const match = (key: string, classification: PriceMatch["classification"], targets: PriceTarget[], src: PriceMatch["source"] = source(10)): PriceMatch => ({ key, source: src, targets, classification, candidate_shared: false });

test("only this template's targets become lines, with the right states and differences", () => {
  const { lines } = buildPriceLines([
    match("1", "increased", [target("a1", "T1", 8)]),
    match("2", "unchanged", [target("a2", "T1", 10)]),
    match("3", "unchanged", [target("other", "T2", 10)]),
    match("4", "unmatched", [], source(5)),
    match("5", "target_not_represented", [target("a5", "T1", 3)], null),
    match("6", "needs_dimension_mapping", [target("a6", "T1", 1)]),
    match("7", "increased", [target("a7", "T1", 8)], source(10, "EUR")),
  ], "T1");
  assert.deepEqual(lines.map((line) => [line.code, line.state, line.difference]), [["A1", "changed", 2], ["A2", "same", 0], ["A5", "not_in_supplier_list", null], ["A6", "needs_mapping", 10 - 1], ["A7", "changed", null]]);
  assert.equal(lines.find((line) => line.code === "A5")?.supplierPrice, null);
});

test("an empty or unrelated match set gives no lines and long sets are capped", () => {
  assert.deepEqual(buildPriceLines([], "T1"), { lines: [], truncated: false });
  const many = Array.from({ length: priceLineLimit + 3 }, (_, index) => match(`m${index}`, "unchanged", [target(`k${index}`, "T1", 1)]));
  const capped = buildPriceLines(many, "T1");
  assert.equal(capped.lines.length, priceLineLimit);
  assert.equal(capped.truncated, true);
});

test("the action is role-checked, read-only and the button is for allowed roles on covered supplier products", () => {
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.match(action, /throw Error\("Brand price approver permission required\."\)/);
  assert.doesNotMatch(action, /supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|revalidatePath/);
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /if \(allowed !== true\) return null/);
  assert.match(popup, /Read only\. Nothing is saved here\./);
  assert.doesNotMatch(popup, /router|window\.location|<Link/);
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /!compact && supplierPresentation && !supplierPresentation\.actionHref \? <SupplierPriceLinesAction/);
});

test("summary counts and attention-first filtering keep the code order inside each group", async () => {
  const { summarizePriceLines, filterAndOrderPriceLines } = await import("./supplier-price-lines");
  const line = (code: string, state: import("./supplier-price-lines").PriceLineState) => ({ key: code, code, field: "", ourPrice: 1, ourCurrency: "AED", supplierPrice: 1, supplierCurrency: "AED", difference: 0, state });
  const lines = [line("A", "same"), line("B", "changed"), line("C", "same"), line("D", "needs_mapping"), line("E", "shared"), line("F", "not_in_supplier_list")];
  // A confirmed shared line (E) is fine, like Same: it counts in Same, not in Other or Needs attention.
  assert.deepEqual(summarizePriceLines(lines), { same: 3, changed: 1, needsMapping: 1, other: 1, shared: 1 });
  assert.deepEqual(filterAndOrderPriceLines(lines, "all").map((item) => item.code), ["D", "B", "F", "A", "C", "E"]);
  assert.deepEqual(filterAndOrderPriceLines(lines, "attention").map((item) => item.code), ["D", "B", "F"]);
  assert.deepEqual(filterAndOrderPriceLines(lines, "same").map((item) => item.code), ["A", "C", "E"]);
});

test("the popup keeps the read-only note, filters, sticky header and plain column names", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  for (const text of ["Read only. Nothing is saved here.", "Needs attention", "sticky top-0", "Your price", "Supplier price", "Difference", "Status", "sm:w-[min(1180px,96vw)]"]) assert.ok(popup.includes(text), text);
  assert.doesNotMatch(popup, /router|window\.location|<Link|supplierWrite/);
});

const identity = (key: string, code: string, dimension: string, price: number, currency = "EUR") => ({ key, code, price_field: "unit_price", dimension, raw_dimension: dimension, finishes: [], price, currency, row_keys: [], issues: [] }) as unknown as NonNullable<PriceMatch["source"]>;
const scalarTarget = (key: string, template_id: string, price: number, currency: "AED" | "EUR" | "USD" = "EUR") => target(key, template_id, price, { code: "159983", raw_code: "159 983", currency, dimension: "" });
const realMatches = async (sources: NonNullable<PriceMatch["source"]>[], targets: PriceTarget[], bindings: Array<{ id: string; code: string; price_field: string; source_dimension: string; target_keys: string[]; kind: "alias" | "shared" | "disambiguation"; confirmed: boolean }> = []) => (await import("./supplier-price-matching")).matchSupplierPrices(sources, targets, [], bindings);

test("a Needs-mapping line with one target and one tier can be mapped, and the preview shows the result without writing", async () => {
  const matches = await realMatches([identity("s1", "159983", "Cat A", 702)], [scalarTarget("t1", "T1", 702)]);
  const [line] = buildPriceLines(matches, "T1").lines;
  assert.equal(line.state, "needs_mapping");
  assert.deepEqual(line.mapping, { code: "159983", priceField: "unit_price", sourceDimension: "Cat A", tierLabel: "Cat A", targetKey: "t1", pricingVersion: "1", targetPrice: 702, targetCurrency: "EUR", preview: "same" });
  const changed = buildPriceLines(await realMatches([identity("s1", "159983", "Cat A", 750)], [scalarTarget("t1", "T1", 702)]), "T1").lines[0];
  assert.equal(changed.mapping?.preview, "changed");
});

test("no Map button when the code has several supplier tiers, several product targets, another product, or a saved mapping", async () => {
  const several = buildPriceLines(await realMatches([identity("s1", "159983", "Cat A", 702), identity("s2", "159983", "Cat B", 702)], [scalarTarget("t1", "T1", 702)]), "T1").lines;
  assert.ok(several.length > 0 && several.every((line) => line.mapping === undefined), "several tiers");
  const targets = buildPriceLines(await realMatches([identity("s1", "159983", "Cat A", 702)], [scalarTarget("t1", "T1", 702), scalarTarget("t2", "T1", 702)]), "T1").lines;
  assert.ok(targets.length > 0 && targets.every((line) => line.mapping === undefined), "several targets");
  const shared = buildPriceLines(await realMatches([identity("s1", "159983", "Cat A", 702)], [scalarTarget("t1", "T1", 702), scalarTarget("t2", "T2", 702)]), "T1").lines;
  assert.ok(shared.every((line) => line.mapping === undefined), "a code used by another product");
});

test("a saved mapping is reported with its id, offers Remove only, and a duplicate pair of mappings is ignored like the matcher does", async () => {
  const binding = { id: "b1", code: "159 983", price_field: "unit_price", source_dimension: "Cat A", target_keys: ["t1"], kind: "alias" as const, confirmed: true };
  const sources = [identity("s1", "159983", "Cat A", 702)];
  const matches = await realMatches(sources, [scalarTarget("t1", "T1", 702)], [binding]);
  const [line] = buildPriceLines(matches, "T1", [binding]).lines;
  assert.equal(line.state, "same");
  assert.deepEqual(line.binding, { id: "b1", kind: "alias" });
  assert.equal(line.mapping, undefined);
  assert.equal(buildPriceLines(matches, "T1", [binding, { ...binding, id: "b2", code: "159983" }]).lines[0].binding, undefined);
  assert.equal(buildPriceLines(matches, "T1", [{ ...binding, confirmed: false }]).lines[0].binding, undefined);
});

test("the popup saves or removes only from the confirm click, through the existing actions, with the brand-wide warning", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /import \{[^}]*confirmSupplierBindings[^}]*removeSupplierBinding[^}]*\} from "@\/app\/products\/price-updates\/supplier-sources\/actions"/);
  assert.equal((popup.match(/await confirmSupplierBindings\(/g) ?? []).length, 2, 'one save for Map this line and one for Map as shared');
  assert.equal((popup.match(/await removeSupplierBinding\(/g) ?? []).length, 1);
  assert.match(popup, /kind: "alias", target_keys: \[mapping\.targetKey\]/);
  assert.match(popup, /This is saved for the whole brand and for future price lists\./);
  assert.match(popup, /if \(allowed !== true\) return null/);
  // Both writes sit inside confirm(); the buttons only open the confirm step.
  const confirm = popup.slice(popup.indexOf("const confirm = async"), popup.indexOf("} finally { setBusy(false); }"));
  assert.ok(confirm.includes("confirmSupplierBindings(") && confirm.includes("removeSupplierBinding("));
  assert.doesNotMatch(popup.replace(confirm, ""), /confirmSupplierBindings\(|removeSupplierBinding\(/);
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.doesNotMatch(action, /supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|revalidatePath/);
});

const changedLines = async (ourPrice: number | null, supplierPrice = 110, extra: { supplierCurrency?: "EUR" | "AED" } = {}) => {
  const sources = [identity("s1", "159983", "", supplierPrice, extra.supplierCurrency ?? "EUR")];
  return buildPriceLines(await realMatches(sources, [{ ...scalarTarget("t1", "T1", 100), price: ourPrice }]), "T1").lines;
};

test("Use supplier price is offered only for one changed single-target line with a price", async () => {
  const [lower] = await changedLines(100), [higher] = await changedLines(120);
  assert.equal(lower.state, "changed");
  assert.deepEqual(lower.apply, { matchKey: "s1", targetKey: "t1", batchId: null });
  assert.equal(higher.state, "changed");
  assert.ok(higher.apply);
  const [same] = await changedLines(110);
  assert.deepEqual([same.state, same.apply, same.applyHint], ["same", undefined, undefined]);
});

test("empty prices get a hint to set them by hand, never a button; other currencies, shared and unclear lines get neither", async () => {
  const [empty] = await changedLines(null, 0);
  assert.deepEqual([empty.state, empty.apply, empty.applyHint], ["changed", undefined, "set_by_hand"]);
  const [currency] = await changedLines(100, 110, { supplierCurrency: "AED" });
  assert.deepEqual([currency.state, currency.apply, currency.applyHint], ["changed", undefined, undefined]);
  const twoTargets = [{ ...scalarTarget("t1", "T1", 33) }, { ...scalarTarget("t2", "T1", 33) }];
  const unclear = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], twoTargets), "T1").lines;
  assert.ok(unclear.length === 2 && unclear.every((line) => line.state === "ambiguous" && !line.apply && !line.applyHint));
  const shared = { id: "b", code: "159983", price_field: "unit_price", source_dimension: "", target_keys: ["t1", "t2"], kind: "shared" as const, confirmed: true };
  const sharedLines = buildPriceLines(await realMatches([identity("s1", "159983", "", 40)], twoTargets, [shared]), "T1", [shared]).lines;
  assert.ok(sharedLines.length === 2 && sharedLines.every((line) => line.state === "shared" && !line.apply && !line.applyHint));
});

test("the lines action only reads: it attaches a batch only when the open review holds the same line", () => {
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /review\.status === "review"/);
  assert.match(action, /\["increased", "decreased", "changed"\]\.includes\(stored\.classification\)/);
  assert.match(action, /stored\.targets\[0\]\.key === line\.apply!\.targetKey/);
  assert.match(action, /stored\.targets\[0\]\.price === line\.ourPrice && stored\.source\?\.price === line\.supplierPrice/);
  assert.match(action, /applyHint: "old_review"/);
  assert.doesNotMatch(action, /supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|revalidatePath|saveSupplierDecision|applySupplierReviewedPrice/);
});

test("the popup writes a price only from the confirm click: review mark first, then the price, once each, with the plain warning", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  const confirm = popup.slice(popup.indexOf("const confirm = async"), popup.indexOf("} finally { setBusy(false); }"));
  assert.equal((popup.match(/await saveSupplierDecision\(/g) ?? []).length, 1);
  assert.equal((popup.match(/await applySupplierReviewedPrice\(/g) ?? []).length, 1);
  assert.ok(confirm.indexOf('await saveSupplierDecision(batchId, matchKey, "reviewed", "")') > 0 && confirm.indexOf("await saveSupplierDecision(") < confirm.indexOf("await applySupplierReviewedPrice(batchId, matchKey)"), "the decision is saved before the price is applied");
  assert.doesNotMatch(popup.replace(confirm, ""), /saveSupplierDecision\(|applySupplierReviewedPrice\(/, "no write outside confirm");
  assert.match(popup, /The product price was not changed\./);
  assert.match(popup, /This changes the product price\. Saved quotations do not change\. The old price stays in the price history\. There is no undo button; a price can be set back by hand\./);
  assert.match(popup, /line\.apply\?\.batchId \? <button/);
  assert.match(popup, /Start the review for this price list first\./);
  assert.match(popup, /This price is empty\. Set it by hand in Edit Template\./);
  assert.match(popup, /if \(allowed !== true\) return null/);
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(actions.match(/export async function applySupplierReviewedPrice[\s\S]*?\n\}/)?.[0] ?? "", /await approver\(\)/);
});

const sharedBinding = { id: "sb", code: "159983", price_field: "unit_price", source_dimension: "", target_keys: ["t1", "t2"], kind: "shared" as const, confirmed: true };

test("Map as shared: eligible when one supplier line is read by 2+ targets with equal price and currency", async () => {
  const targets = [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 33)];
  const lines = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], targets), "T1").lines;
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.state, "ambiguous");
    assert.ok(line.shared, "each unclear line can be mapped as shared");
    assert.deepEqual(line.shared!.targets.map((item) => item.key), ["t1", "t2"], "exactly the matcher's targets, never picked by the user");
    assert.equal(line.shared!.preview, "shared");
    assert.deepEqual([line.shared!.code, line.shared!.priceField, line.shared!.sourceDimension], ["159983", "unit_price", ""]);
    assert.ok(!line.mapping && !line.apply && !line.binding);
  }
  // Two different products: the line of T1 lists both targets.
  const cross = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T2", 33)]), "T1").lines;
  assert.deepEqual(cross.map((line) => line.shared?.targets.map((item) => item.templateId)), [["T1", "T2"]]);
});

test("Map as shared: no button for different prices, one target, other currencies, or an existing mapping", async () => {
  const differentPrices = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 40)]), "T1").lines;
  assert.ok(differentPrices.length === 2 && differentPrices.every((line) => !line.shared), "different prices");
  const oneTarget = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], [scalarTarget("t1", "T1", 33)]), "T1").lines;
  assert.ok(oneTarget.length === 1 && !oneTarget[0].shared, "one target");
  const supplierAed = buildPriceLines(await realMatches([identity("s1", "159983", "", 33, "AED")], [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 33)]), "T1").lines;
  assert.ok(supplierAed.every((line) => !line.shared), "supplier currency differs");
  const emptyPrices = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], [{ ...scalarTarget("t1", "T1", 33), price: null }, { ...scalarTarget("t2", "T1", 33), price: null }]), "T1").lines;
  assert.ok(emptyPrices.every((line) => !line.shared), "empty prices");
  const targets = [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 33)];
  const mapped = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], targets, [sharedBinding]), "T1", [sharedBinding]).lines;
  assert.ok(mapped.length === 2 && mapped.every((line) => line.state === "shared" && !line.shared && line.binding?.id === "sb"), "already mapped: only Remove mapping is offered");
  // Two columns of one row that read the same tier are one price cell seen twice, not a shared case: the matcher gives no candidate_shared there.
  const sameRow = [{ ...scalarTarget("t1", "T1", 33), dimension: "SG3", column_id: "a" }, { ...scalarTarget("t2", "T1", 33), dimension: "SG3", column_id: "b" }];
  const columns = buildPriceLines(await realMatches([identity("s1", "159983", "SG3", 33)], sameRow), "T1").lines;
  assert.ok(columns.length === 2 && columns.every((line) => line.state === "ambiguous" && !line.shared), "two columns of one row");
});

test("Map as shared: nothing is written on load or on the first click; confirm saves once with kind shared and the baseline", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  const actions = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.doesNotMatch(actions, /confirmSupplierBindings|supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.match(popup, /setPending\(\{ kind: "share", line \}\)/, "the button only opens the confirm step");
  const confirm = popup.slice(popup.indexOf("const confirm = async"), popup.indexOf("} finally { setBusy(false); }"));
  const share = confirm.slice(confirm.indexOf('pending.kind === "share" && pending.line.shared'), confirm.indexOf('pending.kind === "apply"'));
  assert.equal((share.match(/await confirmSupplierBindings\(/g) ?? []).length, 1, "one save in the share branch");
  assert.match(share, /kind: "shared", target_keys: shared\.targets\.map\(\(item\) => item\.key\)/);
  assert.match(share, /expected_targets: shared\.targets\.map\(\(item\) => \(\{ key: item\.key, pricing_version: item\.pricingVersion, price: item\.price, currency: item\.currency \}\)\)/);
  assert.doesNotMatch(popup.replace(confirm, ""), /confirmSupplierBindings\(/, "no save outside confirm");
  assert.match(popup, /will use this supplier line together\. Product prices and saved quotations do not change\. You can remove this mapping later\./);
  assert.match(popup, /Map as shared/);
  assert.match(popup, /if \(allowed !== true\) return null/, "same role check as Map this line");
  const serverActions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(serverActions.match(/export async function confirmSupplierBindings[\s\S]*?\n\}/)?.[0] ?? "", /await approver\(\)/);
});

test("the wizard's family hint tells the truth about choosing none", () => {
  const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
  assert.match(wizard, /If you choose none, the lines show Needs mapping until you choose a family\./);
  assert.doesNotMatch(wizard, /every family in the list is compared/);
});

const taggedId = (key: string, family: string, price: number) => ({ ...identity(key, "159983", "", price), dimension: JSON.stringify(["", "series", family]) }) as SourceIdentity;
const everyScope = (...families: string[]) => new Map([["T1", new Set(families)]]);
const scopedMatches = async (sources: SourceIdentity[], targets: PriceTarget[], familyScope?: ReadonlyMap<string, ReadonlySet<string>>) => (await import("./supplier-price-matching")).matchSupplierPrices(sources, targets, [], [], familyScope);

test("family bar guard: a family-tagged line cannot be mapped until the product has a saved family", async () => {
  const sources = [taggedId("every", "EVERY", 58)];
  const noScope = await scopedMatches(sources, [scalarTarget("t1", "T1", 58)]);
  const open = buildPriceLines(noScope, "T1").lines;
  assert.ok(open.length === 1 && open[0].state === "needs_mapping" && open[0].mapping, "today: a tagged line can be mapped");
  const guarded = buildPriceLines(noScope, "T1", [], { familyRequired: true }).lines;
  assert.ok(guarded.length === 1 && !guarded[0].mapping && !guarded[0].shared && guarded[0].familyHint === "choose_family", "no mapping button, hint instead");
  assert.deepEqual(buildPriceLines(noScope, "T1", [], { familyRequired: false }).lines, open, "with a family chosen nothing is hidden");
});

test("family bar guard: shared mapping is hidden too, and lines without a family tag are never affected", async () => {
  const targets = [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 33)];
  const scoped = await scopedMatches([taggedId("every", "EVERY", 33)], targets, everyScope("every"));
  assert.ok(buildPriceLines(scoped, "T1").lines.every((line) => line.shared), "a chosen family can map as shared");
  const guarded = buildPriceLines(scoped, "T1", [], { familyRequired: true }).lines;
  assert.ok(guarded.every((line) => !line.shared && line.familyHint === "choose_family"));
  const untagged = await realMatches([identity("s1", "159983", "SG3", 13)], [{ ...scalarTarget("t1", "T1", 13), dimension: "SG3" }]);
  assert.deepEqual(buildPriceLines(untagged, "T1", [], { familyRequired: true }).lines, buildPriceLines(untagged, "T1").lines, "brands and lines without families look exactly as before");
  assert.deepEqual(buildPriceLines(untagged, "T1", [], {}).lines, buildPriceLines(untagged, "T1").lines);
});

test("family scope reaches the matcher: the saved family decides which supplier rows are this product's lines", async () => {
  const sources = [taggedId("aim", "AIM", 57), taggedId("every", "EVERY", 58), taggedId("goal", "Goal-Air", 57)];
  const lines = buildPriceLines(await scopedMatches(sources, [scalarTarget("t1", "T1", 58)], everyScope("every")), "T1").lines;
  assert.deepEqual(lines.map((line) => [line.state, line.supplierPrice]), [["same", 58]]);
  const repository = readFileSync("lib/products/supplier-price-repository.ts", "utf8");
  assert.match(repository, /supplierFamilyScope\(client, source\.definition_id\)/);
  assert.match(repository, /matchSupplierPrices\(identities\.map\(\(identity\) => withoutEvidence\(identity\.data\)\), targets, rules, bindings, familyScope\)/);
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /await supplierBrandMatches\(client, current\.id\)/);
  assert.match(action, /const familyRequired = families\.length > 0 && chosen\.length === 0/);
  assert.match(action, /buildPriceLines\(matches, templateId, bindings, \{ familyRequired \}\)/);
});

test("the lines action returns the families, the chosen set and the missing ones, read only, for approvers", () => {
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /supplierSourceFamilies\(client, current\.id\)/);
  assert.match(action, /supplierListTemplateFamilies\(client, \{ definitionId: definition\.id \}\)/);
  assert.match(action, /supplierMissingTemplateFamilies\(client, definition\.id, current\.id\)/);
  assert.match(action, /item\.template_id === templateId/);
  assert.match(action, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.doesNotMatch(action, /supplierSetTemplateFamilies|setSupplierTemplateFamilies|supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
});

test("family bar in the popup: hidden without families, plain messages, one save from the button, nothing on load", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  const bar = popup.slice(popup.indexOf("function FamilyBar"), popup.indexOf("function SourceLines"));
  assert.match(bar, /if \(!source\.families\.length\) return null/, "hidden for brands like LAS");
  assert.match(bar, /No family chosen for this product\. Choose a family to compare prices\./);
  assert.match(bar, /"Choose family" : "Change"/);
  assert.match(bar, /source\.chosen\.map\(\(item\) => <span key=\{item\.key\}[^>]*>\{item\.family\}<\/span>\)/, "chosen families as chips");
  assert.match(bar, /Choose one family\. Choose more only if this product really mixes parts from more than one family\./);
  assert.match(bar, /const searchFrom = 15|source\.families\.length > searchFrom/);
  assert.match(popup, /const searchFrom = 15;/);
  assert.match(bar, /source\.families\.length === 1 \? \[source\.families\[0\]\.key\] : \[\]/, "one is selected for the user only when the list has exactly one");
  assert.match(bar, /This family is not in the new price list: \{item\.family\}\. Choose again\./);
  assert.equal((popup.match(/await setSupplierTemplateFamilies\(/g) ?? []).length, 1, "one save call in the whole popup");
  assert.match(bar, /await setSupplierTemplateFamilies\(source\.definitionId, templateId, names\)/);
  const beforeSave = bar.slice(0, bar.indexOf("const save = async"));
  assert.doesNotMatch(beforeSave, /setSupplierTemplateFamilies|useEffect/, "nothing is written when the bar opens or loads");
  assert.match(bar, /disabled=\{busy \|\| !picked\.length\}/, "saving needs at least one family");
  assert.match(popup, /if \(allowed !== true\) return null/, "same role check as the other popup actions");
  assert.match(popup, /Choose a family first\./);
  const serverActions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  assert.match(serverActions.match(/export async function setSupplierTemplateFamilies[\s\S]*?\n\}/)?.[0] ?? "", /await approver\(\)/);
});

test("confirmed Shared lines count as OK: in Same, never in Needs attention; every other state is unchanged", async () => {
  const { summarizePriceLines, filterAndOrderPriceLines } = await import("./supplier-price-lines");
  const states = ["same", "shared", "shared", "changed", "needs_mapping", "ambiguous", "not_in_supplier_list"] as const;
  const lines = states.map((state, index) => ({ key: `k${index}`, code: `C${index}`, field: "", ourPrice: 1, ourCurrency: "EUR", supplierPrice: 1, supplierCurrency: "EUR", difference: 0, state }));
  assert.deepEqual(summarizePriceLines(lines), { same: 3, changed: 1, needsMapping: 1, other: 2, shared: 2 });
  assert.deepEqual(filterAndOrderPriceLines(lines, "same").map((item) => item.state), ["same", "shared", "shared"]);
  assert.deepEqual(filterAndOrderPriceLines(lines, "attention").map((item) => item.state), ["needs_mapping", "changed", "ambiguous", "not_in_supplier_list"], "Other stays in Needs attention as before");
  assert.equal(filterAndOrderPriceLines(lines, "all").length, lines.length);
  // Real lines: two confirmed shared lines end up in Same, with their badge state and their Remove mapping binding kept.
  const targets = [scalarTarget("t1", "T1", 33), scalarTarget("t2", "T1", 33)];
  const real = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], targets, [sharedBinding]), "T1", [sharedBinding]).lines;
  assert.ok(real.length === 2 && real.every((line) => line.state === "shared" && line.binding?.id === "sb"));
  assert.deepEqual(summarizePriceLines(real), { same: 2, changed: 0, needsMapping: 0, other: 0, shared: 2 });
  assert.equal(filterAndOrderPriceLines(real, "attention").length, 0);
  assert.equal(filterAndOrderPriceLines(real, "same").length, 2);
  // An unconfirmed candidate (unclear line) is still Other and still needs attention.
  const unclear = buildPriceLines(await realMatches([identity("s1", "159983", "", 33)], targets), "T1").lines;
  assert.deepEqual(summarizePriceLines(unclear), { same: 0, changed: 0, needsMapping: 0, other: 2, shared: 0 });
});

test("the Same tile keeps its label and shows 'includes N shared' only when shared lines exist", async () => {
  const { summarizePriceLines } = await import("./supplier-price-lines");
  const plain = (state: "same" | "changed") => ({ key: state, code: state, field: "", ourPrice: 1, ourCurrency: "EUR", supplierPrice: 1, supplierCurrency: "EUR", difference: 0, state });
  assert.equal(summarizePriceLines([plain("same"), plain("changed")]).shared, 0, "no shared lines, no note");
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /\{ label: "Same", value: summary\.same, tone: "[^"]+", note: summary\.shared \? `includes \$\{summary\.shared\} shared` : "" \}/);
  assert.equal((popup.match(/note: "" \}/g) ?? []).length, 3, "no other tile has a note");
  assert.match(popup, /\{tile\.note \? <p className="text-\[11px\] text-zinc-500">\{tile\.note\}<\/p> : null\}/, "the grey note only renders when there is one");
  // The badge and the Remove mapping button of a shared line are untouched.
  assert.match(popup, /shared: "border-sky-200 bg-sky-50 text-sky-900"/);
  assert.match(popup, /Remove mapping/);
});
