"use client";

import { useRef, useState } from "react";
import { refreshProviderStatus } from "@/app/settings/ai/operations-actions";
import { HEALTH_MESSAGES, NOA_VOICE_PROFILES, PROVIDER_PORTALS, type ProviderHealth } from "@/lib/ai/provider-operations";
import type { AiProviderId } from "@/lib/ai/types";

export function AiProviderOperations({ configured }: { configured: Record<AiProviderId, boolean> }) {
  const [results, setResults] = useState<ProviderHealth[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const voice = NOA_VOICE_PROFILES.openai;
  return <div className="mt-5 grid min-w-0 gap-5">
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6" aria-labelledby="provider-operations-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="provider-operations-title" className="text-lg font-semibold text-zinc-950">Provider Operations</h2>
        <button type="button" disabled={pending} className="min-h-11 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true; setPending(true); setError("");
          try {
            const response = await refreshProviderStatus();
            if (response.ok) setResults(response.results); else setError(response.message);
          } catch { setError("Provider status could not be refreshed. Try again."); }
          finally { inFlight.current = false; setPending(false); }
        }}>{pending ? "Checking..." : "Refresh provider status"}</button>
      </div>
      <p className="mt-2 text-sm text-zinc-500">Manual metadata checks only. They do not generate content or confirm inference quota, billing tier, or credit balance.</p>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-emerald-800">{pending ? "Checking providers..." : results.length ? "Provider status updated." : "Not checked yet."}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error} Previous results, if shown, are from their displayed check time.</p>}
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-3">{(Object.keys(PROVIDER_PORTALS) as AiProviderId[]).map((provider) => {
        const portal = PROVIDER_PORTALS[provider];
        const health = results.find((item) => item.provider === provider);
        const credential = health?.credentialStatus ?? (configured[provider] ? "configured" : "missing");
        return <article key={provider} className="min-w-0 rounded-lg border border-zinc-200 p-4">
          <h3 className="font-semibold text-zinc-950">{portal.label}</h3><p className="mt-1 text-xs font-medium text-zinc-600">{credential === "configured" ? "Configured" : "Missing credential"}</p>
          <dl className="mt-3 grid gap-2 text-sm text-zinc-600">
            <div><dt className="font-medium text-zinc-900">Metadata endpoint</dt><dd>{health?.reachability ?? "unknown"}</dd></div>
            <div><dt className="font-medium text-zinc-900">Authentication</dt><dd>{health?.authStatus ?? "unknown"}</dd></div>
            <div><dt className="font-medium text-zinc-900">Quota</dt><dd>{(health?.quotaStatus ?? "unknown").replaceAll("_", " ")}</dd></div>
            <div><dt className="font-medium text-zinc-900">Provider model checked</dt><dd className="break-words">{health?.model ?? "No provider model checked"}{health?.model ? ` · ${health.modelStatus.replaceAll("_", " ")}` : ""}</dd></div>
          </dl>
          {health && <p className="mt-3 text-xs text-zinc-600">{HEALTH_MESSAGES[health.message]}</p>}
          <p className="mt-3 text-xs text-zinc-500">Last checked: {health ? <time dateTime={health.checkedAt}>{new Date(health.checkedAt).toLocaleString()}</time> : "Not checked"}</p>
          <h4 className="mt-4 font-medium text-zinc-900">Provider usage</h4>
          <p className="mt-1 text-sm text-zinc-600">Current month usage / cost: Unavailable</p>
          <p className="mt-1 text-xs text-zinc-500">{provider === "gemini" ? "Billing reporting is not connected." : "Admin usage reporting is not connected."}</p>
          <p className="mt-2 text-sm text-zinc-600">Balance unavailable through current integration</p>
          <p className="mt-1 text-sm text-zinc-600">Billing tier: Unavailable</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium text-emerald-800"><a href={portal.usage} target="_blank" rel="noopener noreferrer" aria-label={`${portal.label} usage (opens in a new tab)`}>View usage ↗</a><a href={portal.billing} target="_blank" rel="noopener noreferrer" aria-label={`${portal.label} billing (opens in a new tab)`}>View billing ↗</a></div>
        </article>;
      })}</div>
    </section>
    <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6"><h2 className="text-lg font-semibold text-zinc-950">NOA Voice Profile</h2>
      <p className="mt-2 break-words text-sm text-zinc-700">Primary voice: {voice.provider} · {voice.voice} · {voice.model}</p>
      <p className="mt-1 text-sm text-zinc-600">Character target: warm, professional, natural.</p>
      <p className="mt-1 break-words text-sm text-zinc-600">Transcription: {voice.provider} · {voice.transcriptionModel}</p>
      <p className="mt-2 text-sm text-zinc-600">Fallbacks: not configured. Voice is independent of the reasoning provider. Runtime-managed; no automatic switching.</p>
    </section>
  </div>;
}
