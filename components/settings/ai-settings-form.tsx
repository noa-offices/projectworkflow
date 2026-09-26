"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveAiAgentSettings, saveAiProviderSettings } from "@/app/settings/ai/actions";

type ProviderId = "openai" | "anthropic" | "gemini";
type Provider = { id: ProviderId; label: string; models: readonly string[] };
type ProviderSetting = { default_model: string | null; enabled: boolean; is_default: boolean; provider_id: string };
type AgentSetting = { agent_id: string; enabled: boolean; model: string | null; provider_id: string | null };
type Runtime = { agentId: string; provider: string; model: string; enabled: boolean };
type Fields = Record<string, string | boolean>;
type SaveResult = { ok: boolean; message: string };
const SaveContext = createContext<{ busy: boolean; acquire: () => boolean; release: () => void }>({ busy: false, acquire: () => true, release: () => {} });
const selectStyle = "min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus:outline-emerald-700";
const sectionStyle = "min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6";

function SavePanel({ values, save, children, label, dirtyKey }: { values: Fields; save: (data: FormData) => Promise<SaveResult>; children: ReactNode; label: string; dirtyKey?: string }) {
  const snapshot = dirtyKey ?? JSON.stringify(values);
  const [saved, setSaved] = useState(snapshot);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useContext(SaveContext);
  const router = useRouter();
  useEffect(() => {
    if (!result?.ok) return;
    const timer = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(timer);
  }, [result]);
  return <form aria-label={label} className="min-w-0" onSubmit={async (event) => {
    event.preventDefault();
    if (snapshot === saved || !lock.acquire()) return;
    setPending(true); setResult(null);
    const data = new FormData();
    Object.entries(values).forEach(([key, value]) => data.set(key, String(value)));
    try {
      const response = await save(data);
      setResult(response);
      if (response.ok) { setSaved(snapshot); router.refresh(); }
    } catch { setResult({ ok: false, message: "Could not save AI settings. Try again." }); }
    finally { setPending(false); lock.release(); }
  }}>
    <fieldset disabled={lock.busy} className="grid min-w-0 gap-3 disabled:opacity-70">{children}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button type="submit" disabled={lock.busy || snapshot === saved} className="min-h-10 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Saving..." : "Save changes"}</button>
        <span role="status" aria-live="polite" className="text-sm font-medium text-emerald-800">{result?.ok ? "Saved" : ""}</span>
      </div>
    </fieldset>
    {result && !result.ok && <p role="alert" className="mt-3 text-sm text-red-700">{result.message} Your selections have been retained.</p>}
  </form>;
}

