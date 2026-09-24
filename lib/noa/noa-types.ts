// Pure, dependency-free NOA types shared by the assistant UI and its page-context/state-machine
// helpers. Kept alias-free (no "@/..." imports) so lib/noa/noa-state-machine.ts and
// lib/noa/use-noa-page-context.ts can be unit tested with the plain Node test runner.
//
// C3: NoaConversationReference is defined in its own file and imported here type-only. That file
// itself imports NoaDomain from this one, also type-only - a type-only circular reference is
// fully erased at compile time (no runtime cycle), the same safe pattern TypeScript projects use
// whenever two small type modules reference each other.
import type { NoaConversationReference } from "./noa-conversation-reference";

export type NoaVisualState =
  | "idle"
  | "hover"
  | "open"
  | "thinking"
  | "responding"
  | "success"
  | "error";

export type NoaMessageRole = "user" | "assistant";

export type NoaMessage = {
  createdAt: number;
  // Set only on assistant replies once a real backend answer arrives (Phase 1B) - user messages
  // never carry these.
  domain?: NoaDomain;
  id: string;
  role: NoaMessageRole;
  sources?: NoaSource[];
  text: string;
};

// Phase 1A only needs enough to gate visibility and (later) pass along to a real backend -
// appRole is kept as a plain string here (rather than importing the app's AppRole type) so this
// module stays alias-free; callers can pass the real AppRole value in, since it's string-based.
export type NoaAuthContext = {
  appRole: string | null;
  displayName: string;
  userId: string;
};

export type NoaPageSection =
  | "dashboard"
  | "projects"
  | "products"
  | "quotations"
  | "procurement"
  | "insights"
  | "system"
  | "other";

export type NoaPageContext = {
  brandId?: string;
  pathname: string;
  productTemplateId?: string;
  projectId?: string;
  quotationId?: string;
  section: NoaPageSection;
};

// Phase 1B backend types - still alias-free/pure, so lib/noa/noa-intent-router.ts (and any other
// pure NOA helper) can depend on them and stay unit testable.

export type NoaDomain = "Product" | "Quotation" | "Price" | "Project" | "Client" | "Procurement" | "UserActivity" | "Admin" | "Insights" | "Help";

export type NoaSource = {
  label: string;
  recordId?: string;
  type: string;
};

export type NoaAnswer = {
  domain: NoaDomain;
  sources: NoaSource[];
  text: string;
  // C3: the fresh, bounded reference to THIS result (UserActivity only today) - the caller
  // round-trips it verbatim on the next request so a short follow-up ("which quotation?", "what
  // about yesterday?") can be resolved without parsing prose. Omitted (not merged/accumulated)
  // whenever this result has no useful reference, so the client always replaces its stored
  // reference with exactly what the server returns.
  conversationReference?: NoaConversationReference;
};

export type NoaChatRequest = {
  context: NoaPageContext;
  // C3: the caller's own previously-returned conversationReference, round-tripped verbatim - see
  // NoaAnswer.conversationReference. Untrusted input: validated with isNoaConversationReference()
  // before use, never assumed well-formed.
  conversationReference?: NoaConversationReference;
  // Conversation polish: the caller's own safe display name (profiles.full_name), used only for
  // occasional personalization (greetings, provider tone) - optional since callers/tests that
  // don't have it yet must keep working unchanged.
  displayName?: string;
  message: string;
  recentMessages?: Array<{ role: NoaMessageRole; text: string }>;
};

// Internal routing result, richer than the public NoaDomain shown to users: covers self/page-
// context questions, plus (conversation polish) casual greetings and explicit "what can you do"
// capability questions. None of "context"/"greeting"/"capabilities" is ever exposed as a
// user-facing domain badge - all three resolve to the Help domain in the final NoaAnswer. Kept
// alias-free like the rest of this file.
// B5: Procurement is now a real NoaDomain rather than a placeholder unsupported-domain route,
// mirroring exactly how Project and Client were each promoted the same way in earlier phases.
export type NoaRouteKind = NoaDomain | "context" | "greeting" | "capabilities";

// Shared result shape every NOA capability function returns: either the allow-listed data it
// fetched (already scoped to what the current user is authorized to see) plus the source
// descriptors to surface, or a safe reason the request could not be fulfilled - never a raw
// error/exception, so the orchestrator/route never has to guess what happened.
export type NoaCapabilityResult =
  | { data: unknown; ok: true; sources: NoaSource[] }
  | { message: string; ok: false; reason: "unauthorized" | "not_found" | "ambiguous" };
