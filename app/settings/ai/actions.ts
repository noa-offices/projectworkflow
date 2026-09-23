"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAiAgentConfig } from "@/lib/ai/agent-registry";
import { getAiProviderConfig, isApprovedAiModel, listAiProviderConfigs } from "@/lib/ai/provider-config";
import type { AiProviderId } from "@/lib/ai/types";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, name: string) {
  const item = formData.get(name);
  return typeof item === "string" ? item.trim() : "";
}

function optionalProvider(value: string): AiProviderId | null {
  if (!value) return null;
  if (!getAiProviderConfig(value)) throw new Error("Unknown AI provider.");
  return value as AiProviderId;
}

function optionalModel(providerId: AiProviderId, model: string) {
  if (!model) return null;
  if (!isApprovedAiModel(providerId, model)) throw new Error("Unsupported AI model.");
  return model;
}

export async function saveAiProviderSettings(formData: FormData) {
  const { user } = await requireSystemOwner();
  const providerId = value(formData, "provider_id");
  if (!listAiProviderConfigs().some((provider) => provider.id === providerId)) throw new Error("Unknown AI provider.");
  const provider = providerId as AiProviderId;
  const enabled = value(formData, "enabled") === "true";
  const isDefault = value(formData, "is_default") === "true";
  const defaultModel = optionalModel(provider, value(formData, "default_model"));
  const supabase = await createClient();

  if (isDefault) {
    const { error } = await supabase.from("ai_provider_settings").update({ is_default: false }).neq("provider_id", provider);
    if (error) throw new Error("AI provider settings could not be saved.");
  }
  const { error } = await supabase.from("ai_provider_settings").upsert({
    provider_id: provider,
    enabled,
    default_model: defaultModel,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }, { onConflict: "provider_id" });
  if (error) throw new Error("AI provider settings could not be saved.");
  if (isDefault) {
    const { data: inheritedAgents, error: inheritedReadError } = await supabase
      .from("ai_agent_settings")
      .select("agent_id,model")
      .is("provider_id", null)
      .not("model", "is", null)
      .returns<Array<{ agent_id: string; model: string | null }>>();
    if (inheritedReadError) throw new Error("AI provider settings could not be saved.");
    await Promise.all((inheritedAgents ?? [])
      .filter((agent) => agent.model && !isApprovedAiModel(provider, agent.model))
      .map((agent) => supabase.from("ai_agent_settings").update({ model: null }).eq("agent_id", agent.agent_id)));
  }
  revalidatePath("/settings/ai");
  redirect("/settings/ai?message=AI+provider+settings+saved.");
}

export async function saveAiAgentSettings(formData: FormData) {
  const { user } = await requireSystemOwner();
  const agentId = value(formData, "agent_id");
  if (!getAiAgentConfig(agentId)) throw new Error("Unknown AI agent.");
  const providerId = optionalProvider(value(formData, "provider_id"));
  const modelRaw = value(formData, "model");
  const supabase = await createClient();
  let effectiveProvider = providerId;
  if (!effectiveProvider && modelRaw) {
    const { data } = await supabase
      .from("ai_provider_settings")
      .select("provider_id")
      .eq("is_default", true)
      .eq("enabled", true)
      .maybeSingle<{ provider_id: AiProviderId }>();
    effectiveProvider = data?.provider_id ?? null;
  }
  if (modelRaw && !effectiveProvider) throw new Error("Select a global provider before choosing an inherited AI model.");
  const model = effectiveProvider ? optionalModel(effectiveProvider, modelRaw) : null;
  const { error } = await supabase.from("ai_agent_settings").upsert({
    agent_id: agentId,
    provider_id: providerId,
    model,
    enabled: value(formData, "enabled") === "true",
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }, { onConflict: "agent_id" });
  if (error) throw new Error("AI agent settings could not be saved.");
  revalidatePath("/settings/ai");
  redirect("/settings/ai?message=AI+agent+settings+saved.");
}
