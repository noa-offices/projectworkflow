/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated server dependencies and React hook state. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function compile(path: string, dependencies: Record<string, any> = {}, globals: Record<string, any> = {}) {
  const compiled = { exports: {} as any };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "exports", ...Object.keys(globals), code)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled.exports, ...Object.values(globals));
  return compiled.exports;
}
const config = compile("lib/ai/provider-config.ts");
const catalog = compile("lib/ai/model-catalog.ts", { "./provider-config": config });
const contract = compile("lib/ai/provider-operations.ts", { "../noa/noa-voice-provider": compile("lib/noa/noa-voice-provider.ts") });
function health(fetch: any, env: any = { OPENAI_API_KEY: "test-secret", ANTHROPIC_API_KEY: "test-secret", GEMINI_API_KEY: "test-secret" }, timer?: any) {
  return compile("lib/ai/provider-health.server.ts", { "server-only": {}, "./provider-config": config }, { fetch, process: { env }, ...(timer ? { setTimeout: timer, clearTimeout: () => {} } : {}) });
}
for (const provider of config.listAiProviderConfigs()) test(`${provider.id}: metadata GET contains no business data and returns only normalized fields`, async () => {
  const model = config.listApprovedAiModels(provider.id)[0]; let calls = 0;
  const api = health(async (url: string, init: RequestInit) => {
    calls++; assert.ok(url.includes('/models/')); assert.ok(!url.includes('test-secret')); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
    return Response.json(provider.id === 'gemini' ? { name: `models/${model}`, secret: 'do-not-return' } : { id: model, secret: 'do-not-return' });
  });
  const result = await api.checkProviderHealth(provider.id, model);
  assert.equal(calls, 1); assert.equal(result.credentialStatus, 'configured'); assert.equal(result.authStatus, 'valid'); assert.equal(result.modelStatus, 'metadata_available'); assert.equal(result.quotaStatus, 'unknown'); assert.ok(result.checkedAt);
  assert.doesNotMatch(JSON.stringify(result), /test-secret|do-not-return|Authorization|api-key/);
});
test('missing credentials make no request', async () => {
  const api = health(() => assert.fail('must not call provider'), {});
  for (const p of config.listAiProviderConfigs()) { const result = await api.checkProviderHealth(p.id, null); assert.equal(result.credentialStatus, 'missing'); assert.equal(result.authStatus, 'unknown'); }
});
test('OpenAI fallback credential is supported without billing requests', async () => {
  const result = await health(async (url: string) => { assert.equal(url, 'https://api.openai.com/v1/models'); return Response.json({ data: [] }); }, { SOURCE_QA_AI_API_KEY: 'fallback-test-secret' }).checkProviderHealth('openai', null);
  assert.equal(result.authStatus, 'valid'); assert.equal(result.modelStatus, 'unknown'); assert.equal(result.quotaStatus, 'unknown');
});
for (const [provider, status, error, expected] of [
  ['openai', 401, {message:'private'}, 'invalid_credential'],
  ['anthropic', 401, {type:'authentication_error'}, 'invalid_credential'],
  ['gemini', 400, {details:[{reason:'API_KEY_INVALID'}]}, 'invalid_credential'],
  ['openai', 429, {}, 'rate_limited'],
  ['gemini', 429, {status:'RESOURCE_EXHAUSTED'}, 'rate_limited'],
  ['openai', 429, {code:'insufficient_quota'}, 'quota_exhausted'],
  ['anthropic', 402, {type:'billing_error'}, 'billing_blocked'],
  ['anthropic', 529, {}, 'provider_unavailable'],
  ['openai', 403, {}, 'unknown_provider_error'],
  ['gemini', 404, {}, 'unknown_provider_error'],
] as const) test(`${provider} ${status} normalizes as ${expected}`, async () => {
  const result = await health(async () => Response.json({ error: {...error, message:'secret stack business payload'} }, {status})).checkProviderHealth(provider, config.listApprovedAiModels(provider)[0]);
  assert.equal(result.message, expected); assert.doesNotMatch(JSON.stringify(result), /secret|stack|payload/);
  if(status === 403) assert.equal(result.authStatus, 'unknown');
});
test('8 second timeout aborts without retries or raw exception', async () => {
  let calls=0;
  const api = health(async (_: string, init: RequestInit) => { calls++; return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(Error('secret timeout')))); }, undefined, (fn: any, ms: number) => { assert.equal(ms, 8000); queueMicrotask(fn); return 1; });
  assert.equal((await api.checkProviderHealth('openai',null)).message,'timeout'); assert.equal(calls,1);
});
test('network failure is safely bounded', async () => {
  const result=await health(async()=>{throw Error('test-secret');}).checkProviderHealth('openai',null);
  assert.equal(result.message,'provider_unavailable'); assert.doesNotMatch(JSON.stringify(result),/test-secret/);
});
test('oversized and malformed bodies do not get returned or confirm model access', async () => {
  for(const response of [new Response('x'.repeat(20_000)),new Response('<html>private</html>')]) {
    const result=await health(async()=>response).checkProviderHealth('openai','gpt-4.1'); assert.equal(result.message,'unknown_provider_error'); assert.equal(result.modelStatus,'unknown');
  }
});
test('unapproved persisted model cannot affect provider URL or response', async () => {
  const result=await health(async(url:string)=>{assert.equal(url,'https://api.openai.com/v1/models');return Response.json({data:[]});}).checkProviderHealth('openai','https://evil.invalid/secret');
  assert.equal(result.model,null);
});
function action(deny = false, readError = false) {
  let calls=0;
  const result=compile('app/settings/ai/operations-actions.ts', {
    '@/lib/auth':{requireSystemOwner:async()=>{if(deny)throw Error('private');}},
    '@/lib/supabase/server':{createClient:async()=>({from:(table:string)=>{assert.equal(table,'ai_provider_settings');return {select:async()=>({data:[{provider_id:'openai',default_model:'gpt-4.1'}],error:readError?{}:null})};}})},
    '@/lib/ai/provider-config':config,
    '@/lib/ai/provider-health.server':{checkProviderHealth:async(provider:string,model:string|null)=>{calls++;return {provider,model};}},
  });return {...result,calls:()=>calls};
}
test('manual action requires system owner before any provider calls',async()=>{
  const api=action(true); const result=await api.refreshProviderStatus();assert.equal(result.ok,false);assert.equal(api.calls(),0);assert.doesNotMatch(result.message,/private/);
});
test('manual action reads saved models and checks each provider once',async()=>{
  const api=action();const result=await api.refreshProviderStatus();assert.equal(result.ok,true);assert.equal(api.calls(),3);assert.equal(result.results[0].model,'gpt-4.1');
});
test('settings read failure cannot dispatch checks',async()=>{const api=action(false,true);assert.equal((await api.refreshProviderStatus()).ok,false);assert.equal(api.calls(),0);});
function ui(refresh: any, react: any = React) {
 return compile('components/settings/ai-provider-operations.tsx', {react,'react/jsx-runtime':jsx,'@/app/settings/ai/operations-actions':{refreshProviderStatus:refresh},'@/lib/ai/provider-operations':contract,'@/lib/ai/model-catalog':catalog});
}
const props={configured:{openai:true,anthropic:false,gemini:true}};
test('operations render safe missing/configured status, no automatic calls, honest billing and external links',()=>{
 const html=renderToStaticMarkup(React.createElement(ui(()=>assert.fail('automatic refresh')).AiProviderOperations,props));
 for(const text of ['Configured','Missing credential','Not checked yet','Provider usage','Unavailable','Balance unavailable through current integration','NOA Voice Profile','marin','Fallback:'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/\$0|API_KEY|Bearer|secret|session is pinned/);
 for(const p of Object.values(contract.PROVIDER_PORTALS) as any[]) {assert.ok(html.includes(p.usage));assert.ok(html.includes(p.billing));}
 assert.equal((html.match(/rel="noopener noreferrer"/g)||[]).length,6);
 assert.ok(html.includes('lg:grid-cols-3'));assert.ok(html.includes('min-w-0'));
});
function elements(e:any):any[]{return !e||typeof e!=='object'?[]:[e,...React.Children.toArray(e.props?.children).flatMap(elements)];}
test('refresh blocks duplicate clicks, shows checking and timestamps, retains results on failure',async()=>{
 const state:any[]=[];let cursor=0;let calls=0;let finish:any;
 const react={...React,useState:(initial:any)=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],(value:any)=>{state[i]=value;}];},useRef:(initial:any)=>{const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];}};
 const component=ui(()=>{calls++;return new Promise(r=>{finish=r;});},react).AiProviderOperations;
 const render=()=>{cursor=0;return component(props);};const button=(tree:any)=>elements(tree).find(e=>e.type==='button');
 const first=button(render()).props.onClick();assert.equal(button(render()).props.children,'Checking...');await button(render()).props.onClick();assert.equal(calls,1);
 finish({ok:true,results:[{provider:'openai',credentialStatus:'configured',reachability:'available',authStatus:'valid',quotaStatus:'unknown',model:null,modelStatus:'unknown',checkedAt:'2026-09-27T00:00:00.000Z',message:'metadata_available'}]});await first;
 assert.ok(elements(render()).some(e=>e.type==='time'&&e.props.dateTime==='2026-09-27T00:00:00.000Z'));
 const next=button(render()).props.onClick();finish({ok:false,message:'Could not refresh.'});await next;assert.ok(elements(render()).some(e=>e.props.role==='alert'));assert.ok(elements(render()).some(e=>e.type==='time'));
});
test('voice profile matches provider registry and transcription stays OpenAI',()=>{
 assert.deepEqual(Object.keys(contract.NOA_VOICE_PROFILES),['openai','gemini']); const voice=contract.NOA_VOICE_PROFILES.openai;
 const speech=readFileSync('lib/noa/noa-voice-provider.ts','utf8');const session=readFileSync('app/api/noa/voice/session/route.ts','utf8');
 assert.ok(speech.includes(`model: "${voice.model}"`));assert.ok(speech.includes(`voice: "${voice.voice}"`));assert.ok(session.includes(`"${voice.transcriptionModel}"`));
 assert.doesNotMatch(readFileSync('components/settings/ai-provider-operations.tsx','utf8'),/setInterval|useEffect/);
});
