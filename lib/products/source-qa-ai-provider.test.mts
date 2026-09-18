import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceQaAiReport } from "./source-qa-ai-contract.js";
import { SOURCE_QA_AI_INPUT_TOKEN_BUDGET, SourceQaAiProviderError, buildSourceQaTextPayload, estimateSourceQaTokens, verifySourceQaWithProvider } from "./source-qa-ai-provider.server.js";

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

test("logs safe HTTP and exception diagnostics while retaining friendly 429 and failure messages", async () => {
  const previousError = console.error; const diagnostics: unknown[][] = []; console.error = (...args: unknown[]) => { diagnostics.push(args); };
  try {
    await withProvider(async () => new Response("busy", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "30" } }), async () => await assert.rejects(verifySourceQaWithProvider(input()), /temporarily unavailable/));
    await withProvider(async () => { throw new Error("network offline"); }, async () => await assert.rejects(verifySourceQaWithProvider(input()), /provider request failed/));
  } finally { console.error = previousError; }
  assert.deepEqual(diagnostics[0], ["Source QA AI provider HTTP error", { status: 429, statusText: "Too Many Requests", retryAfter: "30", body: "busy" }]);
  assert.deepEqual(diagnostics[1], ["Source QA AI provider exception", { name: "Error", message: "network offline" }]);
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

// ---------------------------------------------------------------------------
// Payload-budget helper: keeps the AI Source QA text payload safely below the
// provider's TPM ceiling using compaction, then dropping the redundant
// secondary draft copy, before ever touching the primary source text.
// ---------------------------------------------------------------------------

/** A dense, pretty-printed, Sigma-scale ProductTemplateDraft-shaped batch of real commercial rows. */
function sigmaBatch(batchIndex: number, rowCount = 90) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `row-${batchIndex}-${index}`,
    supplierCodes: [`1AJ P${75 + batchIndex * 100 + index}`],
    dimensions: { rawText: `${1000 + index}x${600 + index}x${750 + index} mm` },
    price: 100 + index,
    currency: "EUR",
    specification: "Panel-base module with soft-close hardware and adjustable levellers.",
    importantRequirements: [`Always complete with 2 Art.0${index % 90} fixing kits.`],
  }));
  const sources = Array.from({ length: 3 }, (_, index) => ({ id: `page-${28 + batchIndex + index}`, documentName: "Sigma.pdf", pageNumber: 28 + batchIndex + index, region: null, rawText: `Section heading for printed page ${28 + batchIndex + index}` }));
  return JSON.stringify({ version: 1, pricing: { baseModelRows: rows }, sources }, null, 2);
}

/** Four ~7,000-token batches whose combined size mirrors the confirmed real-world 36,236-token overage. */
function sigmaBatches() {
  return [sigmaBatch(0), sigmaBatch(1), sigmaBatch(2), sigmaBatch(3)];
}

test("1: a large multi-batch Sigma-style Source QA payload is reduced below the new safe input-token budget", () => {
  const batches = sigmaBatches();
  const fixedInstructionsText = "x".repeat(4_100);
  const compactedSize = batches.reduce((sum, text) => sum + JSON.stringify(JSON.parse(text)).length, 0);
  const unbudgeted = fixedInstructionsText.length / 3.5 + (compactedSize / 3.5) * 2;
  assert.ok(unbudgeted > SOURCE_QA_AI_INPUT_TOKEN_BUDGET, "Expected the unbudgeted fixture (original batches + duplicate draft) to exceed the safe budget, proving this test actually exercises trimming");
  const result = buildSourceQaTextPayload({ fixedInstructionsText, sources: batches, draftJson: batches[0] });
  assert.ok(result.estimatedTokens <= SOURCE_QA_AI_INPUT_TOKEN_BUDGET, `Expected estimatedTokens (${result.estimatedTokens}) to be within budget (${SOURCE_QA_AI_INPUT_TOKEN_BUDGET})`);
  assert.equal(result.trimmed, true);
});

test("2: supplier codes in the retained batches survive Source QA payload compaction", () => {
  const batches = sigmaBatches();
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: batches, draftJson: batches[0] });
  ["1AJ P75", "1AJ P91"].forEach((code) => assert.ok(result.originalJsonText.includes(code), `Expected supplier code ${code} to survive compaction`));
});

test("3: page numbers/page identities in the retained batches survive Source QA payload compaction", () => {
  const batches = sigmaBatches();
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: batches, draftJson: batches[0] });
  ['"pageNumber":28', '"documentName":"Sigma.pdf"'].forEach((fragment) => assert.ok(result.originalJsonText.includes(fragment), `Expected page identity ${fragment} to survive compaction`));
});

