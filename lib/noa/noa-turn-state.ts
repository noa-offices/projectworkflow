import type { NoaAnswer, NoaChatRequest } from "./noa-types";
export const NOA_GREETING_TEXT =
  "Hi, I'm NOA 👋\nI can help you find and configure products, check quotations and pricing, review projects and procurement, and answer questions about ProjectWorkflow. I can also show you what needs attention.";

export const NOA_REQUEST_FAILED_TEXT = "I couldn't complete that request right now. Please try again.";
// Transport-only session identity; deliberately absent from the authoritative routing request.
export type NoaSessionChatRequest = NoaChatRequest & { sessionId?: string };
export type NoaSessionAnswer = NoaAnswer & { sessionId?: string };
export function noaSessionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : undefined;
}
export type NoaTurnState = Pick<NoaSessionChatRequest, "conversationReference" | "productConfigurationReference" | "sessionId">;
// Success replaces both references. Errors preserve both. Configuration passthrough belongs to the server.
export function applyNoaConversationTurnState(previous: NoaTurnState, answer?: NoaSessionAnswer): NoaTurnState {
  return answer ? { conversationReference: answer.conversationReference, productConfigurationReference: answer.productConfigurationReference,
    ...(noaSessionId(answer.sessionId) ? { sessionId: noaSessionId(answer.sessionId) } : {}),
  } : previous;
}
export function noaRecentMessages(messages: NonNullable<NoaChatRequest["recentMessages"]>) {
  return messages.slice(-6).map(({ role, text }) => ({ role, text }));
}
export function noaTurnErrorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : NOA_REQUEST_FAILED_TEXT;
}
