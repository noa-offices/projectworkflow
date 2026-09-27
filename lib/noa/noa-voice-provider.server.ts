import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { checkProviderHealth, classifyProviderFailure } from "@/lib/ai/provider-health.server";
import { createClient } from "@/lib/supabase/server";
import { NOA_VOICE_PROFILES, NOA_VOICE_STYLE, type NoaVoiceFailure, type NoaVoiceProviderId, type NoaVoiceSession } from "./noa-voice-provider";

// V4.1: the primary/fallback ORDER stays a pure code-level policy (openai-then-gemini) - this is
// only ever a user CHOICE of which registered, credentialed V4 adapter goes first. Reuses the
// existing ai_agent_settings table (agent_id/provider_id/model/enabled, no schema change) with a
// reserved, non-agent agent_id - deliberately never read through resolveAiAgentRuntimeConfig()/
// getAiAgentConfig(), so this stays fully independent of Global AI Provider/feature-override
// resolution (voice and reasoning must never share a resolution path).
const VOICE_PREFERENCE_ROW_ID = "noa_voice";

export function isNoaVoiceProviderId(value: unknown): value is NoaVoiceProviderId {
  return typeof value === "string" && Object.hasOwn(NOA_VOICE_PROFILES, value);
}

// Missing table/row/read-error is treated exactly like "no preference saved" - never fatal to
// starting a voice session, and never a reason to fall back to the Global AI Provider.
export async function readNoaVoiceProviderPreference(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaVoiceProviderId | null> {
  try {
    const { data, error } = await supabase
      .from("ai_agent_settings").select("provider_id").eq("agent_id", VOICE_PREFERENCE_ROW_ID)
      .maybeSingle<{ provider_id: string | null }>();
    if (error || !isNoaVoiceProviderId(data?.provider_id)) return null;
    return data.provider_id;
  } catch { return null; }
}

// Server-owned closed validation (Part 2/9): only "openai"/"gemini" - the two providers with a
// registered V4 adapter - are ever accepted; the client never supplies a model, voice or credential.
export async function saveNoaVoiceProviderPreference(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  value: unknown,
): Promise<void> {
  if (!isNoaVoiceProviderId(value)) throw new Error("Unsupported voice provider.");
  const { error } = await supabase.from("ai_agent_settings").upsert({
    agent_id: VOICE_PREFERENCE_ROW_ID, provider_id: value, model: null, enabled: true,
    updated_at: new Date().toISOString(), updated_by: userId,
  }, { onConflict: "agent_id" });
  if (error) throw new Error("Voice provider preference could not be saved.");
}

export class NoaVoiceError extends Error {
  constructor(public readonly code: NoaVoiceFailure) { super("Speech unavailable"); }
}
function credential(provider: NoaVoiceProviderId) {
  return adapters[provider].credential();
}
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0; let text = ""; const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new NoaVoiceError("invalid_audio"); }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); } catch { return null; }
  } finally { reader.releaseLock(); }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

