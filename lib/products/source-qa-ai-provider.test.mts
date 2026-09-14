import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceQaAiReport } from "./source-qa-ai-contract.js";
import { SourceQaAiProviderError, verifySourceQaWithProvider } from "./source-qa-ai-provider.server.js";

const report = { version: 1, summary: { issueCount: 1, highSeverityCount: 1, reviewRequired: true }, issues: [{ id: "issue-1", type: "price_value_mismatch", severity: "critical", confidence: "high", supplierModelCode: "A-1", sourcePage: 1, sourceEvidence: "A-1 100", sourceValue: 100, jsonLocation: "pricing.baseModelRows[0].price", jsonValue: 120, explanation: "Source price differs." }] };
const coverageDraft = {
  pricing: { baseModelRows: [{ supplierCodes: ["BASE-100"], dimensions: { rawText: "1000x600" }, price: 10 }], priceMatrices: [{ rows: [{ supplierCodes: ["MATRIX-200"], prices: { standard: 20 } }] }], modularGroups: [{ matrix: { rows: [{ supplierCodes: ["MOD-300"], prices: { standard: 30 } }] } }], workstationRows: [{ supplierCodes: ["WORK-NULL"], price: null }] },
  optionGroups: [{ selection: { mode: "required_choose_one" }, items: [{ supplierCodes: ["ACC-ZERO"], price: 0 }] }],
};
const input = (bytes = new ArrayBuffer(4), draft: object = {}, originalImportedJsonSources = [{ id: "source-1", rawJson: '{"supplier_code":"BASE-100"}' }]) => ({ sourcePdf: { fileName: "source.pdf", bytes }, originalImportedJsonSources, draft: draft as never });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const completed = (value: unknown) => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

async function withProvider(fetcher: typeof fetch, run: () => Promise<void>) {
  const previousKey = process.env.SOURCE_QA_AI_API_KEY; const previousFetch = globalThis.fetch;
  process.env.SOURCE_QA_AI_API_KEY = "test-key"; globalThis.fetch = fetcher;
  try { await run(); } finally { if (previousKey === undefined) delete process.env.SOURCE_QA_AI_API_KEY; else process.env.SOURCE_QA_AI_API_KEY = previousKey; globalThis.fetch = previousFetch; }
}

test("missing API key is not configured", async () => {
  const previous = process.env.SOURCE_QA_AI_API_KEY; delete process.env.SOURCE_QA_AI_API_KEY;
  await assert.rejects(verifySourceQaWithProvider(input()), (error: unknown) => error instanceof SourceQaAiProviderError && error.message === "AI Source QA is not configured yet.");
  if (previous !== undefined) process.env.SOURCE_QA_AI_API_KEY = previous;
});

test("rejects oversized PDF and draft before fetch", async () => {
  await withProvider(async () => { throw new Error("fetch should not run"); }, async () => {
    await assert.rejects(verifySourceQaWithProvider(input(new ArrayBuffer(15 * 1024 * 1024 + 1))), /Source PDF exceeds/);
    await assert.rejects(verifySourceQaWithProvider(input(undefined, { text: "x".repeat(2 * 1024 * 1024) })), /Product draft exceeds/);
  });
});

test("sends the four-pass exhaustive verification protocol and full pricing fixture", async () => {
  let body: Record<string, unknown> | null = null;
  await withProvider(async (_url, init) => { body = JSON.parse(String(init?.body)); return response(completed(report)); }, async () => { await verifySourceQaWithProvider(input(undefined, coverageDraft)); });
  const request = body as unknown as Record<string, unknown>; const instructions = String(request.instructions); const content = ((request.input as Array<{ content: Array<{ text?: string }> }>)[0]?.content[2]?.text) ?? "";
  ["PASS 1", "PASS 2", "PASS 3", "PASS 4", "every enumerated price-bearing JSON row", "DENSE-TABLE BINDING RULE", "Printed 0 is a real zero", "blank source price is blank/null", "code-only report is incomplete", "Consolidate duplicate findings", "character-for-character", "9MU202a ≠ 9MU202", "ABC-R ≠ ABC", "ML18/1 ≠ ML18", "X-20 ≠ X20", "For every coded JSON row", "independently of price verification"].forEach((value) => assert.match(instructions, new RegExp(value)));
  ["BASE-100", "1000x600", "MATRIX-200", "MOD-300", "WORK-NULL", "ACC-ZERO", "\"price\":null", "\"price\":0"].forEach((value) => assert.ok(content.includes(value), value));
});

test("accepts structured price findings for every pricing structure", async () => {
  const issues = ["baseModelRows[0].price", "priceMatrices[0].rows[0].prices.standard", "modularGroups[0].matrix.rows[0].prices.standard", "optionGroups[0].items[0].price"].map((jsonLocation, index) => ({ ...report.issues[0], id: `price-${index}`, jsonLocation }));
  const result = { ...report, summary: { issueCount: 4, highSeverityCount: 4, reviewRequired: true }, issues };
  await withProvider(async () => response(completed(result)), async () => assert.deepEqual(await verifySourceQaWithProvider(input()), result));
});

test("retries malformed output once then fails safely", async () => {
  let calls = 0;
  await withProvider(async () => { calls += 1; return response(completed({ ...report, issues: [{ ...report.issues[0], type: "invalid" }] })); }, async () => await assert.rejects(verifySourceQaWithProvider(input()), /invalid report/));
  assert.equal(calls, 2);
});

test("duplicates remain schema-valid but are forbidden by the provider instruction", async () => {
  const duplicate = { ...report, summary: { issueCount: 2, highSeverityCount: 2, reviewRequired: true }, issues: [report.issues[0], { ...report.issues[0], id: "issue-duplicate" }] };
  assert.ok(parseSourceQaAiReport(duplicate));
});

test("sanitizes provider HTTP errors and timeouts", async () => {
  await withProvider(async () => response({}, 500), async () => await assert.rejects(verifySourceQaWithProvider(input()), /provider request failed/));
  await withProvider(async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; }, async () => await assert.rejects(verifySourceQaWithProvider(input()), /request timed out/));
});

test("sends each original source separately and rejects invalid source collections", async () => {
  let body: Record<string, unknown> | null = null;
  const sources = [{ id: "one", rawJson: '{"code":"IN120E"}' }, { id: "two", rawJson: '{"code":"IN127E"}' }];
  await withProvider(async (_url, init) => { body = JSON.parse(String(init?.body)); return response(completed(report)); }, async () => { await verifySourceQaWithProvider(input(undefined, {}, sources)); });
  const request = body as unknown as Record<string, unknown>;
  const content = (request.input as Array<{ content: Array<{ text?: string }> }>)[0]?.content ?? [];
  assert.equal(request.store, false);
  assert.match(String(request.instructions), /PDF is the source of truth/);
  assert.match(String(request.instructions), /secondary context only/);
  assert.match(content[1]?.text ?? "", /Original Imported JSON Source 1:[\s\S]*IN120E[\s\S]*Original Imported JSON Source 2:[\s\S]*IN127E/);
  await withProvider(async () => { throw new Error("fetch should not run"); }, async () => {
    await assert.rejects(verifySourceQaWithProvider(input(undefined, {}, [])), /At least one original/);
    await assert.rejects(verifySourceQaWithProvider(input(undefined, {}, Array.from({ length: 11 }, (_, index) => ({ id: String(index), rawJson: "{}" })))), /At most 10/);
    await assert.rejects(verifySourceQaWithProvider(input(undefined, {}, [{ id: "large", rawJson: "x".repeat(2 * 1024 * 1024 + 1) }])), /2 MB/);
  });
});
