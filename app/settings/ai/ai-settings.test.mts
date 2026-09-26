/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated execution of server actions and React hook state. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function compile(path: string, dependencies: Record<string, any> = {}, extra = "") {
  const output = ts.transpileModule(readFileSync(path, "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} as any };
  new Function("require", "module", "exports", output)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled, compiled.exports);
  return compiled.exports;
}
const registry = compile("lib/ai/provider-config.ts");
const agents = compile("lib/ai/agent-registry.ts");
function actions({ denied = false, fail = "" } = {}) {
  const writes: any[] = [];
  const database = { from: (table: string) => {
    const query: any = { then: (resolve: any) => resolve({ data: [], error: fail ? { message: fail } : null }) };
    for (const method of ["update", "upsert", "select", "eq", "neq", "is", "not", "returns", "maybeSingle"]) query[method] = (...args: any[]) => { if (["update", "upsert"].includes(method)) writes.push({ table, method, args }); return query; };
    return query;
  } };
  return { writes, ...compile("app/settings/ai/actions.ts", {
    "next/cache": { revalidatePath: () => {} }, "@/lib/ai/agent-registry": agents, "@/lib/ai/provider-config": registry,
    "@/lib/auth": { requireSystemOwner: async () => { if (denied) throw new Error("private auth detail"); return { user: { id: "owner" } }; } },
    "@/lib/supabase/server": { createClient: async () => database },
  }) };
}
function data(provider = "openai", model = "gpt-4.1") { return new Map(Object.entries({ provider_id: provider, default_model: model, enabled: "true", is_default: "true" })) as unknown as FormData; }
for (const provider of registry.listAiProviderConfigs()) test(`saves valid ${provider.id} settings`, async () => {
  const action = actions();
  assert.deepEqual(await action.saveAiProviderSettings(data(provider.id, registry.listApprovedAiModels(provider.id)[0])), { ok: true, message: "Saved" });
  assert.ok(action.writes.some((item: any) => item.method === "upsert" && item.args[0].provider_id === provider.id));
});
for (const [provider, model] of [["unknown", "gpt-4.1"], ["gemini", "gpt-4.1"], ["anthropic", ""]]) test(`rejects invalid pairing ${provider}/${model}`, async () => {
  const action = actions(); assert.equal((await action.saveAiProviderSettings(data(provider, model))).ok, false); assert.equal(action.writes.length, 0);
});
test("owner guard rejects mutations and does not expose authorization details", async () => {
  const action = actions({ denied: true }); const result = await action.saveAiProviderSettings(data());
  assert.equal(result.ok, false); assert.doesNotMatch(result.message, /private/); assert.equal(action.writes.length, 0);
});
test("database failure returns bounded safe state", async () => {
  const action = actions({ fail: "SQL secret credential detail" }); const result = await action.saveAiProviderSettings(data());
  assert.equal(result.ok, false); assert.doesNotMatch(result.message, /SQL|secret|credential/);
});
test("registered override saves; unknown target is rejected", async () => {
  for (const agent of agents.listAiAgents()) {
    const action = actions(); const input = new FormData(); input.set("agent_id", agent.id); input.set("provider_id", "openai"); input.set("model", "gpt-4.1"); input.set("enabled", "true");
    assert.equal((await action.saveAiAgentSettings(input)).ok, true);
    input.set("agent_id", "semantic_fake"); assert.equal((await action.saveAiAgentSettings(input)).ok, false);
  }
});
const props = { agents: agents.listAiAgents(), agentSettings: [], providerSettings: [], credentialConfigured: { openai: true, anthropic: false, gemini: true }, providers: registry.listAiProviderConfigs().map((p: any) => ({ ...p, models: registry.listApprovedAiModels(p.id) })), runtime: agents.listAiAgents().map((a: any) => ({ agentId: a.id, provider: "openai", model: a.defaultModel, enabled: true })) };
function form(react = React, refresh = () => {}) { return compile("components/settings/ai-settings-form.tsx", { react, "react/jsx-runtime": jsx, "next/navigation": { useRouter: () => ({ refresh }) }, "@/app/settings/ai/actions": { saveAiProviderSettings: async () => ({ ok: true, message: "Saved" }), saveAiAgentSettings: async () => ({ ok: true, message: "Saved" }) } }, "\nexport { SavePanel, AgentCard };\n"); }
test("UI exposes only real providers/overrides, safe credential status and runtime notes", () => {
  const html = renderToStaticMarkup(React.createElement(form().AiSettingsForm, props));
  for (const text of ["OpenAI", "Anthropic", "Google Gemini", "Source QA", "Specification Enrichment", "Final Specification", "NOA Assistant", "Configured", "Missing credential", "Saved runtime:", "Runtime-managed", "Semantic classification uses NOA Assistant", "deterministic plans"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /API_KEY|modelEnv|secret|type="password"/);
  assert.equal((html.match(/aria-label="Global default provider"/g) ?? []).length, 1);
  assert.ok(html.includes("lg:grid-cols-3") && html.includes("min-w-0") && html.includes("min-h-11"));
});
test("voice display matches actual routes without adding voice controls", () => {
  const html = renderToStaticMarkup(React.createElement(form().AiSettingsForm, props));
  const session = readFileSync("app/api/noa/voice/session/route.ts", "utf8"); const speech = readFileSync("app/api/noa/voice/speech/route.ts", "utf8");
  for (const [text, source] of [["gpt-4o-mini-transcribe", session], ["gpt-4o-mini-tts", speech], ["marin", speech]]) { assert.ok(source.includes(`"${text}"`)); assert.ok(html.includes(text)); }
});
function hooks() {
  const states: any[] = []; let index = 0; let held = false; const effects: any[] = [];
  const lock = { busy: false, acquire: () => { if (held) return false; held = true; lock.busy = true; return true; }, release: () => { held = false; lock.busy = false; } };
  return { reset: () => { index = 0; }, effects, react: { ...React, useState: (initial: any) => { const key = index++; if (!(key in states)) states[key] = initial; return [states[key], (next: any) => { states[key] = next; }]; }, useContext: () => lock, useEffect: (effect: any) => effects.push(effect) } as unknown as typeof React };
}
function elements(element: any): any[] { if (!element || typeof element !== "object") return []; return [element, ...React.Children.toArray(element.props?.children).flatMap(elements)]; }
test("save state machine: unchanged, pending, duplicate prevention, failure retention, retry and Saved", async () => {
  const hook = hooks(); let refreshes = 0; const component = form(hook.react, () => refreshes++).SavePanel;
  let resolve: any; let calls = 0; const save = () => { calls++; return new Promise((r) => { resolve = r; }); };
  const values = { model: "gpt-4.1" };
  const render = () => { hook.reset(); return component({ values, save, children: null, label: "test" }); };
  const submit = (tree: any) => tree.props.onSubmit({ preventDefault() {} });
  await submit(render()); assert.equal(calls, 0);
  values.model = "gpt-4.1-mini";
  const pending = submit(render());
  assert.ok(elements(render()).some((e) => e.type === "button" && e.props.children === "Saving..."));
  await submit(render()); assert.equal(calls, 1);
  resolve({ ok: false, message: "Could not save AI settings." }); await pending;
  assert.ok(elements(render()).some((e) => e.props.role === "alert")); assert.equal(values.model, "gpt-4.1-mini");
  const retry = submit(render()); resolve({ ok: true, message: "Saved" }); await retry;
  assert.equal(refreshes, 1); assert.ok(elements(render()).some((e) => e.props.role === "status" && e.props.children === "Saved"));
  assert.ok(elements(render()).some((e) => e.type === "button" && e.props.disabled));
});
test("agent provider switch clears stale model and bounds choices", () => {
  const hook = hooks(); const component = form(hook.react).AgentCard;
  const render = () => { hook.reset(); return component({ agent: props.agents[0], setting: { provider_id: "openai", model: "gpt-4.1", enabled: true }, providers: props.providers, globalProvider: "openai" }); };
  const select = elements(render()).find((e) => e.type === "select" && e.props.value === "openai");
  select.props.onChange({ target: { value: "gemini" } });
  const tree = render(); const modelSelect = elements(tree).filter((e) => e.type === "select")[1];
  assert.equal(modelSelect.props.value, "");
  const options = elements(modelSelect).filter((e) => e.type === "option").map((e) => e.props.children);
  assert.ok(options.includes("gemini-3.5-flash-lite")); assert.ok(!options.includes("gpt-4.1"));
});
test("migration sync contains exactly the applied grants", () => {
  assert.equal(readFileSync("supabase/migrations/110_ai_settings_table_privileges.sql", "utf8").trim(), "GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_provider_settings TO authenticated;\nGRANT SELECT, INSERT, UPDATE ON TABLE public.ai_agent_settings TO authenticated;");
});

