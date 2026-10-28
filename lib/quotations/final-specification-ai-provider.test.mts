import assert from "node:assert/strict";
import test from "node:test";
import {
  FinalSpecificationProviderError,
  improveFinalSpecificationWithProvider,
} from "./final-specification-ai-provider.server.js";

const request = {
  currentSpecification: "Desk with steel frame.",
  productName: "Desk",
  selectedModel: "Model A",
  selectedDimensions: "1600 x 800",
  selectedFinishLabels: ["Oak"],
  selectedOptionLabels: ["Cable tray"],
  selectedAccessoryLabels: ["Screen"],
  selectedCompanionLabels: ["Return desk"],
  selectedRowFacts: ["Powder-coated steel frame"],
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

test("uses stateless structured output and sends only the compact selection", async () => {
  let body: Record<string, unknown> | null = null;
  await withProvider(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return completed({ specificationSuggestion: "Oak-finished desk with steel frame and cable tray." });
  }, async () => {
    assert.deepEqual(await improveFinalSpecificationWithProvider(request), {
      specificationSuggestion: "Oak-finished desk with steel frame and cable tray.",
    });
  });
  assert.equal((body as unknown as Record<string, unknown>).store, false);
  assert.equal(((body as unknown as { text: { format: { type: string; strict: boolean } } }).text.format).type, "json_schema");
  assert.equal(((body as unknown as { text: { format: { type: string; strict: boolean } } }).text.format).strict, true);
  const inputText = ((body as unknown as {
    input: [{ content: [{ text: string }] }];
  }).input[0].content[0].text);
  assert.deepEqual(JSON.parse(inputText), request);
  assert.doesNotMatch(inputText, /price|currency|supplier.*code/i);
});

test("prompt returns only the specification body while preserving selected facts", async () => {
  let prompt = "";
  await withProvider(async (_url, init) => {
    prompt = String((JSON.parse(String(init?.body)) as { instructions?: unknown }).instructions);
    return completed({ specificationSuggestion: null });
  }, async () => {
    assert.deepEqual(await improveFinalSpecificationWithProvider(request), { specificationSuggestion: null });
  });
  [
    "Preserve every selected technical fact",
    "Do not invent, infer, remove, or replace selected features",
    "Do not repeat the product, template, or model name",
    "do not begin with it",
    "Do not include dimensions, size, width, depth, height, diameter, or dimension formatting",
    "quotation/builder layout displays the product/model name and dimension line separately",
    "Keep actually selected technical features, accessories, options, and configuration facts",
    "do not remove important selected facts because name and dimensions are excluded",
    "Do not mention price, currency, discount",
    "supplier codes, model codes, internal codes",
    "Do not add marketing claims",
    "Return specificationSuggestion null",
  ].forEach((rule) => assert.match(prompt, new RegExp(rule)));
});

test("missing configuration and malformed responses fail safely", async () => {
  const previousKey = process.env.SOURCE_QA_AI_API_KEY;
  delete process.env.SOURCE_QA_AI_API_KEY;
  await assert.rejects(improveFinalSpecificationWithProvider(request), (error: unknown) =>
    error instanceof FinalSpecificationProviderError && error.kind === "not_configured");
  if (previousKey !== undefined) process.env.SOURCE_QA_AI_API_KEY = previousKey;

  await withProvider(async () => completed({ specificationSuggestion: 7 }), async () => {
    await assert.rejects(improveFinalSpecificationWithProvider(request), /invalid result/);
  });
});

test("the prompt carries the house style guide and no longer asks for finishes, brand or country", async () => {
  let prompt = "";
  await withProvider(async (_url, init) => {
    prompt = String((JSON.parse(String(init?.body)) as { instructions?: unknown }).instructions);
    return completed({ specificationSuggestion: null });
  }, async () => { await improveFinalSpecificationWithProvider(request); });
  const { FINAL_SPECIFICATION_STYLE_GUIDE } = await import("./final-specification-style");
  assert.ok(prompt.includes(FINAL_SPECIFICATION_STYLE_GUIDE), "style guide is part of the system instructions");
  assert.doesNotMatch(prompt, /Include supplied selected finish\/material/);
  assert.doesNotMatch(prompt, /technical features, finishes/);
  assert.doesNotMatch(prompt, /brand\/origin fact may be preserved/);
  assert.match(prompt, /Never write the brand, country/);
});

test("the prompt has the Improve block by default and the Shorten block in shorten mode", async () => {
  const prompts: string[] = [];
  await withProvider(async (_url, init) => {
    prompts.push(String((JSON.parse(String(init?.body)) as { instructions?: unknown }).instructions));
    return completed({ specificationSuggestion: null });
  }, async () => {
    await improveFinalSpecificationWithProvider(request);
    await improveFinalSpecificationWithProvider({ ...request, mode: "shorten" });
  });
  assert.match(prompts[0], /MODE: IMPROVE/); assert.doesNotMatch(prompts[0], /MODE: SHORTEN/);
  assert.match(prompts[1], /MODE: SHORTEN[\s\S]*Never remove a selected accessory[\s\S]*Never add a fact[\s\S]*Never change a number or size/);
  assert.doesNotMatch(prompts[1], /MODE: IMPROVE/);
});

test("the Shorten block asks for about 25% fewer words, and the rules say colour-only accessories are not written", async () => {
  let shorten = "";
  await withProvider(async (_url, init) => {
    shorten = String((JSON.parse(String(init?.body)) as { instructions?: unknown }).instructions);
    return completed({ specificationSuggestion: null });
  }, async () => { await improveFinalSpecificationWithProvider({ ...request, mode: "shorten" }); });
  assert.match(shorten, /about 25% fewer words, without removing a selected feature or number/);
  assert.match(shorten, /Do not write accessories that are only a colour or finish \(for example "Black Plastic Parts"\)/);
  assert.match(shorten, /Colour words stay allowed inside a feature name such as "black soft double castors"/);
});
