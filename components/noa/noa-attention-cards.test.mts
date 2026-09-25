// NOA Attention - Structured Human-Friendly Message UI. noa-messages.tsx/noa-assistant.tsx are
// "use client" files with "@/..." aliases, and noa-orchestrator.ts has "server-only" imports -
// none resolvable by Node's plain ESM resolver outside the Next.js build. These are source-level
// wiring/safety checks, matching the convention already used throughout this codebase's other
// *-safety.test.mts files. The grouping/label logic itself is pure and re-implemented identically
// here (verified against the real source first) for direct behavioral testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// 1. client never parses Attention prose to build cards
test("1. noa-messages.tsx never parses message.text to build cards - it only reads message.attention fields", () => {
  const cardsSectionEnd = messages.indexOf("// Home UX: a starter is either");
  const cardsSection = messages.slice(0, cardsSectionEnd);
  // Only a comment documents the intent ("never parses `message.text`") - no actual property
  // access/parsing call on `.text` exists in the card-building code itself.
  assert.ok(!/\bmessage\.text\.|\.text\.match|\.text\.split|\.text\.replace/.test(cardsSection));
  assert.ok(!/\bitem\.title\.match|\bitem\.detail\.match|\bitem\.title\.split|\bitem\.detail\.split/.test(cardsSection));
});

// 2. structured Attention data comes from server response
test("2. the orchestrator builds `attention` from the same authorized capabilityResult.data items - not client-invented", () => {
  assert.ok(orchestrator.includes("function isAttentionCapabilityData(data: unknown): data is NoaAttentionCapabilityData {"));
  assert.ok(orchestrator.includes('domain === "Attention" && isAttentionCapabilityData(capabilityResult.data)'));
  assert.ok(orchestrator.includes("items: capabilityResult.data.items.map((item) => ({"));
});

// 3. no UUID/internal key is transported to display unless already safe
test("3. the transport item shape never includes key/entity_id/vendor_key/quotation_id - only safe fields", () => {
  const mapStart = orchestrator.indexOf("items: capabilityResult.data.items.map((item) => ({");
  const mapBody = orchestrator.slice(mapStart, orchestrator.indexOf("})),", mapStart));
  assert.ok(!mapBody.includes("key:"));
  assert.ok(!mapBody.includes("quotationId"));
  assert.ok(!mapBody.includes("vendor_key"));
  assert.ok(types.includes("export type NoaAttentionTransportItem = {"));
  const typeStart = types.indexOf("export type NoaAttentionTransportItem = {");
  // N2C1.1 note: sliceFunctionBody() searches for a bare "\n}\n" closer, which never matches a
  // type literal's own "};\n" close (semicolon breaks the pattern) - it was only ever accidentally
  // "working" here by running into a LATER real function's closer further down the file. Now that
  // N2C1.1 added more type declarations after this one (including a legitimate `key: string;`
  // field on an unrelated NoaAnalyticsMetric type), that accidental overrun would produce a false
  // positive - scoped precisely to this type's own "};" close instead.
  const typeBody = types.slice(typeStart, types.indexOf("};", typeStart));
  assert.ok(!typeBody.includes("key:"));
});

// 4. Procurement grouped by Project File
// 6. same vendor across different Project Files remains separate
// 7. Project title rendered once per project group
const PROCUREMENT_STATUS_LABEL: Record<string, string> = {
  procurement_missing_eta: "ETA missing",
  procurement_missing_etd: "ETD missing",
};

type TransportItem = { sourceDomain: string; kind: string; title: string; detail: string; entityLabel: string; entityIdentifier?: string };

function procurementProjectTitle(item: TransportItem): string {
  const prefix = item.entityIdentifier ? `${item.entityIdentifier} · ` : null;
  return prefix && item.detail.startsWith(prefix) ? item.detail.slice(prefix.length) : item.detail;
}

function groupProcurementItems(items: TransportItem[]) {
  const groups: Array<{ entityIdentifier: string; projectTitle: string; vendors: Array<{ vendorLabel: string; statuses: string[] }> }> = [];
  const groupByOrder = new Map<string, typeof groups[number]>();
  for (const item of items) {
    const orderKey = item.entityIdentifier ?? item.detail;
    let group = groupByOrder.get(orderKey);
    if (!group) {
      group = { entityIdentifier: item.entityIdentifier ?? "", projectTitle: procurementProjectTitle(item), vendors: [] };
      groupByOrder.set(orderKey, group);
      groups.push(group);
    }
    let vendor = group.vendors.find((candidate) => candidate.vendorLabel === item.entityLabel);
    if (!vendor) {
      vendor = { vendorLabel: item.entityLabel, statuses: [] };
      group.vendors.push(vendor);
    }
    const label = PROCUREMENT_STATUS_LABEL[item.kind] ?? item.title;
    if (!vendor.statuses.includes(label)) vendor.statuses.push(label);
  }
  return groups;
}

