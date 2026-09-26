/* eslint-disable @typescript-eslint/no-explicit-any -- This harness executes untyped transpiled modules and inspects heterogeneous JSX trees. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the actual TS/TSX with mocked browser APIs and a tiny hook harness. No DOM,
// microphone, network, dependency installation or Next server is needed for these tests.
const require = createRequire(import.meta.url);
let slots: unknown[] = [];
let cursor = 0;
const hooks = {
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useEffect() {},
  useRef: () => ({ current: null }),
};
const sources = Object.fromEntries(["use-noa-voice.ts", "noa-composer.tsx", "noa-messages.tsx", "noa-chat-drawer.tsx", "noa-assistant.tsx"].map((file) => [file, readFileSync(`components/noa/${file}`, "utf8")]));
function compile(file: string, overrides: Record<string, unknown> = {}) {
  const output = ts.transpileModule(sources[file], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} as any }; // Transpiled module boundary, not production types.
  new Function("require", "module", "exports", output)((id: string) => overrides[id] ?? (id === "react" ? hooks : require(id)), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const voiceModule = compile("use-noa-voice.ts");
const { createNoaVoice, appendVoiceTranscript, hasSpeechText } = voiceModule;
const { NoaComposer } = compile("noa-composer.tsx", { "@/components/noa/use-noa-voice": voiceModule });
const { NoaMessages } = compile("noa-messages.tsx", { "@/components/noa/use-noa-voice": voiceModule, "@/components/noa/noa-source-badges": { NoaSourceBadges: () => null } });
function elements(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
const find = (tree: any, label: string) => elements(tree).find((node) => node.props?.["aria-label"] === label);
function setup(options: { enabled?: boolean; recognition?: boolean; speech?: boolean; prefixed?: boolean; locale?: string } = {}) {
  const instances: any[] = [];
  const spoken: any[] = [];
  let cancels = 0;
  class Recognition {
    starts = 0; stops = 0; aborts = 0;
    onresult: any; onerror: any; onend: any;
    constructor() { instances.push(this); }
    start() { this.starts++; }
    stop() { this.stops++; }
    abort() { this.aborts++; }
  }
  const browser = {
    [options.prefixed ? "webkitSpeechRecognition" : "SpeechRecognition"]: options.recognition === false ? undefined : Recognition,
    SpeechSynthesisUtterance: options.speech === false ? undefined : class { text: string; constructor(text: string) { this.text = text; } },
    speechSynthesis: options.speech === false ? undefined : { speak: (value: any) => spoken.push(value), cancel: () => { cancels++; } },
    navigator: { language: options.locale },
  };
  const voice = createNoaVoice();
  voice.connect(browser, options.enabled !== false);
  const state = () => ({ ...voice, ...voice.getSnapshot() });
  const result = (text: string, isFinal = true) => instances.at(-1).onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  slots = [];
  const sent: string[] = [];
  const composer = () => { cursor = 0; return NoaComposer({ disabled: false, onSend: (text: string) => sent.push(text), voice: state() }); };
  const input = () => elements(composer()).find((node) => node.type === "textarea");
  const messages = (text = "Authoritative reply", role = "assistant", extra = {}) => NoaMessages({ messages: [{ id: "one", role, text, ...extra }], onQuickPrompt() {}, voice: state() });
  return { voice, state, instances, spoken, cancels: () => cancels, result, composer, input, sent, messages };
}

test("flag off hides all controls and never starts microphone", () => {
  const h = setup({ enabled: false });
  assert.equal(find(h.composer(), "Start voice input"), undefined);
  assert.equal(find(h.messages(), "Read response aloud"), undefined);
  h.voice.toggleInput(() => assert.fail());
  assert.equal(h.instances.length, 0);
  assert.match(sources["use-noa-voice.ts"], /process.env.NEXT_PUBLIC_NOA_VOICE_V1 === "true"/);
});
test("standard and prefixed support show mic; opening requests no microphone", () => {
  for (const prefixed of [false, true]) {
    const h = setup({ prefixed });
    assert.ok(find(h.composer(), "Start voice input"));
    assert.equal(h.instances.length, 0);
  }
});
test("unsupported recognition retains typed send and independently supported TTS", () => {
  const h = setup({ recognition: false });
  assert.equal(find(h.composer(), "Start voice input"), undefined);
  h.input().props.onChange({ target: { value: "Typed request" } });
  find(h.composer(), "Send message").props.onClick();
  assert.deepEqual(h.sent, ["Typed request"]);
  assert.ok(find(h.messages(), "Read response aloud"));
});
test("tap starts and second tap stops; natural end restores idle", () => {
  const h = setup();
  find(h.composer(), "Start voice input").props.onClick();
  assert.equal(h.instances[0].starts, 1);
  find(h.composer(), "Stop voice input").props.onClick();
  assert.equal(h.instances[0].stops, 1);
  assert.equal(h.state().ending, true);
  h.instances[0].onend();
  assert.equal(h.state().listening, false);
});
test("final populates existing editable input, waits for send, then uses ordinary callback", () => {
  const h = setup();
  find(h.composer(), "Start voice input").props.onClick();
  h.result("What needs my attention?");
  assert.equal(h.input().props.value, "What needs my attention?");
  assert.deepEqual(h.sent, []);
  h.input().props.onChange({ target: { value: "Edited request" } });
  find(h.composer(), "Send message").props.onClick();
  assert.deepEqual(h.sent, ["Edited request"]);
  assert.equal(h.input().props.value, "");
});
test("transcript appends to latest typed text and duplicate final is ignored", () => {
  const h = setup();
  find(h.composer(), "Start voice input").props.onClick();
  h.input().props.onChange({ target: { value: "Typed during recognition  " } });
  h.result("  plus speech "); h.result("  plus speech ");
  assert.equal(h.input().props.value, "Typed during recognition plus speech");
  assert.equal(appendVoiceTranscript("keep", "  "), "keep");
});
test("interim is never inserted or submitted", () => {
  const h = setup();
  find(h.composer(), "Start voice input").props.onClick();
  h.result("partial", false);
  assert.equal(h.input().props.value, "");
  find(h.composer(), "Send message").props.onClick();
  assert.deepEqual(h.sent, []);
});
for (const error of ["not-allowed", "audio-capture", "no-speech", "aborted", "service-not-allowed", "network", "language-not-supported", "unknown"]) {
  test(`${error} returns idle with short error and working typed chat`, () => {
    const h = setup();
    h.voice.toggleInput(() => assert.fail());
    h.instances[0].onerror({ error });
    assert.equal(h.state().listening, false);
    assert.ok(h.state().error);
    if (error === "not-allowed") assert.equal(h.state().error, "Microphone permission was denied.");
    h.input().props.onChange({ target: { value: "Still works" } });
    find(h.composer(), "Send message").props.onClick();
    assert.deepEqual(h.sent, ["Still works"]);
  });
}
test("locale follows browser and falls back only when absent; recognition is one-shot", () => {
  for (const locale of ["ml-IN", undefined]) {
    const h = setup({ locale }); h.voice.toggleInput(() => {});
    assert.equal(h.instances[0].lang, locale || "en-US");
    assert.equal(h.instances[0].continuous, false);
  }
});
test("agent and follow-up phrases use the same Send and Enter callbacks", () => {
  const h = setup();
  for (const text of ["Give me a complete update on CO-0003-001", "Tell me about CO-0003-001", "What changed on it?"]) {
    find(h.composer(), "Start voice input").props.onClick(); h.result(text);
    h.input().props.onKeyDown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.equal(h.sent.at(-1), text);
  }
  const a = sources["noa-assistant.tsx"];
  assert.match(a, /const NOA_CHAT_ENDPOINT = "\/api\/noa\/chat"/);
  assert.match(a, /requestNoaAnswer\(outgoing, pageContext, recentMessages, conversationReferenceRef.current/);
});
test("Shift+Enter preserves keyboard newline behavior", () => {
  const h = setup(); h.input().props.onChange({ target: { value: "typed" } });
  h.input().props.onKeyDown({ key: "Enter", shiftKey: true, preventDefault() { assert.fail(); } });
  assert.deepEqual(h.sent, []);
});
test("late result after Send or disposal cannot repopulate input", () => {
  for (const dispose of [false, true]) {
    const h = setup(); find(h.composer(), "Start voice input").props.onClick();
    const late = h.instances[0].onresult;
    if (dispose) h.voice.dispose();
    else { h.input().props.onChange({ target: { value: "send" } }); find(h.composer(), "Send message").props.onClick(); }
    late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late" } }] });
    assert.equal(h.input().props.value, "");
    assert.equal(h.instances[0].aborts, 1);
  }
});
test("assistant payload spoken verbatim, only on explicit click", () => {
  const h = setup(); const tree = h.messages("Exact server text");
  assert.equal(h.spoken.length, 0);
  find(tree, "Read response aloud").props.onClick();
  assert.equal(h.spoken[0].text, "Exact server text");
  assert.ok(find(h.messages(), "Stop reading response"));
});
test("second playback cancels first and stale callbacks cannot clear new state", () => {
  const h = setup(); h.voice.speak("first", "First");
  const staleEnd = h.spoken[0].onend;
  h.voice.speak("second", "Second"); staleEnd();
  assert.equal(h.cancels(), 1);
  assert.equal(h.state().speakingId, "second");
});
test("Stop cancels playback; end and error reset playback state", () => {
  const h = setup(); h.voice.speak("one", "Text");
  find(h.messages(), "Stop reading response").props.onClick();
  assert.equal(h.cancels(), 1); assert.equal(h.state().speakingId, null);
  h.voice.speak("two", "Text"); h.spoken.at(-1).onend();
  assert.equal(h.state().speakingId, null);
  h.voice.speak("three", "Text"); h.spoken.at(-1).onerror();
  assert.equal(h.state().speakingId, null); assert.ok(h.state().error);
});
test("close/unmount disposes speech and recognition, and reopen starts idle", () => {
  const h = setup(); h.voice.speak("one", "Text"); h.voice.dispose();
  assert.equal(h.cancels(), 1); assert.equal(h.state().speakingId, null);
  assert.match(sources["use-noa-voice.ts"], /return \(\) => controller.dispose\(\)/);
  assert.match(sources["use-noa-voice.ts"], /\[controller, isOpen\]/);
  assert.match(sources["noa-chat-drawer.tsx"], /useNoaVoice\(isOpen\)/);
});
test("unsupported TTS, user messages and meaningless payloads have no speaker", () => {
  assert.equal(find(setup({ speech: false }).messages(), "Read response aloud"), undefined);
  const h = setup();
  for (const text of ["", "  \n", "...", "👋"]) {
    assert.equal(hasSpeechText(text), false);
    assert.equal(find(h.messages(text), "Read response aloud"), undefined);
  }
  assert.equal(find(h.messages("User text", "user"), "Read response aloud"), undefined);
  assert.equal(hasSpeechText("മലയാളം"), true);
});
test("structured cards use only message.text for voice, with no invented summaries", () => {
  const h = setup();
  for (const extra of [{ attention: { items: [{}] } }, { catchUp: { items: [{}] } }, { analytics: {} }, { agentBrief: { title: "Brief", sections: [], omissions: [] } }]) {
    find(h.messages("Server text", "assistant", extra), "Read response aloud").props.onClick();
    assert.equal(h.spoken.at(-1).text, "Server text"); h.voice.stopSpeech();
    assert.equal(find(h.messages("", "assistant", extra), "Read response aloud"), undefined);
  }
});
test("voice layer adds no upload, persistence, DOM scraping or alternate API", () => {
  for (const file of ["use-noa-voice.ts", "noa-composer.tsx", "noa-messages.tsx", "noa-chat-drawer.tsx"]) {
    assert.doesNotMatch(sources[file], /MediaRecorder|supabase|localStorage|sessionStorage|getUserMedia|fetch\(|WebSocket|\/api\/|innerText|textContent/);
  }
});
test("compact controls preserve Send, shrinkable input, accessible labels and wrapping status", () => {
  const h = setup();
  assert.ok(find(h.composer(), "Send message"));
  assert.match(h.input().props.className, /min-w-0/);
  assert.match(find(h.composer(), "Start voice input").props.className, /shrink-0/);
  assert.doesNotMatch(sources["noa-composer.tsx"], /overflow-x/);
  h.voice.toggleInput(() => {});
  assert.ok(elements(h.composer()).some((node) => node.props?.role === "status" && /break-words/.test(node.props.className)));
});

test("synchronous browser failures never break chat or leave active controls", () => {
  const voice = createNoaVoice();
  voice.connect({ SpeechRecognition: class { constructor() { throw new Error("Unavailable"); } } }, true);
  assert.doesNotThrow(() => voice.toggleInput(() => assert.fail()));
  assert.equal(voice.getSnapshot().listening, false);
  assert.ok(voice.getSnapshot().error);
  voice.connect({ SpeechRecognition: class {
    start() { const error = new Error("Denied"); error.name = "NotAllowedError"; throw error; }
    abort() { throw new Error("Already stopped"); }
  } }, true);
  assert.doesNotThrow(() => voice.toggleInput(() => assert.fail()));
  assert.equal(voice.getSnapshot().error, "Microphone permission was denied.");
  voice.connect({ SpeechSynthesisUtterance: class {}, speechSynthesis: { speak() { throw new Error("Unavailable"); }, cancel() {} } }, true);
  assert.doesNotThrow(() => voice.speak("one", "Reply"));
  assert.equal(voice.getSnapshot().speakingId, null);
});

test("speech and microphone do not run together", () => {
  const h = setup(); h.voice.speak("one", "Reply"); h.voice.toggleInput(() => {});
  assert.equal(h.cancels(), 1); assert.equal(h.state().speakingId, null);
  h.voice.speak("two", "Reply");
  assert.equal(h.instances[0].aborts, 1); assert.equal(h.state().listening, false);
});

test("V2 playback prefers voiceText while visual text stays intact and Stop still cancels", () => {
  const h = setup();
  const tree = h.messages("Full visual detail", "assistant", { voiceText: "Short spoken reply." });
  assert.ok(elements(tree).some((node) => node.type === "p" && node.props.children === "Full visual detail"));
  find(tree, "Read response aloud").props.onClick();
  assert.equal(h.spoken[0].text, "Short spoken reply.");
  find(h.messages("Full visual detail", "assistant", { voiceText: "Short spoken reply." }), "Stop reading response").props.onClick();
  assert.equal(h.cancels(), 1);
});

test("V2 absent field falls back to text; explicit empty projection suppresses unsafe fallback", () => {
  const h = setup();
  find(h.messages("Legacy reply"), "Read response aloud").props.onClick();
  assert.equal(h.spoken[0].text, "Legacy reply");
  h.voice.stopSpeech();
  assert.equal(find(h.messages("Omission details", "assistant", { voiceText: "" }), "Read response aloud"), undefined);
  assert.ok(find(h.messages("", "assistant", { voiceText: "Usable speech" }), "Read response aloud"));
});
