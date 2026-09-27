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

// V4.2c: safe media-type parsing (RFC 2045-style "type/subtype; param=value; ..."), never a blind
// string strip - whitespace around ";"/"=" is tolerated, the media type is compared
// case-insensitively, and an unparseable rate/channels parameter makes the whole mime invalid
// rather than being silently ignored.
function parseGeminiAudioMimeType(value: unknown): { mediaType: string; rate: number | null; channels: number | null } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const segments = value.split(";").map((segment) => segment.trim()).filter(Boolean);
  const mediaType = segments[0]?.toLowerCase();
  if (!mediaType) return null;
  let rate: number | null = null;
  let channels: number | null = null;
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const raw = segment.slice(eq + 1).trim();
    if (key === "rate") { if (!/^\d+$/.test(raw)) return null; rate = Number(raw); }
    else if (key === "channels") { if (!/^\d+$/.test(raw)) return null; channels = Number(raw); }
  }
  return { mediaType, rate, channels };
}

// V4.2 Diagnostics: read-only, best-effort observation of ONE live Gemini TTS round trip - a
// separate response.clone() is read here so this can NEVER change what the real classify()/
// decode() calls below see or do, and any failure in here is swallowed so diagnostics can never
// themselves cause (or mask) a real failure. Logs only the bounded, non-secret shape fields this
// diagnostics pass was asked to capture - never the request/response body, transcript, voiceText,
// credentials, or full provider payload. Temporary: remove once the real root cause is confirmed.
function redactedGeminiErrorMessage(value: unknown, key: string | undefined): string | null {
  if (typeof value !== "string") return null;
  let safe = value;
  if (key) safe = safe.split(key).join("[REDACTED]");
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/AIza[\w-]{20,}/g, "[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 300);
}
async function logGeminiVoiceDiagnostics(response: Response, endpoint: string, key: string | undefined): Promise<void> {
  try {
    const requestMode = endpoint.includes(":generateContent") ? "generateContent" : endpoint.includes("/interactions") ? "interactions" : "unknown";
    const body = object(await boundedJson(response, 6_000_000));
    const steps = Array.isArray(body.steps) ? body.steps : [];
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const contentItems = steps.flatMap((step) => { const content = object(step).content; return Array.isArray(content) ? content : []; }).map(object);
    const audioItems = contentItems.filter((item) => typeof item.data === "string");
    const audioPart = audioItems[0];
    let decodedByteLength: number | null = null;
    let firstFourBytesHex: string | null = null;
    if (audioPart && typeof audioPart.data === "string") {
      try {
        const bytes = Buffer.from(audioPart.data, "base64");
        decodedByteLength = bytes.length;
        firstFourBytesHex = Array.from(bytes.subarray(0, 4)).map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
      } catch { /* leave nulls - decode itself is diagnostic-only here */ }
    }
    const errorField = object(body.error);
    const hasError = Object.keys(errorField).length > 0;
    console.log({
      diagnostic: "noa_voice_gemini_tts",
      provider: "gemini",
      endpointPath: new URL(endpoint).pathname,
      model: NOA_VOICE_PROFILES.gemini.model,
      requestMode,
      requestedMimeType: "audio/l16",
      requestedSampleRate: 24000,
      httpStatus: response.status,
      responseContentType: response.headers.get("content-type"),
      responseOk: response.ok,
      topLevelKeys: Object.keys(body),
      ...(hasError ? {
        errorCode: typeof errorField.code === "string" || typeof errorField.code === "number" ? errorField.code : null,
        errorStatusOrType: (typeof errorField.status === "string" ? errorField.status : typeof errorField.type === "string" ? errorField.type : null),
        errorMessage: redactedGeminiErrorMessage(errorField.message, key),
      } : {}),
      stepsCount: steps.length,
      candidatesCount: candidates.length,
      audioItemsFound: audioItems.length,
      parsedAudioMimeType: typeof audioPart?.mime_type === "string" ? audioPart.mime_type : null,
      parsedSampleRate: typeof audioPart?.sample_rate === "number" ? audioPart.sample_rate : null,
      base64Length: typeof audioPart?.data === "string" ? audioPart.data.length : null,
      decodedByteLength,
      firstFourBytesHex,
    });
  } catch { /* diagnostics must never break or alter the real request path */ }
}

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
  // V4.2b: verified directly against the live docs at https://ai.google.dev/gemini-api/docs/
  // speech-generation (fetched during this change, not assumed) - the Interactions API is the
  // real, documented TTS endpoint (the prior "generateContent" migration was itself the mistake:
  // that endpoint does not document response_format/speech_metadata for TTS at all). Unary
  // requests there default to a WAV-wrapped response; response_format.mime_type explicitly
  // requests the documented headerless "audio/l16" form instead, and per-part speech_metadata
  // (nested in content[].annotations[], not a bare top-level field) carries the delivery style.
  gemini: {
    credential: () => process.env.GEMINI_API_KEY?.trim(),
    health: () => checkProviderHealth("gemini", null),
    classify: (status: number, body: unknown) => classifyProviderFailure("gemini", status, body),
    endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
    headers: (key: string): Record<string, string> => ({ "x-goog-api-key": key, "Content-Type": "application/json" }),
    body: (text: string) => ({
      model: NOA_VOICE_PROFILES.gemini.model,
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: NOA_VOICE_STYLE }] }] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: NOA_VOICE_PROFILES.gemini.voice }] },
    }),
    // Documented response path is steps[].content[].data (base64) - decoded exactly once, and
    // only ever accepted when the documented mime_type/sample_rate confirm headerless L16 24k PCM
    // (a WAV response - mime_type "audio/wav" - fails this same gate and is never stripped/guessed).
    decode: async (response: Response): Promise<ReadableStream<Uint8Array>> => {
      const body = object(await boundedJson(response, 6_000_000));
      const steps = Array.isArray(body.steps) ? body.steps : [];
      const contentItems = steps.flatMap((step) => { const content = object(step).content; return Array.isArray(content) ? content : []; }).map(object);
      // V4.2c: the proven live response parameterizes the media type (e.g.
      // "audio/l16; rate=24000; channels=1") - a strict `=== "audio/l16"` equality check rejected
      // it outright. Parsed safely (never a blind string strip): media type is the part before the
      // first ";", each remaining "key=value" parameter is trimmed/lowercased before comparing.
      const audioPart = contentItems.find((item) => parseGeminiAudioMimeType(item.mime_type)?.mediaType === "audio/l16" && typeof item.data === "string");
      if (!audioPart) throw new NoaVoiceError("invalid_audio");
      const parsedMime = parseGeminiAudioMimeType(audioPart.mime_type)!;
      const fieldSampleRate = typeof audioPart.sample_rate === "number" ? audioPart.sample_rate : null;
      // Sample rate may come from the documented response field OR the mime "rate" parameter -
      // whichever is present must resolve to exactly 24000; a malformed rate/channels parameter
      // parses as an invalid mime type entirely (never silently ignored).
      const resolvedSampleRate = fieldSampleRate ?? parsedMime.rate;
      if (resolvedSampleRate !== null && resolvedSampleRate !== 24000) throw new NoaVoiceError("invalid_audio");
      if (parsedMime.channels !== null && parsedMime.channels !== 1) throw new NoaVoiceError("invalid_audio");
      const data = audioPart.data as string;
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
    // V4.2 Diagnostics: reads a CLONE, so this can never change what classify()/decode() below see.
    if (provider === "gemini") await logGeminiVoiceDiagnostics(response.clone(), adapter.endpoint, key);
    if (!response.ok) {
      const body = await boundedJson(response, 16_384).catch(() => null);
      const code = adapter.classify(response.status, body);
      throw new NoaVoiceError(code === "unknown_provider_error" ? "unknown" : code as NoaVoiceFailure);
    }
    if (!response.body) throw new NoaVoiceError("provider_unavailable");
    return await adapters[provider].decode(response);
  } catch (error) {
    const finalCode: NoaVoiceFailure = signal.aborted ? "cancelled" : combined.aborted ? "timeout" : error instanceof NoaVoiceError ? error.code : "provider_unavailable";
    if (provider === "gemini") console.log({ diagnostic: "noa_voice_gemini_tts_final_error", provider: "gemini", finalErrorCode: finalCode });
    throw new NoaVoiceError(finalCode);
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
