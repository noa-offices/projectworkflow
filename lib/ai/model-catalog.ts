import { listApprovedAiModels } from "./provider-config";
import type { AiProviderId } from "./types";

export type DiscoveredAiModel = {
  provider: AiProviderId;
  id: string;
  displayName?: string;
  lifecycle: "stable" | "preview" | "experimental" | "deprecated" | "unknown";
  available: boolean;
  capabilities: { textGeneration: boolean; structuredOutput: boolean | "unknown"; tts: boolean; realtime: boolean; embeddings: boolean; image: boolean; video: boolean };
  selectableForText: boolean;
};
export type ProviderCatalog = {
  provider: AiProviderId;
  source: "live" | "registry";
  status: "ready" | "not_refreshed" | "missing_credential" | "invalid_credential" | "unavailable";
  refreshedAt: string | null;
  models: DiscoveredAiModel[];
};
export function registryCatalog(provider: AiProviderId, status: ProviderCatalog["status"] = "not_refreshed", refreshedAt: string | null = null): ProviderCatalog {
  return { provider, source: "registry", status, refreshedAt, models: listApprovedAiModels(provider).map((id) => ({
    provider, id, lifecycle: "unknown", available: false, selectableForText: true,
    capabilities: { textGeneration: true, structuredOutput: provider === "anthropic" ? "unknown" : true, tts: false, realtime: false, embeddings: false, image: false, video: false },
  })) };
}
export function catalogCounts(catalog: ProviderCatalog) {
  return { discovered: catalog.source === "live" ? catalog.models.length : null,
    compatible: catalog.models.filter((m) => m.selectableForText).length,
    preview: catalog.models.filter((m) => m.lifecycle === "preview" || m.lifecycle === "experimental").length,
    tts: catalog.models.filter((m) => m.capabilities.tts).length };
}
export function modelWarning(catalog: ProviderCatalog, id: string): string | null {
  if (!id || catalog.source !== "live") return null;
  const model = catalog.models.find((m) => m.id === id);
  if (!model || !model.available) return "Selected model is no longer available.";
  if (model.lifecycle === "deprecated") return "Selected model is deprecated. Choose another model.";
  return model.selectableForText ? null : "Selected model is not compatible with this feature. Choose another model.";
}
