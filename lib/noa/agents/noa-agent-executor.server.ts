import "server-only";
import type { NoaPageContext } from "../noa-types";
import { fetchNoaQuotationCapability } from "../noa-quotation-capability.server";
import { fetchNoaProjectCapability } from "../noa-project-capability.server";
import { fetchNoaClientCapability } from "../noa-client-capability.server";
import { fetchNoaProcurementCapability } from "../noa-procurement-capability.server";
import { fetchNoaProductCapability } from "../noa-product-capability.server";
import { fetchNoaPriceCapability } from "../noa-price-capability.server";
import { fetchNoaInsightsCapability } from "../noa-insights-capability.server";
import { fetchNoaAdminCapability } from "../noa-admin-capability.server";
import { fetchNoaUserActivityCapability } from "../noa-user-activity-capability.server";
import { executeAgentPlanWithAdapters, type NoaAgentAdapters } from "./noa-agent-executor-core";

// Same callable entry points as normal NOA dispatch. Every capability performs its
// existing auth/permission checks in the current server request. Scope is NOT permission.
// A1 contains resolved canonical messages; no conversation or semantic options are inferred.
const ADAPTERS: NoaAgentAdapters = Object.freeze({
  Quotation: fetchNoaQuotationCapability,
  Project: fetchNoaProjectCapability,
  Client: fetchNoaClientCapability,
  Procurement: fetchNoaProcurementCapability,
  Product: fetchNoaProductCapability,
  Price: fetchNoaPriceCapability,
  Insights: fetchNoaInsightsCapability,
  Admin: fetchNoaAdminCapability,
  UserActivity: fetchNoaUserActivityCapability,
});

// Dormant: no route, server action, client transport, or orchestrator activation.
// Invoke inside the existing authenticated request context. Never accept adapters from
// callers. Single-step plans use this same boundary; compose returns internal results only.
export function executeNoaAgentPlan(plan: unknown, context: NoaPageContext) {
  return executeAgentPlanWithAdapters(plan, context, ADAPTERS);
}
