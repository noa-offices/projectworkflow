"use client";

import { useCallback, useRef, useState } from "react";
import { NoaChatDrawer } from "@/components/noa/noa-chat-drawer";
import { NoaLauncher } from "@/components/noa/noa-launcher";
import { classifyNoaIntent } from "@/lib/noa/noa-intent-router";
import type { NoaConversationReference } from "@/lib/noa/noa-conversation-reference";
import { noaStateReducer, type NoaStateEvent } from "@/lib/noa/noa-state-machine";
import type {
  NoaAnswer,
  NoaAuthContext,
  NoaDomain,
  NoaMessage,
  NoaSource,
  NoaVisualState,
} from "@/lib/noa/noa-types";
import { useNoaPageContext } from "@/lib/noa/use-noa-page-context";

const GREETING_TEXT =
  "Hi, I'm NOA. I can help with ProjectWorkflow products, quotations, pricing, projects, procurement, and system guidance.";
const REQUEST_FAILED_TEXT = "I couldn't complete that request right now. Please try again.";
const SETTLE_DELAY_MS = 900;
// Send only a small bounded slice of prior turns, never the entire session.
const RECENT_MESSAGE_LIMIT = 6;
const NOA_CHAT_ENDPOINT = "/api/noa/chat";

function createMessage(
  role: NoaMessage["role"],
  text: string,
  meta?: { domain?: NoaDomain; sources?: NoaSource[] },
): NoaMessage {
  return {
    createdAt: Date.now(),
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    ...(meta?.domain ? { domain: meta.domain } : {}),
    ...(meta?.sources?.length ? { sources: meta.sources } : {}),
  };
}

async function requestNoaAnswer(
  message: string,
  context: ReturnType<typeof useNoaPageContext>,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  conversationReference: NoaConversationReference | undefined,
): Promise<NoaAnswer> {
  const response = await fetch(NOA_CHAT_ENDPOINT, {
    body: JSON.stringify({ context, conversationReference, message, recentMessages }),
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
    const trimmed = text.trim();
    if (!trimmed) return;

    clearSettleTimer();

    const recentMessages = messages
      .slice(-RECENT_MESSAGE_LIMIT)
      .map((message) => ({ role: message.role, text: message.text }));

    setMessages((current) => [...current, createMessage("user", trimmed)]);
    setPendingDomain(classifyNoaIntent(trimmed, pageContext));
    dispatch({ type: "SEND" });

    requestNoaAnswer(trimmed, pageContext, recentMessages, conversationReferenceRef.current)
      .then((answer) => {
        // Always replace, never merge/accumulate - a result with no reference of its own
        // (conversationReference undefined) correctly clears any stale one from before.
        conversationReferenceRef.current = answer.conversationReference;
        setMessages((current) => [
          ...current,
          createMessage("assistant", answer.text, { domain: answer.domain, sources: answer.sources }),
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
      {/* Component-local keyframes only (no animation library, no globals.css edit): idle float,
          idle glow pulse, thinking ring, and the one-shot success pulse. Respects
          prefers-reduced-motion by disabling motion while keeping the state glow colors. */}
      <style>{`
        @keyframes noa-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes noa-idle-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
        @keyframes noa-thinking-ring { 0% { transform: rotate(0deg); opacity: 0.65; } 50% { opacity: 1; } 100% { transform: rotate(360deg); opacity: 0.65; } }
        @keyframes noa-success-pulse { 0% { transform: scale(1); opacity: 0.85; } 100% { transform: scale(1.6); opacity: 0; } }
        .noa-anim-float { animation: noa-float 3.4s ease-in-out infinite; }
        .noa-anim-idle-pulse { animation: noa-idle-pulse 3.2s ease-in-out infinite; }
        .noa-anim-thinking-ring { animation: noa-thinking-ring 1.6s linear infinite; }
        .noa-anim-success-pulse { animation: noa-success-pulse 0.6s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .noa-anim-float, .noa-anim-idle-pulse, .noa-anim-thinking-ring, .noa-anim-success-pulse {
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
