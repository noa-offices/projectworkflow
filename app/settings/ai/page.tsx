import Link from "next/link";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { listAiAgents } from "@/lib/ai/agent-registry";
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

  return <ErpAppShell eyebrow="SYSTEM" title="AI Settings" description="Manage AI providers and per-agent model settings." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
    <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8"><Link href="/settings" className="mb-5 inline-flex text-sm font-semibold text-emerald-900">Back to settings</Link><AiSettingsForm agents={listAiAgents()} agentSettings={agentResult.data ?? []} providerSettings={providerResult.data ?? []} credentialConfigured={credentialConfigured} providers={providers.map((provider) => ({ ...provider, models: listApprovedAiModels(provider.id) }))} /></div>
  </ErpAppShell>;
}
