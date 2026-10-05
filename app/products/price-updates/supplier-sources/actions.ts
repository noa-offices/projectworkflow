"use server";

import { revalidatePath } from "next/cache";
import { requireBrandPriceReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { assertSupplierProfile, type RawSupplierRow, type SourceScope, type SupplierProfile } from "@/lib/products/supplier-price-contracts";
import { normalizeSupplierRows } from "@/lib/products/supplier-price-import";
import { sharedBaselineDrift } from "@/lib/products/supplier-price-matching";
import { supplierApplyReviewedPrice, supplierCompleteReview, supplierCompletionReadiness, supplierConfirmUnchangedPrice, supplierExcludeTargetFromSource, supplierBulkApplyChanged, supplierBulkConfirmUnchanged, supplierBulkExcludeMissing, supplierBrandMatches, supplierBrandTargets, supplierMatchChunks, supplierSource, supplierSourceInspectorDetail, supplierSourceInspectorSearch, supplierWrite } from "@/lib/products/supplier-price-repository";

const workspacePath = "/products/price-updates/supplier-sources";
async function reviewer() { const auth = await requireBrandPriceReviewer(); return { auth, client: await createClient() }; }
async function approver() { const context = await reviewer(); if (!canApproveBrandPrices(context.auth.profile?.role, context.auth.profile?.account_status)) throw Error("Brand price approver permission required."); return context; }

/** Read-only inspector actions use the same authenticated reviewer access as Supplier Pricing. */
export async function searchSupplierSourceInspector(sourceId: string, query = "", offset = 0) {
  const { client } = await reviewer();
  if (typeof sourceId !== "string" || !sourceId || typeof query !== "string") throw Error("Supplier source and search text are required.");
  return supplierSourceInspectorSearch(client, sourceId, query, offset, 50);
}
export async function supplierSourceInspectorDetails(sourceId: string, identityKey: string) {
  const { client } = await reviewer();
  if (typeof sourceId !== "string" || !sourceId || typeof identityKey !== "string" || !identityKey) throw Error("Supplier source identity is required.");
  return supplierSourceInspectorDetail(client, sourceId, identityKey);
}

export async function saveSupplierProfile(brandId: string, title: string, config: unknown) {
  const { client } = await approver(); assertSupplierProfile(config);
  if (!title.trim()) throw Error("Profile title required.");
  const result = await supplierWrite(client, "profile", { brand_id: brandId, title: title.trim(), config }); revalidatePath(workspacePath); return result;
}
export async function createSupplierSource(payload: { profile_id: string; expected_profile: SupplierProfile; title: string; filename: string; file_hash: string; source_type: string; expected_rows: number; expected_cells: number; expected_chunks: number; original_reference?: string; effective_from?: string; received_at?: string }) {
  const { client } = await reviewer();
  if (!payload.title.trim() || !/^[a-f0-9]{64}$/.test(payload.file_hash) || !["xlsx", "csv", "json"].includes(payload.source_type)) throw Error("Source title, hash and structured format required.");
  const result = await supplierWrite(client, "source", payload); const source = await supplierSource(client, result.id); revalidatePath(workspacePath); return { ...result, status: source.status };
}
export async function attachSupplierWorkingFile(sourceId: string, path: string) {
  const { client } = await reviewer(); await supplierWrite(client, "attach_file", { source_id: sourceId, path });
}
export async function uploadSupplierChunk(sourceId: string, chunkIndex: number, rows: RawSupplierRow[]) {
  const { client } = await reviewer();
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || new TextEncoder().encode(JSON.stringify(rows)).length > 600_000 || rows.some((row) => !row || typeof row.unit_key !== "string" || !Number.isInteger(row.row_number) || typeof row.sheet !== "string" || !row.values || typeof row.values !== "object" || Array.isArray(row.values))) throw Error("Invalid bounded source chunk.");
  const source = await supplierSource(client, sourceId); assertSupplierProfile(source.profile);
  const cells = normalizeSupplierRows(rows, source.profile);
  return supplierWrite(client, "chunk", { source_id: sourceId, chunk_index: chunkIndex, rows, cells });
}
export async function finalizeSupplierSource(sourceId: string) {
  const { client } = await reviewer(); const result = await supplierWrite(client, "finalize_source", { source_id: sourceId }); revalidatePath(workspacePath); return result;
}
export async function archiveSupplierSource(sourceId: string) {
  const { client } = await reviewer(); await supplierWrite(client, "archive_source", { source_id: sourceId }); revalidatePath(workspacePath);
}
export async function createSupplierReviewBatch(sourceId: string, scope: SourceScope, selectedIds: string[], brandListId?: string) {
  const { client } = await reviewer();
  if (!["complete", "partial", "selected_templates"].includes(scope)) throw Error("Invalid review scope.");
  // Always build against the entire Brand; scope is only a review filter.
  const { source, matches } = await supplierBrandMatches(client, sourceId);
  const chunks = supplierMatchChunks(matches);
  const result = await supplierWrite(client, "batch", { source_id: sourceId, title: source.title, scope, selected_template_ids: selectedIds, brand_price_list_update_id: brandListId || null, expected_matches: matches.length, expected_chunks: chunks.length });
  for (let index = 0; index < chunks.length; index++) await supplierWrite(client, "match_chunk", { batch_id: result.id, chunk_index: index, matches: chunks[index] });
  await supplierWrite(client, "finalize_batch", { batch_id: result.id }); revalidatePath(workspacePath); return result;
}
export async function saveSupplierDecision(batchId: string, key: string, decision: string, note: string, proposedKeys: string[] = []) {
  const { client } = await reviewer(); if (!["reviewed", "skip", "reject", "mapping_proposed"].includes(decision) || note.length > 4000 || proposedKeys.length > 500) throw Error("Invalid review decision.");
  await supplierWrite(client, "decision", { batch_id: batchId, key, decision, note, proposed_target_keys: proposedKeys }); revalidatePath(workspacePath);
}
export async function applySupplierReviewedPrice(batchId: string, matchKey: string) {
  const { client } = await approver();
  const result = await supplierApplyReviewedPrice(client, batchId, matchKey);
  revalidatePath(workspacePath);
  revalidatePath("/products/templates");
  return result;
}
export async function confirmSupplierUnchangedPrice(batchId: string, matchKey: string) {
  const { client } = await approver();
  const result = await supplierConfirmUnchangedPrice(client, batchId, matchKey);
  revalidatePath(workspacePath);
  return result;
}
export async function supplierCompletionStatus(batchId: string) {
  const { client } = await approver();
  return supplierCompletionReadiness(client, batchId);
}
export async function completeSupplierPriceReview(batchId: string) {
  const { client } = await approver();
  const result = await supplierCompleteReview(client, batchId);
  revalidatePath(workspacePath);
  revalidatePath("/products/price-updates");
  revalidatePath("/products/templates");
  return result;
}
export async function excludeSupplierTargetFromSource(batchId: string, matchKey: string, note: string) {
  const { client } = await approver();
  const result = await supplierExcludeTargetFromSource(client, batchId, matchKey, note);
  revalidatePath(workspacePath);
  return result;
}
// Bulk Family actions: the browser sends only the batch id, match keys and (for exclusion) a reason.
export async function bulkApplySupplierChangedPrices(batchId: string, matchKeys: string[]) {
  const { client } = await approver();
  const result = await supplierBulkApplyChanged(client, batchId, matchKeys);
  revalidatePath(workspacePath);
  revalidatePath("/products/templates");
  return result;
}
export async function bulkConfirmSupplierUnchanged(batchId: string, matchKeys: string[]) {
  const { client } = await approver();
  const result = await supplierBulkConfirmUnchanged(client, batchId, matchKeys);
  revalidatePath(workspacePath);
  return result;
}
export async function bulkExcludeSupplierMissing(batchId: string, matchKeys: string[], reason: string) {
  const { client } = await approver();
  const result = await supplierBulkExcludeMissing(client, batchId, matchKeys, reason);
  revalidatePath(workspacePath);
  return result;
}
export async function saveSupplierDimension(rule: { brand_id: string; template_id?: string; group_id?: string; raw_labels: string[]; finish_codes: string[]; dimension_code: string }) {
  const { client } = await approver();
  if (!rule.dimension_code || !Array.isArray(rule.raw_labels) || !Array.isArray(rule.finish_codes) || rule.raw_labels.length + rule.finish_codes.length === 0) throw Error("Explicit dimension labels or finish set required.");
  const { targets } = await supplierBrandTargets(client, rule.brand_id);
  if (!targets.some((target) => target.dimension === rule.dimension_code && (!rule.template_id || target.template_id === rule.template_id) && (!rule.group_id || target.group_id === rule.group_id))) throw Error("Canonical dimension does not exist in the selected Brand target column set.");
  await supplierWrite(client, "dimension", rule); revalidatePath(workspacePath);
}
export async function confirmSupplierBindings(brandId: string, proposals: Array<{ code: string; price_field: string; source_dimension: string; kind: "alias" | "shared" | "disambiguation"; target_keys: string[]; expected_targets: Array<{ key: string; pricing_version: string; price: number | null; currency: string }> }>) {
  const { client } = await approver();
  if (!proposals.length || proposals.length > 500) throw Error("Select 1–500 bindings.");
  const { targets } = await supplierBrandTargets(client, brandId); const index = new Map(targets.map((target) => [target.key, target]));
  const bindings = proposals.map((proposal) => {
    if (!proposal.code || !["alias", "shared", "disambiguation"].includes(proposal.kind) || !proposal.target_keys.length || new Set(proposal.target_keys).size !== proposal.target_keys.length) throw Error("Invalid explicit binding.");
    const selected = proposal.target_keys.map((key) => { const target = index.get(key); if (!target) throw Error("Binding target unavailable in this Brand."); return target; });
    if (!Array.isArray(proposal.expected_targets) || selected.some((target) => !proposal.expected_targets.some((expected) => expected.key === target.key && expected.pricing_version === target.pricing_version && expected.price === target.price && expected.currency === target.currency))) throw Error("Displayed target baseline changed or is missing. Refresh before confirming.");
    if (proposal.kind !== "shared" && selected.length !== 1) throw Error("Alias/disambiguation requires exactly one target; use explicit shared approval for multiple targets.");
    if (selected.some((target) => target.price_field !== proposal.price_field)) throw Error("Binding price-field mismatch.");
    if (proposal.kind === "shared" && (selected.length < 2 || sharedBaselineDrift(selected))) throw Error("Shared baseline drift requires individual review.");
    return { ...proposal, brand_id: brandId, baseline_snapshot: selected };
  });
  await supplierWrite(client, "bindings", { bindings }); revalidatePath(workspacePath);
}
export async function supplierProfileForImport(profileId: string) {
  const { client } = await reviewer();
  const { data, error } = await client.from("supplier_price_profiles").select("config").eq("id", profileId).single<{ config: SupplierProfile }>();
  if (error || !data) throw Error(error?.message ?? "Profile unavailable."); assertSupplierProfile(data.config); return data.config;
}
export async function supplierMappingTargets(brandId: string, query = "", from = 0) {
  const { client } = await reviewer(); const { targets } = await supplierBrandTargets(client, brandId);
  const search = query.trim().toLowerCase().slice(0, 120); const start = Math.max(0, Math.floor(from));
  const filtered = targets.filter((target) => !search || `${target.template_name} ${target.label} ${target.raw_code} ${target.dimension}`.toLowerCase().includes(search));
  // Manual picker search only; it never auto-maps or performs fuzzy matching.
  return { targets: filtered.slice(start, start + 100).map((target) => ({ key: target.key, label: `${target.template_name} / ${target.label} / ${target.raw_code} / ${target.dimension || "scalar"}`, price: target.price, currency: target.currency, pricing_version: target.pricing_version })), hasMore: filtered.length > start + 100 };
}
export async function archiveSupplierDimension(id: string) {
  const { client } = await approver(); await supplierWrite(client, "archive_dimension", { id }); revalidatePath(workspacePath);
}
