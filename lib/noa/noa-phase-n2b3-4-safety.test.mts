// NOA 2.0B-3.4: Catch-Up timeline UI - structured transport (noa-types.ts, noa-orchestrator.ts,
// noa-assistant.tsx) + presentation (noa-messages.tsx). Purely additive/presentational - no audit
// writer, query, routing, auth, or Attention change. Source-level wiring/safety checks, same
// convention as the other *-safety.test.mts files in this codebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const types = readFileSync("lib/noa/noa-types.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

const catchUpVarStart = orchestrator.indexOf("const catchUp = domain ===");
const catchUpVarBody = orchestrator.slice(catchUpVarStart, catchUpVarStart + 1200);

test("1. client does not parse Catch-Up prose - the transport is built from structured capabilityResult.data, never message.text", () => {
  assert.ok(catchUpVarBody.includes("isCatchUpCapabilityData(capabilityResult.data)"));
  assert.ok(!/message\.text|deterministicText\.match|deterministicText\.split/.test(catchUpVarBody));
});

test("2. Catch-Up cards use structured server transport - NoaCatchUpTimeline reads only typed item fields, never message.text", () => {
  const fnStart = messages.indexOf("function NoaCatchUpTimeline(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("catchUp.items.map("));
  assert.ok(!fnBody.includes("message.text"));
});

test("3. audit UUID (the server's internal `key`) is never transported to the client", () => {
  assert.ok(!catchUpVarBody.includes("key:"));
});

test("3b. audit UUID is never part of the NoaCatchUpTransportItem type", () => {
  const typeStart = types.indexOf("export type NoaCatchUpTransportItem");
  const typeBody = types.slice(typeStart, typeStart + 400);
  assert.ok(!typeBody.includes("key:"));
  assert.ok(!typeBody.includes("id:"));
});

test("4. entity UUID is never transported - only entityType (a category string), never entityId", () => {
  const typeStart = types.indexOf("export type NoaCatchUpTransportItem");
  const typeBody = types.slice(typeStart, typeStart + 400);
  assert.ok(typeBody.includes("entityType: string;"));
  assert.ok(!/\bentityId\b/.test(typeBody));
  assert.ok(!/\bentityId\b/.test(catchUpVarBody));
});

test("5. CO/QN heading is rendered once in the timeline header, never per-event", () => {
  const timelineStart = messages.indexOf("function NoaCatchUpTimeline(");
  const timelineBody = sliceFunctionBody(messages, timelineStart);
  const rowStart = messages.indexOf("function NoaCatchUpEventRow(");
  const rowBody = sliceFunctionBody(messages, rowStart);
  assert.ok(timelineBody.includes("catchUp.heading"));
  assert.ok(!rowBody.includes("heading"));
  assert.ok(!rowBody.includes("entityIdentifier"));
});

test("6. QN heading uses the exact same heading field as CO (one generic renderer, no QN-specific branch)", () => {
  assert.equal((messages.match(/catchUp\.heading/g) ?? []).length, 1);
});

test("7. raw/group counts render from the transported fields, never recomputed client-side", () => {
  const timelineStart = messages.indexOf("function NoaCatchUpTimeline(");
  const timelineBody = sliceFunctionBody(messages, timelineStart);
  assert.ok(timelineBody.includes("catchUp.groupCount"));
  assert.ok(timelineBody.includes("catchUp.rawEventCount"));
  assert.ok(!/catchUp\.items\.length/.test(timelineBody));
});

test("8. structured status/enum change renders old -> new via the shared change-row renderer", () => {
  const fnStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("formattedOld"));
  assert.ok(fnBody.includes("formattedNew"));
  assert.ok(fnBody.includes("catchUpFormatScalar"));
});

test("9. structured price change renders with currency prefix when supplied", () => {
  const fnStart = messages.indexOf("function catchUpFormatScalar(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("currency ? `${currency} ${formatted}` : formatted"));
});

test("10. structured date (eta/etd) change renders old -> new via canonical date formatting", () => {
  const fnStart = messages.indexOf("function catchUpFormatScalar(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes('(field === "eta" || field === "etd")'));
  assert.ok(fnBody.includes("catchUpFormatCanonicalDate"));
});

test("11. added field renders cleanly (Added chip, no bare null shown)", () => {
  const fnStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("change.oldValue === null && formattedNew !== null"));
  assert.ok(fnBody.includes(">Added<"));
});

test("12. cleared field renders cleanly (Cleared chip with \"was <value>\", never coerced to zero)", () => {
  const fnStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("change.newValue === null && formattedOld !== null"));
  assert.ok(fnBody.includes(">Cleared<"));
  // N2C1.1 spacing polish: composed as one explicit text string ("· was ${formattedOld}")
  // instead of separate JSX children - see noa-analytics-cards.test.mts #23 for the dedicated
  // regression test on this exact change.
  assert.ok(fnBody.includes("was ${formattedOld}"));
});

test("13. multiple changes render within one event row, preserving array order (no sort)", () => {
  const fnStart = messages.indexOf("function NoaCatchUpEventRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("item.changes.map("));
  assert.ok(!/item\.changes(?:\s*\?\?\s*\[\])?\.sort\(/.test(fnBody));
});

test("14. legacy event (no changes[]) still renders title/detail", () => {
  const fnStart = messages.indexOf("function NoaCatchUpEventRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("item.title"));
  assert.ok(fnBody.includes(": item.detail ? ("));
});

test("15. actor renders only when present, and never shows the unresolved-actor sentinel", () => {
  const rowStart = messages.indexOf("function NoaCatchUpEventRow(");
  const rowBody = sliceFunctionBody(messages, rowStart);
  assert.ok(rowBody.includes("item.actorLabel ? "));
  assert.ok(catchUpVarBody.includes("item.actorLabel !== CATCH_UP_UNRESOLVED_ACTOR_LABEL"));
  assert.ok(orchestrator.includes('const CATCH_UP_UNRESOLVED_ACTOR_LABEL = "Unresolved user";'));
});

test("16. occurrenceCount renders as a ×N badge, never expanding the underlying rows", () => {
  const fnStart = messages.indexOf("function NoaCatchUpEventRow(");
  const fnBody = sliceFunctionBody(messages, fnStart);
  assert.ok(fnBody.includes("item.occurrenceCount && item.occurrenceCount > 1"));
  assert.ok(fnBody.includes("×{item.occurrenceCount}"));
});

test("17. client does not regroup events - it only maps over the already-grouped items array once", () => {
  const timelineStart = messages.indexOf("function NoaCatchUpTimeline(");
  const timelineBody = sliceFunctionBody(messages, timelineStart);
  assert.ok(!/\.reduce\(|new Map\(|groupBy/i.test(timelineBody));
});

test("18. no duplicate long text list - the timeline card and the full prose bubble are mutually exclusive branches", () => {
  assert.ok(messages.includes("hasCatchUpTimeline && message.catchUp ? ("));
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 800);
  assert.ok(ternaryBody.includes("hasCatchUpTimeline && message.catchUp"));
  assert.ok(ternaryBody.includes("{message.text}"));
});

test("19. fallback prose remains when the structured payload is missing/empty/invalid", () => {
  assert.ok(messages.includes("Boolean(message.catchUp?.items.length)"));
});

test("20. Attention card rendering is unchanged - same NoaAttentionCards component, checked first in the priority order", () => {
  const ternaryStart = messages.indexOf("{hasAttentionCards && message.attention ? (");
  const ternaryBody = messages.slice(ternaryStart, ternaryStart + 200).replace(/\r\n/g, "\n");
  assert.ok(ternaryBody.startsWith("{hasAttentionCards && message.attention ? (\n              <NoaAttentionCards attention={message.attention} />"));
});

test("21. ordinary (non-Catch-Up, non-Attention) messages are unchanged - the plain <p> bubble is still the final else branch", () => {
  assert.equal((messages.match(/<p\b/g) ?? []).length, 1);
});

test("22. mobile layout contains no table/horizontal-scroll dependency in the new Catch-Up code", () => {
  const timelineStart = messages.indexOf("function NoaCatchUpTimeline(");
  const rowStart = messages.indexOf("function NoaCatchUpEventRow(");
  const changeRowStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const newUiRegion = messages.slice(Math.min(timelineStart, rowStart, changeRowStart), timelineStart + 5000);
  assert.ok(!/<table|overflow-x-auto|overflow-x-scroll/i.test(newUiRegion));
});

test("23. change values are non-interactive - plain span/div, never a button or clickable element", () => {
  const chipStart = messages.indexOf("function NoaCatchUpChip(");
  const chipBody = sliceFunctionBody(messages, chipStart);
  const changeRowStart = messages.indexOf("function NoaCatchUpChangeRow(");
  const changeRowBody = sliceFunctionBody(messages, changeRowStart);
  assert.ok(!chipBody.includes("<button"));
  assert.ok(!chipBody.includes("onClick"));
  assert.ok(!changeRowBody.includes("<button"));
  assert.ok(!changeRowBody.includes("onClick"));
});

test("24. source provenance (NoaSourceBadges) is preserved for assistant messages regardless of which branch rendered", () => {
  assert.ok(messages.includes("<NoaSourceBadges domain={message.domain} sources={message.sources} />"));
});

test("25. no routing/auth/query change - noa-user-activity-capability.server.ts's Catch-Up query functions carry no N2B3.4 marker", () => {
  assert.ok(!catchUpReader.includes("N2B3.4"));
});

test("26. no schema/migration/RLS reference was added in any touched file", () => {
  for (const source of [types, orchestrator, assistant, messages]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

test("27. no provider/LLM usage was added in any touched file", () => {
  for (const source of [types, orchestrator, assistant, messages]) {
    assert.ok(!/openai|anthropic\.messages|provider\.(generate|complete|chat)/i.test(source));
  }
});

test("28. no audit writer was changed by this phase", () => {
  const quotationWriter = readFileSync("app/quotations/actions.ts", "utf8");
  const productWriter = readFileSync("app/products/templates/actions.ts", "utf8");
  const procurementWriter = readFileSync("lib/procurement/vendor-docs-action.ts", "utf8");
  for (const writer of [quotationWriter, productWriter, procurementWriter]) {
    assert.ok(!writer.includes("N2B3.4"));
  }
});

test("29. Attention capability/business rules untouched by this phase", () => {
  assert.ok(!attentionCapability.includes("N2B3.4"));
});

test("30. NoaAnswer/NoaMessage catchUp field is additive-only - never replaces the existing `text`/`attention`/`choices` fields", () => {
  assert.ok(types.includes("text: string;"));
  assert.ok(types.includes("attention?: NoaAttentionTransport;"));
  assert.ok(types.includes("catchUp?: NoaCatchUpTransport;"));
});
