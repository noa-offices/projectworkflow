"use server";

import { revalidatePath } from "next/cache";
import { getAiAgentConfig } from "@/lib/ai/agent-registry";
import { getAiProviderConfig, listAiProviderConfigs } from "@/lib/ai/provider-config";
import { isSelectableAiModel, refreshAllProviderModels } from "@/lib/ai/model-catalog.server";
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

async function optionalModel(providerId: AiProviderId, model: string) {
  if (!model) return null;
  if (!await isSelectableAiModel(providerId, model)) throw new Error("Unsupported AI model. Refresh provider models and choose a compatible model.");
  return model;
}

async function persistAiProviderSettings(formData: FormData) {
  const { user } = await requireSystemOwner();
  const providerId = value(formData, "provider_id");
  if (!listAiProviderConfigs().some((provider) => provider.id === providerId)) throw new Error("Unknown AI provider.");
  const provider = providerId as AiProviderId;
  const enabled = value(formData, "enabled") === "true";
  const isDefault = value(formData, "is_default") === "true";
  if (isDefault && !enabled) throw new Error("The default provider must be enabled.");
  const defaultModel = await optionalModel(provider, value(formData, "default_model"));
  if (!defaultModel && provider !== "openai") throw new Error("Select a compatible model for this provider.");
  const supabase = await createClient();

  if (isDefault) {
    const { data: inheritedAgents, error: inheritedReadError } = await supabase
      .from("ai_agent_settings").select("agent_id,model").is("provider_id", null).not("model", "is", null)
      .returns<Array<{ agent_id: string; model: string | null }>>();
    if (inheritedReadError) throw new Error("AI provider settings could not be saved.");
    const compatible = await Promise.all((inheritedAgents ?? []).map((agent) => !agent.model || isSelectableAiModel(provider, agent.model)));
    if (compatible.includes(false)) throw new Error("Choose compatible inherited agent models before changing the global provider.");
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
  revalidatePath("/settings/ai");
}

async function persistAiAgentSettings(formData: FormData) {
  const { user } = await requireSystemOwner();
  const agentId = value(formData, "agent_id");
  if (!getAiAgentConfig(agentId)) throw new Error("Unknown AI agent.");
  const providerId = optionalProvider(value(formData, "provider_id"));
  const modelRaw = value(formData, "model");
  const supabase = await createClient();
  let effectiveProvider = providerId;
  if (!effectiveProvider && modelRaw) {
    const { data, error } = await supabase
      .from("ai_provider_settings")
      .select("provider_id")
      .eq("is_default", true)
      .eq("enabled", true)
      .maybeSingle<{ provider_id: AiProviderId }>();
    if (error) throw new Error("AI agent settings could not be saved.");
    effectiveProvider = data?.provider_id ?? null;
  }
  if (modelRaw && !effectiveProvider) throw new Error("Select a global provider before choosing an inherited AI model.");
  const model = effectiveProvider ? await optionalModel(effectiveProvider, modelRaw) : null;
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
}

// Expected failures are returned as bounded UI state, never raw provider/DB errors.
async function save(action: (data: FormData) => Promise<void>, data: FormData) {
  try {
    await action(data);
    return { ok: true as const, message: "Saved" };
  } catch (error) {
    const safe = ["Unknown AI provider.", "Unsupported AI model. Refresh provider models and choose a compatible model.", "Choose compatible inherited agent models before changing the global provider.", "Unknown AI agent.", "The default provider must be enabled.", "Select a compatible model for this provider.", "Select a global provider before choosing an inherited AI model."];
    return { ok: false as const, message: error instanceof Error && safe.includes(error.message) ? error.message : "Could not save AI settings. Check your access and try again." };
  }
}

export async function saveAiProviderSettings(data: FormData) {
  return save(persistAiProviderSettings, data);
}

export async function saveAiAgentSettings(data: FormData) {
  return save(persistAiAgentSettings, data);
}

export async function refreshProviderModels() {
  try {
    await requireSystemOwner();
    return { ok: true as const, results: await refreshAllProviderModels() };
  } catch { return { ok: false as const, message: "Provider models could not be refreshed. Check your access and try again." }; }
}
