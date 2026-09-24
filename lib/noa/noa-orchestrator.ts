import "server-only";

import { classifyNoaRoute, describeNoaPageContext, greetingResponseText, NOA_CAPABILITY_SUMMARY_TEXT, recordedQuotationFollowUpReference } from "@/lib/noa/noa-intent-router";
import { fetchNoaAdminCapability } from "@/lib/noa/noa-admin-capability.server";
import { fetchNoaClientCapability } from "@/lib/noa/noa-client-capability.server";
import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";
import { fetchNoaPriceCapability } from "@/lib/noa/noa-price-capability.server";
import { fetchNoaProcurementCapability } from "@/lib/noa/noa-procurement-capability.server";
import { fetchNoaProductCapability } from "@/lib/noa/noa-product-capability.server";
import { fetchNoaProjectCapability } from "@/lib/noa/noa-project-capability.server";
import { fetchNoaQuotationCapability } from "@/lib/noa/noa-quotation-capability.server";
import { fetchNoaUserActivityCapability } from "@/lib/noa/noa-user-activity-capability.server";
import type { NoaAnswer, NoaChatRequest } from "@/lib/noa/noa-types";
import { runNoaProvider } from "@/lib/noa/noa-provider.server";

// Conversation polish: a short clarification for an unclear/off-topic request - NOT a capability
// list. The capability list is shown only for the separate, explicit "capabilities" route above
// (NOA_CAPABILITY_SUMMARY_TEXT); repeating it here on every unclear message was the stale,
// stiff-feeling fallback this replaces.
const HELP_ANSWER_TEXT =
  "I'm not sure what you'd like me to check. Try asking about a product, quotation, project, activity, or another ProjectWorkflow area.";

// The one and only dispatch point: classify -> call exactly one capability -> (optionally) phrase
// the result with the provider. No capability ever calls another, and the model never picks which
// capability or query runs - that's fully deterministic, in code, before the provider is invoked.
export async function runNoaOrchestrator(request: NoaChatRequest): Promise<NoaAnswer> {
  const recordedQuotationFollowUpFrom = recordedQuotationFollowUpReference(request.message, request.recentMessages ?? []);
  const route = recordedQuotationFollowUpFrom ? "UserActivity" : classifyNoaRoute(request.message, request.context);

  // NOA self/page-context questions ("where am I", "which page is this") are answered directly
  // from NoaPageContext - never a capability call, never the AI provider. Not exposed as a
  // user-facing domain (PART 1): the badge shown is the existing Help domain.
  if (route === "context") {
    return { domain: "Help", sources: [], text: describeNoaPageContext(request.context) };
  }

  // Conversation polish: a pure greeting gets a short, personalized reply - never a capability
  // call, never the AI provider (same "fixed, fast, no model call" pattern as "context"/Help).
  if (route === "greeting") {
    return { domain: "Help", sources: [], text: greetingResponseText(request.message, request.displayName) };
  }

  // Conversation polish: NOA's capability list is shown ONLY for this explicit route, never on
  // every Help/out-of-scope fallback.
  if (route === "capabilities") {
    return { domain: "Help", sources: [], text: NOA_CAPABILITY_SUMMARY_TEXT };
  }

  // Help/out-of-scope never reaches a capability or the AI provider at all - it's a fixed,
  // deterministic redirect back to what NOA can actually do.
  if (route === "Help") {
    return { domain: "Help", sources: [], text: HELP_ANSWER_TEXT };
  }

  const domain = route;

  const capabilityResult = domain === "Product"
    ? await fetchNoaProductCapability(request.message, request.context)
    : domain === "Quotation"
      ? await fetchNoaQuotationCapability(request.message, request.context)
      : domain === "Project"
        ? await fetchNoaProjectCapability(request.message, request.context)
        : domain === "Client"
          ? await fetchNoaClientCapability(request.message, request.context)
          : domain === "Procurement"
            ? await fetchNoaProcurementCapability(request.message, request.context)
            : domain === "UserActivity"
              ? await fetchNoaUserActivityCapability(request.message, request.context, { recordedQuotationFollowUpFrom: recordedQuotationFollowUpFrom ?? undefined })
              : domain === "Admin"
                ? await fetchNoaAdminCapability(request.message, request.context)
                : domain === "Insights"
                  ? await fetchNoaInsightsCapability(request.message, request.context)
                  : await fetchNoaPriceCapability(request.message, request.context);

  if (!capabilityResult.ok) {
    // Unauthorized / not-found / ambiguous: return the capability's own safe copy directly,
    // without spending a provider call on something the model can't help with anyway.
    return { domain, sources: [], text: capabilityResult.message };
  }

  const deterministicData = typeof capabilityResult.data === "object" && capabilityResult.data !== null
    ? capabilityResult.data as { deterministicOnly?: unknown; deterministicText?: unknown }
    : null;
  if (deterministicData?.deterministicOnly === true && typeof deterministicData.deterministicText === "string") {
    return { domain, sources: capabilityResult.sources, text: deterministicData.deterministicText };
  }

  try {
    const { text } = await runNoaProvider({
      capabilityData: capabilityResult.data,
      context: request.context,
      displayName: request.displayName,
      domain,
      message: request.message,
      recentMessages: request.recentMessages ?? [],
    });
    return { domain, sources: capabilityResult.sources, text };
  } catch (error) {
    const deterministicText = typeof capabilityResult.data === "object" && capabilityResult.data !== null
      && "deterministicText" in capabilityResult.data && typeof capabilityResult.data.deterministicText === "string"
      ? capabilityResult.data.deterministicText.trim()
      : "";
    if (deterministicText) return { domain, sources: capabilityResult.sources, text: deterministicText };
    throw error;
  }
}
