import assert from "node:assert/strict";
import test from "node:test";
import type { PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { confirmLinksInOrder, type AliasProposal } from "./supplier-link-confirm";
import { matchSupplierPrices } from "./supplier-price-matching";
import { buildPriceLines, filterAndOrderPriceLines, notInProductLines, summarizePriceLines, targetRowNotes } from "./supplier-price-lines";

// Interstuhl 2349: one option code, seven product rows (one per chair model), sixteen supplier tiers.
const models: Array<[string, number]> = [["162S", 535], ["262S", 665], ["362S", 790], ["100S", 350], ["101S", 535], ["151S", 665], ["191S", 790]];
const otherTiers = ["854S", "856S", "858S", "860S", "862S", "864S", "865S", "866S", "890S"];
const group = "metal-parts-finish";
const row = (model: string, price: number, over: Partial<PriceTarget> = {}): PriceTarget => ({ key: JSON.stringify(["T1", "accessory_pricing", group, `brushed-silver-${model.toLowerCase()}`, "price", ""]), template_id: "T1", template_name: "Silver", brand_id: "b", architecture: "accessory_pricing", group_id: group, row_id: `brushed-silver-${model.toLowerCase()}`, column_id: "", dimension: "", price_field: "unit_price", physical_field: "price", code: "2349", raw_code: "2349", price, currency: "EUR", pricing_version: "7", label: "Brushed Silver Metal Parts", ...over });
const rows = () => models.map(([m, price]) => row(m, price));
const notes = (targets: PriceTarget[]) => new Map(targets.map((t) => [t.key, `model ${t.row_id.split("-").at(-1)!.toUpperCase()}`]));
const tier = (dimension: string, price: number, over: Partial<SourceIdentity> = {}) => ({ key: `s:${dimension}`, code: "2349", price_field: "unit_price", dimension, raw_dimension: dimension, finishes: [], price, currency: "EUR", row_keys: [], issues: [], ...over }) as SourceIdentity;
const supplier = () => [...models.map(([m, price]) => tier(m, price)), ...otherTiers.map((t, i) => tier(t, 900 + i))];
type Binding = { id: string; code: string; price_field: string; source_dimension: string; kind: "alias"; confirmed: boolean; target_keys: string[] };

const mergedRows = () => [row("100s", 350), row("162s-101s", 535), row("262s-151s", 665), row("362s-191s", 790)];
const linkFor = (tier: string, target: PriceTarget): Binding => ({ id: tier, code: "2349", price_field: "unit_price", source_dimension: tier, kind: "alias", confirmed: true, target_keys: [target.key] });
test("merged Silver rows: three remaining suggestions, nine unrelated tiers, then seven resolved tiers", () => {
  const targets = mergedRows();
  const bindings = ["100S", "101S", "151S", "191S"].map((tier, i) => linkFor(tier, targets[i]));
  const compare = () => buildPriceLines(matchSupplierPrices(supplier(), targets, [], bindings), "T1", bindings).lines;
  const lines = compare();
  assert.equal(summarizePriceLines(lines).needsMapping, 3);
  assert.equal(notInProductLines(lines).length, 9);
  for (const [index, tier] of ["162S", "262S", "362S"].entries()) {
    const line = lines.find((l) => l.link?.tierLabel === tier)!;
    assert.equal(line.link!.suggestion?.targetKey, targets[index + 1].key);
    assert.equal(line.link!.rows.find((r) => r.targetKey === targets[index + 1].key)!.taken, false);
    bindings.push(linkFor(tier, targets[index + 1]));
  }
  const resolved = compare();
  assert.deepEqual(summarizePriceLines(resolved), { same: 7, changed: 0, needsMapping: 0, other: 0, shared: 0 });
  assert.equal(notInProductLines(resolved).length, 9);
  assert.deepEqual(resolved.find((l) => l.binding?.id === "101S")!.linkedTiers, ["101S", "162S"]);
});

test("saved aliases on one row: equal prices compare normally; conflicting price or currency is never applicable", () => {
  const target = mergedRows()[1], bindings = [linkFor("101S", target), linkFor("162S", target)];
  for (const [prices, currency, state] of [[[535, 535], "EUR", "same"], [[600, 600], "EUR", "changed"], [[600, 650], "EUR", "ambiguous"], [[600, 600], "USD", "ambiguous"]] as const) {
    const sources = [tier("101S", prices[0]), tier("162S", prices[1], { currency })];
    const matches = matchSupplierPrices(sources, [target], [], bindings);
    const lines = buildPriceLines(matches, "T1", bindings).lines;
    assert.deepEqual(lines.map((l) => l.state), [state, state]);
    if (state === "ambiguous") for (const line of lines) {
      assert.equal(line.apply, undefined);
      assert.match(line.matchHint!, /101S.*600.*162S/);
    }
  }
});

test("a row already linked to one tier accepts a second tier of the same price", () => {
  const target = row("101S", 535), bindings = [linkFor("101S", target)];
  const lines = buildPriceLines(matchSupplierPrices([tier("101S", 535), tier("162S", 535)], [target], [], bindings), "T1", bindings).lines;
  const choice = lines.find((l) => l.link?.tierLabel === "162S")!.link!.rows[0];
  assert.equal(choice.taken, false);
  assert.deepEqual(choice.linkedTiers, ["101S"]);
});

test("a single-tier row remains disabled for a second tier of a different price, with the clear reason", () => {
  const target = row("101S", 535), bindings = [linkFor("101S", target)];
  const lines = buildPriceLines(matchSupplierPrices([tier("101S", 535), tier("162S", 600)], [target], [], bindings), "T1", bindings).lines;
  const choice = lines.find((l) => l.link?.tierLabel === "162S")!.link!.rows[0];
  assert.equal(choice.taken, true);
  assert.equal(choice.takenReason, "Different price (EUR 600.00) from the row (EUR 535.00)");
});

test("the alias conflict guard requires distinct saved aliases and never absorbs other binding kinds", () => {
  const target = mergedRows()[1];
  const one = linkFor("101S", target);
  const duplicate = matchSupplierPrices([tier("101S", 535), tier("101S", 600, { key: "duplicate" })], [target], [], [one]);
  assert.deepEqual(duplicate.map((m) => m.classification), ["unchanged", "increased"]);
  assert.ok(duplicate.every((m) => !m.aliasSources));
  const disambiguation = { ...linkFor("162S", target), kind: "disambiguation" as const };
  const separate = matchSupplierPrices([tier("101S", 535), tier("162S", 600)], [target], [], [one, disambiguation]);
  assert.deepEqual(separate.map((m) => m.classification), ["unchanged", "increased"]);
  assert.ok(separate.every((m) => !m.aliasSources));
});
const build = (targets: PriceTarget[], over: { sources?: SourceIdentity[]; bindings?: Binding[]; rowNotes?: ReadonlyMap<string, string>; familyRequired?: boolean } = {}) => {
  const matches = matchSupplierPrices(over.sources ?? supplier(), targets);
  return buildPriceLines(matches, "T1", over.bindings ?? [], { rowNotes: over.rowNotes ?? notes(targets.filter((t) => t.template_id === "T1")), familyRequired: over.familyRequired });
};

test("2349: sixteen supplier lines, not 7 x 16; seven suggested to the right row; nine are not in this product", () => {
  const targets = rows();
  assert.equal(matchSupplierPrices(supplier(), targets).flatMap((m) => m.targets).length, 7 * 16, "the matcher still reports every pair");
  const { lines } = build(targets);
  assert.equal(lines.length, 16);
  assert.ok(lines.every((l) => l.state === "needs_mapping" && l.link && !l.mapping));
  const suggested = lines.filter((l) => l.link!.suggestion);
  assert.equal(suggested.length, 7);
  for (const line of suggested) { const m = line.link!.tierLabel; assert.equal(line.link!.suggestion!.targetKey, row(m, 0).key, m); assert.equal(line.link!.suggestion!.reason, "note"); }
  // the rows with the same price 535 (162S, 101S) and 665 (262S, 151S) each get their own tier
  assert.equal(lines.find((l) => l.link!.tierLabel === "101S")!.link!.suggestion!.targetKey, row("101S", 0).key);
  assert.equal(lines.find((l) => l.link!.tierLabel === "162S")!.link!.suggestion!.targetKey, row("162S", 0).key);
  assert.equal(lines.find((l) => l.link!.tierLabel === "151S")!.link!.suggestion!.targetKey, row("151S", 0).key);
  assert.equal(lines.find((l) => l.link!.tierLabel === "262S")!.link!.suggestion!.targetKey, row("262S", 0).key);
  assert.deepEqual(notInProductLines(lines).map((l) => l.link!.tierLabel).sort(), [...otherTiers].sort());
  assert.deepEqual(summarizePriceLines(lines), { same: 0, changed: 0, needsMapping: 7, other: 0, shared: 0 });
  assert.equal(filterAndOrderPriceLines(lines, "all").length, 7);
  assert.equal(filterAndOrderPriceLines(lines, "attention").length, 7);
  // each suggestion previews through the real matcher: our row equals the supplier price for the seven models
  assert.ok(suggested.every((l) => l.link!.rows.find((r) => r.targetKey === l.link!.suggestion!.targetKey)!.mapping.preview === "same"));
  assert.ok(lines.every((l) => l.link!.rows.length === 7));
});

test("suggestions fall back to the end of the row id when there is no name or note clue, and say so", () => {
  const { lines } = build(rows(), { rowNotes: new Map() });
  const line = lines.find((l) => l.link!.tierLabel === "262S")!;
  assert.deepEqual(line.link!.suggestion, { targetKey: row("262S", 0).key, reason: "id" });
  assert.equal(lines.filter((l) => l.link!.suggestion).length, 7);
});

test("a tier that matches two rows gets no suggestion; a row claimed by two tiers is suggested to neither", () => {
  const targets = rows();
  const twoRows = new Map(notes(targets)); twoRows.set(targets[1].key, "model 162S"); // the 262S row also says 162S
  const a = build(targets, { rowNotes: twoRows }).lines;
  assert.equal(a.find((l) => l.link!.tierLabel === "162S")!.link!.suggestion, undefined, "162S matches two rows");
  assert.equal(a.find((l) => l.link!.tierLabel === "262S")!.link!.suggestion, undefined, "262S has no row that mentions it any more");
  assert.equal(a.find((l) => l.link!.tierLabel === "362S")!.link!.suggestion?.targetKey, targets[2].key);
  const claimed = new Map(notes(targets)); claimed.set(targets[0].key, "models 162S and 262S"); // one row names two tiers
  const b = build(targets, { rowNotes: claimed }).lines;
  assert.equal(b.find((l) => l.link!.tierLabel === "162S")!.link!.suggestion?.targetKey, targets[0].key, "162S: its row is the only one with 162S");
  assert.equal(b.find((l) => l.link!.tierLabel === "262S")!.link!.suggestion, undefined, "262S: two rows carry it");
});

test("a row already linked to another supplier line can take a tier of the same price, and is suggested for it", () => {
  const binding: Binding = { id: "x", code: "2349", price_field: "unit_price", source_dimension: "OLD", kind: "alias", confirmed: true, target_keys: [row("101S", 0).key] };
  const line = build(rows(), { bindings: [binding] }).lines.find((l) => l.link?.tierLabel === "101S")!;
  assert.equal(line.link!.suggestion?.targetKey, row("101S", 0).key);
  assert.equal(line.link!.rows.find((r) => r.targetKey === row("101S", 0).key)!.taken, false);
  assert.equal(line.link!.rows.filter((r) => r.taken).length, 0);
});

test("a row already linked to another supplier line is not suggested and cannot be picked for a different price", () => {
  const binding: Binding = { id: "x", code: "2349", price_field: "unit_price", source_dimension: "OLD", kind: "alias", confirmed: true, target_keys: [row("101S", 0).key] };
  const sources = supplier().map((s) => s.dimension === "101S" ? { ...s, price: 999 } : s);
  const line = build(rows(), { bindings: [binding], sources }).lines.find((l) => l.link?.tierLabel === "101S")!;
  assert.equal(line.link!.suggestion, undefined);
  const choice = line.link!.rows.find((r) => r.targetKey === row("101S", 0).key)!;
  assert.equal(choice.taken, true);
  assert.equal(choice.takenReason, "Different price (EUR 999.00) from the row (EUR 535.00)");
  assert.equal(line.link!.rows.filter((r) => r.taken).length, 1);
});

test("the picker lists only this product rows of the code; other products rows are never offered", () => {
  const mine = rows();
  const other = [row("162S", 535, { template_id: "T2", key: JSON.stringify(["T2", "accessory_pricing", group, "x-162s", "price", ""]), row_id: "x-162s" })];
  const lines = build([...mine, ...other], { rowNotes: notes(mine) }).lines;
  assert.equal(lines.length, 16);
  for (const line of lines) { assert.equal(line.link!.rows.length, 7); assert.ok(line.link!.rows.every((r) => r.targetKey.startsWith("[\"T1\""))); }
  assert.equal(lines.find((l) => l.link!.tierLabel === "162S")!.link!.suggestion!.targetKey, row("162S", 0).key);
});

test("guards: no link while a family is required, for an invalid supplier price, or across currencies; unrecognisable tiers are not hidden", () => {
  const targets = rows();
  const tagged = supplier().map((s) => ({ ...s, dimension: JSON.stringify([s.dimension, "series", "Silver"]), raw_dimension: s.dimension }));
  const waiting = build(targets, { sources: tagged, familyRequired: true }).lines;
  assert.ok(waiting.length === 16 && waiting.every((l) => !l.link && l.familyHint === "choose_family"));
  const invalid = build(targets, { sources: [tier("162S", 5, { issues: ["x"] }), tier("262S", 5)] }).lines;
  assert.equal(invalid.find((l) => l.field.includes("162S"))?.link, undefined);
  const usd = build(targets, { sources: [tier("162S", 5, { currency: "USD" }), tier("262S", 5)] }).lines.find((l) => l.link?.tierLabel === "162S")!;
  assert.equal(usd.link!.rows.length, 0);
  // tiers that no row mentions, in a code where no tier matches any row, stay normal lines that need attention
  const unrelated = build(targets, { sources: [tier("Grade A", 5), tier("Grade B", 6)], rowNotes: new Map() }).lines;
  assert.ok(unrelated.length === 2 && unrelated.every((l) => l.link && !l.link.notInProduct));
  assert.equal(summarizePriceLines(unrelated).needsMapping, 2);
});

test("Confirm all calls the existing save once per suggested line with its alias proposal and stops at the first failure", async () => {
  const { lines } = build(rows());
  const items = lines.filter((l) => l.link!.suggestion).map((l) => ({ label: `2349 · ${l.link!.tierLabel}`, mapping: l.link!.rows.find((r) => r.targetKey === l.link!.suggestion!.targetKey)!.mapping }));
  const calls: Array<[string, AliasProposal[]]> = [];
  const ok = await confirmLinksInOrder("brand-1", items, async (brandId, proposals) => { calls.push([brandId, proposals]); });
  assert.deepEqual([ok.saved, ok.failed], [7, null]);
  assert.equal(calls.length, 7);
  for (const [i, [brandId, proposals]] of calls.entries()) {
    assert.equal(brandId, "brand-1"); assert.equal(proposals.length, 1);
    const [p] = proposals; const m = items[i].mapping;
    assert.deepEqual([p.kind, p.code, p.price_field, p.source_dimension, p.target_keys], ["alias", "2349", "unit_price", m.sourceDimension, [m.targetKey]]);
    assert.deepEqual(p.expected_targets, [{ key: m.targetKey, pricing_version: "7", price: m.targetPrice, currency: "EUR" }]);
    assert.equal(p.source_dimension, items[i].label.split(" · ")[1]);
  }
  const seen: string[] = [];
  const stopped = await confirmLinksInOrder("brand-1", items, async (_b, proposals) => { seen.push(proposals[0].source_dimension); if (seen.length === 3) throw Error("Displayed target baseline changed or is missing. Refresh before confirming."); });
  assert.equal(seen.length, 3, "nothing is attempted after the failure");
  assert.deepEqual([stopped.saved, stopped.failed?.index, stopped.failed?.label, stopped.failed?.message], [2, 2, items[2].label, "Displayed target baseline changed or is missing. Refresh before confirming."]);
});

test("row notes come from the stored specification of the row, found by group and row ids", () => {
  const targets = rows().slice(0, 2);
  const template = { id: "T1", accessory_pricing: [{ id: group, items: [{ id: "brushed-silver-162s", specification: "model 162S" }, { id: "brushed-silver-262s", notes: "model 262S" }] }] };
  const found = targetRowNotes([template, { id: "T2", accessory_pricing: [] }], targets);
  assert.deepEqual([found.get(targets[0].key), found.get(targets[1].key)], ["model 162S", "model 262S"]);
  assert.equal(targetRowNotes([], targets).size, 0);
});

test("Confirm-all text shows each row's code, name and note, so rows with the same name and price can be told apart", async () => {
  const { confirmLineText, linkRowIdentity } = await import("./supplier-link-confirm");
  const { lines } = build(rows(), { rowNotes: new Map(rows().map((t) => [t.key, `Brushed silver metal parts, model ${t.row_id.split("-").at(-1)!.toUpperCase()}`])) });
  const suggested = lines.filter((l) => l.link!.suggestion);
  assert.equal(suggested.length, 7);
  const texts = suggested.map((l) => ({ l, text: confirmLineText(l, l.link!.rows.find((r) => r.targetKey === l.link!.suggestion!.targetKey)!) }));
  for (const { l, text } of texts) {
    const m = l.link!.tierLabel;
    assert.ok(text.startsWith(`Tier ${m} EUR`), text);
    for (const part of ["→", "2349", "Brushed Silver Metal Parts", `Brushed silver metal parts, model ${m}`, "Same", "from the row note"]) assert.ok(text.includes(part), `${m}: ${part}`);
  }
  assert.equal(new Set(texts.map((t) => t.text)).size, 7, "all seven lines differ");
  const [a, b] = ["162S", "101S"].map((m) => texts.find((t) => t.l.link!.tierLabel === m)!.text.split("→")[1]);
  assert.notEqual(a, b, "162S and 101S share the price EUR 535.00 but read differently");
  assert.ok(a.includes("EUR 535.00") && b.includes("EUR 535.00"));
  // a row without a note shows its code and name only; the long note is not truncated
  assert.deepEqual(linkRowIdentity({ code: "2349", name: "Brushed Silver Metal Parts", note: "" }), ["2349", "Brushed Silver Metal Parts"]);
  const bare = build(rows(), { rowNotes: new Map() }).lines.find((l) => l.link!.tierLabel === "262S")!;
  const text = confirmLineText(bare, bare.link!.rows.find((r) => r.targetKey === bare.link!.suggestion!.targetKey)!);
  assert.ok(text.includes("2349 · Brushed Silver Metal Parts · EUR 665.00") && text.includes("from the row id"), text);
  const long = "x".repeat(400);
  assert.ok(linkRowIdentity({ code: "1", name: "n", note: long }).includes(long));
});

// Joyce, code 608: two rows with the SAME name at different prices; many supplier tiers at two prices. Plain rows: no row names a tier.
const joyceRow = (id: string, price: number) => row("x", price, { key: JSON.stringify(["T1", "accessory_pricing", group, id, "price", ""]), row_id: id, code: "608", raw_code: "608", label: "608 - Seat depth and lumbar support adjustment" });
const rowA = () => joyceRow("seat-depth-a", 49), rowB = () => joyceRow("seat-depth-b", 17);
const jt = (name: string, price: number) => tier(name, price, { code: "608" });
const joyceTiers: Array<[string, number]> = [["JC211", 49], ["JC216", 17], ["JC213", 49], ["JC251", 49], ["JC252", 49], ["JC253", 49], ["JC217", 17], ["JC218", 17], ["JC256", 17], ["JC257", 17], ["JC258", 17]];
const joyceBind = (tierName: string, targetKey: string): Binding => ({ id: tierName, code: "608", price_field: "unit_price", source_dimension: tierName, kind: "alias", confirmed: true, target_keys: [targetKey] });
const joyce = (bindings: Binding[], prices: Record<string, number> = {}, targets = [rowA(), rowB()]) =>
  buildPriceLines(matchSupplierPrices(joyceTiers.map(([n, p]) => jt(n, prices[n] ?? p)), targets, [], bindings), "T1", bindings, { rowNotes: new Map() });

test("Joyce 608: equal-price tiers are suggested to the one row with that price; Confirm all saves normal alias bindings and nothing needs attention", async () => {
  const [A, B] = [rowA(), rowB()], bindings = [joyceBind("JC211", A.key), joyceBind("JC216", B.key)];
  const grouped = joyce(bindings).lines.filter((l) => l.link);
  assert.deepEqual(grouped.map((l) => l.link!.tierLabel).sort(), ["JC213", "JC217", "JC218", "JC251", "JC252", "JC253", "JC256", "JC257", "JC258"]);
  for (const line of grouped) {
    const expected = ["JC213", "JC251", "JC252", "JC253"].includes(line.link!.tierLabel) ? A : B;
    assert.deepEqual(line.link!.suggestion, { targetKey: expected.key, reason: "price" }, line.link!.tierLabel);
    assert.equal(line.link!.rows.find((r) => r.targetKey === expected.key)!.taken, false);
    assert.equal(line.link!.notInProduct, false);
  }
  assert.equal(summarizePriceLines(joyce(bindings).lines).needsMapping, 9);
  // the reason is in plain words and names the price
  const { confirmLineText } = await import("./supplier-link-confirm");
  const first = grouped.find((l) => l.link!.tierLabel === "JC213")!;
  assert.ok(confirmLineText(first, first.link!.rows.find((r) => r.targetKey === A.key)!).includes("Same price EUR 49.00 as the row"));
  // Confirm all goes through the existing path: one normal alias proposal per tier
  const items = grouped.map((l) => ({ label: l.link!.tierLabel, mapping: l.link!.rows.find((r) => r.targetKey === l.link!.suggestion!.targetKey)!.mapping }));
  const calls: AliasProposal[] = [];
  const outcome = await confirmLinksInOrder("brand-1", items, async (_b, proposals) => { calls.push(...proposals); });
  assert.deepEqual([outcome.saved, outcome.failed], [9, null]);
  assert.ok(calls.every((p) => p.kind === "alias" && p.code === "608" && p.target_keys.length === 1));
  for (const p of calls) bindings.push(joyceBind(p.source_dimension, p.target_keys[0]));
  const done = joyce(bindings).lines;
  assert.ok(done.every((l) => !l.link && l.state === "same"), "every line resolves");
  assert.equal(done.length, 11, "one line per saved tier");
  assert.deepEqual(summarizePriceLines(done), { same: 11, changed: 0, needsMapping: 0, other: 0, shared: 0 });
});

test("price clue: two rows with the same price, no matching row, a name clue, or an already linked tier get no price suggestion", () => {
  const sameTwo = joyce([], {}, [rowA(), joyceRow("seat-depth-c", 49), rowB()]).lines.filter((l) => l.link);
  for (const l of sameTwo.filter((x) => x.supplierPrice === 49)) assert.equal(l.link!.suggestion, undefined, `${l.link!.tierLabel}: two rows at 49`);
  for (const l of sameTwo.filter((x) => x.supplierPrice === 17)) assert.equal(l.link!.suggestion?.targetKey, rowB().key);
  const none = joyce([], { JC213: 30 }).lines.find((l) => l.link?.tierLabel === "JC213")!;
  assert.equal(none.link!.suggestion, undefined, "price matches no row");
  // a row note naming the tier keeps its existing suggestion (the price clue never overrides it)
  const A = rowA(), B = rowB();
  const sources = joyceTiers.map(([n, p]) => jt(n, p));
  const noted = buildPriceLines(matchSupplierPrices(sources, [A, B]), "T1", [], { rowNotes: new Map([[B.key, "model JC213"]]) }).lines.find((l) => l.link?.tierLabel === "JC213")!;
  assert.deepEqual(noted.link!.suggestion, { targetKey: B.key, reason: "note" });
  // a tier that is already linked is never re-suggested: it has no picker line at all
  assert.equal(joyce([joyceBind("JC211", A.key)]).lines.find((l) => l.link?.tierLabel === "JC211"), undefined);
});

test("price clue is off for rows that name tiers: a Silver tier at a Silver row price is not suggested by price", () => {
  const targets = mergedRows();
  const bindings = ["100S", "101S", "151S", "191S"].map((t, i) => linkFor(t, targets[i]));
  const lines = buildPriceLines(matchSupplierPrices([...supplier(), tier("ZZ9", 535)], targets, [], bindings), "T1", bindings).lines; // ZZ9: same price as the 162S-101S row
  const zz = lines.find((l) => l.link?.tierLabel === "ZZ9")!;
  assert.equal(zz.link!.suggestion, undefined);
  assert.equal(zz.link!.notInProduct, true);
  const suggested = lines.filter((l) => l.link?.suggestion);
  assert.equal(suggested.length, 3);
  assert.ok(suggested.every((l) => l.link!.suggestion!.reason !== "price"));
  assert.equal(summarizePriceLines(lines).needsMapping, 3);
  assert.equal(notInProductLines(lines).length, 10);
});

test("tiers saved by price that later differ in price are unclear on every line, with no apply", () => {
  const [A, B] = [rowA(), rowB()], bindings = [joyceBind("JC211", A.key), joyceBind("JC213", A.key), joyceBind("JC216", B.key)];
  assert.deepEqual(joyce(bindings).lines.filter((l) => l.binding && l.ourPrice === 49).map((l) => l.state), ["same", "same"]);
  const lines = joyce(bindings, { JC213: 52 }).lines.filter((l) => l.binding && l.ourPrice === 49);
  assert.deepEqual(lines.map((l) => l.state), ["ambiguous", "ambiguous"]);
  for (const line of lines) { assert.equal(line.apply, undefined); assert.match(line.matchHint!, /Conflicting tiers/); }
});
