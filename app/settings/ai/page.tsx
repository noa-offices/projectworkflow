import Link from "next/link";
import { AiProviderOperations } from "@/components/settings/ai-provider-operations";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { listAiAgents } from "@/lib/ai/agent-registry";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { listAiProviderConfigs, listApprovedAiModels } from "@/lib/ai/provider-config";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErpAppShell } from "@/components/layout/erp-app-shell";

export default async function AiSettingsPage() {
  const { user, profile, displayName } = await requireSystemOwner();
  const supabase = await createClient();
  const [providerResult, agentResult] = await Promise.all([
    supabase.from("ai_provider_settings").select("provider_id,enabled,default_model,is_default"),
    supabase.from("ai_agent_settings").select("agent_id,provider_id,model,enabled"),
  ]);
  const credentialConfigured = {
    openai: Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim()),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };
  const providers = listAiProviderConfigs();
  const runtime = await Promise.all(listAiAgents().map(async (agent) => {
    const { agentId, provider, model, enabled } = await resolveAiAgentRuntimeConfig(agent.id);
    return { agentId, provider, model, enabled };
  }));

  return <ErpAppShell eyebrow="SYSTEM" title="AI Settings" description="Manage AI providers and per-agent model settings." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8"><Link href="/settings" className="mb-5 inline-flex text-sm font-semibold text-emerald-900">Back to settings</Link>{providerResult.error || agentResult.error ? <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700">AI settings could not be loaded. Please try again.</p> : <AiSettingsForm runtime={runtime} agents={listAiAgents().map(({ id, label }) => ({ id, label }))} agentSettings={agentResult.data ?? []} providerSettings={providerResult.data ?? []} credentialConfigured={credentialConfigured} providers={providers.map((provider) => ({ id: provider.id, label: provider.label, models: listApprovedAiModels(provider.id) }))} />}<AiProviderOperations configured={credentialConfigured} /></div>
  </ErpAppShell>;
}
