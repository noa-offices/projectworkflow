import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { NoaAnswer, NoaAnalyticsTransport } from "./noa-types.js";

const source = readFileSync("lib/noa/noa-spoken-response.ts", "utf8");
const compiled = { exports: {} };
new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(compiled.exports);
const { buildNoaSpokenResponse: speak, withNoaSpokenResponse: attach, normalizeNoaSpeech: normalize } = compiled.exports as {
  buildNoaSpokenResponse: (answer: NoaAnswer) => string | null;
  withNoaSpokenResponse: (answer: NoaAnswer) => NoaAnswer;
  normalizeNoaSpeech: (text: string) => string;
};
const answer = (fields: Partial<NoaAnswer> = {}): NoaAnswer => ({ domain: "Help", sources: [], text: "Original visual response.", ...fields });
const metric = (key: string, value: string) => ({ key, label: key, value });
const analytics = (fields: Partial<NoaAnalyticsTransport>) => answer({ domain: "Insights", analytics: { kind: "quotation_analytics", title: "Quotation analytics", ...fields } });
const attentionItem = { sourceDomain: "Procurement" as const, kind: "procurement_missing_eta", title: "LAS MOBILI — ETA missing", detail: "CO-0003-001 · Galleria", entityLabel: "LAS MOBILI", entityIdentifier: "CO-0003-001" };
const event = (title: string) => ({ title, action: "updated", entityType: "procurement", occurredAt: "2026-09-26T14:50:00Z", occurrenceCount: 3 });
const brief = (facts: string[][]): NoaAnswer => answer({ agentBrief: { title: "Project briefing", summary: "3 sections", partial: true, omissions: ["Secret refusal detail"], sections: facts.map((facts, index) => ({ heading: `Section ${index}`, facts })) } });

test("contract is optional, additive and leaves visual payload/reference identities untouched", () => {
  const input = analytics({ metrics: [metric("count", "2")] });
  const before = JSON.stringify(input);
  Object.freeze(input);
  const output = attach(input);
  assert.equal(output.text, input.text);
  assert.equal(output.analytics, input.analytics);
  assert.equal(output.sources, input.sources);
  assert.equal(JSON.stringify(input), before);
  assert.ok(output.voiceText);
  const types = readFileSync("lib/noa/noa-types.ts", "utf8");
  assert.equal((types.match(/voiceText\?: string;/g) ?? []).length, 2);
});
test("multi-item attention uses supplied count and mentions at most one representative", () => {
  const text = speak(answer({ attention: { count: 5, items: [attentionItem, { ...attentionItem, entityLabel: "Other vendor" }] } }))!;
  assert.match(text, /5 items needing attention/);
  assert.match(text, /2 items with missing ETA/);
  assert.match(text, /LAS MOBILI on Galleria is missing an ETA/);
  assert.doesNotMatch(text, /Other vendor|CO-0003|urgent|priority/);
  assert.ok(text.length <= 600);
});
test("single attention item can identify its name and existing issue", () => {
  const text = speak(answer({ attention: { count: 1, items: [attentionItem] } }))!;
  assert.match(text, /1 item needing attention/); assert.match(text, /LAS MOBILI on Galleria is missing an ETA/);
  assert.doesNotMatch(text, /CO-0003/);
});
test("single attention item retains identifier when name is unavailable", () => {
  assert.match(speak(answer({ attention: { count: 1, items: [{ ...attentionItem, entityLabel: "", detail: "" }] } }))!, /CO-0003-001/);
});

test("Attention keeps the project name when the vendor label is unavailable", () => {
  const text = speak(answer({ attention: { count: 1, items: [{ ...attentionItem, entityLabel: "" }] } }))!;
  assert.match(text, /An item on Galleria is missing an ETA/);
  assert.doesNotMatch(text, /CO-0003/);
});

test("Attention counts distinct projects and summarizes ETA/ETD without enumerating rows", () => {
  const items = [attentionItem,
    { ...attentionItem, kind: "procurement_missing_etd" },
    { ...attentionItem, entityLabel: "Vendor B" },
    { ...attentionItem, kind: "procurement_missing_etd", entityLabel: "Vendor C", entityIdentifier: "CO-0002-003", detail: "CO-0002-003 · HQ Office" },
    { ...attentionItem, entityLabel: "Vendor D", entityIdentifier: "CO-0002-003", detail: "CO-0002-003 · HQ Office" },
  ];
  const input = answer({ attention: { count: 5, items } });
  const before = JSON.stringify(input);
  const output = attach(input);
  assert.equal(output.voiceText, "You have 5 items needing attention across 2 projects. Listed issues include 3 items with missing ETA and 2 items with missing ETD. LAS MOBILI on Galleria is missing an ETA.");
  assert.doesNotMatch(output.voiceText!, /Vendor B|Vendor C|Vendor D|HQ Office|CO-/);
  assert.equal(output.attention, input.attention);
  assert.equal(output.text, input.text);
  assert.equal(JSON.stringify(input), before);
});

