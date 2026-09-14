export type AiAgentId =
  | "source_qa"
  | "specification_enrichment"
  | "final_specification";

export type AiProviderId = "openai";

export type AiAgentMode =
  | "read_only"
  | "suggestion";

export type AiAgentCapability =
  | "read_pdf"
  | "read_json"
  | "read_reviewed_draft"
  | "read_json_fragment"
  | "read_builder_selection"
  | "suggest_findings"
  | "suggest_text";

export type AiAgentConfig = {
  id: AiAgentId;
  label: string;
  enabled: boolean;
  provider: AiProviderId;
  mode: AiAgentMode;
  capabilities: readonly AiAgentCapability[];
  canWrite: boolean;
  modelEnv: string | null;
  defaultModel: string;
};

export type AiProviderConfig = {
  id: AiProviderId;
  label: string;
  endpoint: string;
};
