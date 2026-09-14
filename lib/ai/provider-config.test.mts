import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderConfig, listAiProviderConfigs, OPENAI_RESPONSES_API_ENDPOINT } from "./provider-config.js";

test("exposes only non-secret OpenAI Responses metadata", () => {
  const provider = getAiProviderConfig("openai");
  assert.deepEqual(provider, { id: "openai", label: "OpenAI", endpoint: OPENAI_RESPONSES_API_ENDPOINT });
  assert.deepEqual(listAiProviderConfigs(), [provider]);
  assert.doesNotMatch(JSON.stringify(provider), /api.?key|secret|token|password/i);
});

test("returns undefined for unknown providers", () => {
  assert.equal(getAiProviderConfig("unknown"), undefined);
});
