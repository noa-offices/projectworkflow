import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderConfig, listAiProviderConfigs, listApprovedAiModels, isApprovedAiModel, OPENAI_RESPONSES_API_ENDPOINT } from "./provider-config.js";

test("exposes only non-secret OpenAI Responses metadata", () => {
  const provider = getAiProviderConfig("openai");
  assert.deepEqual(provider, { id: "openai", label: "OpenAI", endpoint: OPENAI_RESPONSES_API_ENDPOINT });
  assert.deepEqual(listAiProviderConfigs().map((item) => item.id), ["openai", "anthropic", "gemini"]);
  assert.doesNotMatch(JSON.stringify(provider), /api.?key|secret|token|password/i);
});

test("approved models are provider-specific", () => {
  for (const provider of listAiProviderConfigs()) {
    for (const model of listApprovedAiModels(provider.id)) {
      assert.equal(isApprovedAiModel(provider.id, model), true);
      for (const other of listAiProviderConfigs().filter((item) => item.id !== provider.id)) assert.equal(isApprovedAiModel(other.id, model), false);
    }
    assert.equal(isApprovedAiModel(provider.id, "invented-model"), false);
  }
});

test("returns undefined for unknown providers", () => {
  assert.equal(getAiProviderConfig("unknown"), undefined);
});
