import assert from "node:assert/strict";
import test from "node:test";
import { getAiAgentConfig, listAiAgents } from "./agent-registry.js";

test("registers the four enabled non-writing current agents", () => {
  const agents = listAiAgents();
  assert.deepEqual(agents.map((agent) => agent.id), ["source_qa", "specification_enrichment", "final_specification", "noa_orchestrator"]);
  assert.equal(new Set(agents.map((agent) => agent.id)).size, agents.length);
  assert.ok(agents.every((agent) => agent.enabled && !agent.canWrite));
});

test("declares current capabilities and model metadata", () => {
  assert.deepEqual(getAiAgentConfig("source_qa"), {
    id: "source_qa", label: "Source QA", enabled: true, provider: "openai", mode: "read_only",
    capabilities: ["read_pdf", "read_json", "read_reviewed_draft", "suggest_findings"],
    canWrite: false, modelEnv: "SOURCE_QA_AI_MODEL", defaultModel: "gpt-4.1",
  });
  assert.deepEqual(getAiAgentConfig("specification_enrichment"), {
    id: "specification_enrichment", label: "Specification Enrichment", enabled: true, provider: "openai", mode: "suggestion",
    capabilities: ["read_json_fragment", "suggest_text"],
    canWrite: false, modelEnv: "SPEC_ENRICHMENT_AI_MODEL", defaultModel: "gpt-4.1-mini",
  });
  assert.deepEqual(getAiAgentConfig("final_specification"), {
    id: "final_specification", label: "Final Specification", enabled: true, provider: "openai", mode: "suggestion",
    capabilities: ["read_builder_selection", "suggest_text"],
    canWrite: false, modelEnv: "FINAL_SPECIFICATION_AI_MODEL", defaultModel: "gpt-4.1-mini",
  });
  assert.deepEqual(getAiAgentConfig("noa_orchestrator"), {
    id: "noa_orchestrator", label: "NOA Assistant", enabled: true, provider: "openai", mode: "read_only",
    capabilities: ["product_read", "quotation_read", "price_read", "help"],
    canWrite: false, modelEnv: "NOA_AI_MODEL", defaultModel: "gpt-4.1-mini",
  });
});

test("returns undefined for unknown agents", () => {
  assert.equal(getAiAgentConfig("unknown"), undefined);
});
