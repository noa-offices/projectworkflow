"use client";

import { useCallback, useRef, useState } from "react";
import { NoaChatDrawer } from "@/components/noa/noa-chat-drawer";
import { NoaLauncher } from "@/components/noa/noa-launcher";
import { NOA_DRAFT_STARTER_SIGNAL_PREFIX } from "@/components/noa/noa-messages";
import { classifyNoaIntent } from "@/lib/noa/noa-intent-router";
import type { NoaConversationReference } from "@/lib/noa/noa-conversation-reference";
import type { NoaProductConfigurationReference } from "@/lib/noa/noa-product-configuration-reference";
import { noaStateReducer, type NoaStateEvent } from "@/lib/noa/noa-state-machine";
import type {
  NoaAnswer,
  NoaAuthContext,
  NoaChoice,
  NoaDomain,
  NoaMessage,
  NoaSource,
  NoaVisualState,
} from "@/lib/noa/noa-types";
import { useNoaPageContext } from "@/lib/noa/use-noa-page-context";

const GREETING_TEXT =
  "Hi, I'm NOA 👋\nI can help you find and configure products, check quotations and pricing, review projects and procurement, and answer questions about ProjectWorkflow.";
// Home UX PART 5: the "Configure product" starter never sends this to the server (GPC requires
// "configure <product name>", which the starter alone can't supply) - it's shown locally, then the
// user's NEXT typed message is prefixed with the pending draft (see handleSend below).
const CONFIGURE_PRODUCT_GUIDANCE_TEXT = "Which product would you like to configure? Type the product name below.\nFor example: MONOLITH or EVERY.";
const REQUEST_FAILED_TEXT = "I couldn't complete that request right now. Please try again.";
const SETTLE_DELAY_MS = 900;
// Send only a small bounded slice of prior turns, never the entire session.
const RECENT_MESSAGE_LIMIT = 6;
const NOA_CHAT_ENDPOINT = "/api/noa/chat";

function createMessage(
  role: NoaMessage["role"],
  text: string,
  meta?: { choices?: NoaChoice[]; domain?: NoaDomain; sources?: NoaSource[] },
): NoaMessage {
  return {
    createdAt: Date.now(),
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    // GPC-3.1: only ever set for an assistant message, and only ever the server's own bounded
    // choices for THAT answer - never invented client-side, never carried over from a prior turn.
    ...(meta?.choices?.length ? { choices: meta.choices } : {}),
    ...(meta?.domain ? { domain: meta.domain } : {}),
    ...(meta?.sources?.length ? { sources: meta.sources } : {}),
  };
}

