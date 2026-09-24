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
          float+breathe, idle glow pulse, thinking ring, the one-shot success pulse, the one-shot
          greet wiggle, the ambient halo pulse, and the sparse peek-mode attention blip. Respects
          prefers-reduced-motion by disabling motion while keeping the state glow colors. */}
      <style>{`
        /* Float now also carries a very small scale "breathe" in the same transform timeline
           (never a second animation stacked on the same element/property - see noa-avatar.tsx's
           own comment on why the one-shot greet wiggle instead lives on a CHILD element). */
        @keyframes noa-float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.015); } }
        @keyframes noa-idle-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
        @keyframes noa-thinking-ring { 0% { transform: rotate(0deg); opacity: 0.65; } 50% { opacity: 1; } 100% { transform: rotate(360deg); opacity: 0.65; } }
        @keyframes noa-success-pulse { 0% { transform: scale(1); opacity: 0.85; } 100% { transform: scale(1.6); opacity: 0; } }
        /* One-shot "hello" wiggle - plays once whenever noa-avatar.tsx's "greet" prop turns true;
           its own 100% keyframe already returns to rotate(0deg), the same as unanimated rest. */
        @keyframes noa-greet { 0% { transform: rotate(0deg); } 15% { transform: rotate(-7deg); } 35% { transform: rotate(5deg); } 55% { transform: rotate(-3deg); } 75% { transform: rotate(2deg); } 100% { transform: rotate(0deg); } }
        /* Large, slow ambient-halo breathing behind the character (PART 1 "soft light" feel). */
        @keyframes noa-ambient-pulse { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.06); } }
        /* PART 3 "occasional attention" for the peek launcher - almost entirely dormant across a
           9s cycle, one brief soft blip near the end. Deliberately sparse, never a constant loop. */
        @keyframes noa-peek-attention { 0%, 88%, 100% { opacity: 0; transform: scale(0.85); } 94% { opacity: 0.8; transform: scale(1.12); } }
        .noa-anim-float { animation: noa-float 3.4s ease-in-out infinite; }
        .noa-anim-idle-pulse { animation: noa-idle-pulse 3.2s ease-in-out infinite; }
        .noa-anim-thinking-ring { animation: noa-thinking-ring 1.6s linear infinite; }
        .noa-anim-success-pulse { animation: noa-success-pulse 0.6s ease-out; }
        .noa-anim-greet { animation: noa-greet 1.4s ease-in-out 1; transform-origin: 50% 85%; }
        .noa-anim-ambient-pulse { animation: noa-ambient-pulse 4.5s ease-in-out infinite; }
        .noa-anim-peek-attention { animation: noa-peek-attention 9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .noa-anim-float, .noa-anim-idle-pulse, .noa-anim-thinking-ring, .noa-anim-success-pulse,
          .noa-anim-greet, .noa-anim-ambient-pulse, .noa-anim-peek-attention {
            animation: none !important;
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
