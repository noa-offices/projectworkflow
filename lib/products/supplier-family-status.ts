import { resolveApplicableSupplierSourceVersion, upcomingSupplierSourceVersions, type SupplierFamilyReviewFact } from "./supplier-price-repository";

// One shared Family price-status resolver. Pure: callers load the batched inputs once (coverage, Source Versions, Phase 2A-0 facts)
// and every consumer (Price Updates, Product Library, Local Builder, Templates) gets the same answer. No database access here.

export type SupplierFamilyPriceStatusKey = "needs_attention" | "update_available" | "in_review" | "ready_to_complete" | "price_checked" | "partially_checked" | "no_price_list" | "legacy_manual";
/** Highest priority first. The first matching status across a Family's responsibilities is the one shown. */
export const supplierFamilyStatusPrecedence: SupplierFamilyPriceStatusKey[] = ["needs_attention", "update_available", "in_review", "ready_to_complete", "partially_checked", "price_checked", "no_price_list", "legacy_manual"];
/** The one user-facing label set. UI components read these; they never derive status themselves. */
export const supplierFamilyStatusLabels: Record<SupplierFamilyPriceStatusKey, string> = {
  needs_attention: "Needs attention", update_available: "Price update available", in_review: "In review", ready_to_complete: "Ready to complete",
  price_checked: "Price checked", partially_checked: "Partially checked", no_price_list: "No current price list", legacy_manual: "Manual price check",
};
export type SupplierVersionRef = { id: string; title: string; status: string; effective_from: string | null; created_at: string };
/** A Source Definition responsible for a Family, with that definition's Source Versions (any status; the resolver filters). */
export type SupplierResponsibilityInput = { templateId: string; definitionId: string; definitionName: string; versions: SupplierVersionRef[] };
export type SupplierFamilyPriceStatus = {
  familyId: string;
  brandId: string;
  status: SupplierFamilyPriceStatusKey;
  label: string;
  source?: { definitionId: string; definitionName: string; sourceId: string; title: string; effectiveFrom: string | null };
  upcoming?: { sourceId: string; title: string; effectiveFrom: string };
  progress?: { checked: number; total: number; excluded: number; unresolved: number };
  /** Not provided: the completion stores no pricing version per Family, so this cannot be proven safely at Family level. */
  editedSinceCheck?: boolean;
  detail: string;
};
export type SupplierBrandPriceState = "needs_attention" | "partially_checked" | "update_available" | "in_review" | "ready_to_complete" | "current" | "legacy_manual";
export type SupplierBrandPriceStatus = {
  applicableFamilies: number; checkedFamilies: number; partiallyCheckedFamilies: number; needsAttentionFamilies: number; updateAvailableFamilies: number;
  inReviewFamilies: number; readyToCompleteFamilies: number; noPriceListFamilies: number; legacyFamilies: number; upcomingCount: number;
  state: SupplierBrandPriceState;
};
type ResponsibilityState = { status: SupplierFamilyPriceStatusKey; source?: SupplierFamilyPriceStatus["source"]; upcoming?: SupplierVersionRef; progress?: SupplierFamilyPriceStatus["progress"]; detail: string };

function latestCompleted(facts: SupplierFamilyReviewFact[]) {
  return [...facts].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.batchId.localeCompare(a.batchId))[0];
}
/** Status of one responsibility (one Source Definition for one Family), from the applicable Source Version only. */
function responsibilityState(responsibility: SupplierResponsibilityInput, facts: SupplierFamilyReviewFact[], businessDate: string): ResponsibilityState {
  const applicable = resolveApplicableSupplierSourceVersion(responsibility.versions, businessDate);
  const upcoming = upcomingSupplierSourceVersions(responsibility.versions, businessDate)[0];
  const sourceRef = applicable ? { definitionId: responsibility.definitionId, definitionName: responsibility.definitionName, sourceId: applicable.id, title: applicable.title, effectiveFrom: applicable.effective_from } : undefined;
  if (!applicable) {
    return { status: "no_price_list", upcoming, detail: upcoming ? `upcoming list effective ${upcoming.effective_from}; no current list yet` : "no current price list" };
  }
  const forVersion = facts.filter((fact) => fact.templateId === responsibility.templateId && fact.sourceId === applicable.id);
  const completed = latestCompleted(forVersion.filter((fact) => fact.batchStatus === "completed"));
  if (completed) {
    const progress = { checked: completed.resolvedTargets, total: completed.totalTargets, excluded: completed.excludedTargets, unresolved: 0 };
    if (completed.fullyChecked) return { status: "price_checked", source: sourceRef, upcoming, progress, detail: `${applicable.title}: all ${completed.totalTargets} pricing targets checked` };
    if (completed.partiallyChecked) return { status: "partially_checked", source: sourceRef, upcoming, progress, detail: `${applicable.title}: ${completed.resolvedTargets} of ${completed.totalTargets} pricing targets checked · ${completed.excludedTargets} excluded from Supplier source` };
    return { status: "update_available", source: sourceRef, upcoming, detail: `${applicable.title}: the completed review checked no pricing targets for this Family` };
  }
  const open = [...forVersion.filter((fact) => fact.batchStatus === "matching" || fact.batchStatus === "review")].sort((a, b) => b.totalTargets - a.totalTargets || a.batchId.localeCompare(b.batchId))[0];
  if (open) {
    const progress = { checked: open.resolvedTargets, total: open.totalTargets, excluded: open.excludedTargets, unresolved: open.unresolvedTargets };
    if (!open.hasReviewEvidence) return { status: "update_available", source: sourceRef, upcoming, detail: `${applicable.title}: not yet reviewed` };
    if (open.unresolvedTargets > 0) return { status: "needs_attention", source: sourceRef, upcoming, progress, detail: `${applicable.title}: ${open.unresolvedTargets} pricing targets need a decision` };
    if (open.batchStatus === "matching") return { status: "in_review", source: sourceRef, upcoming, progress, detail: `${applicable.title}: comparison in progress` };
    return { status: "ready_to_complete", source: sourceRef, upcoming, progress, detail: `${applicable.title}: review resolved, not completed yet` };
  }
  return { status: "update_available", source: sourceRef, upcoming, detail: `${applicable.title}: not yet reviewed` };
}

