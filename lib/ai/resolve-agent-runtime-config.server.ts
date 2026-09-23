import "server-only";

import { getAiAgentConfig } from "./agent-registry";
import { createClient } from "@/lib/supabase/server";
import type { AiAgentId, AiProviderId, AiRuntimeConfigSource } from "./types";

export type AiAgentRuntimeConfig = {
  agentId: AiAgentId;
  apiKeyConfigured: boolean;
  model: string;
  provider: AiProviderId;
  enabled: boolean;
  source: AiRuntimeConfigSource;
};

type ProviderSettingsRow = { default_model: string | null; enabled: boolean; is_default: boolean; provider_id: string };
type AgentSettingsRow = { agent_id: string; enabled: boolean; model: string | null; provider_id: string | null };

// Env vars whose presence means that provider's credentials are configured. Phase 2A-1 has no DB
// settings yet, so this table is the entire credential-status source until Phase 2A-2 adds one;
// only booleans are ever derived from it, never a key value.
const PROVIDER_CREDENTIAL_ENV: Record<AiProviderId, readonly string[]> = {
  openai: ["OPENAI_API_KEY", "SOURCE_QA_AI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
};

// Exported so callers that need a provider-level (not agent-level) credential-configured boolean
// - e.g. an Admin/System summary - can reuse this exact check rather than re-deriving it from
// process.env themselves. Still only ever returns a boolean, never a credential value.
export function isProviderCredentialConfigured(provider: AiProviderId): boolean {
  return PROVIDER_CREDENTIAL_ENV[provider].some((envVar) => Boolean(process.env[envVar]?.trim()));
}

// The ONLY place a migrated agent resolves its provider/model from - never read the registry or
// process.env directly at a call site once migrated. Phase 2A-1 is registry-only resolution:
//   provider: the agent's registry entry (agent.provider)
//   model:    agent.modelEnv's current env value if set, else agent.defaultModel
//   apiKeyConfigured: boolean only, never the credential value itself
// This function never reads agent.canWrite/mode/capabilities and never touches Supabase - it has
// no bearing on what a user may access, only on where the agent executes.
//
// Deliberately shaped so Phase 2A-2 can later insert "agent DB override -> global DB default ->
// registry code default" as new steps *inside* this function, without any migrated agent's call
// site changing at all.
export async function resolveAiAgentRuntimeConfig(agentId: AiAgentId): Promise<AiAgentRuntimeConfig> {
  const agentConfig = getAiAgentConfig(agentId);
  if (!agentConfig) {
    throw new Error(`Unknown AI agent: ${agentId}`);
  }

  let provider = agentConfig.provider;
  let providerSource: AiRuntimeConfigSource["provider"] = "registry_default";
  let providerDefaultModel: string | null = null;
  let agentSettings: AgentSettingsRow | null = null;

  try {
    const supabase = await createClient();
    const [agentResult, providerResult, registryProviderResult] = await Promise.all([
      supabase.from("ai_agent_settings").select("agent_id,provider_id,model,enabled").eq("agent_id", agentId).maybeSingle<AgentSettingsRow>(),
      supabase.from("ai_provider_settings").select("provider_id,enabled,default_model,is_default").eq("is_default", true).eq("enabled", true).maybeSingle<ProviderSettingsRow>(),
      supabase.from("ai_provider_settings").select("provider_id,enabled,default_model,is_default").eq("provider_id", agentConfig.provider).maybeSingle<ProviderSettingsRow>(),
    ]);
    // Missing tables/rows are intentionally non-fatal during migration rollout.
    if (!agentResult.error) agentSettings = agentResult.data;
    const globalProvider = !providerResult.error ? providerResult.data : null;

    if (agentSettings?.enabled === false) {
      return {
        agentId,
        apiKeyConfigured: false,
        enabled: false,
        model: agentConfig.defaultModel,
        provider: agentConfig.provider,
        source: { model: "registry_default", provider: "registry_default" },
      };
    }

    if (agentSettings?.provider_id === "openai" || agentSettings?.provider_id === "anthropic" || agentSettings?.provider_id === "gemini") {
      const { data: overrideProvider } = await supabase
        .from("ai_provider_settings")
        .select("provider_id,enabled,default_model,is_default")
        .eq("provider_id", agentSettings.provider_id)
        .maybeSingle<ProviderSettingsRow>();
      if (overrideProvider?.enabled) {
        provider = overrideProvider.provider_id as AiProviderId;
        providerDefaultModel = overrideProvider.default_model;
        providerSource = "agent_override";
      }
    }

    if (providerSource === "registry_default" && (globalProvider?.provider_id === "openai" || globalProvider?.provider_id === "anthropic" || globalProvider?.provider_id === "gemini")) {
      provider = globalProvider.provider_id as AiProviderId;
      providerDefaultModel = globalProvider.default_model;
      providerSource = "global_default";
    }

    if (providerSource === "registry_default" && registryProviderResult.data) {
      if (!registryProviderResult.data.enabled) {
        return { agentId, apiKeyConfigured: false, enabled: true, model: agentConfig.defaultModel, provider: agentConfig.provider, source: { model: "registry_default", provider: "registry_default" } };
      }
      providerDefaultModel = registryProviderResult.data.default_model;
    }
  } catch (error) {
    console.error("AI RUNTIME SETTINGS LOOKUP ERROR", error);
  }

  const modelFromEnv = agentConfig.modelEnv ? process.env[agentConfig.modelEnv]?.trim() : undefined;
  const agentModel = agentSettings?.model?.trim();
  const model = agentModel || providerDefaultModel || modelFromEnv || agentConfig.defaultModel;
  const modelSource: AiRuntimeConfigSource["model"] = agentModel
    ? "agent_override"
    : providerDefaultModel
      ? "provider_default"
      : modelFromEnv
        ? "env_override"
        : "registry_default";

  return {
    agentId,
    apiKeyConfigured: isProviderCredentialConfigured(provider),
    enabled: true,
    model,
    provider,
    source: { model: modelSource, provider: providerSource },
  };
}
