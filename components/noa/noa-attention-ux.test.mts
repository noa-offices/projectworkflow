// NOA 2.0A-3: launcher attention-count badge + "Needs attention" starter. Source-inspection tests,
// matching this codebase's established convention for "use client" files with "@/..." aliases
// that Node's plain ESM resolver can't load outside the Next.js build (see
// noa-avatar-full-sneak.test.mts, noa-messages.test.mts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync("components/noa/noa-launcher.tsx", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const messages = readFileSync("components/noa/noa-messages.tsx", "utf8");
const chatDrawer = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
const attentionRoute = readFileSync("app/api/noa/attention/route.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

// 1. attention count uses existing server Attention capability
test("1. the count endpoint calls the existing fetchNoaAttentionCapability(), never a new implementation", () => {
  assert.ok(attentionRoute.includes('import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";'));
  assert.ok(attentionRoute.includes("await fetchNoaAttentionCapability("));
});

// 2. no Attention rule duplicated in API/client
test("2. no price/procurement/payment rule is duplicated in the route or the client components", () => {
  for (const source of [attentionRoute, assistant, launcher]) {
    assert.ok(!/productTemplatePriceCheckState|deriveClientPaymentStatus|buildEffectiveDocumentGroups/.test(source));
    assert.ok(!/\.from\(\s*["'](product_templates|procurement_vendor_progress|client_payment_installments)["']/.test(source));
  }
});

// 3. no service/admin client
test("3. no service-role/admin database client anywhere in the new route or client components", () => {
  for (const source of [attentionRoute, assistant, launcher]) {
    assert.ok(!source.includes("createAdminClient"));
    assert.ok(!/SUPABASE_SERVICE_ROLE/.test(source));
  }
});

// 4. count request is bounded by existing capability
test("4. the route returns only a bounded {available, count} shape - never the full findings list", () => {
  assert.ok(attentionRoute.includes("return NextResponse.json({ available: true, count });"));
  assert.ok(!attentionRoute.includes("items"));
});

// 5. client fetch occurs once, no interval/polling
test("5. the client fetches the attention count once on mount, never polls", () => {
  assert.ok(assistant.includes("attentionFetchStartedRef.current"));
  assert.ok(!/setInterval/.test(assistant));
  assert.ok(assistant.includes("fetch(NOA_ATTENTION_ENDPOINT)"));
  assert.equal((assistant.match(/fetch\(NOA_ATTENTION_ENDPOINT\)/g) ?? []).length, 1);
});

// 6. failure hides badge without affecting chat
test("6. a failed/denied attention fetch is swallowed - no chat error, no dispatch call", () => {
  const effectStart = assistant.indexOf("useEffect(() => {");
  const effectEnd = assistant.indexOf("}, [auth]);", effectStart);
  const effectBody = assistant.slice(effectStart, effectEnd);
  assert.ok(effectBody.includes(".catch(() => {"));
  assert.ok(!effectBody.includes("dispatch("));
  assert.ok(!effectBody.includes("setMessages("));
});

// 7. count 0 => no badge
// 8. count 1-9 => numeric badge
// 9. count >9 => "9+"
test("7/8/9. attentionBadgeLabel renders nothing for 0, the number for 1-9, and 9+ above that", () => {
  assert.ok(launcher.includes("function attentionBadgeLabel(count: number | null | undefined): string | null {"));
  assert.ok(launcher.includes("if (typeof count !== \"number\" || count <= 0) return null;"));
  assert.ok(launcher.includes('return count > 9 ? "9+" : String(count);'));
});

// 10. badge is pointer-events-none
test("10. the badge span is pointer-events-none and aria-hidden", () => {
  const badgeStart = launcher.indexOf("badgeLabel ? (");
  const badgeBlock = launcher.slice(badgeStart, launcher.indexOf(") : null}", badgeStart));
  assert.ok(badgeBlock.includes('aria-hidden="true"'));
  assert.ok(badgeBlock.includes("pointer-events-none"));
});

// 11. badge does not replace launcher click/drag target
test("11. the launcher button's click/drag handlers are unchanged - the badge is an additional sibling span, not a wrapper", () => {
  assert.ok(launcher.includes("onClick={() => {"));
  assert.ok(launcher.includes("onPointerDown={(event) => {"));
  assert.ok(launcher.includes("onPointerMove={(event) => {"));
  assert.ok(launcher.includes("onPointerUp={(event) => {"));
  // The badge span comes AFTER the avatar span, inside the same <button>, never wrapping it.
  const avatarSpanEnd = launcher.indexOf("</span>", launcher.indexOf("<NoaAvatar floatEnabled={floatEnabled}"));
  const badgeIndex = launcher.indexOf("badgeLabel ? (");
  assert.ok(avatarSpanEnd > -1 && badgeIndex > avatarSpanEnd);
});

// 12. Needs attention starter exists
test("12. a Needs attention starter exists", () => {
  assert.ok(messages.includes('{ label: "Needs attention", prompt: "what needs my attention" }'));
});

// 13. starter sends exact: what needs my attention
test("13. the starter's outgoing prompt is exactly \"what needs my attention\"", () => {
  assert.match(messages, /label: "Needs attention", prompt: "what needs my attention"/);
});

// 14. starter uses normal handleSend path
test("14. the starter is rendered through the same QUICK_PROMPTS -> onQuickPrompt path as every other starter - no separate Attention-only click handler", () => {
  assert.ok(messages.includes("onClick={() => onQuickPrompt(quickPrompt.prompt ?? `${NOA_DRAFT_STARTER_SIGNAL_PREFIX}${quickPrompt.draft ?? \"\"}`)}"));
  assert.ok(!/onQuickPrompt\(\s*["'`]what needs my attention["'`]\s*\)(?!.*quickPrompt)/.test(messages) || messages.includes("quickPrompt.prompt"));
});

// 15. no synthetic hidden chat message on mount
test("15. no automatic/synthetic Attention chat message is appended on mount", () => {
  const effectStart = assistant.indexOf("useEffect(() => {");
  const effectEnd = assistant.indexOf("}, [auth]);", effectStart);
  const effectBody = assistant.slice(effectStart, effectEnd);
  assert.ok(!effectBody.includes("setMessages"));
  assert.ok(!effectBody.includes("createMessage"));
});

// 16. no seen/read/dismiss persistence
test("16. no seen/read/dismissed/snooze/notification-history state exists", () => {
  for (const source of [assistant, launcher, attentionRoute]) {
    assert.ok(!/\b(seen|dismissed|snooze|lastCheckedAt|notificationHistory)\b/i.test(source));
  }
});

// 17. avatar/Sneak animation logic unchanged
test("17. Sneak/drag/animation logic is untouched - only additive badge markup was introduced", () => {
  assert.ok(launcher.includes("const DRAG_ACTIVATION_PX = 6;"));
  assert.ok(launcher.includes("const MODE_DRAG_THRESHOLD_PX = 38;"));
  assert.ok(launcher.includes('pose="sneak"'));
  assert.ok(launcher.includes("setDragOffset(isSneak ? Math.min(0, dx) : Math.max(0, dx));"));
});

// 18. mobile drawer/composer logic unchanged
test("18. the chat drawer/composer was not touched by this phase", () => {
  assert.ok(chatDrawer.includes("<NoaComposer disabled={isBusy} onSend={onSend} />"));
  assert.ok(!chatDrawer.includes("attentionCount"));
  assert.ok(!chatDrawer.includes("Attention"));
});

// 19. existing starters remain functional
test("19. the other 3 existing starters remain present and unchanged", () => {
  assert.ok(messages.includes('{ draft: "configure ", label: "Configure product" }'));
  assert.ok(messages.includes('{ label: "Pending quotations", prompt: "Show pending quotations" }'));
  assert.ok(messages.includes('{ label: "Active projects", prompt: "Show active projects" }'));
});

// 20. no schema/RLS change
test("20. the count endpoint reuses the capability's own existing auth gates - no new gate/RLS was added", () => {
  assert.ok(!/import\s*\{[^}]*require\w+/.test(attentionRoute));
  assert.ok(!attentionRoute.includes("createAdminClient"));
  assert.ok(attentionCapability.includes("await requireActiveUser();"));
});
