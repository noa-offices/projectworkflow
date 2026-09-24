import "server-only";

import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import type { NoaPageContext } from "@/lib/noa/noa-types";
import { isNoaSemanticRequest, UNCLEAR_SEMANTIC_REQUEST, type NoaSemanticRequest } from "@/lib/noa/noa-semantic-request";

// C1: understands language only. This module never authorizes anything, never queries a database,
// and never sees business data - it turns one rough English message into the small closed
// NoaSemanticRequest shape and nothing else. No capability wiring, no routing change: nothing in
// today's NOA request flow calls this yet (that's C2+).
//
// Reuses the existing single NOA provider/runtime exactly as lib/noa/noa-provider.server.ts does
// (resolveAiAgentRuntimeConfig("noa_orchestrator") + runAiProvider()) - no second registry agent,
// no second provider architecture, per the reviewed C1 architecture plan.

const TIMEOUT_MS = 10_000;

// Deliberately tiny: no ProjectWorkflow schema dump, no long examples, no business vocabulary -
// just enough for the model to place a message into the closed enums below.
const SYSTEM_INSTRUCTIONS = `You classify one ProjectWorkflow chat message into a small structured intent. You do not answer the question, compute facts, decide access, or invent a name/count/ID not present in the message. Output only the schema fields.
domain: the ProjectWorkflow area the message is about, or "Unclear" if none of the listed areas fit.
intent: "recorded_activity" for what-did-I/they-work-on questions, "activity_time" for how-long/duration/active-time questions, "recent_presence" for who-is-online/active-now questions, "follow_up" for a short reference back to a prior answer (e.g. "which one", "which quotation"), otherwise "unsupported".
subject: who the question is about - self (I/me/my), named_user (give the exact name as written), or team (asking about other people in general, e.g. "who is online").
period: today/yesterday/this_week/last_7_days/this_month only if a time period is actually mentioned.
entityReference: only for a follow-up referring back to something already discussed - type (e.g. "quotation") and fromPreviousResult true.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["domain", "intent"],
  properties: {
    domain: {
      type: "string",
      enum: ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Help", "Unclear"],
    },
    intent: {
      type: "string",
      enum: ["recorded_activity", "activity_time", "recent_presence", "follow_up", "unsupported"],
    },
    subject: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["self", "named_user", "team"] },
        name: { type: "string", maxLength: 80 },
      },
    },
    period: {
      type: "string",
      enum: ["today", "yesterday", "this_week", "last_7_days", "this_month"],
    },
    entityReference: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string", maxLength: 40 },
        value: { type: "string", maxLength: 80 },
        fromPreviousResult: { type: "boolean" },
      },
    },
    metric: { type: "string", maxLength: 40 },
    followUp: { type: "boolean" },
  },
} as const;

export type NoaIntentExtractorInput = {
  context: NoaPageContext;
  message: string;
};

// Cost control (PART 7): only the current message and a compact page-context hint are ever sent -
// never the conversation transcript, never already-fetched capability results, never database
// rows/profile lists/business entities. Any extraction failure (disabled/not configured, provider
// error, timeout, malformed or off-schema JSON) degrades to UNCLEAR_SEMANTIC_REQUEST - extraction
// uncertainty is never surfaced as an answer-generation error; the caller decides what to do with
// an Unclear result.
export async function extractNoaSemanticRequest(input: NoaIntentExtractorInput): Promise<NoaSemanticRequest> {
  const runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");

  if (!runtime.enabled || !runtime.apiKeyConfigured) {
    return UNCLEAR_SEMANTIC_REQUEST;
  }

  try {
    const response = await runAiProvider({
      model: runtime.model,
      provider: runtime.provider,
      responseSchema: { name: "noa_semantic_request", schema },
      systemInstructions: SYSTEM_INSTRUCTIONS,
      timeoutMs: TIMEOUT_MS,
      userContent: {
        message: input.message,
        pageContext: { section: input.context.section },
      },
    });

    const parsed: unknown = response.text ? JSON.parse(response.text) : null;
    return isNoaSemanticRequest(parsed) ? parsed : UNCLEAR_SEMANTIC_REQUEST;
  } catch {
    // Provider errors, timeouts, and JSON.parse failures are all treated identically here -
    // none of them are worth distinguishing for a classification-only call with a safe fallback.
    return UNCLEAR_SEMANTIC_REQUEST;
  }
}