function ProviderCard({ provider, setting, configured, isDefault }: { provider: Provider; setting?: ProviderSetting; configured: boolean; isDefault: boolean }) {
  const [model, setModel] = useState(setting?.default_model ?? "");
  const [enabled, setEnabled] = useState(setting?.enabled ?? true);
  return <article className="min-w-0 rounded-lg border border-zinc-200 p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-zinc-950">{provider.label}</h3>{isDefault && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">Default</span>}</div>
    <p className={`mb-4 text-xs font-medium ${configured ? "text-emerald-800" : "text-amber-800"}`}>{configured ? "Configured" : "Missing credential"} · {provider.models.length} approved models</p>
    <SavePanel label={`${provider.label} settings`} dirtyKey={JSON.stringify([model, enabled])} save={saveAiProviderSettings} values={{ provider_id: provider.id, default_model: model, enabled, is_default: isDefault }}>
      <label className="grid min-w-0 gap-1.5 text-sm">Provider model<select className={selectStyle} value={model} onChange={(event) => setModel(event.target.value)}>
        <option value="" disabled={provider.id !== "openai"}>{provider.id === "openai" ? "Registry/environment default" : "Select an approved model"}</option>{model && !provider.models.includes(model) && <option value={model} disabled>Choose an approved model</option>}{provider.models.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
    </SavePanel>
  </article>;
}

function AgentCard({ agent, setting, providers, globalProvider, runtime }: { agent: { id: string; label: string }; setting?: AgentSetting; providers: readonly Provider[]; globalProvider: string; runtime?: Runtime }) {
  const [provider, setProvider] = useState(setting?.provider_id ?? "");
  const [model, setModel] = useState(setting?.model ?? "");
  const [enabled, setEnabled] = useState(setting?.enabled ?? true);
  const models = providers.find((item) => item.id === (provider || globalProvider))?.models ?? [];
  const selectedModel = models.includes(model) ? model : "";
  return <article className="min-w-0 rounded-lg border border-zinc-200 p-4">
    <h3 className="font-semibold text-zinc-950">{agent.label}</h3>
    <p className="mb-4 mt-1 break-words text-xs text-zinc-500">Saved runtime: {runtime ? `${runtime.provider} / ${runtime.model}${runtime.enabled ? "" : " (disabled)"}` : "Unavailable"}</p>
    <SavePanel label={`${agent.label} override`} save={saveAiAgentSettings} values={{ agent_id: agent.id, provider_id: provider, model: selectedModel, enabled }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm">Provider<select value={provider} className={selectStyle} onChange={(event) => { setProvider(event.target.value); setModel(""); }}><option value="">Inherit global default</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="grid min-w-0 gap-1.5 text-sm">Model<select value={selectedModel} className={selectStyle} onChange={(event) => setModel(event.target.value)}><option value="">Use runtime default</option>{models.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
    </SavePanel>
  </article>;
}

function GlobalDefault({ providers, settings }: { providers: readonly Provider[]; settings: ProviderSetting[] }) {
  const current = settings.find((item) => item.is_default && item.enabled)?.provider_id ?? "";
  const [choice, setChoice] = useState(current);
  const setting = settings.find((item) => item.provider_id === choice);
  return <SavePanel label="Global default provider" dirtyKey={choice} save={saveAiProviderSettings} values={{ provider_id: choice, default_model: setting?.default_model ?? "", enabled: true, is_default: true }}>
    <label className="grid max-w-md min-w-0 gap-1.5 text-sm">Default provider<select required className={selectStyle} value={choice} onChange={(event) => setChoice(event.target.value)}><option value="" disabled>Registry default (OpenAI)</option>{providers.map((provider) => {
      const saved = settings.find((item) => item.provider_id === provider.id);
      const available = saved?.enabled !== false && (saved?.default_model ? provider.models.includes(saved.default_model) : provider.id === "openai");
      return <option key={provider.id} value={provider.id} disabled={!available}>{provider.label}</option>;
    })}</select></label>
    <p className="text-xs text-zinc-500">Enable and save the provider’s model first. Uses its saved model, or each feature’s runtime default. Saving replaces the previous global default.</p>
  </SavePanel>;
}

export function AiSettingsForm({ agents, agentSettings, credentialConfigured, providers, providerSettings, runtime }: {
  agents: ReadonlyArray<{ id: string; label: string }>;
  agentSettings: AgentSetting[];
  credentialConfigured: Record<ProviderId, boolean>;
  providers: readonly Provider[];
  providerSettings: ProviderSetting[];
  runtime: Runtime[];
}) {
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const globalProvider = providerSettings.find((setting) => setting.is_default && setting.enabled)?.provider_id ?? "openai";
  return <SaveContext.Provider value={{ busy, acquire: () => { if (held.current) return false; held.current = true; setBusy(true); return true; }, release: () => { held.current = false; setBusy(false); } }}>
    <div className="grid min-w-0 gap-5">
      <section className={sectionStyle}><h2 className="text-lg font-semibold text-zinc-950">AI Providers</h2><p className="mt-1 text-sm text-zinc-500">Manage approved models and availability. Save each changed section.</p>
        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-3">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} setting={providerSettings.find((item) => item.provider_id === provider.id)} configured={credentialConfigured[provider.id]} isDefault={providerSettings.some((item) => item.provider_id === provider.id && item.is_default)} />)}</div>
      </section>
      <section className={sectionStyle}><h2 className="mb-4 text-lg font-semibold text-zinc-950">Global defaults</h2><GlobalDefault providers={providers} settings={providerSettings} /></section>
      <section className={sectionStyle}><h2 className="text-lg font-semibold text-zinc-950">Feature / Agent overrides</h2><p className="mt-1 text-sm text-zinc-500">Semantic classification uses NOA Assistant provider settings. Overrides change execution settings, never permissions.</p><div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">{agents.map((agent) => <AgentCard key={agent.id} agent={agent} providers={providers} globalProvider={globalProvider} setting={agentSettings.find((item) => item.agent_id === agent.id)} runtime={runtime.find((item) => item.agentId === agent.id)} />)}</div></section>
      <section className={sectionStyle}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-zinc-950">Voice runtime</h2><span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">Runtime-managed</span></div><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-medium">Realtime transcription</dt><dd className="mt-1 break-words text-zinc-600">OpenAI · gpt-4o-mini-transcribe</dd></div><div><dt className="font-medium">Text-to-speech</dt><dd className="mt-1 break-words text-zinc-600">OpenAI · gpt-4o-mini-tts · marin</dd></div></dl><p className="mt-3 text-xs text-zinc-500">Read-only runtime values; provider settings above do not change voice.</p></section>
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-950">Runtime notes</h2><p className="mt-2 text-sm text-zinc-600">NOA agent briefings use deterministic plans and existing capabilities; they do not select an independent AI model.</p><p className="mt-2 text-sm text-zinc-600">Models resolve from feature overrides, then provider defaults, then runtime defaults. Missing settings fall back to registry configuration. Automatic provider failover is not configured here.</p></section>
    </div>
  </SaveContext.Provider>;
}