// Output contract: signed 16-bit LE PCM, 24 kHz, mono, maximum 90 seconds.
export interface NoaVoiceProvider {
  id: NoaVoiceProviderId;
  profile: typeof NOA_VOICE_PROFILES[NoaVoiceProviderId];
  available(): boolean;
  health(): ReturnType<typeof checkProviderHealth>;
  synthesize(text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

// Adapter descriptors own request/format details; the registry and session logic are generic.
const adapters = {
  openai: {
    credential: () => process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim(),
    health: () => checkProviderHealth("openai", null),
    classify: (status: number, body: unknown) => classifyProviderFailure("openai", status, body),
    endpoint: "https://api.openai.com/v1/audio/speech",
    headers: (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    body: (text: string) => ({ model: NOA_VOICE_PROFILES.openai.model, voice: NOA_VOICE_PROFILES.openai.voice, input: text, instructions: NOA_VOICE_STYLE, response_format: "pcm" }),
    decode: async (response: Response) => response.body!,
  },
  // V4.2: the previous "v1beta/interactions" endpoint and steps[]/annotations/generation_config
  // request+response shape do not exist in the documented API (see the doc link on
  // NOA_VOICE_PROFILES.gemini in ./noa-voice-provider) - every real call silently produced no
  // audio.steps to parse, so decode() always threw "invalid_audio" (never a failover code, so
  // nothing ever recovered - exactly the reported symptom). Corrected to the real, documented
  // generateContent contract: https://ai.google.dev/gemini-api/docs/speech-generation.
  gemini: {
    credential: () => process.env.GEMINI_API_KEY?.trim(),
    health: () => checkProviderHealth("gemini", null),
    classify: (status: number, body: unknown) => classifyProviderFailure("gemini", status, body),
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${NOA_VOICE_PROFILES.gemini.model}:generateContent`,
    headers: (key: string): Record<string, string> => ({ "x-goog-api-key": key, "Content-Type": "application/json" }),
    body: (text: string) => ({
      contents: [{ parts: [{ text }] }],
      systemInstruction: { parts: [{ text: NOA_VOICE_STYLE }] },
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: NOA_VOICE_PROFILES.gemini.voice } } } },
    }),
    // Documented output is already headerless raw PCM (mimeType "audio/L16;codec=pcm;rate=24000")
    // in candidates[0].content.parts[].inlineData.data - one base64 field, decoded exactly once,
    // never a WAV container to parse or strip.
    decode: async (response: Response): Promise<ReadableStream<Uint8Array>> => {
      const body = object(await boundedJson(response, 6_000_000));
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      const parts = candidates.flatMap((candidate) => {
        const contentParts = object(object(candidate).content).parts;
        return Array.isArray(contentParts) ? contentParts : [];
      });
      const inline = parts.map((part) => object(object(part).inlineData)).find((data) => typeof data.mimeType === "string" && typeof data.data === "string");
      if (!inline) throw new NoaVoiceError("invalid_audio");
      const mimeType = inline.mimeType as string;
      const rate = /(?:^|;)\s*rate=(\d+)/i.exec(mimeType)?.[1];
      if (!/^audio\/l16(?:;|$)/i.test(mimeType) || rate !== "24000") throw new NoaVoiceError("invalid_audio");
      const data = inline.data as string;
      if (!data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new NoaVoiceError("invalid_audio");
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      if (!bytes.length || bytes.length % 2 || bytes.length > 24_000 * 2 * 90) throw new NoaVoiceError("invalid_audio");
      return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    },
  },
};

async function requestAudio(provider: NoaVoiceProviderId, text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const key = credential(provider);
  if (!key) throw new NoaVoiceError("invalid_credential");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    const adapter = adapters[provider];
    const response = await fetch(adapter.endpoint, {
      method: "POST", signal: combined, redirect: "error", cache: "no-store",
      headers: adapter.headers(key), body: JSON.stringify(adapter.body(text)),
    });
    if (!response.ok) {
      const body = await boundedJson(response, 16_384).catch(() => null);
      const code = adapter.classify(response.status, body);
      throw new NoaVoiceError(code === "unknown_provider_error" ? "unknown" : code as NoaVoiceFailure);
    }
    if (!response.body) throw new NoaVoiceError("provider_unavailable");
    return await adapters[provider].decode(response);
  } catch (error) {
    if (signal.aborted) throw new NoaVoiceError("cancelled");
    if (combined.aborted) throw new NoaVoiceError("timeout");
    if (error instanceof NoaVoiceError) throw error;
    throw new NoaVoiceError("provider_unavailable");
  }
}
export const NOA_VOICE_PROVIDERS: Readonly<Record<NoaVoiceProviderId, NoaVoiceProvider>> = Object.fromEntries(
  (Object.keys(NOA_VOICE_PROFILES) as NoaVoiceProviderId[]).map((id) => [id, {
    id, profile: NOA_VOICE_PROFILES[id], available: () => Boolean(credential(id)),
    health: adapters[id].health, synthesize: (text: string, signal: AbortSignal) => requestAudio(id, text, signal),
  }]),
) as Record<NoaVoiceProviderId, NoaVoiceProvider>;

type Claims = { provider: NoaVoiceProviderId; user: string; session: string; expires: number };
function signature(payload: string) {
  const key = credential("openai") || credential("gemini");
  if (!key) throw new NoaVoiceError("invalid_credential");
  return createHmac("sha256", key).update(`noa-voice-session-v4:${payload}`).digest();
}
function issue(claims: Claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyVoiceSession(token: unknown, user: string): Claims | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  try {
    const [payload, mac, extra] = token.split("."); if (extra || !payload || !mac) return null;
    const actual = Buffer.from(mac, "base64url"); const expected = signature(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
    return claims.user === user && typeof claims.session === "string" && typeof claims.expires === "number" && claims.expires > Date.now()
      && Object.hasOwn(NOA_VOICE_PROVIDERS, claims.provider) ? claims : null;
  } catch { return null; }
}

// Part 5: preferredProvider only ever REORDERS the existing bounded-failover loop below - it never
// skips the availability/health check (an unavailable preferred provider is safely passed over,
// never forced), and it never changes which two providers exist or how failover works.
export async function createVoiceSession(user: string, preferredProvider?: NoaVoiceProviderId): Promise<NoaVoiceSession> {
  const registryOrder = Object.values(NOA_VOICE_PROVIDERS);
  const order = preferredProvider && Object.hasOwn(NOA_VOICE_PROVIDERS, preferredProvider)
    ? [NOA_VOICE_PROVIDERS[preferredProvider], ...registryOrder.filter((entry) => entry.id !== preferredProvider)]
    : registryOrder;
  for (let index = 0; index < order.length; index++) {
    const provider = order[index]; if (!provider.available()) continue;
    const health = await provider.health();
    if (health.authStatus === "invalid" || health.reachability === "unavailable" || ["quota_exhausted", "billing_blocked", "rate_limited"].includes(health.quotaStatus)) continue;
    const claims: Claims = { provider: provider.id, user, session: randomUUID(), expires: Date.now() + 600_000 };
    const next = order.slice(index + 1).find((entry) => entry.available());
    return { provider: provider.id, token: issue(claims), ...(next ? { next: { provider: next.id, token: issue({ ...claims, provider: next.id }) } } : {}) };
  }
  throw new NoaVoiceError("provider_unavailable");
}