async function requestNoaAnswer(
  message: string,
  context: ReturnType<typeof useNoaPageContext>,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  conversationReference: NoaConversationReference | undefined,
  productConfigurationReference: NoaProductConfigurationReference | undefined,
): Promise<NoaAnswer> {
  const response = await fetch(NOA_CHAT_ENDPOINT, {
    body: JSON.stringify({ context, conversationReference, message, productConfigurationReference, recentMessages }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || REQUEST_FAILED_TEXT);
  }

  return response.json() as Promise<NoaAnswer>;
}

export function NoaAssistant({ auth }: { auth: NoaAuthContext | null }) {
  const [visualState, setVisualState] = useState<NoaVisualState>("idle");
  const [messages, setMessages] = useState<NoaMessage[]>(() => [createMessage("assistant", GREETING_TEXT)]);
  // Domain classified up front, before the request even goes out, purely so NoaStatus can show
  // "Checking Product Library..." instead of a generic "thinking" - reuses the same deterministic
  // classifier the backend uses for routing, never a second guess.
  const [pendingDomain, setPendingDomain] = useState<NoaDomain | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  // C3: the single, ephemeral reference to the immediately previous result - held only in memory
  // (a ref, not state, since it never needs to trigger a render on its own), replaced wholesale by
  // whatever the server returns after each successful reply, and cleared entirely on error. Never
  // persisted beyond this component instance.
  const conversationReferenceRef = useRef<NoaConversationReference | undefined>(undefined);
  // GPC-3: the same replace-wholesale-from-the-server pattern as conversationReferenceRef above,
  // held independently. Safe to always replace verbatim (never merge) because the ORCHESTRATOR is
  // responsible for re-attaching an active configuration reference to an ordinary, unrelated
  // answer's productConfigurationReference field when it should persist - the client stays a dumb
  // mirror of whatever the server last returned, exactly like conversationReferenceRef.
  const productConfigurationReferenceRef = useRef<NoaProductConfigurationReference | undefined>(undefined);
  // Home UX PART 5: set only by the "Configure product" starter (see handleSend's signal check
  // below), consumed by exactly the next real handleSend call, then cleared - never persisted
  // beyond that one message, never sent to the server on its own.
  const pendingConfigureDraftRef = useRef<string | null>(null);
  const pageContext = useNoaPageContext();

  const dispatch = useCallback((event: NoaStateEvent) => {
    setVisualState((current) => noaStateReducer(current, event));
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const scheduleSettle = useCallback(() => {
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "SETTLE" });
      settleTimerRef.current = null;
    }, SETTLE_DELAY_MS);
  }, [clearSettleTimer, dispatch]);

  const handleSend = useCallback((text: string) => {
    // Home UX PART 5: the "Configure product" starter's own click is never a chat turn - it just
    // arms the draft prefix and shows a local guidance message, no request, no busy state.
    if (text.startsWith(NOA_DRAFT_STARTER_SIGNAL_PREFIX)) {
      pendingConfigureDraftRef.current = text.slice(NOA_DRAFT_STARTER_SIGNAL_PREFIX.length);
      setMessages((current) => [...current, createMessage("assistant", CONFIGURE_PRODUCT_GUIDANCE_TEXT)]);
      return;
    }

    const typed = text.trim();
    if (!typed) return;

    // Consumed by exactly this one message, whatever the user typed - "configure " + "MONOLITH"
    // becomes the same "configure MONOLITH" GPC already knows how to start from, shown to the user
    // exactly as sent (never a hidden mismatch between the bubble and the outgoing request).
    const outgoing = pendingConfigureDraftRef.current ? `${pendingConfigureDraftRef.current}${typed}` : typed;
    pendingConfigureDraftRef.current = null;

    clearSettleTimer();

    const recentMessages = messages
      .slice(-RECENT_MESSAGE_LIMIT)
      .map((message) => ({ role: message.role, text: message.text }));

    setMessages((current) => [...current, createMessage("user", outgoing)]);
    setPendingDomain(classifyNoaIntent(outgoing, pageContext));
    dispatch({ type: "SEND" });

    requestNoaAnswer(outgoing, pageContext, recentMessages, conversationReferenceRef.current, productConfigurationReferenceRef.current)
      .then((answer) => {
        // Always replace, never merge/accumulate - a result with no reference of its own
        // (conversationReference undefined) correctly clears any stale one from before.
        conversationReferenceRef.current = answer.conversationReference;
        // Same replace-wholesale rule, but the server (not the client) decides when
        // undefined truly means "end/cancel configuration" vs. "an unrelated answer that should
        // leave an active configuration alone" - see noa-orchestrator.ts's passthrough handling.
        productConfigurationReferenceRef.current = answer.productConfigurationReference;
        setMessages((current) => [
          ...current,
          createMessage("assistant", answer.text, { choices: answer.choices, domain: answer.domain, sources: answer.sources }),
        ]);
        dispatch({ type: "RESPONSE_SUCCESS" });
      })
      .catch((error: unknown) => {
        // A failed request has nothing new to remember; the previous reference is left as-is
        // rather than guessed at.
        const errorText = error instanceof Error && error.message ? error.message : REQUEST_FAILED_TEXT;
        setMessages((current) => [...current, createMessage("assistant", errorText)]);
        dispatch({ type: "RESPONSE_ERROR" });
      })
      .finally(() => {
        setPendingDomain(null);
        scheduleSettle();
      });
  }, [clearSettleTimer, dispatch, messages, pageContext, scheduleSettle]);

  const isOpen = visualState !== "idle" && visualState !== "hover";

  const handleToggle = useCallback(() => {
    dispatch({ type: isOpen ? "CLOSE" : "OPEN" });
  }, [dispatch, isOpen]);

  const handleClose = useCallback(() => {
    dispatch({ type: "CLOSE" });
  }, [dispatch]);

  const handleHoverStart = useCallback(() => {
    dispatch({ type: "HOVER_START" });
  }, [dispatch]);

  const handleHoverEnd = useCallback(() => {
    dispatch({ type: "HOVER_END" });
  }, [dispatch]);

  if (!auth) {
    return null;
  }

  return (
    <>
      {/* Component-local keyframes only (no animation library, no globals.css edit): idle
          float+breathe, eye-light pulse, chest/logo pulse, two staggered occasional wing
          shimmers, thinking ring, the one-shot success pulse, the one-shot greet lean/bounce +
          eye brighten, and the sparse sneak-mode "curious peek" lean. Every cycle length below is
          deliberately different (PART 14 "slightly offset timing") so nothing peaks in sync.
          Respects prefers-reduced-motion by disabling all of it while keeping the state glow
          colors/Full-Sneak positioning static. Also carries the ONE non-keyframe rule this file
          needs: PART 18's hover-only reveal for the launcher's secondary Hide/Show control, which
          only applies on devices that actually have real hover + a fine pointer (a mouse) - on
          touch devices (no reliable hover) that control stays visible at its own base Tailwind
          opacity (set in noa-launcher.tsx) instead, so there's always a way to reach it. */}
      <style>{`
        /* Float carries a very small scale "breathe" in the same transform timeline (never a
           second animation stacked on the same element/property - see noa-avatar.tsx's own
           comment on why the one-shot greet motion instead lives on a CHILD element). Amplitude
           kept to 1-2px (PART 16) - alive, not bouncing. */
        @keyframes noa-float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2px) scale(1.008); } }
        /* Eye-light: slow, clearly-visible brightness change - no flashing. */
        @keyframes noa-idle-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.95; } }
        @keyframes noa-thinking-ring { 0% { transform: rotate(0deg); opacity: 0.65; } 50% { opacity: 1; } 100% { transform: rotate(360deg); opacity: 0.65; } }
        @keyframes noa-success-pulse { 0% { transform: scale(1); opacity: 0.85; } 100% { transform: scale(1.6); opacity: 0; } }
        /* One-shot "hello" - a tiny lateral lean + small upward bounce + a few degrees of
           rotation, plays once whenever noa-avatar.tsx's "greet" prop turns true. Its own 100%
           keyframe already returns to the unanimated resting transform. */
        @keyframes noa-greet { 0% { transform: translate(0, 0) rotate(0deg); } 20% { transform: translate(-2px, -3px) rotate(-3deg); } 45% { transform: translate(1px, -5px) rotate(2deg); } 70% { transform: translate(-1px, -1px) rotate(-1deg); } 100% { transform: translate(0, 0) rotate(0deg); } }
        /* Companion one-shot eye brighten, timed alongside the greet lean above (never combined
           with the continuous idle-pulse on the same element - see noa-avatar.tsx). */
        @keyframes noa-greet-eye { 0% { opacity: 0.6; transform: scale(1); } 40% { opacity: 1; transform: scale(1.25); } 100% { opacity: 0.6; transform: scale(1); } }
        /* Companion one-shot chest brighten, same timing family as the eye brighten above (never
           combined with the continuous chest-pulse on the same element). */
        @keyframes noa-greet-chest { 0% { opacity: 0.45; transform: scale(1); } 40% { opacity: 0.85; transform: scale(1.15); } 100% { opacity: 0.45; transform: scale(1); } }
        /* Chest/logo light: slower and weaker than the eye-light above. */
        @keyframes noa-chest-pulse { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }
        /* Wing/side shimmer (left + right, staggered cycle lengths per PART 14): dormant almost
           the entire cycle, one brief streak that travels a short distance and fades - never a
           continuous loop, never a spin/flap. */
        @keyframes noa-wing-shimmer { 0%, 88%, 100% { opacity: 0; transform: translateY(6px) scale(0.7); } 94% { opacity: 1; transform: translateY(-6px) scale(1.2); } }
        /* One-shot "both wings light up" flash, timed alongside the greet lean above (PART 15). */
        @keyframes noa-greet-wing { 0% { opacity: 0; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0; transform: scale(0.8); } }
        /* Sneak-mode "curious peek" (launcher only): the resting offset itself (5px, mostly
           hidden) with one brief, small lean toward fully-revealed - PART 17 "roughly every
           10-14 sec". Hover/focus overrides this entirely (see noa-launcher.tsx's group-hover/
           group-focus-within [animation:none]), never runs alongside the hover reveal. */
        @keyframes noa-sneak-lean { 0%, 92%, 100% { transform: translateX(5px); } 96% { transform: translateX(0); } }
        /* PART 9/10: layer-ready motion classes - only ever reached from noa-avatar.tsx's
           USE_LAYERED_NOA_AVATAR branch, which is false today (PART 6/8), so these never run in
           production yet. Bounded per PART 10/11: a small +/-3-5deg head tilt, a small one-shot
           arm rotation for the greeting - never a fake 3D rotation, never exaggerated. */
        @keyframes noa-layer-tilt { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes noa-layer-wave { 0% { transform: rotate(0deg); } 30% { transform: rotate(-8deg); } 60% { transform: rotate(4deg); } 100% { transform: rotate(0deg); } }
        .noa-anim-float { animation: noa-float 5s ease-in-out infinite; }
        .noa-anim-idle-pulse { animation: noa-idle-pulse 3.4s ease-in-out infinite; }
        .noa-anim-thinking-ring { animation: noa-thinking-ring 1.6s linear infinite; }
        .noa-anim-success-pulse { animation: noa-success-pulse 0.6s ease-out; }
        .noa-anim-greet { animation: noa-greet 1.05s ease-in-out 1; transform-origin: 50% 85%; }
        .noa-anim-greet-eye { animation: noa-greet-eye 1.1s ease-in-out 1; }
        .noa-anim-greet-chest { animation: noa-greet-chest 1.1s ease-in-out 1; }
        .noa-anim-greet-wing { animation: noa-greet-wing 1.1s ease-in-out 1; }
        .noa-anim-chest-pulse { animation: noa-chest-pulse 5s ease-in-out infinite; }
        .noa-anim-wing-shimmer-left { animation: noa-wing-shimmer 8s ease-in-out infinite; }
        .noa-anim-wing-shimmer-right { animation: noa-wing-shimmer 10.5s ease-in-out infinite; }
        .noa-anim-sneak-lean { animation: noa-sneak-lean 11s ease-in-out infinite; }
        .noa-anim-layer-tilt { animation: noa-layer-tilt 6s ease-in-out infinite; }
        .noa-anim-layer-wave { animation: noa-layer-wave 1.1s ease-in-out 1; transform-origin: 20% 15%; }
        @media (prefers-reduced-motion: reduce) {
          .noa-anim-float, .noa-anim-idle-pulse, .noa-anim-thinking-ring, .noa-anim-success-pulse,
          .noa-anim-greet, .noa-anim-greet-eye, .noa-anim-greet-chest, .noa-anim-greet-wing,
          .noa-anim-chest-pulse, .noa-anim-wing-shimmer-left, .noa-anim-wing-shimmer-right,
          .noa-anim-sneak-lean, .noa-anim-layer-tilt, .noa-anim-layer-wave {
            animation: none !important;
          }
          /* PART 21: Full/Sneak positioning itself still works without animation - the sneak
             crop's resting (mostly-hidden) offset is kept as a static transform. */
          .noa-anim-sneak-lean { transform: translateX(5px); }
        }
        /* PART 2/9/18: hover-only reveal for the secondary Hide/Show control, but ONLY on
           devices with real hover + a fine pointer - touch devices keep it at its own base
           opacity (see noa-launcher.tsx) since they have no hover to reveal it with. */
        @media (hover: hover) and (pointer: fine) {
          .noa-secondary-control { opacity: 0; pointer-events: none; }
          .group:hover .noa-secondary-control,
          .group:focus-within .noa-secondary-control {
            opacity: 1;
            pointer-events: auto;
          }
        }
      `}</style>
      <NoaLauncher
        onHoverEnd={handleHoverEnd}
        onHoverStart={handleHoverStart}
        onToggle={handleToggle}
        pageSection={pageContext.section}
        state={visualState}
      />
      <NoaChatDrawer
        isOpen={isOpen}
        messages={messages}
        onClose={handleClose}
        onSend={handleSend}
        pendingDomain={pendingDomain}
        state={visualState}
      />
    </>
  );
}