/**
 * One status per active Family. Families with no Supplier responsibility get legacy_manual with the caller's legacy detail
 * (productTemplatePriceCheckState output, computed once by the caller). Families covered by several definitions show the worst
 * responsibility by precedence; every responsibility stays visible in the detail. Nothing here is inferred from UI text.
 */
export function resolveSupplierFamilyPriceStatus(input: {
  businessDate: string;
  families: Array<{ templateId: string; brandId: string }>;
  responsibilities: SupplierResponsibilityInput[];
  facts: SupplierFamilyReviewFact[];
  legacyDetail?: (templateId: string) => string;
}): SupplierFamilyPriceStatus[] {
  return input.families.map((family) => {
    const responsibilities = input.responsibilities.filter((item) => item.templateId === family.templateId).sort((a, b) => a.definitionName.localeCompare(b.definitionName) || a.definitionId.localeCompare(b.definitionId));
    if (responsibilities.length === 0) {
      return { familyId: family.templateId, brandId: family.brandId, status: "legacy_manual", label: supplierFamilyStatusLabels.legacy_manual, detail: input.legacyDetail?.(family.templateId) ?? "Manual price check" };
    }
    const states = responsibilities.map((responsibility) => ({ responsibility, state: responsibilityState(responsibility, input.facts, input.businessDate) }));
    const worst = [...states].sort((a, b) => supplierFamilyStatusPrecedence.indexOf(a.state.status) - supplierFamilyStatusPrecedence.indexOf(b.state.status))[0];
    const upcomings = states.flatMap(({ state }) => state.upcoming ? [state.upcoming] : []).sort((a, b) => (a.effective_from ?? "").localeCompare(b.effective_from ?? ""));
    const upcoming = upcomings[0] ? { sourceId: upcomings[0].id, title: upcomings[0].title, effectiveFrom: upcomings[0].effective_from ?? "" } : undefined;
    return {
      familyId: family.templateId, brandId: family.brandId, status: worst.state.status, label: supplierFamilyStatusLabels[worst.state.status],
      source: worst.state.source, upcoming, progress: worst.state.progress,
      detail: states.map(({ responsibility, state }) => `${responsibility.definitionName}: ${state.detail}`).join(" · "),
    };
  });
}

/**
 * Brand summary over the resolved Family statuses. The denominator is Families with Supplier coverage and a current applicable
 * version. No-price-list Families and legacy Families are counted separately and never raise the checked share.
 */
export function resolveSupplierBrandPriceStatus(statuses: Array<Pick<SupplierFamilyPriceStatus, "status">>, upcomingCount = 0): SupplierBrandPriceStatus {
  const count = (key: SupplierFamilyPriceStatusKey) => statuses.filter((item) => item.status === key).length;
  const checked = count("price_checked"), partial = count("partially_checked"), needs = count("needs_attention"), update = count("update_available"), inReview = count("in_review"), ready = count("ready_to_complete"), noList = count("no_price_list"), legacy = count("legacy_manual");
  const applicable = checked + partial + needs + update + inReview + ready;
  let state: SupplierBrandPriceState;
  if (applicable === 0) state = "legacy_manual";
  else if (needs > 0) state = "needs_attention";
  else if (checked + partial > 0 && checked < applicable) state = "partially_checked";
  else if (update > 0) state = "update_available";
  else if (inReview > 0) state = "in_review";
  else if (ready > 0) state = "ready_to_complete";
  else state = "current";
  return { applicableFamilies: applicable, checkedFamilies: checked, partiallyCheckedFamilies: partial, needsAttentionFamilies: needs, updateAvailableFamilies: update, inReviewFamilies: inReview, readyToCompleteFamilies: ready, noPriceListFamilies: noList, legacyFamilies: legacy, upcomingCount, state };
}
