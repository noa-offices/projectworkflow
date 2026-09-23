"use client";

import { useState } from "react";
import { saveAiAgentSettings, saveAiProviderSettings } from "@/app/settings/ai/actions";

type ProviderSetting = { default_model: string | null; enabled: boolean; is_default: boolean; provider_id: string };
type AgentSetting = { agent_id: string; enabled: boolean; model: string | null; provider_id: string | null };
type ProviderId = "openai" | "anthropic" | "gemini";

export function AiSettingsForm({
  agents,
  agentSettings,
  credentialConfigured,
  providers,
  providerSettings,
}: {
  agents: ReadonlyArray<{ defaultModel: string; id: string; label: string }>;
  agentSettings: AgentSetting[];
  credentialConfigured: Record<ProviderId, boolean>;
  providers: ReadonlyArray<{ id: ProviderId; label: string; models: readonly string[] }>;
  providerSettings: ProviderSetting[];
}) {
  const providerById = new Map(providerSettings.map((setting) => [setting.provider_id, setting]));
  const globalProvider = providerSettings.find((setting) => setting.is_default)?.provider_id ?? "openai";
  const byAgent = new Map(agentSettings.map((setting) => [setting.agent_id, setting]));
  const [agentChoices, setAgentChoices] = useState(() => Object.fromEntries(agents.map((agent) => {
    const setting = byAgent.get(agent.id);
    const provider = (setting?.provider_id as ProviderId | null) ?? "";
    const effectiveProvider = provider || globalProvider as ProviderId;
    return [agent.id, { model: setting?.model && (providers.find((item) => item.id === effectiveProvider)?.models.includes(setting.model) ?? false) ? setting.model : "", provider }];
  })) as Record<string, { model: string; provider: ProviderId | "" }>);

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-950">Global provider settings</h2>
        <p className="mt-1 text-sm text-zinc-500">Choose one default provider; each card keeps its own approved model list.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {providers.map((provider) => {
            const setting = providerById.get(provider.id) ?? { default_model: null, enabled: true, is_default: globalProvider === provider.id, provider_id: provider.id };
            return <form key={provider.id} action={saveAiProviderSettings} className="grid gap-3 rounded border border-zinc-200 p-4">
              <input type="hidden" name="provider_id" value={provider.id} />
              <div className="flex items-center justify-between"><h3 className="font-semibold text-zinc-950">{provider.label}</h3><span className={credentialConfigured[provider.id] ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-amber-700"}>{credentialConfigured[provider.id] ? "Configured" : "Missing credential"}</span></div>
              <label className="grid gap-1 text-sm">Default model<select name="default_model" defaultValue={setting.default_model ?? ""} className="rounded border border-zinc-300 px-2 py-1"><option value="">Registry/environment default</option>{provider.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" value="true" defaultChecked={setting.enabled} /> Enabled</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default" value="true" defaultChecked={setting.is_default} /> Global default</label>
              <button className="w-fit rounded border border-emerald-800 px-3 py-1 text-sm font-semibold text-emerald-900">Save</button>
            </form>;
          })}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-950">Agent overrides</h2>
        <p className="mt-1 text-sm text-zinc-500">Overrides change where an agent executes, never its permissions or capabilities.</p>
        <div className="mt-4 grid gap-4">
          {agents.map((agent) => {
            const setting = byAgent.get(agent.id);
            const choice = agentChoices[agent.id];
            const effectiveProvider = choice.provider || globalProvider as ProviderId;
            const effectiveModel = choice.model || providerById.get(effectiveProvider)?.default_model || agent.defaultModel;
            const effectiveProviderLabel = providers.find((provider) => provider.id === effectiveProvider)?.label ?? "OpenAI";
            return <form key={agent.id} action={saveAiAgentSettings} className="grid gap-3 rounded border border-zinc-200 p-4 sm:grid-cols-4">
              <input type="hidden" name="agent_id" value={agent.id} />
              <div><h3 className="font-medium text-zinc-900">{agent.label}</h3><p className="text-xs text-zinc-500">Effective: {effectiveProviderLabel} / {effectiveModel}</p></div>
              <label className="grid gap-1 text-sm">Provider<select name="provider_id" value={choice.provider} onChange={(event) => { const provider = event.target.value as ProviderId | ""; setAgentChoices((current) => ({ ...current, [agent.id]: { model: "", provider } })); }} className="rounded border border-zinc-300 px-2 py-1"><option value="">Use Global Default</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Model<select name="model" value={choice.model} onChange={(event) => setAgentChoices((current) => ({ ...current, [agent.id]: { ...current[agent.id], model: event.target.value } }))} className="rounded border border-zinc-300 px-2 py-1"><option value="">Use Provider Default</option>{providers.find((provider) => provider.id === effectiveProvider)?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <div className="flex items-end gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" value="true" defaultChecked={setting?.enabled ?? true} /> Enabled</label><button className="rounded border border-emerald-800 px-3 py-1 text-sm font-semibold text-emerald-900">Save</button></div>
            </form>;
          })}
        </div>
      </section>
    </div>
  );
}
