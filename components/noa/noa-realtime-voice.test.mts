/* eslint-disable @typescript-eslint/no-explicit-any -- Execute production modules with browser/provider fakes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path: string, overrides: Record<string, any> = {}, globals: Record<string, any> = {}) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} as any };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((id: string) => overrides[id] ?? require(id), compiled, compiled.exports, ...Object.values(globals));
  return compiled.exports;
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T = any>() { let resolve!: (value: T) => void; let reject!: (reason?: any) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(options: { setupError?: boolean; speechError?: boolean } = {}) {
  let receive!: (event: any) => void;
  let connects = 0; let closes = 0; let stops = 0; let unlocks = 0;
  const requests: Array<{ text: string; reply: ReturnType<typeof deferred> }> = [];
  const speech: Array<{ text: string; signal: AbortSignal; started: () => void; done: ReturnType<typeof deferred> }> = [];
  const timers = new Map<number, () => void>();
  const { createNoaRealtimeVoice } = compile("components/noa/use-noa-realtime-voice.ts", { "./noa-realtime-transport": {} }, {
    setTimeout: (callback: () => void, ms: number) => { timers.set(ms, callback); return ms; }, clearTimeout: (ms: number) => timers.delete(ms),
  });
  const transport = { connect: async (_signal: AbortSignal, listener: typeof receive) => { connects++; receive = listener; if (options.setupError) throw Error(); }, close: () => { closes++; } };
  const player = { unlock: async () => { unlocks++; }, stop: () => { stops++; }, dispose() {}, play: (text: string, signal: AbortSignal, started: () => void) => {
    if (options.speechError) return Promise.reject(Error());
    const done = deferred(); speech.push({ text, signal, started, done }); started(); return done.promise;
  } };
  const controller = createNoaRealtimeVoice(transport, player, (text: string) => { const reply = deferred(); requests.push({ text, reply }); return reply.promise; });
  const emit = (type: string, item_id = "a", extra = {}) => receive({ type, item_id, ...extra });
  const begin = (id = "a") => emit("input_audio_buffer.speech_started", id);
  const final = (transcript: string, id = "a") => emit("conversation.item.input_audio_transcription.completed", id, { transcript });
  return { controller, state: controller.getSnapshot, emit, begin, final, requests, speech, timers, counts: () => ({ connects, closes, stops, unlocks }), listener: () => receive };
}

test("explicit start only, speech start/stop, interim, final and duplicate/blank safety", async () => {
  const h = harness(); assert.equal(h.counts().connects, 0); assert.equal(h.state().phase, "idle");
  await h.controller.start(); assert.equal(h.counts().connects, 1); assert.equal(h.counts().unlocks, 1);
  h.begin(); assert.equal(h.state().phase, "listening");
  h.emit("conversation.item.input_audio_transcription.delta", "a", { delta: "What needs" });
  assert.equal(h.state().transcript, "What needs"); assert.equal(h.requests.length, 0);
  h.emit("input_audio_buffer.speech_stopped"); assert.equal(h.state().phase, "transcribing");
  h.final("What needs my attention?"); h.final("Duplicate"); await flush();
  assert.deepEqual(h.requests.map((r) => r.text), ["What needs my attention?"]);
  h.requests[0].reply.resolve({ text: "Visual", voiceText: "Five items need attention." }); await flush();
  assert.equal(h.speech[0].text, "Five items need attention."); assert.equal(h.state().phase, "speaking");
  h.speech[0].done.resolve(undefined); await flush(); assert.equal(h.state().phase, "listening");
  h.begin("b"); h.final("   ", "b"); await flush(); assert.equal(h.requests.length, 1);
  h.controller.stop(); assert.equal(h.state().phase, "idle"); assert.equal(h.timers.size, 0);
});

test("barge-in immediately aborts speech; stale player callbacks cannot change new turn", async () => {
  const h = harness(); await h.controller.start(); h.begin(); h.final("First"); await flush();
  h.requests[0].reply.resolve({ voiceText: "First answer." }); await flush();
  h.begin("b"); assert.equal(h.speech[0].signal.aborted, true); assert.equal(h.state().phase, "listening");
  h.speech[0].started(); h.speech[0].done.reject(Error()); await flush(); assert.equal(h.state().phase, "listening");
  h.final("Which project is that?", "b"); await flush(); assert.equal(h.requests[1].text, "Which project is that?");
  h.controller.stop();
});

test("thinking interruption keeps NOA ordered and suppresses stale response speech/transcript", async () => {
  const h = harness(); await h.controller.start(); h.begin(); h.final("Tell me about CO-0003-001"); await flush();
  h.begin("b"); h.emit("conversation.item.input_audio_transcription.delta", "b", { delta: "What changed" });
  h.final("Stale transcript", "a"); assert.equal(h.state().transcript, "What changed");
  h.final("What changed on it?", "b"); await flush(); assert.equal(h.requests.length, 1);
  h.requests[0].reply.resolve({ voiceText: "Old answer" }); await flush();
  assert.equal(h.speech.length, 0); assert.equal(h.requests[1].text, "What changed on it?"); assert.equal(h.state().transcript, "What changed on it?");
  h.requests[1].reply.resolve({ voiceText: "Current answer" }); await flush(); assert.equal(h.speech[0].text, "Current answer");
  h.controller.stop();
});

test("missing, empty, meaningless and oversized voiceText never fall back to visual text", async () => {
  for (const voiceText of [undefined, "", "...", "a".repeat(601)]) {
    const h = harness(); await h.controller.start(); h.begin(); h.final("Question"); await flush();
    h.requests[0].reply.resolve({ text: "Visual answer must remain visual", voiceText }); await flush();
    assert.equal(h.speech.length, 0); assert.equal(h.state().phase, "listening"); h.controller.stop();
  }
});

test("close/restart ignores old session events and old answer; idle and maximum session cleanup", async () => {
  const h = harness(); await h.controller.start(); const old = h.listener();
  h.begin(); h.final("Question"); await flush(); h.controller.stop(); await h.controller.start();
  old({ type: "input_audio_buffer.speech_started", item_id: "old" }); assert.equal(h.state().transcript, "");
  h.requests[0].reply.resolve({ voiceText: "Old session answer" }); await flush(); assert.equal(h.speech.length, 0);
  h.timers.get(120_000)!(); assert.equal(h.state().phase, "idle");
  await h.controller.start(); h.timers.get(600_000)!(); assert.equal(h.state().phase, "idle");
});

test("connection/TTS failures release voice mode for manual fallback; long transcripts fail safely", async () => {
  const failed = harness({ setupError: true }); await failed.controller.start(); assert.equal(failed.state().phase, "error"); assert.equal(failed.timers.size, 0);
  const h = harness({ speechError: true }); await h.controller.start(); h.begin(); h.final("Question"); await flush();
  h.requests[0].reply.resolve({ text: "Visual still exists", voiceText: "Answer" }); await flush(); assert.equal(h.state().phase, "listening");
  assert.match(h.state().error, /Speech couldn't play/);
  assert.equal(h.counts().connects, 1);
  h.begin("long"); assert.equal(h.state().error, undefined);
  h.final("x".repeat(2001), "long"); assert.equal(h.state().phase, "error");
});

function route(path: "session" | "speech", options: { auth?: boolean; flag?: boolean; providerStatus?: number; providerBody?: unknown; nonJson?: boolean; fetchError?: Error } = {}) {
  const calls: any[] = [];
  const logs: any[] = [];
  const env = { NEXT_PUBLIC_NOA_REALTIME_VOICE: options.flag === false ? "false" : "true", OPENAI_API_KEY: "standard-secret" };
  const { POST } = compile(`app/api/noa/voice/${path}/route.ts`, { "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.auth === false ? null : { id: "user" } } }) } }) } }, {
    process: { env }, console: { error: (entry: unknown) => logs.push(entry) }, fetch: async (url: string, init: any) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      if (options.fetchError) throw options.fetchError;
      if (options.nonJson) return new Response("private gateway response", { status: options.providerStatus ?? 502 });
      return path === "session" ? Response.json(options.providerBody ?? { value: "ek_ephemeral", expires_at: 123, private: "hidden" }, { status: options.providerStatus ?? 200 })
        : new Response(new Uint8Array([0, 0, 1, 0]), { status: options.providerStatus ?? 200 });
    },
  });
  const request = (body?: unknown) => new Request(`https://app.test/api/noa/voice/${path}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { POST, request, calls, env, logs };
}

test("session upstream 4xx logs only safe diagnostics and keeps the client 502 generic", async () => {
  const h = route("session", { providerStatus: 400, providerBody: {
    error: { code: "invalid_value", type: "invalid_request_error", message: "Unsupported session parameter.", user: "private-user", Authorization: "standard-secret" },
    value: "ek_private", user_data: "private-request",
  } });
  const response = await h.POST(h.request({ user_data: "do not log" }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Realtime voice isn't available right now." });
  assert.deepEqual(h.logs, [{ upstreamStatus: 400, model: "gpt-4o-mini-transcribe", code: "invalid_value", type: "invalid_request_error", message: "Unsupported session parameter." }]);
});

test("session diagnostics redact keys, masked keys, ephemeral secrets and email in every error field", async () => {
  const secretText = "standard-secret legacy-secret sk-proj-abc***xyz ek_sensitive Bearer token-value user@example.com";
  const h = route("session", { providerStatus: 401, providerBody: { error: { code: secretText, type: secretText, message: `${secretText}\n${"x".repeat(900)}` } } });
  Object.assign(h.env, { SOURCE_QA_AI_API_KEY: "legacy-secret" });
  await h.POST(h.request());
  const logged = JSON.stringify(h.logs);
  for (const secret of ["standard-secret", "legacy-secret", "sk-proj-", "ek_sensitive", "token-value", "user@example.com"]) assert.ok(!logged.includes(secret));
  assert.ok(h.logs[0].message.length <= 500);
  assert.ok(!h.logs[0].message.includes("\n"));
});

test("session success/auth/flag never log payloads; malformed errors and transport failures stay safe", async () => {
  for (const options of [{}, { auth: false }, { flag: false }]) {
    const h = route("session", options); await h.POST(h.request()); assert.deepEqual(h.logs, []);
  }
  const malformed = route("session", { providerStatus: 403, nonJson: true });
  assert.equal((await malformed.POST(malformed.request())).status, 502);
  assert.deepEqual(malformed.logs[0], { upstreamStatus: 403, model: "gpt-4o-mini-transcribe", code: null, type: null, message: null });
  const failed = route("session", { fetchError: new TypeError("secret exception standard-secret") });
  assert.equal((await failed.POST(failed.request())).status, 502);
  assert.equal(failed.logs[0].code, "session_request_failed"); assert.equal(failed.logs[0].upstreamStatus, null);
  assert.doesNotMatch(JSON.stringify(failed.logs), /secret exception|standard-secret/);
  const invalid = route("session", { providerBody: { value: "sk-private", expires_at: 123 } });
  assert.equal((await invalid.POST(invalid.request())).status, 502);
  assert.equal(invalid.logs[0].code, "invalid_session_response"); assert.equal(invalid.logs[0].upstreamStatus, 200);
});

test("both routes require auth and flag; session fixed transcription/VAD, ephemeral only, no tools", async () => {
  for (const name of ["session", "speech"] as const) {
    for (const options of [{ auth: false }, { flag: false }]) {
      const h = route(name, options); assert.equal((await h.POST(h.request({ voiceText: "Hello" }))).status, options.auth === false ? 401 : 404); assert.equal(h.calls.length, 0);
    }
  }
  const h = route("session"); const response = await h.POST(h.request({ model: "malicious", tools: [{}] }));
  assert.deepEqual(await response.json(), { value: "ek_ephemeral", expires_at: 123 }); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = h.calls[0].body;
  assert.equal(body.session.type, "transcription"); assert.equal(body.expires_after.seconds, 60);
  assert.equal(body.session.audio.input.transcription.model, "gpt-4o-mini-transcribe");
  assert.equal(body.session.audio.input.turn_detection.type, "server_vad"); assert.equal(body.session.audio.input.turn_detection.silence_duration_ms, 800);
  assert.doesNotMatch(JSON.stringify(body), /malicious|tools|CO-0003/);
});

test("speech validates bytes/plain bounded text/only voiceText and streams exact text with fixed model", async () => {
  const h = route("speech");
  for (const body of [{ voiceText: "x".repeat(601) }, { voiceText: "" }, { voiceText: "..." }, { voiceText: "<speak>Hi</speak>" }, { voiceText: "Hi", model: "other" }, { voiceText: "Hi", voice: "other" }, { voiceText: 12 }, [], null]) {
    assert.equal((await h.POST(h.request(body))).status, 400);
  }
  assert.equal((await h.POST(h.request({ voiceText: "x".repeat(5000) }))).status, 413); assert.equal(h.calls.length, 0);
  const text = "Five items across two projects. Missing ETA and ETD.";
  const response = await h.POST(h.request({ voiceText: text }));
  assert.equal(response.headers.get("content-type"), "audio/pcm"); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(h.calls[0].body, { model: "gpt-4o-mini-tts", voice: "marin", input: text, response_format: "pcm" });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 0, 1, 0]);
});

test("provider errors never return credentials or raw provider data; existing key fallback works", async () => {
  for (const name of ["session", "speech"] as const) {
    const h = route(name, { providerStatus: 500 }); const response = await h.POST(h.request({ voiceText: "Hello" }));
    assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /secret|hidden|ephemeral/);
    h.env.OPENAI_API_KEY = ""; assert.equal((await h.POST(h.request({ voiceText: "Hello" }))).status, 503);
    Object.assign(h.env, { SOURCE_QA_AI_API_KEY: "legacy-secret" }); await h.POST(h.request({ voiceText: "Hello" }));
    assert.equal(h.calls.at(-1).headers.Authorization, "Bearer legacy-secret");
  }
});

function elements(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
test("drawer flags, Start/End, readable state, transcript, disclosure, close, and manual fallback", () => {
  let started = 0; let stopped = 0; let manualStops = 0; let closed = 0; const sent: string[] = [];
  const state: any = { active: false, phase: "idle", transcript: "", start: () => started++, stop: () => stopped++ };
  const voice = { abortInput: () => manualStops++, stopSpeech: () => manualStops++ };
  const env = { NEXT_PUBLIC_NOA_REALTIME_VOICE: "false" };
  const overrides: any = {
    "@/components/noa/use-noa-realtime-voice": { useNoaRealtimeVoice: () => state },
    "@/components/noa/use-noa-voice": { useNoaVoice: () => voice },
  };
  for (const [file, name] of [["noa-header", "NoaHeader"], ["noa-composer", "NoaComposer"], ["noa-messages", "NoaMessages"], ["noa-status", "NoaStatus"]]) overrides[`@/components/noa/${file}`] = { [name]: name };
  const { NoaChatDrawer } = compile("components/noa/noa-chat-drawer.tsx", overrides, { process: { env } });
  const messages = [{ id: "a", attention: { items: [] }, analytics: {}, catchUp: {}, agentBrief: {} }];
  const render = () => elements(NoaChatDrawer({ isOpen: true, messages, onClose: () => closed++, onSend: (text: string) => sent.push(text), state: "open" }));
  assert.equal(render().filter((n) => n.type === "button").length, 0);
  env.NEXT_PUBLIC_NOA_REALTIME_VOICE = "true";
  const start = render().find((n) => n.type === "button"); assert.equal(start.props.children, "Voice"); assert.equal(start.props["aria-label"], "Start voice conversation"); start.props.onClick(); assert.equal(started, 1); assert.equal(manualStops, 2);
  Object.assign(state, { active: true, phase: "listening", transcript: "Project File" });
  const nodes = render(); assert.equal(nodes.find((n) => n.type === "button").props.children, "End voice");
  assert.equal(nodes.find((n) => n.type === "button").props["aria-label"], "End voice conversation");
  for (const [phase, label] of [["listening", "Listening…"], ["thinking", "Thinking…"], ["speaking", "Speaking…"], ["transcribing", "Listening…"]]) {
    state.phase = phase;
    assert.ok(render().some((n) => n.props?.role === "status" && n.props.children === label));
  }
  state.error = "Speech couldn't play.";
  assert.equal(render().find((n) => n.type === "NoaMessages").props.voice, undefined);
  assert.equal(render().find((n) => n.type === "NoaComposer").props.voice, undefined);
  assert.ok(render().some((n) => n.props?.role === "status" && n.props.children === state.error));
  nodes.find((n) => n.type === "button").props.onClick(); assert.ok(stopped > 0);
  assert.ok(nodes.some((n) => n.props?.children === "AI-generated voice"));
  const renderedMessages = nodes.find((n) => n.type === "NoaMessages"); assert.equal(renderedMessages.props.messages, messages); assert.equal(renderedMessages.props.voice, undefined);
  nodes.find((n) => n.type === "NoaHeader").props.onClose(); assert.equal(closed, 1); assert.ok(stopped > 0);
  Object.assign(state, { active: false, phase: "error" });
  const fallback = render().find((n) => n.type === "NoaComposer"); assert.equal(fallback.props.voice, voice); fallback.props.onSend("Typed works"); assert.deepEqual(sent, ["Typed works"]);
});

test("NOA spelling context stays static; transcripts about Noah are not rewritten", async () => {
  const r = route("session"); await r.POST(r.request());
  const prompt = r.calls[0].body.session.audio.input.transcription.prompt;
  for (const term of ["N-O-A", "Hey NOA", "ProjectWorkflow", "LAS MOBILI", "Interstuhl", "EXQUITECH", "ETA", "ETD", "RFQ", "Quotation", "Project File", "Preserve Noah"]) assert.ok(prompt.includes(term));
  const h = harness(); await h.controller.start(); h.begin(); h.final("Ask Noah about the quotation"); await flush();
  assert.equal(h.requests[0].text, "Ask Noah about the quotation"); h.controller.stop();
});

test("V3.2 only normalizes closed leading invocations and contextual Interstool chair phrases", async () => {
  const { normalizeNoaVoiceTranscript } = compile("components/noa/use-noa-realtime-voice.ts", { "./noa-realtime-transport": {} });
  for (const greeting of ["Hey", "Hello", "Hi", "Okay", "OK"]) {
    for (const name of ["Noah", "Nova"]) assert.equal(normalizeNoaVoiceTranscript(`${greeting} ${name}, what needs my attention?`), `${greeting} NOA, what needs my attention?`);
  }
  for (const text of ["I spoke to Noah yesterday", "Nova is a project name", "Hello Noah is the title", "Ask Noah about Interstool", "Interstol chairs"]) assert.equal(normalizeNoaVoiceTranscript(text), text);
  assert.equal(normalizeNoaVoiceTranscript("Interstool chairs"), "Interstuhl chairs");
  const h = harness(); await h.controller.start(); h.begin(); h.final("Can you find me price for every chair from Interstool?"); await flush();
  assert.equal(h.requests[0].text, "Can you find me price for every chair from Interstuhl?"); h.controller.stop();
  assert.doesNotMatch(readFileSync("components/noa/noa-assistant.tsx", "utf8"), /normalizeNoaVoiceTranscript/);
});

test("compact Voice row sits above composer, wraps at narrow widths, and has no agent wording", () => {
  const source = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
  assert.doesNotMatch(source, /Live Agent|Voice Agent|Call Agent|overflow-x|whitespace-nowrap/);
  assert.match(source, /flex min-w-0 flex-wrap/);
  assert.ok(source.indexOf("<NoaMessages") < source.indexOf("{realtimeEnabled &&"));
  assert.ok(source.indexOf("{realtimeEnabled &&") < source.indexOf("<NoaComposer"));
});

test("End cancels neural speech and a new session keeps using exact authoritative voiceText", async () => {
  const h = harness(); await h.controller.start();
  for (let i = 0; i < 3; i++) {
    h.begin(String(i)); h.final("Question", String(i)); await flush();
    h.requests[i].reply.resolve({ text: "Different visual text", voiceText: `Exact answer ${i}` }); await flush();
    assert.equal(h.speech[i].text, `Exact answer ${i}`);
    h.speech[i].done.resolve(undefined); await flush();
  }
  h.controller.stop(); assert.equal(h.speech[2].signal.aborted, true);
});

test("voice implementation adds no persistence, business agent, tools, or client standard key", () => {
  for (const file of ["components/noa/use-noa-realtime-voice.ts", "components/noa/noa-realtime-transport.ts", "components/noa/noa-chat-drawer.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /OPENAI_API_KEY|SOURCE_QA_AI_API_KEY|MediaRecorder|localStorage|sessionStorage|supabase|noa-orchestrator|response\.create|tools:/);
  }
  const hook = readFileSync("components/noa/use-noa-realtime-voice.ts", "utf8");
  assert.match(hook, /return \(\) => controller.stop\(\)/); assert.match(hook, /if \(!isOpen\) controller.stop\(\)/);
});

test("actual existing send path serializes turns, renders original cards, and carries both references", async () => {
  const slots: any[] = []; let cursor = 0;
  const hooks = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: (fn: any) => fn, useEffect() {},
  };
  const requests: any[] = []; const replies: Array<ReturnType<typeof deferred>> = [];
  const { NoaAssistant } = compile("components/noa/noa-assistant.tsx", {
    react: hooks,
    "@/components/noa/noa-chat-drawer": { NoaChatDrawer: "Drawer" },
    "@/components/noa/noa-launcher": { NoaLauncher: "Launcher" },
    "@/components/noa/noa-messages": { NOA_DRAFT_STARTER_SIGNAL_PREFIX: "draft:" },
    "@/lib/noa/noa-intent-router": { classifyNoaIntent: () => "projects" },
    "@/lib/noa/noa-state-machine": compile("lib/noa/noa-state-machine.ts"),
    "@/lib/noa/use-noa-page-context": { useNoaPageContext: () => ({ section: "projects" }) },
  }, { window: { setTimeout: () => 1, clearTimeout() {} }, fetch: async (url: string, init: any) => {
    requests.push({ url, ...JSON.parse(init.body) }); const reply = deferred(); replies.push(reply); return reply.promise;
  } });
  const drawer = () => { cursor = 0; return elements(NoaAssistant({ auth: { userId: "user" } })).find((n) => n.type === "Drawer").props; };
  const send = drawer().onSend;
  const first = send("Tell me about CO-0003-001"); const second = send("What changed on it?"); await flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/noa/chat");
  const answer = { text: "Original visual", voiceText: "Exact speech", conversationReference: { kind: "project", id: "CO-0003-001" }, productConfigurationReference: { id: "configuration" }, attention: { items: [] }, analytics: {}, catchUp: {}, agentBrief: {} };
  replies[0].resolve(Response.json(answer)); assert.deepEqual(await first, answer); await flush();
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].conversationReference, answer.conversationReference);
  assert.deepEqual(requests[1].productConfigurationReference, answer.productConfigurationReference);
  assert.ok(requests[1].recentMessages.some((m: any) => m.text === answer.text));
  const visible = drawer().messages;
  assert.equal(visible[1].text, "Tell me about CO-0003-001");
  for (const key of ["text", "voiceText", "attention", "analytics", "catchUp", "agentBrief"]) assert.deepEqual(visible[2][key], (answer as any)[key]);
  replies[1].resolve(Response.json({ text: "Follow-up", voiceText: "Follow-up" })); await second;
});

test("real WebRTC adapter requests mic only on connect, uses ephemeral SDP and closes tracks/peer", async () => {
  let microphone = 0; let tracksStopped = 0; let peerClosed = 0;
  const channel = Object.assign(new EventTarget(), { readyState: "open", close() {}, onmessage: null, onclose: null });
  const track = { stop: () => tracksStopped++, onended: null };
  class Peer {
    createDataChannel(name: string) { assert.equal(name, "oai-events"); return channel; }
    addTrack() {} close() { peerClosed++; } createOffer() { return { type: "offer", sdp: "offer" }; }
    setLocalDescription() {} setRemoteDescription(answer: any) { assert.equal(answer.sdp, "answer"); }
  }
  const calls: any[] = [];
  const { createRealtimeTransport } = compile("components/noa/noa-realtime-transport.ts", {}, {
    RTCPeerConnection: Peer, navigator: { mediaDevices: { getUserMedia: async () => { microphone++; return { getTracks: () => [track] }; } } },
    fetch: async (url: string, init: any) => { calls.push({ url, ...init }); return url.startsWith("/api") ? Response.json({ value: "ek_only" }) : new Response("answer"); },
  });
  const transport = createRealtimeTransport(); assert.equal(microphone, 0);
  const abort = new AbortController(); await transport.connect(abort.signal, () => {});
  assert.equal(microphone, 1); assert.equal(calls[1].headers.Authorization, "Bearer ek_only"); assert.equal(calls[1].body, "offer");
  abort.abort(); transport.close(); assert.equal(tracksStopped, 1); assert.equal(peerClosed, 1);
});

test("microphone granted after close is immediately released and never sent", async () => {
  const permission = deferred(); let stopped = 0;
  class Peer { createDataChannel() { return { close() {} }; } close() {} }
  const { createRealtimeTransport } = compile("components/noa/noa-realtime-transport.ts", {}, {
    RTCPeerConnection: Peer, navigator: { mediaDevices: { getUserMedia: () => permission.promise } }, fetch: () => assert.fail("No setup after close"),
  });
  const transport = createRealtimeTransport(); const abort = new AbortController();
  const pending = transport.connect(abort.signal, () => {}); abort.abort();
  permission.resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await assert.rejects(pending); assert.equal(stopped, 1);
});

test("PCM player starts on incoming chunks and abort stops scheduled audio and fetch", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>; let began = 0; let stopped = 0; let closed = 0; let fetchSignal!: AbortSignal;
  const values: number[] = [];
  class Audio {
    state = "running"; currentTime = 0; destination = {};
    async resume() {} async close() { closed++; }
    createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { duration: length / 24000, getChannelData: () => data, data }; }
    createBufferSource() { return { buffer: null as any, connect() {}, disconnect() {}, start() { values.push(...this.buffer.data); }, stop() { stopped++; } }; }
  }
  const { createStreamingPlayer } = compile("components/noa/noa-realtime-transport.ts", {}, {
    AudioContext: Audio, fetch: async (_url: string, init: any) => {
      assert.deepEqual(JSON.parse(init.body), { voiceText: "Exact words" }); fetchSignal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; init.signal.addEventListener("abort", () => controller.error(new Error("Aborted"))); } }));
    },
  });
  const player = createStreamingPlayer(); await player.unlock(); const abort = new AbortController();
  const playing = player.play("Exact words", abort.signal, () => began++); await flush();
  stream.enqueue(new Uint8Array([0])); await flush(); assert.equal(began, 0);
  stream.enqueue(new Uint8Array([64, 0, 128])); await flush(); assert.equal(began, 1); assert.deepEqual(values, [0.5, -1]);
  abort.abort(); await assert.rejects(playing); assert.equal(fetchSignal.aborted, true); assert.ok(stopped > 0);
  player.dispose(); assert.equal(closed, 1);
});
