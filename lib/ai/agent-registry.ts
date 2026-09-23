import type { AiAgentCapability, AiAgentConfig } from "./types";

const agents: readonly Readonly<AiAgentConfig>[] = Object.freeze([
  Object.freeze({
    id: "source_qa",
    label: "Source QA",
    enabled: true,
    provider: "openai",
    mode: "read_only",
    capabilities: Object.freeze(["read_pdf", "read_json", "read_reviewed_draft", "suggest_findings"]) as readonly AiAgentCapability[],
    canWrite: false,
    modelEnv: "SOURCE_QA_AI_MODEL",
    defaultModel: "gpt-4.1",
  }),
  Object.freeze({
    id: "specification_enrichment",
    label: "Specification Enrichment",
    enabled: true,
    provider: "openai",
    mode: "suggestion",
    capabilities: Object.freeze(["read_json_fragment", "suggest_text"]) as readonly AiAgentCapability[],
    canWrite: false,
    modelEnv: "SPEC_ENRICHMENT_AI_MODEL",
    defaultModel: "gpt-4.1-mini",
  }),
  Object.freeze({
    id: "final_specification",
    label: "Final Specification",
    enabled: true,
    provider: "openai",
    mode: "suggestion",
    capabilities: Object.freeze(["read_builder_selection", "suggest_text"]) as readonly AiAgentCapability[],
    canWrite: false,
    modelEnv: "FINAL_SPECIFICATION_AI_MODEL",
    defaultModel: "gpt-4.1-mini",
  }),
  Object.freeze({
    id: "noa_orchestrator",
    label: "NOA Assistant",
    enabled: true,
    provider: "openai",
    mode: "read_only",
    capabilities: Object.freeze(["product_read", "quotation_read", "price_read", "help"]) as readonly AiAgentCapability[],
    canWrite: false,
    modelEnv: "NOA_AI_MODEL",
    defaultModel: "gpt-4.1-mini",
  }),
]);

export function listAiAgents(): readonly Readonly<AiAgentConfig>[] {
  return agents;
}

export function getAiAgentConfig(id: string): Readonly<AiAgentConfig> | undefined {
  return agents.find((agent) => agent.id === id);
}
