import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichSpecificationBatchWithProvider,
  enrichSpecificationWithProvider,
  SpecificationEnrichmentProviderError,
} from "./specification-enrichment-provider.server.js";

const input = {
  row: { id: "row-1", displayName: "Desk", specification: null, supplierCodes: ["D-1"], referenceCodes: [], dimensions: null, price: 999 },
  context: { templateName: "Range", groupLabel: "Desks", rowType: "base_model" },
  sourceFragment: { row: { code: "D-1", material: "oak" } },
};
const completed = (value: unknown) => new Response(JSON.stringify({
  status: "completed",
  output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
}), { status: 200 });

async function withProvider(fetcher: typeof fetch, run: () => Promise<void>) {
  const previousKey = process.env.SOURCE_QA_AI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SOURCE_QA_AI_API_KEY = "test-key";
  globalThis.fetch = fetcher;
  try { await run(); } finally {
    if (previousKey === undefined) delete process.env.SOURCE_QA_AI_API_KEY;
    else process.env.SOURCE_QA_AI_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
}

test("uses store false and sends only supplied matched context", async () => {
  let requestBody: Record<string, unknown> | null = null;
  await withProvider(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return completed({ displayNameSuggestion: "Oak Desk", specificationSuggestion: "Oak desk." });
  }, async () => {
    assert.deepEqual(await enrichSpecificationWithProvider(input), {
      displayNameSuggestion: "Oak Desk",
      specificationSuggestion: "Oak desk.",
    });
  });
  assert.equal((requestBody as unknown as Record<string, unknown>).store, false);
  const serialized = JSON.stringify(requestBody);
  assert.match(serialized, /matchedSourceContext/);
  assert.doesNotMatch(serialized, /FULL_RAW_SOURCE_SENTINEL/);
  assert.doesNotMatch(serialized, /"price"|999/);
});

test("batch provider preserves target mapping and rejects non-exhaustive output", async () => {
  const items = [
    { targetId: "baseModel:one", currentSpecification: "Current", rowContext: { displayName: "One", templateName: "Range", groupLabel: "Base", rowType: "base_model" }, sourceFragment: { material: "oak" } },
    { targetId: "baseModel:two", currentSpecification: null, rowContext: { displayName: "Two", templateName: "Range", groupLabel: "Base", rowType: "base_model" }, sourceFragment: { material: "steel" } },
  ];
  await withProvider(async () => completed({ results: [{ targetId: "baseModel:one", specificationSuggestion: "Oak." }, { targetId: "baseModel:two", specificationSuggestion: null }] }), async () => {
    assert.deepEqual(await enrichSpecificationBatchWithProvider(items), [{ targetId: "baseModel:one", specificationSuggestion: "Oak." }, { targetId: "baseModel:two", specificationSuggestion: null }]);
  });
  await withProvider(async () => completed({ results: [{ targetId: "baseModel:one", specificationSuggestion: "Oak." }] }), async () => {
    await assert.rejects(enrichSpecificationBatchWithProvider(items), /invalid batch result/);
  });
});

test("provider instructions restrict suggestions to stable base-product facts", async () => {
  let instructions = "";
  await withProvider(async (_url, init) => {
    instructions = String((JSON.parse(String(init?.body)) as { instructions?: unknown }).instructions);
    return completed({ displayNameSuggestion: null, specificationSuggestion: null });
  }, async () => {
    assert.deepEqual(await enrichSpecificationWithProvider(input), { displayNameSuggestion: null, specificationSuggestion: null });
  });
  [
    "Do not include dimensions",
    "optional, removable, configurable, user-selectable",
    "without top access",
    "Return specificationSuggestion null if only optional or configurable facts are available",
    "Return displayNameSuggestion null when the existing Display Name is already clear",
    "Do not make cosmetic-only punctuation or spacing rewrites",
  ].forEach((rule) => assert.match(instructions, new RegExp(rule)));
});

test("missing key and malformed output fail safely", async () => {
  const previousKey = process.env.SOURCE_QA_AI_API_KEY;
  delete process.env.SOURCE_QA_AI_API_KEY;
  await assert.rejects(enrichSpecificationWithProvider(input), (error: unknown) =>
    error instanceof SpecificationEnrichmentProviderError && error.kind === "not_configured");
  if (previousKey !== undefined) process.env.SOURCE_QA_AI_API_KEY = previousKey;

  await withProvider(async () => completed({ displayNameSuggestion: "Desk", specificationSuggestion: null, extra: true }), async () => {
    await assert.rejects(enrichSpecificationWithProvider(input), /invalid result/);
  });
});
