/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated server actions and React hook execution. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function compile(file: string, dependencies: any = {}, globals: any = {}, extra = "") {
  const code = ts.transpileModule(readFileSync(file, "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: any = {};
  new Function("require", "exports", ...Object.keys(globals), code)((id: string) => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports, ...Object.values(globals));
  return exports;
}
const config = compile("lib/ai/provider-config.ts");
const contract = compile("lib/ai/model-catalog.ts", { "./provider-config": config });
const agents = compile("lib/ai/agent-registry.ts");
const env = { GEMINI_API_KEY: "private-gemini", OPENAI_API_KEY: "private-openai", ANTHROPIC_API_KEY: "private-anthropic" };
function api(fetch: any, credentials: any = { ...env }, globals: any = {}) {
  return compile("lib/ai/model-catalog.server.ts", { "server-only": {}, "node:crypto": crypto, "./provider-config": config, "./model-catalog": contract }, { fetch, process: { env: credentials }, ...globals });
}
const gemini = (id: string, methods = ["generateContent"]) => ({ name: `models/${id}`, supportedGenerationMethods: methods, displayName: id, privateData: "secret-body" });
const geminiModels = [gemini("gemini-3.5-flash-lite"), gemini("gemini-3.8-pro"), gemini("gemini-3.8-flash-preview"), gemini("gemini-3.8-flash-exp"), gemini("gemini-3.8-flash-tts"), gemini("gemini-embedding-2", ["embedContent"]), gemini("gemini-robotics-er-2-preview"), gemini("gemini-3.8-pro-deprecated"), gemini("gemini-live-3.8"), gemini("imagen-4"), gemini("veo-3"), gemini("gemini-3.8-pro-no-method", [])];

test("Gemini authenticated models.list paginates, normalizes, and filters specialized models", async () => {
  const requests: URL[] = [];
  const server = api(async (url: URL, init: RequestInit) => {
    requests.push(url); assert.equal(url.origin + url.pathname, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.equal((init.headers as any)["x-goog-api-key"], env.GEMINI_API_KEY); assert.ok(!url.href.includes(env.GEMINI_API_KEY));
    return Response.json(requests.length === 1 ? { models: geminiModels.slice(0, 6), nextPageToken: "page-2" } : { models: geminiModels.slice(6) });
  });
  const result = await server.discoverProviderModels("gemini", true);
  assert.equal(requests.length, 2); assert.equal(requests[1].searchParams.get("pageToken"), "page-2");
  assert.equal(result.source, "live"); assert.equal(result.models.length, 12);
  assert.deepEqual(result.models.filter((m: any) => m.selectableForText).map((m: any) => m.id), ["gemini-3.5-flash-lite", "gemini-3.8-flash-exp", "gemini-3.8-flash-preview", "gemini-3.8-pro"]);
  assert.equal(result.models.find((m: any) => m.id.endsWith("deprecated")).lifecycle, "deprecated");
  assert.equal(contract.catalogCounts(result).tts, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-|secret-body|supportedGenerationMethods|headers/);
  assert.ok(result.refreshedAt);
});
test("OpenAI catalog availability is separate from strict JSON compatibility", async () => {
  const server = api(async (url: URL, init: RequestInit) => {
    assert.equal(url.href, "https://api.openai.com/v1/models"); assert.equal((init.headers as any).Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    return Response.json({ data: ["gpt-5.8-mini", "gpt-4.1", "gpt-4o-mini-tts", "text-embedding-3-large", "gpt-realtime", "gpt-image-1", "gpt-5-codex", "unknown-future"].map(id => ({ id, owned_by: "private-account" })).concat([{ id: "gpt-4.1-mini", shutdown_date: "2000-01-01" } as any]) });
  });
  const catalog = await server.discoverProviderModels("openai");
  assert.deepEqual(catalog.models.filter((m: any) => m.selectableForText).map((m: any) => m.id), ["gpt-4.1", "gpt-5.8-mini"]);
  assert.equal(catalog.models.find((m: any) => m.id === "gpt-4.1-mini").available, false);
  assert.doesNotMatch(JSON.stringify(catalog), /private-account/);
});
test("Anthropic official catalog paginates; native structured support is not invented", async () => {
  let count = 0;
  const server = api(async (url: URL, init: RequestInit) => {
    assert.equal(url.origin + url.pathname, "https://api.anthropic.com/v1/models"); assert.equal((init.headers as any)["anthropic-version"], "2023-06-01");
    if (++count === 1) return Response.json({ data: [{ id: "claude-sonnet-4-6", capabilities: { structured_outputs: { supported: true } } }], has_more: true, last_id: "claude-sonnet-4-6" });
    assert.equal(url.searchParams.get("after_id"), "claude-sonnet-4-6");
    return Response.json({ data: [{ id: "claude-opus-5", display_name: "Claude Opus" }], has_more: false });
  });
  const result = await server.discoverProviderModels("anthropic");
  assert.equal(count, 2); assert.equal(contract.catalogCounts(result).compatible, 2);
  assert.equal(result.models.find((m: any) => m.id === "claude-opus-5").capabilities.structuredOutput, "unknown");
});
test("refresh all isolates missing credential and provider failures", async () => {
  const calls: string[] = [];
  const server = api(async (url: URL) => {
    calls.push(url.hostname);
    return url.hostname === "api.openai.com" ? new Response("private provider error", { status: 503 }) : Response.json({ models: geminiModels });
  }, { GEMINI_API_KEY: "test", OPENAI_API_KEY: "test" });
  const catalogs = await server.refreshAllProviderModels();
  assert.equal(calls.length, 2);
  assert.equal(catalogs.find((c: any) => c.provider === "gemini").source, "live");
  assert.equal(catalogs.find((c: any) => c.provider === "anthropic").status, "missing_credential");
  assert.equal(catalogs.find((c: any) => c.provider === "openai").source, "registry");
  assert.doesNotMatch(JSON.stringify(catalogs), /private provider error/);
});
test("cache is credential scoped, manual refresh bypasses it, concurrent requests coalesce", async () => {
  let finish: any; let calls = 0;
  const credentials = { GEMINI_API_KEY: "first" };
  const server = api(() => { calls++; return new Promise(r => { finish = r; }); }, credentials);
  assert.equal(server.cachedCatalog("gemini").source, "registry"); assert.equal(calls, 0);
  const first = server.discoverProviderModels("gemini", true); const second = server.discoverProviderModels("gemini", true);
  assert.equal(calls, 1); finish(Response.json({ models: [gemini("gemini-3.8-pro")] })); await Promise.all([first, second]);
  await server.discoverProviderModels("gemini"); assert.equal(calls, 1);
  const refresh = server.discoverProviderModels("gemini", true); assert.equal(calls, 2); finish(Response.json({ models: [] })); await refresh;
  assert.equal(server.cachedCatalog("gemini").models.length, 0);
  credentials.GEMINI_API_KEY = "second"; assert.equal(server.cachedCatalog("gemini").source, "registry");
});
test("malformed, oversized, repeated pagination, and auth failures fall back safely", async () => {
  for (const response of [() => Response.json({ data: "invalid" }), () => new Response("x".repeat(2_000_001)), () => new Response("private", { status: 401 })]) {
    const result = await api(response).discoverProviderModels("openai"); assert.equal(result.source, "registry"); assert.doesNotMatch(JSON.stringify(result), /private/);
  }
  let calls = 0;
  const result = await api(() => { calls++; return Response.json({ models: [], nextPageToken: "same" }); }).discoverProviderModels("gemini");
  assert.equal(calls, 2); assert.equal(result.source, "registry");
});
test("catalog timeout falls back without retries or raw exceptions", async () => {
  const controller = new AbortController(); let calls = 0;
  const server = api(async (_url: URL, init: RequestInit) => {
    calls++; assert.ok(init.signal?.aborted); throw Error("private timeout detail");
  }, env, { AbortSignal: { timeout: (ms: number) => { assert.equal(ms, 15_000); controller.abort(); return controller.signal; } } });
  const result = await server.discoverProviderModels("gemini");
  assert.equal(calls, 1); assert.equal(result.status, "unavailable"); assert.doesNotMatch(JSON.stringify(result), /private timeout/);
});
test("expired caches render registry fallback without initiating automatic discovery", async () => {
  let now = Date.now(); let calls = 0;
  class Clock extends Date { static now() { return now; } }
  const server = api(async () => { calls++; return Response.json({ models: [gemini("gemini-3.8-pro")] }); }, env, { Date: Clock });
  await server.discoverProviderModels("gemini"); assert.equal(server.cachedCatalog("gemini").source, "live");
  now += 300_001; assert.equal(server.cachedCatalog("gemini").source, "registry"); assert.equal(calls, 1);
});
test("removed static model cannot be newly saved after successful live discovery", async () => {
  const server = api(async () => Response.json({ models: [gemini("gemini-3.8-pro")] }));
  const result = await server.discoverProviderModels("gemini");
  assert.equal(await server.isSelectableAiModel("gemini", "gemini-3.5-flash-lite"), false);
  assert.equal(await server.isSelectableAiModel("gemini", "gemini-3.8-pro"), true);
  assert.equal(await server.isSelectableAiModel("gemini", "https://evil.invalid"), false);
  assert.equal(contract.modelWarning(result, "gemini-3.5-flash-lite"), "Selected model is no longer available.");
});

function actions(server: any, denied = false, inherited: any[] = []) {
  const writes: any[] = [];
  const database = { from: (table: string) => {
    const query: any = { then: (resolve: any) => resolve({ data: inherited, error: null }) };
    for (const method of ["update", "upsert", "select", "eq", "neq", "is", "not", "returns", "maybeSingle"]) query[method] = (...args: any[]) => { if (["update", "upsert"].includes(method)) writes.push({ table, method, args }); return query; };
    return query;
  } };
  return { writes, ...compile("app/settings/ai/actions.ts", { "next/cache": { revalidatePath() {} }, "@/lib/ai/agent-registry": agents, "@/lib/ai/provider-config": config, "@/lib/ai/model-catalog.server": server,
    "@/lib/auth": { requireSystemOwner: async () => { if (denied) throw Error("secret"); return { user: { id: "owner" } }; } }, "@/lib/supabase/server": { createClient: async () => database } }) };
}
test("settings actions accept discovered models, reject removed models before writes, and enforce owner", async () => {
  const server = api(async () => Response.json({ models: [gemini("gemini-3.8-pro")] }));
  const action = actions(server); const data = new FormData(); data.set("provider_id", "gemini"); data.set("default_model", "gemini-3.8-pro"); data.set("enabled", "true");
  assert.equal((await action.saveAiProviderSettings(data)).ok, true); assert.equal(action.writes.length, 1);
  data.set("default_model", "gemini-3.5-flash-lite"); assert.equal((await action.saveAiProviderSettings(data)).ok, false); assert.equal(action.writes.length, 1);
  const denied = actions({ refreshAllProviderModels: () => assert.fail("not authorized") }, true);
  assert.equal((await denied.refreshProviderModels()).ok, false);
  const result = await action.refreshProviderModels(); assert.equal(result.ok, true); assert.equal(result.results.length, 3);
});
test("global change preserves incompatible inherited models and requests an explicit correction", async () => {
  const server = api(async () => Response.json({ models: [gemini("gemini-3.8-pro")] }));
  const action = actions(server, false, [{ agent_id: "source_qa", model: "gpt-4.1" }]);
  const data = new FormData(); for (const [k,v] of Object.entries({ provider_id: "gemini", default_model: "gemini-3.8-pro", enabled: "true", is_default: "true" })) data.set(k,v);
  const result = await action.saveAiProviderSettings(data); assert.equal(result.ok, false); assert.match(result.message, /inherited agent models/); assert.equal(action.writes.length, 0);
});

function form(react: any = React, refresh: any = () => assert.fail("automatic refresh")) {
  return compile("components/settings/ai-settings-form.tsx", { react, "react/jsx-runtime": jsx, "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@/lib/ai/model-catalog": contract,
    "./ai-provider-operations": { AiProviderOperations: () => null }, "@/app/settings/ai/actions": { refreshProviderModels: refresh } }, {}, "\nexport { CatalogRefresh, ProviderCard, AgentCard };\n");
}
function elements(e: any): any[] { return !e || typeof e !== "object" ? [] : [e, ...React.Children.toArray(e.props?.children).flatMap(elements)]; }
test("live compatible models populate dropdowns and removed saved values remain visible", async () => {
  const catalog = await api(async () => Response.json({ models: geminiModels })).discoverProviderModels("gemini");
  const provider = { id: "gemini", label: "Google Gemini", catalog, models: catalog.models.filter((m: any) => m.selectableForText).map((m: any) => m.id) };
  const html = renderToStaticMarkup(React.createElement(form().ProviderCard, { provider, configured: true, isDefault: false, setting: { default_model: "gemini-removed", enabled: true } }));
  assert.match(html, /4 compatible models/); assert.match(html, /value="gemini-3.8-pro"/); assert.match(html, /optgroup label="Preview"/); assert.match(html, /Experimental/);
  assert.doesNotMatch(html, /value="gemini-3.8-flash-tts"|value="gemini-embedding/);
  assert.match(html, /gemini-removed/); assert.match(html, /Selected model is no longer available/); assert.match(html, /type="submit" disabled/);
  const agentHtml = renderToStaticMarkup(React.createElement(form().AgentCard, { agent: { id: "source_qa", label: "Source QA" }, providers: [provider], globalProvider: "gemini", setting: { model: "gemini-removed", enabled: true } }));
  assert.match(agentHtml, /value="gemini-removed"/); assert.match(agentHtml, /Selected model is no longer available/);
});
test("fallback rendering retains saved values and labels registry data honestly", () => {
  const catalog = contract.registryCatalog("gemini", "unavailable");
  const html = renderToStaticMarkup(React.createElement(form().ProviderCard, { provider: { id: "gemini", label: "Gemini", catalog, models: catalog.models.map((m: any) => m.id) }, configured: true, isDefault: false, setting: { default_model: "gemini-3.8-pro", enabled: true } }));
  assert.match(html, /Using registry fallback/); assert.match(html, /gemini-3.8-pro/); assert.doesNotMatch(html, /no longer available/);
});
test("manual refresh blocks duplicate clicks and delivers new catalogs without resetting selections", async () => {
  const state: any[] = []; let cursor = 0; let calls = 0; let finish: any; let delivered: any;
  const react = { ...React, useState: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value: any) => { state[i] = value; }]; }, useRef: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; } };
  const component = form(react, () => { calls++; return new Promise(r => { finish = r; }); }).CatalogRefresh;
  const render = () => { cursor = 0; return component({ onRefresh: (value: any) => { delivered = value; } }); };
  const button = () => elements(render()).find(e => e.type === "button");
  render(); assert.equal(calls, 0); const pending = button().props.onClick(); assert.equal(button().props.children, "Refreshing models...");
  await button().props.onClick(); assert.equal(calls, 1);
  const catalogs = [contract.registryCatalog("gemini", "unavailable", "2026-09-27T00:00:00.000Z")];
  finish({ ok: true, results: catalogs }); await pending; assert.deepEqual(delivered, catalogs); assert.equal(button().props.disabled, false);
});
test("Provider Operations shows counts, selected availability, timestamps, honest quota and billing", async () => {
  const catalog = await api(async () => Response.json({ models: geminiModels })).discoverProviderModels("gemini");
  const operations = compile("lib/ai/provider-operations.ts", { "../noa/noa-voice-provider": compile("lib/noa/noa-voice-provider.ts") });
  const ui = compile("components/settings/ai-provider-operations.tsx", { react: React, "react/jsx-runtime": jsx, "@/lib/ai/model-catalog": contract, "@/lib/ai/provider-operations": operations, "@/app/settings/ai/operations-actions": { refreshProviderStatus: () => assert.fail("automatic check") } });
  const html = renderToStaticMarkup(React.createElement(ui.AiProviderOperations, { configured: { gemini: true, openai: false, anthropic: false }, catalogs: [catalog], selectedModels: [{ provider_id: "gemini", default_model: "removed" }] }));
  for (const text of ["Discovered models", "Compatible text models", "Preview/experimental models", "Voice/TTS models", "Selected model available", "Last model refresh", "Last health check", "Not connected", "Unknown", "Live catalog", "Online"]) assert.ok(html.includes(text), text);
  assert.match(html, /<dd>12<\/dd>/); assert.match(html, /<dd>No<\/dd>/); assert.doesNotMatch(html, /\$0|private-|secret-body|Metadata endpoint/);
});