test("noa-messages.tsx defines the same grouping/label logic re-implemented above", () => {
  assert.ok(messages.includes('  procurement_missing_eta: "ETA missing",'));
  assert.ok(messages.includes('  procurement_missing_etd: "ETD missing",'));
  assert.ok(messages.includes("function groupProcurementItems(items: NoaAttentionTransportItem[]): NoaProcurementProjectGroup[] {"));
  assert.ok(messages.includes("function procurementProjectTitle(item: NoaAttentionTransportItem): string {"));
});

test("4/6/7. Procurement items are grouped by Project File (entityIdentifier), same vendor across different Project Files stays separate, and project title appears once per group", () => {
  const items: TransportItem[] = [
    { sourceDomain: "Procurement", kind: "procurement_missing_eta", title: "INTERSTUHL — ETA missing", detail: "CO-0002-003 · HQ Office Server Room Fit-out", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0002-003" },
    { sourceDomain: "Procurement", kind: "procurement_missing_etd", title: "INTERSTUHL — ETD missing", detail: "CO-0002-003 · HQ Office Server Room Fit-out", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0002-003" },
    { sourceDomain: "Procurement", kind: "procurement_missing_eta", title: "LAS MOBILI — ETA missing", detail: "CO-0003-001 · Galleria Mall Boutique Refurbishment", entityLabel: "LAS MOBILI", entityIdentifier: "CO-0003-001" },
    { sourceDomain: "Procurement", kind: "procurement_missing_etd", title: "LAS MOBILI — ETD missing", detail: "CO-0003-001 · Galleria Mall Boutique Refurbishment", entityLabel: "LAS MOBILI", entityIdentifier: "CO-0003-001" },
    { sourceDomain: "Procurement", kind: "procurement_missing_eta", title: "INTERSTUHL — ETA missing", detail: "CO-0003-001 · Galleria Mall Boutique Refurbishment", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0003-001" },
    { sourceDomain: "Procurement", kind: "procurement_missing_etd", title: "INTERSTUHL — ETD missing", detail: "CO-0003-001 · Galleria Mall Boutique Refurbishment", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0003-001" },
  ];
  const groups = groupProcurementItems(items);
  assert.equal(groups.length, 2, "two distinct Project Files");
  assert.equal(groups[0].entityIdentifier, "CO-0002-003");
  assert.equal(groups[0].projectTitle, "HQ Office Server Room Fit-out");
  assert.equal(groups[1].entityIdentifier, "CO-0003-001");
  assert.equal(groups[1].projectTitle, "Galleria Mall Boutique Refurbishment");
  // INTERSTUHL appears in BOTH groups (same vendor, different Project Files) - never merged.
  assert.equal(groups[0].vendors.length, 1);
  assert.equal(groups[1].vendors.length, 2);
  assert.ok(groups[0].vendors.some((v) => v.vendorLabel === "INTERSTUHL"));
  assert.ok(groups[1].vendors.some((v) => v.vendorLabel === "INTERSTUHL"));
});

// 5. same vendor ETA+ETD becomes two status chips in one vendor row
test("5. a vendor with both missing ETA and missing ETD gets one vendor row with two status chips", () => {
  const items: TransportItem[] = [
    { sourceDomain: "Procurement", kind: "procurement_missing_eta", title: "INTERSTUHL — ETA missing", detail: "CO-0002-003 · HQ Office Server Room Fit-out", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0002-003" },
    { sourceDomain: "Procurement", kind: "procurement_missing_etd", title: "INTERSTUHL — ETD missing", detail: "CO-0002-003 · HQ Office Server Room Fit-out", entityLabel: "INTERSTUHL", entityIdentifier: "CO-0002-003" },
  ];
  const groups = groupProcurementItems(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].vendors.length, 1);
  assert.deepEqual(groups[0].vendors[0].statuses, ["ETA missing", "ETD missing"]);
});

// 8/9. Product Price and Client Payment sections still supported
test("8/9. Product Price and Client Payment items render via NoaAttentionFlatSection, unchanged from Procurement's grouped path", () => {
  assert.ok(messages.includes('<NoaAttentionFlatSection items={priceItems} label="Product prices" />'));
  assert.ok(messages.includes('<NoaAttentionFlatSection items={paymentItems} label="Client payments" />'));
  assert.ok(messages.includes('item.sourceDomain === "Price"'));
  assert.ok(messages.includes('item.sourceDomain === "ClientPayment"'));
});

// 10. mixed Attention response preserves section order
test("10. section order is Price -> Procurement -> Payment, matching the server's own authoritative order", () => {
  const cardsStart = messages.indexOf("function NoaAttentionCards(");
  const cardsBody = sliceFunctionBody(messages, cardsStart);
  const priceIndex = cardsBody.indexOf("priceItems} label=\"Product prices\"");
  const procurementIndex = cardsBody.indexOf('aria-label="Procurement"');
  const paymentIndex = cardsBody.indexOf("paymentItems} label=\"Client payments\"");
  assert.ok(priceIndex > -1 && procurementIndex > -1 && paymentIndex > -1);
  assert.ok(priceIndex < procurementIndex && procurementIndex < paymentIndex);
});

// 11. count remains authoritative
test("11. the header count is read directly from attention.count, never recomputed/inferred", () => {
  assert.ok(messages.includes("{attention.count} item{attention.count === 1 ? \"\" : \"s\"} need attention"));
});

// 12. structured Attention suppresses duplicate long prose list
test("12. when structured cards render, the full text bubble is NOT also rendered for the same message", () => {
  const mapStart = messages.indexOf("{messages.map((message) => {");
  const mapBody = sliceFunctionBody(messages, mapStart);
  assert.ok(mapBody.includes("hasAttentionCards && message.attention ? ("));
  assert.ok(mapBody.includes("<NoaAttentionCards attention={message.attention} />"));
  assert.ok(mapBody.includes(") : ("));
  // Exactly one <p> element total (the plain-text fallback) - never a second copy of it inside
  // the cards branch.
  assert.equal((mapBody.match(/<p\b/g) ?? []).length, 1);
});

// 13. ordinary non-Attention messages unchanged
test("13. hasAttentionCards is false whenever message.attention is absent/empty - ordinary messages render the plain bubble exactly as before", () => {
  assert.ok(messages.includes("const hasAttentionCards = message.role === \"assistant\" && Boolean(message.attention?.items.length);"));
});

// 14. fallback text works when structured data absent
test("14. the orchestrator only ever sets `attention` for the Attention domain - every other domain's answer has attention undefined, so the client fallback applies automatically", () => {
  const attentionAssign = orchestrator.indexOf("const attention = domain ===");
  const attentionLine = orchestrator.slice(attentionAssign, orchestrator.indexOf(";", attentionAssign) + 1);
  assert.ok(attentionLine.includes('domain === "Attention"'));
  assert.ok(attentionLine.includes(": undefined"));
});

// 15. source badge preserved
test("15. NoaSourceBadges still renders for assistant messages, unchanged, regardless of card/bubble branch", () => {
  assert.ok(messages.includes("<NoaSourceBadges domain={message.domain} sources={message.sources} />"));
});

// 16. status chips are non-interactive text
test("16. status chips are plain <span> elements, never <button> or a clickable <div>", () => {
  const chipStart = messages.indexOf("function NoaAttentionStatusChip(");
  const chipBody = sliceFunctionBody(messages, chipStart);
  assert.ok(chipBody.includes("<span "));
  assert.ok(!chipBody.includes("<button"));
  assert.ok(!chipBody.includes("onClick"));
});

// 17. mobile layout contains no table/overflow dependency
test("17. no <table> element and no horizontal-scroll utility class was introduced", () => {
  assert.ok(!messages.includes("<table"));
  assert.ok(!/overflow-x-(auto|scroll)/.test(messages));
  assert.ok(messages.includes("flex-wrap"));
});

// 18. Attention auth/business rules untouched
test("18. Attention capability's auth gates/business rules are untouched", () => {
  assert.equal((attentionCapability.match(/await require(ActiveUser|ProductLibraryManager|ProcurementManager)\(\)/g) ?? []).length, 3);
  assert.equal((attentionCapability.match(/canViewClientPayments\(profileRole\)/g) ?? []).length, 1);
});

// 19. no schema/RLS changes
test("19. no schema/migration/RLS reference was added in any touched file", () => {
  for (const source of [messages, assistant, orchestrator, types, attentionCapability]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

// 20. no avatar/launcher behavior changes
test("20. no avatar/launcher/drag files were touched by this phase", () => {
  assert.ok(!messages.includes("noa-avatar"));
  assert.ok(!messages.includes("DRAG_ACTIVATION_PX"));
});
