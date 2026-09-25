import "server-only";

import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import type { NoaPageContext } from "@/lib/noa/noa-types";
import { isNoaSemanticRequest, UNCLEAR_SEMANTIC_REQUEST, type NoaSemanticRequest } from "@/lib/noa/noa-semantic-request";
import {
  isNoaSemanticRequestV2,
  NOA_SEMANTIC_REQUEST_V2_SCHEMA,
  UNCLEAR_SEMANTIC_REQUEST_V2,
  validateNoaSemanticRequestV2AgainstMessage,
  validateSemanticPeriodAgainstMessage,
  type NoaSemanticRequestV2,
} from "@/lib/noa/noa-semantic-request";

// C1: understands language only. This module never authorizes anything, never queries a database,
// and never sees business data - it turns one rough English message into the small closed
// NoaSemanticRequest shape and nothing else. No capability wiring, no routing change: nothing in
// today's NOA request flow calls this yet (that's C2+).
//
// Reuses the existing single NOA provider/runtime exactly as lib/noa/noa-provider.server.ts does
// (resolveAiAgentRuntimeConfig("noa_orchestrator") + runAiProvider()) - no second registry agent,
// no second provider architecture, per the reviewed C1 architecture plan.

const TIMEOUT_MS = 10_000;
// I3 PART 22: V2 only - the classifier now sits on the live request path (flag-gated), so it gets
// a tighter budget than V1's unchanged TIMEOUT_MS above. A timeout degrades to "provider_error"
// and the deterministic route, never a user-visible error.
const V2_TIMEOUT_MS = 4_000;

