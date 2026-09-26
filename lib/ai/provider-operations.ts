import type { AiProviderId } from "./types";

export type ProviderHealth = {
  provider: AiProviderId;
  credentialStatus: "configured" | "missing";
  reachability: "available" | "unavailable" | "unknown";
  authStatus: "valid" | "invalid" | "unknown";
  quotaStatus: "ok" | "rate_limited" | "quota_exhausted" | "billing_blocked" | "unknown";
  model: string | null;
  modelStatus: "metadata_available" | "unavailable" | "unknown";
  checkedAt: string;
  message: "metadata_available" | "credential_missing" | "invalid_credential" | "rate_limited" | "quota_exhausted" | "billing_blocked" | "provider_unavailable" | "timeout" | "unknown_provider_error";
};

export const PROVIDER_PORTALS = {
  openai: { label: "OpenAI", usage: "https://platform.openai.com/usage", billing: "https://platform.openai.com/settings/organization/billing/overview" },
  anthropic: { label: "Anthropic Console", usage: "https://platform.claude.com/usage", billing: "https://platform.claude.com/settings/billing" },
  gemini: { label: "Google AI Studio", usage: "https://aistudio.google.com/usage", billing: "https://aistudio.google.com/billing" },
} as const;

// Display foundation only. Voice routes remain authoritative and do not consume this map.
export const NOA_VOICE_PROFILES = {
  openai: { provider: "OpenAI", model: "gpt-4o-mini-tts", voice: "marin", transcriptionModel: "gpt-4o-mini-transcribe" },
} as const;

export const HEALTH_MESSAGES: Record<ProviderHealth["message"], string> = {
  metadata_available: "Model metadata is accessible. Inference availability and quota are not tested.",
  credential_missing: "Missing credential.",
  invalid_credential: "Invalid credential.",
  rate_limited: "Rate limited. Try again later.",
  quota_exhausted: "Quota exhausted. Check the provider dashboard.",
  billing_blocked: "Billing blocked. Check the provider dashboard.",
  provider_unavailable: "Provider unavailable.",
  timeout: "Provider check timed out.",
  unknown_provider_error: "Provider check could not confirm access.",
};