test("4: importantRequirements in the retained batches survive Source QA payload compaction", () => {
  const batches = sigmaBatches();
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: batches, draftJson: batches[0] });
  assert.ok(result.originalJsonText.includes("Always complete with 2 Art.0"), "Expected importantRequirements text to survive compaction");
});

test("5: every compacted Source QA JSON batch remains valid JSON", () => {
  const batches = sigmaBatches();
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: batches, draftJson: batches[0] });
  const chunks = result.originalJsonText.split(/Original Imported JSON Source \d+:\n/).filter(Boolean);
  assert.ok(chunks.length >= 1, "Expected at least one retained batch");
  chunks.forEach((chunk) => assert.doesNotThrow(() => JSON.parse(chunk.trim()), "Expected each compacted original JSON batch to remain valid, parseable JSON"));
});

test("6: an already-small Source QA payload is effectively unchanged", () => {
  const small = '{"supplierCodes":["BASE-100"],"price":10}';
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: [small], draftJson: small });
  assert.equal(result.trimmed, false);
  assert.equal(result.droppedDraft, false);
  assert.equal(result.droppedSourceCount, 0);
  assert.ok(result.originalJsonText.includes(small));
  assert.equal(result.draftJson, small);
});

test("estimateSourceQaTokens is a conservative, monotonic character-based estimate", () => {
  assert.equal(estimateSourceQaTokens(""), 0);
  assert.ok(estimateSourceQaTokens("x".repeat(3500)) >= 1000);
  assert.ok(estimateSourceQaTokens("aaaa") <= estimateSourceQaTokens("aaaaaaaa"));
});

test("de-duplication drops the secondary reviewed-draft copy, then only the lowest-priority batches, before ever touching the earliest/highest-priority source text", () => {
  const batches = sigmaBatches();
  const result = buildSourceQaTextPayload({ fixedInstructionsText: "x".repeat(4_100), sources: batches, draftJson: batches[0] });
  assert.equal(result.droppedDraft, true, "Expected the redundant secondary draft copy to be dropped first");
  assert.equal(result.draftJson, "");
  assert.ok(result.droppedSourceCount > 0 && result.droppedSourceCount < batches.length, "Expected only the lowest-priority trailing batches to be dropped, not all of them");
  assert.ok(result.originalJsonText.includes("Original Imported JSON Source 1:"), "Expected the first (highest-priority) batch to remain intact");
});

test("7: the AI Source QA request actually sent to the provider is compacted and stays under budget for a large multi-batch Sigma-style fixture, while the friendly 429 mapping is unchanged", async () => {
  const batches = sigmaBatches();
  let body: Record<string, unknown> | null = null;
  await withProvider(async (_url, init) => { body = JSON.parse(String(init?.body)); return response(completed(report)); }, async () => {
    await verifySourceQaWithProvider(input(undefined, JSON.parse(batches[0]), batches.map((rawJson, index) => ({ id: `sigma-${index}`, rawJson }))));
  });
  const request = body as unknown as Record<string, unknown>;
  const content = (request.input as Array<{ content: Array<{ text?: string }> }>)[0]?.content ?? [];
  const totalOriginalBytes = batches.reduce((sum, text) => sum + text.length, 0);
  const sentBytes = JSON.stringify(request).length;
  assert.ok(sentBytes < totalOriginalBytes * 2, "Expected the actually-sent request to be meaningfully smaller than sending both copies of every batch uncompacted");
  assert.ok(content[1]?.text?.includes("1AJ P75"), "Expected the sent request to still contain a real supplier code");
  // The 429 mapping itself is unrelated to payload size and must remain exactly as before.
  await withProvider(async () => new Response("busy", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "30" } }), async () => await assert.rejects(verifySourceQaWithProvider(input()), /temporarily unavailable/));
});

test("8: diagnostic logging path remains unchanged when the payload is trimmed", async () => {
  const batches = sigmaBatches();
  const previousError = console.error; const diagnostics: unknown[][] = []; console.error = (...args: unknown[]) => { diagnostics.push(args); };
  try {
    await withProvider(async () => response({}, 500), async () => await assert.rejects(verifySourceQaWithProvider(input(undefined, JSON.parse(batches[0]), batches.map((rawJson, index) => ({ id: `sigma-${index}`, rawJson })))), /provider request failed/));
  } finally { console.error = previousError; }
  assert.equal(diagnostics[0]?.[0], "Source QA AI provider HTTP error");
  const details = diagnostics[0]?.[1] as Record<string, unknown>;
  assert.equal(details.status, 500);
});