// Deliberately tiny: no ProjectWorkflow schema dump, no long examples, no business vocabulary -
// just enough for the model to place a message into the closed enums below.
const SYSTEM_INSTRUCTIONS = `You classify one ProjectWorkflow chat message into a small structured intent. You do not answer the question, compute facts, decide access, or invent a name/count/ID not present in the message. Output only the schema fields.
domain: the ProjectWorkflow area the message is about, or "Unclear" if none of the listed areas fit.
intent: "recorded_activity" for what-did-I/they-work-on questions, "activity_time" for how-long/duration/active-time questions, "recent_presence" for who-is-online/active-now questions, "follow_up" for a short reference back to a prior answer (e.g. "which one", "which quotation"), otherwise "unsupported".
subject: who the question is about - self (I/me/my), named_user (give the exact name as written), or team (asking about other people in general, e.g. "who is online").
period: today/yesterday/this_week/last_7_days/this_month only if a time period is actually mentioned.
entityReference: only for a follow-up referring back to something already discussed - type (e.g. "quotation") and fromPreviousResult true.
For a Quotation request with a direct QN-... identifier, include quotation with the exact quotationNo and request: "detail", "total", or "status". QN-... identifiers are quotation numbers.
For a Product or Price request, include product with only candidate text explicitly present: productText, brandText, and/or categoryText. Do not supply IDs or facts.
For a likely Project File name/reference or client name, include entity with only the candidate text from the message. Use type "project_file" or "client" only as a hint when wording is explicit; otherwise use "unknown". Do not decide whether a candidate exists.`;

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
    quotation: {
      type: "object",
      additionalProperties: false,
      required: ["quotationNo", "request"],
      properties: {
        quotationNo: { type: "string", maxLength: 80 },
        request: { type: "string", enum: ["detail", "total", "status"] },
      },
    },
    product: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        productText: { type: "string", maxLength: 160 },
        brandText: { type: "string", maxLength: 160 },
        categoryText: { type: "string", maxLength: 160 },
      },
    },
    entity: {
      type: "object",
      additionalProperties: false,
      required: ["type", "text"],
      properties: {
        type: { type: "string", enum: ["unknown", "project_file", "client"] },
        text: { type: "string", maxLength: 160 },
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

// I1: V2 classifier instructions. Same spirit as V1's SYSTEM_INSTRUCTIONS above (teach semantic
// concepts, not a ProjectWorkflow schema dump or a list of phrases) but covering the wider V2
// vocabulary. Not used by any runtime caller yet - only extractNoaSemanticRequestV2() below calls
// this, and nothing in the orchestrator/router calls that function yet (I2/I3 do).
const SYSTEM_INSTRUCTIONS_V2 = `You classify one ProjectWorkflow chat message into a small structured intent. You do not answer the question, compute facts, decide access, or invent text not present in the message. Output only the schema fields, every field, using null where a slot does not apply.

domain: the ProjectWorkflow area the message is about, or "Unclear" if none fit.
intent: lookup (a specific thing), list, count, aggregate (a total/summary), rank (a "best/top/most" comparison across many), compare (two specific things), trend (over time), history (what changed/happened - Catch-Up), attention (things needing action), activity/activity_time/presence (what someone worked on / how long / who is online), howto (how do I...), or unsupported.
entityType/entityText: only when a specific candidate is named in the message. entityText must be copied verbatim from the message - never invented, never a database ID. For a Product list or lookup, keep the complete explicit search phrase together: retain a named brand and its adjacent product/category qualifier (for example, "Interstuhl chairs" or "LAS desks"), rather than returning the brand alone. A brand-only request remains brand-only.
reference: "previous_result" only for a short follow-up to something already discussed (e.g. "which one", "what about them"), "current_page" only when the message clearly means the thing currently on screen, otherwise "none".
metric/period/comparison/sortDirection: only when explicit or clearly implied; otherwise null.
For rankings across clients, use domain Client, intent rank, entityType client, and leave entityText null unless one client is explicitly named. Select quotation_count for how often clients are quoted, quotation_value for monetary quotation value, confirmed_value for confirmed business, and project_file_value for Project File value; otherwise request missing_metric rather than guessing.
Use Insights for analytical overviews, comparisons, trends, and rankings rather than a current-state entity lookup. Questions about changes, what happened, or catching up describe UserActivity with intent history, not a current-state Project or Quotation lookup.
subject/subjectName: subjectName only when subject is "named_user", and it must be the exact name as written in the message; null otherwise.
quotationStatus/projectFileStatus/priceStatus/procurementStatus/attentionKind: only when the message clearly asks about that specific status/kind.
needsClarification/clarificationReason: set true with the specific missing/ambiguous slot when the request is genuinely ambiguous - for example "who is our best client" is rank+client with no metric named, so metric is null, needsClarification is true, and clarificationReason is "missing_metric". Never guess a metric, entity, or period the user did not state or clearly imply.
If the message asks you to change, create, approve, or delete something, set clarificationReason to "action_requested" and do not treat it as a read intent.
Exact identifiers (quotation numbers, order numbers) are parsed elsewhere - never populate entityText with one.
confidence: "high" only when the classification is unambiguous; "low" otherwise.`;

export type NoaIntentExtractorV2Result = {
  request: NoaSemanticRequestV2;
  stage: "disabled" | "provider_error" | "invalid_json" | "schema_mismatch" | "grounding_failed" | "success";
};

// I1: additive V2 extractor - does NOT replace extractNoaSemanticRequest() above, and nothing in
// the orchestrator/router calls this yet (I2/I3 wire routing/activation). Same cost-control shape
// as V1: only the current message and a compact page-context hint are ever sent, never the
// conversation transcript, never database rows/business data. Any failure (disabled, provider
// error, timeout, malformed JSON, schema mismatch, or a grounding failure - the model naming
// entity/subject text that does not actually appear in the message) degrades to
// UNCLEAR_SEMANTIC_REQUEST_V2, mirroring V1's "extraction uncertainty is never an answer-generation
// error" rule exactly.
export async function extractNoaSemanticRequestV2(input: NoaIntentExtractorInput): Promise<NoaIntentExtractorV2Result> {
  const runtime = await resolveAiAgentRuntimeConfig("noa_orchestrator");

  if (!runtime.enabled || !runtime.apiKeyConfigured) {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "disabled" };
  }

  let responseText: string | undefined;
  try {
    const response = await runAiProvider({
      model: runtime.model,
      provider: runtime.provider,
      responseSchema: { name: "noa_semantic_request_v2", schema: NOA_SEMANTIC_REQUEST_V2_SCHEMA },
      systemInstructions: SYSTEM_INSTRUCTIONS_V2,
      timeoutMs: V2_TIMEOUT_MS,
      userContent: {
        message: input.message,
        pageContext: { section: input.context.section },
      },
    });
    responseText = response.text;
  } catch {
    // Covers a provider/network error, a timeout, AND a provider rejecting the schema itself
    // (I0.5: an OpenAI strict-schema rejection surfaces as an AiProviderError here) - all three
    // are "the provider call did not succeed", distinct from a successful call that returned
    // unparsable or off-schema text below.
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "provider_error" };
  }

  if (!responseText) {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "invalid_json" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "invalid_json" };
  }

  if (!isNoaSemanticRequestV2(parsed)) {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "schema_mismatch" };
  }

  if (!validateNoaSemanticRequestV2AgainstMessage(parsed, input.message)) {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "grounding_failed" };
  }

  // I8 GOAL A: an explicit-period safety net independent of the model's own needsClarification/
  // confidence - if the message names a specific, already-supported period and the model's period
  // doesn't match it (including leaving it null), treat this exactly like a grounding failure
  // rather than letting a downstream default (e.g. history's "no period -> today") silently answer
  // a different period than the one actually asked for.
  if (!validateSemanticPeriodAgainstMessage(input.message, parsed)) {
    return { request: UNCLEAR_SEMANTIC_REQUEST_V2, stage: "grounding_failed" };
  }

  return { request: parsed, stage: "success" };
}
