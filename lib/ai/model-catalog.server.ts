import "server-only";
import { createHash } from "node:crypto";
import { isApprovedAiModel, listAiProviderConfigs } from "./provider-config";
import { registryCatalog, type DiscoveredAiModel, type ProviderCatalog } from "./model-catalog";
import type { AiProviderId } from "./types";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value);

function normalize(provider: AiProviderId, raw: unknown): DiscoveredAiModel | null {
  const item = record(raw);
  const id = provider === "gemini" && typeof item.name === "string" ? item.name.replace(/^models\//, "") : item.id;
  if (!safeId(id)) return null;
  const name = provider === "gemini" ? item.displayName : item.display_name;
  const displayName = typeof name === "string" && name.length <= 128 && !/[<>\u0000-\u001f]/.test(name) ? name : undefined;
  const tts = /(?:^|-)tts(?:-|$)/.test(id);
  const realtime = /(?:live|realtime)/.test(id);
  const embeddings = /embed/.test(id);
  const image = /(?:image|imagen|dall-e)/.test(id);
  const video = /(?:veo|sora|video)/.test(id);
  const specialized = tts || realtime || embeddings || image || video || /(?:audio|transcrib|whisper|robotics|computer-use|deep-research|codex|moderation|aqa)/.test(id);
  const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
  // Catalogs do not all advertise JSON support. These bounded family rules match
  // the existing adapters, not a catalog snapshot. Unknown families stay unselectable.
  const textGeneration = !specialized && (provider === "gemini" ? methods.includes("generateContent")
    : provider === "anthropic" ? /^claude-(?:sonnet|opus|haiku|\d)/.test(id) : /^(?:gpt-|o[1-9])/.test(id));
  let structuredOutput: boolean | "unknown" = "unknown";
  if (provider === "gemini" && textGeneration && /^gemini-(?:[2-9]\d*(?:\.\d+)?)-(?:flash|pro)(?:-|$)/.test(id)) structuredOutput = true;
  if (provider === "openai" && textGeneration && (isApprovedAiModel(provider, id)
    || /^gpt-(?:4\.1|4o|[5-9]\d*(?:\.\d+)?)(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(id))) structuredOutput = true;
  if (provider === "anthropic") {
    const supported = record(record(item.capabilities).structured_outputs).supported;
    if (typeof supported === "boolean") structuredOutput = supported;
  }
  const lifecycle: DiscoveredAiModel["lifecycle"] = item.shutdown_date || /(?:^|-)deprecated(?:-|$)/.test(id) ? "deprecated"
    : /(?:^|-)exp(?:erimental)?(?:-|$)/.test(id) ? "experimental"
    : /(?:preview|beta)/.test(id) ? "preview" : textGeneration && structuredOutput === true ? "stable" : "unknown";
  const available = !(typeof item.shutdown_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.shutdown_date) && item.shutdown_date <= new Date().toISOString().slice(0, 10));
  // Anthropic's current adapter requests JSON in the prompt and validates it. It
  // does not require native structured_outputs; do not claim native support.
  const selectableForText = available && lifecycle !== "deprecated" && textGeneration && (structuredOutput === true || provider === "anthropic");
  return { provider, id, ...(displayName ? { displayName } : {}), lifecycle, available,
    capabilities: { textGeneration, structuredOutput, tts, realtime, embeddings, image, video }, selectableForText };
}

type CatalogAdapter = {
  key(): string | undefined;
  endpoint: string;
  headers(key: string): Record<string, string>;
  page(url: URL, cursor: string): void;
  items(body: Record<string, unknown>): unknown;
  next(body: Record<string, unknown>): unknown;
};
// Official catalog endpoints. Pagination tokens never become hostnames or paths.
const adapters: Record<AiProviderId, CatalogAdapter> = {
  openai: { key: () => process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim(), endpoint: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }), page: () => {}, items: (b) => b.data, next: () => undefined },
  gemini: { key: () => process.env.GEMINI_API_KEY?.trim(), endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }), page: (url, cursor) => { url.searchParams.set("pageSize", "1000"); if (cursor) url.searchParams.set("pageToken", cursor); }, items: (b) => b.models ?? [], next: (b) => b.nextPageToken },
  anthropic: { key: () => process.env.ANTHROPIC_API_KEY?.trim(), endpoint: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }), page: (url, cursor) => { url.searchParams.set("limit", "1000"); if (cursor) url.searchParams.set("after_id", cursor); }, items: (b) => b.data, next: (b) => b.has_more ? b.last_id || true : undefined },
};
const cache = new Map<AiProviderId, { fingerprint: string; expires: number; result: ProviderCatalog }>();
const pending = new Map<string, Promise<ProviderCatalog>>();
function identity(provider: AiProviderId) {
  const key = adapters[provider].key();
  return { key, fingerprint: createHash("sha256").update(key ?? "").digest("hex") };
}
export function cachedCatalog(provider: AiProviderId): ProviderCatalog {
  const { key, fingerprint } = identity(provider);
  const entry = cache.get(provider);
  return entry?.fingerprint === fingerprint && entry.expires > Date.now() ? entry.result : registryCatalog(provider, key ? "not_refreshed" : "missing_credential");
}
async function json(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw Error("Catalog unavailable");
  let text = ""; let bytes = 0; const decoder = new TextDecoder();
  try { while (true) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); throw Error("Catalog unavailable"); }
    text += decoder.decode(part.value, { stream: true });
  } } finally { reader.releaseLock(); }
  return record(JSON.parse(text + decoder.decode()));
}
export async function discoverProviderModels(provider: AiProviderId, refresh = false): Promise<ProviderCatalog> {
  const { key, fingerprint } = identity(provider);
  if (!key) return registryCatalog(provider, "missing_credential", new Date().toISOString());
  const cached = cache.get(provider);
  if (!refresh && cached?.fingerprint === fingerprint && cached.expires > Date.now()) return cached.result;
  const flight = `${provider}:${fingerprint}`;
  const existing = pending.get(flight); if (existing) return existing;
  const work = (async (): Promise<ProviderCatalog> => {
    let status: ProviderCatalog["status"] = "unavailable";
    let result: ProviderCatalog;
    try {
      const adapter = adapters[provider]; const seen = new Set<string>(); const models = new Map<string, DiscoveredAiModel>();
      const signal = AbortSignal.timeout(15_000); let cursor = "";
      for (let page = 0; ; page++) {
        if (page >= 20) throw Error("Catalog limit");
        const url = new URL(adapter.endpoint); adapter.page(url, cursor);
        const response = await fetch(url, { method: "GET", headers: adapter.headers(key), signal, cache: "no-store", redirect: "error" });
        if (!response.ok) { if (response.status === 401) status = "invalid_credential"; await response.body?.cancel(); throw Error("Catalog unavailable"); }
        const body = await json(response); const items = adapter.items(body);
        if (!Array.isArray(items)) throw Error("Invalid catalog");
        for (const item of items) { const model = normalize(provider, item); if (model) models.set(model.id, model); }
        if (models.size > 10_000) throw Error("Catalog limit");
        const next = adapter.next(body); if (next === undefined || next === null || next === "") break;
        if (typeof next !== "string" || next.length > 2048 || seen.has(next)) throw Error("Invalid pagination");
        seen.add(next); cursor = next;
      }
      result = { provider, source: "live", status: "ready", refreshedAt: new Date().toISOString(), models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    } catch { result = registryCatalog(provider, status, new Date().toISOString()); }
    cache.set(provider, { fingerprint, expires: Date.now() + 5 * 60_000, result });
    return result;
  })();
  pending.set(flight, work);
  try { return await work; } finally { pending.delete(flight); }
}
export async function refreshAllProviderModels() {
  return Promise.all(listAiProviderConfigs().map(({ id }) => discoverProviderModels(id, true)));
}
export async function isSelectableAiModel(provider: AiProviderId, model: string) {
  if (!safeId(model)) return false;
  const catalog = await discoverProviderModels(provider);
  return catalog.models.some((entry) => entry.id === model && entry.selectableForText);
}
