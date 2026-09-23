import "server-only";

import { classifyNoaRoute, describeNoaPageContext, greetingResponseText, NOA_CAPABILITY_SUMMARY_TEXT } from "@/lib/noa/noa-intent-router";
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

const HELP_ANSWER_TEXT =
  "I'm NOA, the ProjectWorkflow assistant. I can help with products, quotations, pricing, projects, procurement, and using ProjectWorkflow.";

// The one and only dispatch point: classify -> call exactly one capability -> (optionally) phrase
// the result with the provider. No capability ever calls another, and the model never picks which
// capability or query runs - that's fully deterministic, in code, before the provider is invoked.
export async function runNoaOrchestrator(request: NoaChatRequest): Promise<NoaAnswer> {
  const route = classifyNoaRoute(request.message, request.context);

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
              ? await fetchNoaUserActivityCapability(request.message, request.context)
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

  const { text } = await runNoaProvider({
    capabilityData: capabilityResult.data,
    context: request.context,
    displayName: request.displayName,
    domain,
    message: request.message,
    recentMessages: request.recentMessages ?? [],
  });

  return { domain, sources: capabilityResult.sources, text };
}
