import "server-only";
import { requireQuotationActionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { validateNoaRelationSource, type NoaRelationId, type NoaRelationValidationErrorReason } from "./noa-relation-registry";
import {
  createNoaResultSetHandle, isNoaResultSet, MAX_NOA_RESULT_SET_ITEMS, NOA_QUOTATION_SCOPE_STATUSES,
  type NoaQuotationScopeStatus, type NoaResultSet, type NoaResultSetHandle,
} from "./noa-result-set";
import type { NoaConversationState } from "./noa-conversation-state";

// Phase 1D PART 3/6/8: deterministic, provider-neutral relation/drill-down operations for Phase
// 2's Semantic Planner to invoke later. No natural-language message reaches this file yet (PART
// 12) - it is never imported by the prerouter, intent router, semantic resolver or follow-up
// binder. Session ResultSet identifiers are hints only (PART 6): every operation here re-fetches
// through the SAME authorized Supabase client / auth gate the existing Quotation capability uses
// (requireQuotationActionUser, never a service-role client) - a stale or tampered handle/id can
// only ever surface what the CURRENT user is genuinely authorized to see, exactly like every
// other NOA capability. Only identifiers (project_file orderNo / quotation uuid) are ever stored;
// no name, price, amount or prose crosses into a returned ResultSet.

export type NoaRelationErrorReason = NoaRelationValidationErrorReason | "unauthorized" | "storage_error";

export type NoaRelationSuccess = {
  ok: true;
  resultSet: NoaResultSet;
  // PART 5: metadata for a future renderer/planner - never persisted as business prose.
  sourceCount: number;
  matchedCount: number;
  resultCount: number;
};
export type NoaRelationResult = NoaRelationSuccess | { ok: false; reason: NoaRelationErrorReason };

function isNextRedirectError(error: unknown): boolean {
  return error instanceof Error && "digest" in error &&
    typeof (error as Error & { digest?: unknown }).digest === "string" &&
    (error as Error & { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

async function requireNoaRelationClient(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>> } | { ok: false; reason: "unauthorized" }
> {
  try {
    await requireQuotationActionUser();
  } catch (error) {
    if (isNextRedirectError(error)) return { ok: false, reason: "unauthorized" };
    throw error;
  }
  return { ok: true, supabase: await createClient() };
}

function buildRelationResultSet(entityType: "project_file", orderNos: string[]): NoaResultSet {
  const identity = { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString() };
  const bounded = orderNos.slice(0, MAX_NOA_RESULT_SET_ITEMS);
  return bounded.length === 1
    ? { ...identity, kind: "entity", entityType, count: 1, items: [{ orderNo: bounded[0] }] }
    : { ...identity, kind: "list", entityType, count: bounded.length, items: bounded.map((orderNo) => ({ orderNo })) };
}

// PART 3/4: quotation -> project_file. Re-fetches the source quotations by id (RLS-scoped, never
// trusting the session's cached identifiers as authorization), derives each one's ERP Project
// File the exact same way the existing Project capability's allProjectFiles() does
// (projectFileFromLayoutSettings ?? clientApprovalDraftFromLayoutSettings()?.confirmedOrder -
// there is no separate join table to query), and orders/deduplicates targets by FIRST APPEARANCE
// in the source's own display order (never alphabetical/DB order) so a later "the second one"
// still means what the user actually saw.
export async function resolveNoaRelation(
  state: NoaConversationState,
  sourceHandle: NoaResultSetHandle,
  relationId: NoaRelationId,
): Promise<NoaRelationResult> {
  const validated = validateNoaRelationSource(state, sourceHandle, relationId);
  if (!validated.ok) return validated;
  const quotationIds = validated.source.items.map((item) => (item as { id: string }).id);

  const client = await requireNoaRelationClient();
  if (!client.ok) return client;

  if (validated.source.entityType === "client") {
    // Re-fetch source Clients first. A stored UUID never grants access to its quotations.
    const { data: sources, error: sourceError } = await client.supabase.from("clients").select("id")
      .in("id", quotationIds).returns<Array<{ id: string }>>();
    if (sourceError) return { ok: false, reason: "storage_error" };
    const authorized = new Set((sources ?? []).map((row) => row.id));
    const targets: string[] = [];
    const seen = new Set<string>();
    let matchedCount = 0;
    for (const clientId of quotationIds) {
      if (!authorized.has(clientId)) continue;
      const { data: quotations, error } = await client.supabase.from("quotations").select("id,layout_settings")
        .eq("client_id", clientId).order("created_at", { ascending: false }).order("id", { ascending: true })
        .limit(201).returns<Array<{ id: string; layout_settings: unknown }>>();
      if (error || (quotations?.length ?? 0) > 200) return { ok: false, reason: "storage_error" };
      let matched = false;
      for (const row of quotations ?? []) {
        const target = relationId === "client.quotation" ? row.id
          : (projectFileFromLayoutSettings(row.layout_settings) ?? clientApprovalDraftFromLayoutSettings(row.layout_settings)?.confirmedOrder)?.orderNo;
        if (!target) continue;
        matched = true;
        if (!seen.has(target)) { seen.add(target); targets.push(target); }
      }
      if (matched) matchedCount++;
    }
    // Existing Project/Quotation renderers display at most ten; never store invisible ordinals.
    const shown = targets.slice(0, 10);
    const identity = { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString() };
    const resultSet: NoaResultSet = relationId === "client.project_file" ? buildRelationResultSet("project_file", shown)
      : shown.length === 1 ? { ...identity, kind: "entity", entityType: "quotation", count: 1, items: [{ id: shown[0] }] }
      : { ...identity, kind: "list", entityType: "quotation", count: shown.length, items: shown.map((id) => ({ id })) };
    if (!isNoaResultSet(resultSet)) return { ok: false, reason: "storage_error" };
    return { ok: true, resultSet, sourceCount: quotationIds.length, matchedCount, resultCount: shown.length };
  }

  const { data, error } = await client.supabase
    .from("quotations")
    .select("id,layout_settings")
    .in("id", quotationIds)
    .returns<Array<{ id: string; layout_settings: unknown }>>();
  if (error) return { ok: false, reason: "storage_error" };

  const rowById = new Map((data ?? []).map((row) => [row.id, row]));
  const orderedTargets: string[] = [];
  const seen = new Set<string>();
  let matchedCount = 0;
  for (const quotationId of quotationIds) {
    const row = rowById.get(quotationId);
    if (!row) continue; // not found / not authorized (RLS) - never invented, never a leak signal
    const order = projectFileFromLayoutSettings(row.layout_settings) ?? clientApprovalDraftFromLayoutSettings(row.layout_settings)?.confirmedOrder;
    if (!order) continue;
    matchedCount += 1;
    if (!seen.has(order.orderNo)) {
      seen.add(order.orderNo);
      orderedTargets.push(order.orderNo);
    }
  }

  const resultSet = buildRelationResultSet("project_file", orderedTargets);
  if (!isNoaResultSet(resultSet)) return { ok: false, reason: "storage_error" };
  return { ok: true, resultSet, sourceCount: quotationIds.length, matchedCount, resultCount: orderedTargets.length };
}

// PART 8: deterministic aggregate drill-down - `status` is a caller-supplied closed enum value
// (the future Planner's own explicit operation, e.g. drillDownNoaAggregate(handle,
// "client_confirmed")), never parsed from a phrase like "the two client confirmed" here. The
// source aggregate stores only group counts, never item identifiers, so this always re-queries
// authoritative quotation rows for the requested status - the aggregate's stored counts are never
// trusted as the result.
export async function drillDownNoaAggregate(
  state: NoaConversationState,
  sourceHandle: NoaResultSetHandle,
  status: NoaQuotationScopeStatus,
): Promise<NoaRelationResult> {
  if (!NOA_QUOTATION_SCOPE_STATUSES.includes(status)) return { ok: false, reason: "incompatible_source_type" };
  const source = state.resultSets.find((candidate) => candidate.handle === sourceHandle);
  if (!source) return { ok: false, reason: "result_set_not_found" };
  if (source.kind !== "aggregate" || source.entityType !== "quotation" || source.querySpec.capability !== "quotation"
    || source.querySpec.operation !== "status_summary") {
    return { ok: false, reason: "incompatible_source_type" };
  }
  // The status must be one the aggregate actually covered - drilling into a status the user was
  // never shown a count for is not a valid deterministic operation on this ResultSet.
  if (!source.groups.some((group) => group.status === status)) return { ok: false, reason: "incompatible_source_type" };

  const client = await requireNoaRelationClient();
  if (!client.ok) return client;

  const { data, error } = await client.supabase
    .from("quotations")
    .select("id")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(MAX_NOA_RESULT_SET_ITEMS)
    .returns<Array<{ id: string }>>();
  if (error) return { ok: false, reason: "storage_error" };

  const ids = (data ?? []).map((row) => row.id);
  const identity = { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString() };
  const resultSet: NoaResultSet = {
    ...identity, kind: "list", entityType: "quotation", count: ids.length,
    items: ids.map((id) => ({ id })),
    querySpec: { capability: "quotation", operation: "status_list", filters: { status } },
  };
  if (!isNoaResultSet(resultSet)) return { ok: false, reason: "storage_error" };
  return { ok: true, resultSet, sourceCount: source.groups.find((g) => g.status === status)?.count ?? 0, matchedCount: ids.length, resultCount: ids.length };
}
