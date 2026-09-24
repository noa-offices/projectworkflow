import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "server-only" + "@/..." aliases; the .tsx components use browser-only
// APIs and JSX - none resolvable by Node's plain ESM resolver outside the Next.js build.
// Source-level wiring/safety checks, the same convention as every other lib/noa/*-safety.test.mts
// file (including this repo's own prior client-component checks, e.g. C3's assistantSource
// assertions).

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const drawerSource = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
const messagesSource = readFileSync("components/noa/noa-messages.tsx", "utf8");

// ── SERVER (tests 1-7) ───────────────────────────────────────────────────────────

test("1. a GPC question answer includes bounded choices (<= MAX_DISPLAYED_CONFIGURATION_OPTIONS)", () => {
  const fnStart = orchestratorSource.indexOf("function productConfigurationChoicesFor");
  const fnEnd = orchestratorSource.indexOf("\n// PART 2:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("options.slice(0, MAX_DISPLAYED_CONFIGURATION_OPTIONS)"));
  // GPC-3.2: the aggregate `currency` parameter was removed from this call - each option now
  // carries its own priceCurrency, so no shared currency needs to be threaded through here.
  assert.ok(orchestratorSource.includes("choices: productConfigurationChoicesFor(offered, step.kind === \"accessory\" && !step.required),"));
});

test("2. choice labels come from the CURRENT GPC-1 option data - never invented", () => {
  const fnStart = orchestratorSource.indexOf("function productConfigurationChoicesFor");
  const fnEnd = orchestratorSource.indexOf("\n// PART 2:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("configurationChoiceLabel(option)"));
  assert.ok(fnBody.includes("value: option.label,"));
});

test("3. option ids/internal row ids are never displayed - a choice's `value` is the option's own visible label, never `option.id`", () => {
  const fnStart = orchestratorSource.indexOf("function productConfigurationChoicesFor");
  const fnEnd = orchestratorSource.indexOf("\n// PART 2:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!fnBody.includes("option.id"));
  // The question text builder never dumps the option list into prose (PART 2) - no more
  // "- <option>" line-joining left in the current question builder.
  const qFnStart = orchestratorSource.indexOf("function productConfigurationQuestionAnswer");
  const qFnEnd = orchestratorSource.indexOf("\n// PART 12:", qFnStart) > 0
    ? orchestratorSource.indexOf("\n// PART 12:", qFnStart)
    : orchestratorSource.length;
  const qFnBody = orchestratorSource.slice(qFnStart, qFnEnd);
  assert.ok(!qFnBody.includes('.map((option) => `- '));
});

test("4. an invalid answer returns the SAME structured current choices again, never a prose dump", () => {
  const start = orchestratorSource.indexOf("if (match.kind === \"none\") {");
  const snippet = orchestratorSource.slice(start, start + 400);
  assert.ok(snippet.includes("productConfigurationQuestionAnswer("));
  assert.ok(snippet.includes("I couldn't match that to one of the available"));
});

test("5. an ambiguous answer never selects the first match - it re-offers choices (narrowed to the matcher's own candidates when cheaply available)", () => {
  const start = orchestratorSource.indexOf('if (match.kind === "ambiguous") {');
  const snippet = orchestratorSource.slice(start, start + 400);
  assert.ok(snippet.includes("match.candidates"));
  assert.ok(!snippet.includes("[0]"));
});

test("6. more than 10 options remains bounded - the note states a count but never lists extra options in text", () => {
  const fnStart = orchestratorSource.indexOf("function productConfigurationQuestionAnswer");
  const fnEnd = orchestratorSource.length;
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("step.options.length > MAX_DISPLAYED_CONFIGURATION_OPTIONS"));
  assert.ok(fnBody.includes("I found ${step.options.length} options. Here are the first ${MAX_DISPLAYED_CONFIGURATION_OPTIONS}"));
});

test("7. choices is optional on NoaAnswer/NoaMessage - absent for every non-GPC answer", () => {
  assert.ok(typesSource.includes("choices?: NoaChoice[];"));
  // Every other capability path in the orchestrator's core dispatch never sets `choices` - only
  // the GPC-3.1 question builder does.
  const choiceAssignmentCount = (orchestratorSource.match(/choices: productConfigurationChoicesFor/g) ?? []).length;
  assert.equal(choiceAssignmentCount, 1);
});

// ── MATCHER (tests 8-13) ─────────────────────────────────────────────────────────

test("8-9. exact label and exact dimension still match (now via normalized comparison)", () => {
  const fnStart = orchestratorSource.indexOf("function matchProductConfigurationAnswer");
  const fnEnd = orchestratorSource.indexOf("\n// PART 3:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("normalizeConfigurationAnswerText(option.label) === normalized"));
  assert.ok(fnBody.includes("normalizeConfigurationAnswerText(option.dimension) === normalized"));
});

test("10. dash normalization (em dash, en dash, hyphen) folds to a single comparable form", () => {
  const fnStart = orchestratorSource.indexOf("function normalizeConfigurationAnswerText");
  const fnEnd = orchestratorSource.indexOf("\n}", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("[–—-]"));
});

test("11. 'x'/'×' dimension-separator normalization is applied before comparison", () => {
  const fnStart = orchestratorSource.indexOf("function normalizeConfigurationAnswerText");
  const fnEnd = orchestratorSource.indexOf("\n}", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('replace(/×/g, "x")'));
  assert.ok(fnBody.includes(String.raw`replace(/(\d)\s*x\s*(\d)/gi, "$1 x $2")`));
});

test("12. a unique token-reduced typed answer resolves via tight-containment across label+dimension, only for multi-token input", () => {
  const fnStart = orchestratorSource.indexOf("function matchProductConfigurationAnswer");
  const fnEnd = orchestratorSource.indexOf("\n// PART 3:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("userTokens.length > 1"));
  assert.ok(fnBody.includes("userTokens.every((token) => haystack.includes(tightenConfigurationAnswerText(token)))"));
  assert.ok(fnBody.includes('if (tokenMatches.length === 1) return { kind: "matched", optionId: tokenMatches[0].id };'));
});

test("13. an ambiguous token-reduced answer returns ambiguous, never a guess", () => {
  const fnStart = orchestratorSource.indexOf("function matchProductConfigurationAnswer");
  const fnEnd = orchestratorSource.indexOf("\n// PART 3:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (tokenMatches.length > 1) return { kind: "ambiguous", candidates: tokenMatches };'));
  // No fuzzy/Levenshtein engine was introduced - the whole matcher stays exact/substring/token-set.
  assert.ok(!/levenshtein|fuzzy|similarity|distance\(/i.test(fnBody));
});

// ── CLIENT (tests 14-20) ─────────────────────────────────────────────────────────

test("14. an assistant message stores the choices returned WITH that answer", () => {
  assert.ok(assistantSource.includes("choices?: NoaChoice[]"));
  assert.ok(assistantSource.includes("{ choices: answer.choices, domain: answer.domain, sources: answer.sources }"));
});

test("15. clicking the latest assistant message's choice button calls the EXISTING onQuickPrompt/handleSend path - no separate handler", () => {
  assert.ok(messagesSource.includes("onClick={() => onQuickPrompt(choice.value)}"));
});

test("16. older assistant messages' choices render disabled once the conversation has advanced", () => {
  assert.ok(messagesSource.includes("const latestMessageId = messages.at(-1)?.id;"));
  assert.ok(messagesSource.includes("message.id === latestMessageId"));
  assert.ok(messagesSource.includes("disabled={!choicesEnabled}"));
});

test("17. choice buttons are disabled while a request is in flight (isBusy)", () => {
  assert.ok(messagesSource.includes("const choicesEnabled = !isBusy && message.id === latestMessageId;"));
  assert.ok(drawerSource.includes("<NoaMessages isBusy={isBusy} messages={messages} onQuickPrompt={onSend} />"));
});

test("18. no separate mutation/configuration endpoint was introduced - only the existing NOA_CHAT_ENDPOINT request path is used", () => {
  assert.equal((assistantSource.match(/fetch\(/g) ?? []).length, 1);
  assert.ok(assistantSource.includes("const NOA_CHAT_ENDPOINT = \"/api/noa/chat\";"));
});

test("19. ordinary (non-GPC) messages render unchanged - the choices block is conditional on message.choices?.length and only for assistant messages", () => {
  assert.ok(messagesSource.includes("message.role === \"assistant\" && message.choices?.length"));
});

test("20. a choice button never exposes an internal id in its visible text - only choice.label/choice.secondary are rendered", () => {
  const buttonStart = messagesSource.indexOf("{message.choices.map((choice, index) => (");
  const buttonEnd = messagesSource.indexOf("))}", buttonStart);
  const buttonBody = messagesSource.slice(buttonStart, buttonEnd);
  assert.ok(!/choice\.value\s*[<>{]/.test(buttonBody.replace("onClick={() => onQuickPrompt(choice.value)}", "")));
  assert.ok(buttonBody.includes("{choice.label}"));
});

test("accessibility: real <button type=\"button\"> only, visible text label, no icon-only/clickable-div choice", () => {
  const buttonStart = messagesSource.indexOf("{message.choices.map((choice, index) => (");
  const buttonEnd = messagesSource.indexOf("))}", buttonStart);
  const buttonBody = messagesSource.slice(buttonStart, buttonEnd);
  assert.ok(buttonBody.includes('<button'));
  assert.ok(buttonBody.includes('type="button"'));
  assert.ok(!/<div[^>]*onClick/.test(buttonBody));
});

// ── REGRESSION (tests 21-23) ────────────────────────────────────────────────────

test("21. GPC configuration reference transport (productConfigurationReference on request/answer) is unchanged", () => {
  assert.ok(typesSource.includes("productConfigurationReference?: NoaProductConfigurationReference;"));
  assert.ok(orchestratorSource.includes("productConfigurationReference: reference,"));
});

test("22. cancel/start-over control phrasing is unchanged", () => {
  assert.ok(orchestratorSource.includes("const PRODUCT_CONFIGURATION_CANCEL_PATTERN = /^(?:cancel configuration|stop configuring)[.!]?$/i;"));
  assert.ok(orchestratorSource.includes("const PRODUCT_CONFIGURATION_START_OVER_PATTERN = /^start over[.!]?$/i;"));
});

test("23. fresh Quotation/Project request detection (looksLikeFreshOtherDomainRequest) is unchanged", () => {
  assert.ok(orchestratorSource.includes("function looksLikeFreshOtherDomainRequest(message: string, context: NoaPageContext): boolean {"));
  assert.ok(orchestratorSource.includes("quotationIdentifierCount(message) > 0 || projectFileIdentifierCount(message) > 0"));
});

// ── No GPC-1 business-rule duplication / no new endpoint / no new DB table ──────

test("no new formula/business rule was introduced - the choice/matcher helpers only format GPC-1's own option data and normalize TEXT for comparison, they never compute price/compatibility", () => {
  const choiceFnsStart = orchestratorSource.indexOf("function configurationChoiceLabel");
  const choiceFnsEnd = orchestratorSource.indexOf("\n// PART 2:", choiceFnsStart);
  const block = orchestratorSource.slice(choiceFnsStart, choiceFnsEnd);
  assert.ok(!/roundSourceAmount|resolveProductConfigurationState|baseModelPriceOrDefault/.test(block));
});