test("Attention groups known payment and price kinds, frequency-first without inferred urgency", () => {
  const text = speak(answer({ attention: { count: 4, items: [
    { ...attentionItem, sourceDomain: "Price", kind: "price_due", entityLabel: "Product A" },
    { ...attentionItem, sourceDomain: "ClientPayment", kind: "payment_overdue", entityLabel: "Client A" },
    { ...attentionItem, sourceDomain: "ClientPayment", kind: "payment_overdue", entityLabel: "Client B" },
    { ...attentionItem, sourceDomain: "Price", kind: "price_needs_check", entityLabel: "Product B" },
  ] } }))!;
  assert.match(text, /2 items with overdue payment and 1 item with price marked due/);
  assert.match(text, /Product A has a price marked due/);
  assert.doesNotMatch(text, /Client A|Client B|Product B|projects|urgent|priority|at risk|delayed/);
});

test("price-needs-check remains distinct from overdue payment", () => {
  const text = speak(answer({ attention: { count: 2, items: [
    { ...attentionItem, sourceDomain: "Price", kind: "price_needs_check", entityLabel: "Product" },
    { ...attentionItem, sourceDomain: "Price", kind: "price_needs_check", entityLabel: "Another product" },
  ] } }))!;
  assert.match(text, /2 items with price needing a check/);
  assert.doesNotMatch(text, /overdue|missing ETA/);
});

test("Attention missing details and unknown kinds safely retain the count fallback", () => {
  const text = speak(answer({ attention: { count: 3, items: [{ ...attentionItem, kind: "unknown_internal_kind", title: "", detail: "", entityLabel: "", entityIdentifier: undefined }] } }))!;
  assert.equal(text, "You have 3 items needing attention. You can review the individual items on screen.");
});

test("Attention never infers issue type from prose or a mismatched source domain", () => {
  const text = speak(answer({ attention: { count: 2, items: [{ ...attentionItem, sourceDomain: "Price", detail: "missing ETA", entityIdentifier: undefined }] } }))!;
  assert.doesNotMatch(text, /missing ETA|missing an ETA|projects/);
});

test("Attention rejects UUID/internal labels and ignores hidden metadata", () => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const item = { ...attentionItem, entityLabel: uuid, entityIdentifier: uuid, detail: `vendor_key: ${uuid}`, title: uuid, metadata: "secret", vendor_key: "secret" };
  const text = speak(answer({ attention: { count: 2, items: [item] } }))!;
  assert.match(text, /1 item with missing ETA/);
  assert.doesNotMatch(text, /12345678|vendor_key|secret|metadata/);
  assert.equal(speak(answer({ attention: { count: 1, items: [{ ...item, kind: "unknown" }] } })), "You have 1 item needing attention. You can review the individual items on screen.");
});

test("Attention project counts are omitted for incomplete identification and qualified for partial lists", () => {
  const partial = speak(answer({ attention: { count: 20, items: [attentionItem] } }))!;
  assert.match(partial, /20 items needing attention, with listed procurement issues across 1 project/);
  const unknown = speak(answer({ attention: { count: 2, items: [attentionItem, { ...attentionItem, entityIdentifier: undefined }] } }))!;
  assert.doesNotMatch(unknown, /across .*project/);
});

test("Attention does not treat vendor labels or arbitrary detail prose as project names", () => {
  const text = speak(answer({ attention: { count: 2, items: [{ ...attentionItem, detail: "Unstructured explanation", entityIdentifier: undefined }] } }))!;
  assert.match(text, /LAS MOBILI is missing an ETA/);
  assert.doesNotMatch(text, /on Unstructured|projects/);
});

