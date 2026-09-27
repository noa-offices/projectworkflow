export const NOA_VOICE_IDENTITY = {
  character: "warm-professional-natural", pace: "medium", energy: "calm-confident", clarity: "high", verbosity: "concise",
} as const;

export const NOA_VOICE_PROFILES = {
  openai: { provider: "OpenAI", model: "gpt-4o-mini-tts", voice: "marin", transcriptionModel: "gpt-4o-mini-transcribe" },
  // Official catalog: Sulafat is Warm. Flash-Lite TTS is optimized for voice cascades.
  // https://ai.google.dev/gemini-api/docs/speech-generation
  gemini: { provider: "Gemini", model: "gemini-3.8-flash-lite-tts", voice: "Sulafat" },
} as const;
export type NoaVoiceProviderId = keyof typeof NOA_VOICE_PROFILES;
export type NoaVoiceSession = { provider: NoaVoiceProviderId; token: string; next?: { provider: NoaVoiceProviderId; token: string } };
export type NoaVoiceFailure = "invalid_credential" | "quota_exhausted" | "billing_blocked" | "rate_limited" | "provider_unavailable" | "timeout" | "cancelled" | "invalid_audio" | "unknown";
export const NOA_VOICE_FAILOVER_CODES: readonly NoaVoiceFailure[] = ["invalid_credential", "quota_exhausted", "billing_blocked", "rate_limited", "provider_unavailable", "timeout"];
export const NOA_VOICE_STYLE = "Warm, professional and natural. Medium pace, calm and confident energy, high clarity. Read the transcript exactly; do not add words.";

export function isNoaVoiceSession(value: unknown): value is NoaVoiceSession {
  const choice = (input: unknown): input is Record<string, unknown> => {
    if (!input || typeof input !== "object") return false;
    const item = input as Record<string, unknown>;
    return typeof item.provider === "string" && Object.hasOwn(NOA_VOICE_PROFILES, item.provider)
      && typeof item.token === "string" && item.token.length > 0 && item.token.length <= 2048;
  };
  return choice(value) && (value.next === undefined || choice(value.next) && !("next" in value.next));
}