test("Attention stays bounded with oversized representative labels", () => {
  const text = speak(answer({ attention: { count: 2, items: [{ ...attentionItem, entityLabel: "Name ".repeat(160), detail: `CO-0003-001 · ${"Project ".repeat(160)}` }] } }))!;
  assert.ok(text.length <= 600);
  assert.doesNotMatch(text, /Name|CO-0003/);
  assert.match(text, /1 item with missing ETA/);
});
test("catch-up uses raw event count, first two titles, no timestamps or grouped-row recount", () => {
  const text = speak(answer({ catchUp: { rawEventCount: 15, groupCount: 4, items: [event("Procurement updated"), event("Quotation status changed"), event("Hidden from short speech")] } }))!;
  assert.match(text, /15 recorded changes/); assert.match(text, /Procurement updated/); assert.match(text, /Quotation status changed/);
  assert.doesNotMatch(text, /14:50|2026|×|Hidden from short speech|today|latest/);
});
test("single catch-up speaks the event and normalizes repetition notation", () => {
  const text = speak(answer({ catchUp: { rawEventCount: 3, groupCount: 1, items: [event("Procurement updated ×3")] } }))!;
  assert.match(text, /The change is Procurement updated repeated 3 times/); assert.doesNotMatch(text, /×/);
});
test("quotation analytics reads count and exact value in two sentences", () => {
  const text = speak(analytics({ period: "Last month", metrics: [metric("count", "2"), metric("quoted_value", "AED 147,966.52"), metric("average_value", "AED 73,983.26")] }))!;
  assert.equal(text, "For Last month, there are 2 quotations. The quoted value is 147,966.52 UAE dirhams.");
});
test("singular quotation count stays natural", () => {
  assert.equal(speak(analytics({ metrics: [metric("count", "1")] })), "There is 1 quotation.");
});
test("project analytics does not mislabel total Project Files as active count", () => {
  const text = speak(analytics({ kind: "project_file_analytics", metrics: [metric("project_files", "7"), metric("active_value", "AED 152,000")], statusBreakdown: [{ label: "Active", count: 2 }] }))!;
  assert.match(text, /7 Project Files/); assert.match(text, /active value is 152,000 UAE dirhams/);
  assert.doesNotMatch(text, /7 active/);
});
test("client rankings keep only top three names and preserve metric and currency scopes", () => {
  const text = speak(analytics({ kind: "client_analytics", title: "Top clients by quotation value", rankings: [
    { heading: "AED", rows: ["TechCorp", "EXQUITECH", "Apex", "Fourth"].map((label, index) => ({ label, rank: index + 1, value: "AED 10" })) },
    { heading: "EUR", rows: [{ label: "Euro client", rank: 1, value: "EUR 90" }] },
  ] }))!;
  assert.match(text, /leading clients by quotation value in UAE dirhams are TechCorp, EXQUITECH, Apex/);
  assert.match(text, /in euros are Euro client/); assert.doesNotMatch(text, /Fourth|AED 10|overall/);
});
test("client summary is based only on displayed lifecycle metrics", () => {
  assert.equal(speak(analytics({ kind: "client_analytics", metrics: [metric("active_clients", "2"), metric("archived_clients", "1")] })), "There are 2 active clients. There is 1 archived client.");
});
test("multi-currency values are never summed or converted", () => {
  assert.equal(speak(analytics({ metrics: [metric("quoted_value", "AED 100.50\nEUR 200.25\nUSD 300.75")] })), "The quoted value is 100.50 UAE dirhams and 200.25 euros and 300.75 US dollars.");
});
test("product metrics retain the server scope note", () => {
  const text = speak(analytics({ kind: "product_analytics", metrics: [metric("active_products", "20"), metric("archived_products", "3")], note: "Based on the 200 most recent records." }))!;
  assert.match(text, /20 active products/); assert.match(text, /3 archived products/); assert.match(text, /Based on the 200 most recent records/);
});
test("procurement summary reads active orders and missing ETA without inventing delay", () => {
  const text = speak(analytics({ kind: "procurement_analytics", metrics: [metric("active_orders", "2"), metric("missing_eta", "1")], note: "Vendor figures cover active orders." }))!;
  assert.match(text, /2 active procurement orders/); assert.match(text, /1 vendor group is missing ETA information/);
  assert.doesNotMatch(text, /delayed|urgent|at risk/);
});
test("payment summary uses authorized displayed amounts and retains scope", () => {
  const input = analytics({ kind: "payment_analytics", period: "Active Project Files", metrics: [metric("received", "AED 1,000.25"), metric("outstanding", "EUR 500.50")], note: "Only active Project Files are included." });
  const text = speak(input)!;
  assert.match(text, /received 1,000.25 UAE dirhams/); assert.match(text, /500.50 euros remains outstanding/); assert.match(text, /Only active Project Files/);
  assert.equal(speak(answer({ text: "Payment information isn't available for this request." })), "Payment information isn't available for this request.");
});
test("unavailable metric is not spoken as zero; empty analytics uses server copy", () => {
  assert.equal(speak(analytics({ metrics: [metric("quoted_value", "—")] })), "Original visual response.");
  assert.equal(speak(analytics({ emptyMessage: "No quotations match this period." })), "No quotations match this period.");
});
test("Agent Brief uses complete first facts, not headings/omissions or inferred risk", () => {
  const text = speak(brief([["CO-0003-001 (Galleria) is active.", "Second project detail."], ["Procurement is missing ETA information."], ["There were vendor progress updates."]]))!;
  assert.equal(text, "Galleria is active. Procurement is missing ETA information. There were vendor progress updates.");
  assert.doesNotMatch(text, /Section|sections|Secret|Second project|CO-|urgent|at risk|delayed/);
});
test("a fact's qualifying second sentence remains attached", () => {
  assert.equal(speak(brief([["The value is AED 100. This excludes tax."]])), "The value is 100 UAE dirhams. This excludes tax.");
});
test("client and quotation briefs use the same fact projection", () => {
  for (const fact of ["EXQUITECH has two quotations.", "QN-0005-001 is pending."]) assert.equal(speak(brief([[fact]])), fact);
});
test("empty brief suppresses omission/refusal fallback rather than exposing it through TTS", () => {
  const input = brief([]); input.text = "Secret refusal detail";
  assert.equal(speak(input), null); assert.equal(attach(input).voiceText, "");
});
test("explicit identifier/name pairs prefer names; identifier-only answers retain identity", () => {
  assert.equal(normalize("CO-0003-001 — Galleria Mall Boutique Refurbishment is active."), "Galleria Mall Boutique Refurbishment is active.");
  assert.equal(normalize("QN-0005-001 remains pending."), "QN-0005-001 remains pending.");
});
test("amount signs and decimals are exact for AED/EUR/USD; no approximation or FX", () => {
  assert.equal(normalize("AED -9,999.52; EUR 147,966.52; USD 0.01"), "-9,999.52 UAE dirhams; 147,966.52 euros; 0.01 US dollars");
});
test("date normalization expands explicit month names without timezone conversion", () => {
  assert.equal(normalize("26 Sep 2026 at 14:50"), "26 September 2026 at 14:50");
});
test("normal prose strips presentation markup without removing inequalities or links' labels", () => {
  assert.equal(speak(answer({ text: "**Ready.**\n- Open [Project Files](/projects).\nValue < 10 and > 5." })), "Ready. Open Project Files. Value < 10 and > 5.");
});
test("unknown structured kind and comparison/trend fall back to existing prose", () => {
  for (const kind of ["unknown", "quotation_compare", "quotation_trend"] as NoaAnalyticsTransport["kind"][]) {
    assert.equal(speak(analytics({ kind })), "Original visual response.");
  }
});
test("empty/unusable content yields no speakable projection", () => {
  for (const text of ["", "  ", "...", "👋", "<b></b>"]) assert.equal(speak(answer({ text })), null);
});
test("600-character hard bound drops whole details without mid-word/amount truncation", () => {
  const fact = `This is ${"a detailed phrase ".repeat(28)}ending with AED 123.45.`;
  const text = speak(brief([[fact], ["Another complete fact."], ["z".repeat(700)]]))!;
  assert.ok(text.length <= 600); assert.match(text, /123\.45 UAE dirhams\./); assert.doesNotMatch(text, /zzz/);
  assert.equal(speak(answer({ text: "w".repeat(601) })), null);
});
test("bounds never remove required analytics scope note to fit metrics", () => {
  const text = speak(analytics({ metrics: [metric("quoted_value", "AED 100")], note: "Scope note. ".repeat(80) }));
  assert.equal(text, null);
});
test("renderer ignores source metadata and conversation references; no external calls", () => {
  const input = Object.assign(analytics({ metrics: [metric("count", "2")] }), { metadata: "secret", rawRows: [{ amount: 999999 }] });
  input.sources = [{ label: "Source", type: "secret-type", recordId: "secret-id" }];
  assert.doesNotMatch(speak(input)!, /secret|999999/);
  assert.doesNotMatch(source, /fetch\(|supabase|runAiProvider|OpenAI|Gemini|WebSocket|localStorage|document\./);
});
test("server adds speech on all final paths and client carries it without replacing text", () => {
  const server = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.match(server, /return withNoaSpokenResponse\(configurationAnswer\)/);
  assert.match(server, /return withNoaSpokenResponse\(\{ \.\.\.answer, productConfigurationReference: incomingConfigurationReference \}\)/);
  assert.match(server, /return withNoaSpokenResponse\(answer\)/);
  const client = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  assert.match(client, /createMessage\("assistant", answer.text, \{ voiceText: answer.voiceText/);
  assert.match(client, /role === "assistant" && meta\?\.voiceText !== undefined/);
});
test("existing Agent Brief UI assertion still passes unchanged", () => {
  const path = "lib/noa/agents/noa-agent-runtime.test.mts";
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const statement = ast.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text === "fixed server integration and mutually exclusive wrapping UI");
  assert.ok(statement);
  new Function("test", "assert", "readFileSync", statement.getText(ast))((_name: string, run: () => void) => run(), assert, readFileSync);
});
