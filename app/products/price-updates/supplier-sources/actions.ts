"use server";

import { revalidatePath } from "next/cache";
import { supplierRefreshReviewAfterMapping } from "@/lib/products/supplier-price-repository";
import { requireBrandPriceReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { assertSupplierProfile, type RawSupplierRow, type SourceScope, type SupplierProfile } from "@/lib/products/supplier-price-contracts";
import { normalizeSupplierRows } from "@/lib/products/supplier-price-import";
import { sharedBaselineDrift } from "@/lib/products/supplier-price-matching";
import { supplierCreateReviewBatch, supplierApplyReviewedPrice, supplierCompleteReview, supplierCompletionReadiness, supplierConfirmUnchangedPrice, supplierExcludeTargetFromSource, supplierBulkApplyChanged, supplierBulkConfirmUnchanged, supplierFamilyUnchangedMatchKeys, supplierBulkExcludeMissing, supplierBrandTargets, supplierSource, supplierSourceInspectorDetail, supplierSourceInspectorSearch, supplierWrite } from "@/lib/products/supplier-price-repository";

import { canManageSupplierCapacity, supplierCapacityReport, supplierDeletePreviousSource, supplierSourceStorage, supplierAssignFamiliesToSource, supplierAssignFamilyToSource, supplierConfirmCoverage, supplierCreateSourceDefinition, supplierDeleteSourceDefinition, supplierLinkSourceDefinition, supplierResolveCoverageConflict, supplierUpdateSourceDefinition } from "@/lib/products/supplier-price-repository";

const workspacePath = "/products/price-updates/supplier-sources";
async function reviewer() { const auth = await requireBrandPriceReviewer(); return { auth, client: await createClient() }; }
async function approver() { const context = await reviewer(); if (!canApproveBrandPrices(context.auth.profile?.role, context.auth.profile?.account_status)) throw Error("Brand price approver permission required."); return context; }
function optionalSupplierRuleId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return !trimmed || trimmed === "undefined" || trimmed === "null" ? undefined : trimmed;
}

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
export async function updateSupplierSourceBasis(brandId: string, sourceId: string, basis: string) {
  const { client } = await approver();
  if (!["list", "net"].includes(basis)) throw Error("Choose list or net price basis.");
  const result = await supplierWrite(client, "source_basis_update", { brand_id: brandId, source_id: sourceId, basis });
  revalidatePath(workspacePath); return result;
}
export async function updateSupplierBrandBasis(brandId: string, basis: string) {
  const { client } = await approver();
  if (!["list", "net"].includes(basis)) throw Error("Choose list or net price basis.");
  const result = await supplierWrite(client, "brand_basis_update", { brand_id: brandId, basis });
  revalidatePath(workspacePath); return result;
}
export async function createSupplierSource(payload: { profile_id: string; expected_profile: SupplierProfile; title: string; filename: string; file_hash: string; source_type: string; expected_rows: number; expected_cells: number; expected_chunks: number; original_reference?: string; effective_from?: string; received_at?: string }) {
  const { client } = await reviewer();
  if (!payload.title.trim() || !/^[a-f0-9]{64}$/.test(payload.file_hash) || !["xlsx", "csv", "json"].includes(payload.source_type)) throw Error("Source title, hash and structured format required.");
  const result = await supplierWrite(client, "source", payload); const source = await supplierSource(client, result.id); revalidatePath(workspacePath); return { ...result, status: source.status, existing: source.status === "imported" };
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
/** One bounded finalize step (whole codes, about 20,000 cells). The caller repeats until done; each step fits the database statement timeout. */
export async function finalizeSupplierSource(sourceId: string) {
  const { client } = await reviewer();
  const { data, error } = await client.rpc("supplier_finalize_source_step", { p_source_id: sourceId });
  if (error) throw Error(error.message);
  const result = data as { id: string; done: boolean; remaining_codes: number; identity_count?: number };
  if (result.done) revalidatePath(workspacePath);
  return result;
}
export async function archiveSupplierSource(sourceId: string) {
  const { client } = await reviewer(); await supplierWrite(client, "archive_source", { source_id: sourceId }); revalidatePath(workspacePath);
}
export async function createSupplierReviewBatch(sourceId: string, scope: SourceScope, selectedIds: string[], brandListId?: string) {
  const { client } = await reviewer();
  if (!["complete", "partial", "selected_templates"].includes(scope)) throw Error("Invalid review scope.");
  const result = await supplierCreateReviewBatch(client, sourceId, scope, selectedIds, brandListId); revalidatePath(workspacePath); return result;
}
export async function refreshSupplierReviewAfterMapping(sourceId: string, batchId?: string) {
  const { client } = await approver();
  const result = await supplierRefreshReviewAfterMapping(client, sourceId, batchId);
  revalidatePath(workspacePath);
  return result;
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
export async function supplierFamilyUnchangedKeys(batchId: string, templateId: string) {
  const { client } = await approver();
  return supplierFamilyUnchangedMatchKeys(client, batchId, templateId);
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
  const normalizedRule = { ...rule, template_id: optionalSupplierRuleId(rule.template_id), group_id: optionalSupplierRuleId(rule.group_id) };
  if (!normalizedRule.dimension_code || !Array.isArray(normalizedRule.raw_labels) || !Array.isArray(normalizedRule.finish_codes) || normalizedRule.raw_labels.length + normalizedRule.finish_codes.length === 0) throw Error("Explicit dimension labels or finish set required.");
  const { targets } = await supplierBrandTargets(client, normalizedRule.brand_id);
  if (!targets.some((target) => target.dimension === normalizedRule.dimension_code && (!normalizedRule.template_id || target.template_id === normalizedRule.template_id) && (!normalizedRule.group_id || target.group_id === normalizedRule.group_id))) throw Error("Canonical dimension does not exist in the selected Brand target column set.");
  await supplierWrite(client, "dimension", normalizedRule); revalidatePath(workspacePath);
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

/** Replace the category only; retain the existing rule's authoritative scope and evidence. */
export async function replaceSupplierDimension(id: string, brandId: string, dimensionCode: string) {
  const { client } = await approver();
  const result = await client.from("supplier_dimension_vocabulary").select("*").eq("id", id).eq("brand_id", brandId).eq("is_active", true).single();
  if (result.error || !result.data) throw Error("Active dimension mapping unavailable for this Brand.");
  const rule = { ...result.data, template_id: optionalSupplierRuleId(result.data.template_id), group_id: optionalSupplierRuleId(result.data.group_id), dimension_code: dimensionCode };
  const { targets } = await supplierBrandTargets(client, brandId);
  const target = targets.find((item) => item.dimension === dimensionCode && (!rule.template_id || item.template_id === rule.template_id) && (!rule.group_id || item.group_id === rule.group_id));
  if (!dimensionCode || !target) throw Error("Canonical dimension does not exist in the selected Brand target column set.");
  await supplierWrite(client, "dimension_replace", { id, brand_id: brandId, template_id: rule.template_id, group_id: rule.group_id, raw_labels: rule.raw_labels, finish_codes: rule.finish_codes, dimension_code: dimensionCode, target });
  revalidatePath(workspacePath);
}

// Supplier source definitions and Family coverage: approver-only; the database re-checks the same permission.
export async function createSupplierSourceDefinition(brandId: string, name: string, profileId?: string) {
  const { client } = await approver(); const result = await supplierCreateSourceDefinition(client, brandId, name, profileId); revalidatePath(workspacePath); return result;
}
export async function renameSupplierSourceDefinition(brandId: string, definitionId: string, name: string) {
  const { client } = await approver(); const result = await supplierUpdateSourceDefinition(client, brandId, definitionId, name); revalidatePath(workspacePath); return result;
}
export async function archiveSupplierSourceDefinition(brandId: string, definitionId: string) {
  const { client } = await approver(); const result = await supplierUpdateSourceDefinition(client, brandId, definitionId, undefined, false); revalidatePath(workspacePath); return result;
}
export async function deleteSupplierSourceDefinition(brandId: string, definitionId: string) {
  const { client } = await approver(); const result = await supplierDeleteSourceDefinition(client, brandId, definitionId); revalidatePath(workspacePath); return result;
}
export async function confirmSupplierCoverage(definitionId: string, templateIds: string[]) {
  const { client } = await approver();
  if (!Array.isArray(templateIds) || templateIds.some((id) => typeof id !== "string")) throw Error("Choose the Families this Supplier source covers.");
  const result = await supplierConfirmCoverage(client, definitionId, templateIds); revalidatePath(workspacePath); return result;
}
export async function linkSupplierSourceDefinition(sourceId: string, definitionId: string | null) {
  const { client } = await approver(); const result = await supplierLinkSourceDefinition(client, sourceId, definitionId); revalidatePath(workspacePath); return result;
}
export async function assignFamilyToSupplierSource(definitionId: string, templateId: string) {
  const { client } = await approver(); const result = await supplierAssignFamilyToSource(client, definitionId, templateId); revalidatePath(workspacePath); return result;
}
export async function resolveSupplierCoverageConflict(brandId: string, templateId: string, keepDefinitionId: string) {
  const { client } = await approver(); await supplierResolveCoverageConflict(client, brandId, templateId, keepDefinitionId); revalidatePath(workspacePath);
}
export async function assignFamiliesToSupplierSource(brandId: string, target: { definitionId?: string; newName?: string; profileId?: string }, templateIds: string[]) {
  const { client } = await approver();
  if (!Array.isArray(templateIds) || templateIds.some((id) => typeof id !== "string")) throw Error("Select the Families to assign.");
  const result = await supplierAssignFamiliesToSource(client, brandId, target, templateIds); revalidatePath(workspacePath); return result;
}
/** Read-only capacity report; the database function enforces System Owner again. */
export async function loadSupplierCapacityReport() {
  const { auth, client } = await reviewer();
  if (!canManageSupplierCapacity(auth.profile?.role, auth.profile?.account_status)) throw Error("Only the System Owner can view Supplier database capacity.");
  return supplierCapacityReport(client);
}
/** Deletes an older version of the same Supplier source only when the database verdict says it holds no review history to keep. */
export async function deletePreviousSupplierSource(currentSourceId: string, previousSourceId: string) {
  const { auth, client } = await reviewer();
  if (!canManageSupplierCapacity(auth.profile?.role, auth.profile?.account_status)) throw Error("Only the System Owner can delete a previous price list.");
  const result = await supplierDeletePreviousSource(client, currentSourceId, previousSourceId); revalidatePath(workspacePath); return result;
}
/** System Owner only. Database purge commits atomically; retained receipts make file cleanup retryable. */
export async function permanentlyDeleteSupplierSource(sourceId: string, confirmed: boolean) {
  const { auth, client } = await reviewer();
  if (!canManageSupplierCapacity(auth.profile?.role, auth.profile?.account_status)) throw Error("Only the System Owner can permanently delete a Supplier price list.");
  if (confirmed !== true) throw Error("Explicit permanent-delete confirmation required.");
  const result = await client.rpc("purge_archived_supplier_source", { p_source_id: sourceId, p_confirm: true });
  if (result.error) throw Error(result.error.message);
  const paths = (result.data as { storage_paths: string[] }).storage_paths;
  let warning = "";
  if (paths.length) {
    try {
      const storage = await client.storage.from("supplier-price-sources").remove(paths);
      if (storage.error) throw Error(storage.error.message);
      const finish = await client.rpc("finish_supplier_source_file_cleanup", { p_source_id: sourceId });
      if (finish.error) throw Error(finish.error.message);
    } catch (error) {
      warning = `Database records were deleted. Storage cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}. Retry file cleanup.`;
    }
  }
  // Keep the row's warning/retry control mounted until external file cleanup succeeds.
  if (!warning) revalidatePath(workspacePath);
  return { warning };
}
/** System Owner-only historical cleanup; Phase F and Storage receipts preserve all durable pricing/review proof. */
export async function removeSupplierSourceTechnicalData(sourceId: string, confirmed: boolean) {
  const { auth, client } = await reviewer();
  if (!canManageSupplierCapacity(auth.profile?.role, auth.profile?.account_status)) throw Error("Only the System Owner can remove Supplier technical data.");
  if (confirmed !== true) throw Error("Explicit technical cleanup confirmation required.");
  const result = await client.rpc("remove_supplier_source_technical_data", { p_source_id: sourceId, p_confirm: true });
  if (result.error) throw Error(result.error.message);
  const paths = (result.data as { storage_paths: string[] }).storage_paths;
  let warning = "";
  try {
    if (paths.length) {
      const storage = await client.storage.from("supplier-price-sources").remove(paths);
      if (storage.error) throw Error(storage.error.message);
      const finish = await client.rpc("finish_supplier_source_file_cleanup", { p_source_id: sourceId });
      if (finish.error) throw Error(finish.error.message);
    }
  } catch (error) { warning = `Pricing history is preserved. File cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}. Retry technical cleanup.`; }
  if (!warning) revalidatePath(workspacePath);
  return { warning, message: "Source technical data removed. Completed review and pricing history preserved." };
}

/** Abandons only this review. Applied prices and durable history are not rolled back. */
export async function leaveSupplierReview(batchId: string, confirmed: boolean) {
  const { client } = await approver();
  if (confirmed !== true) throw Error("Explicit Leave review confirmation required.");
  await supplierWrite(client, "review_abandon", { batch_id: batchId, confirmed: true });
  revalidatePath(workspacePath);
  revalidatePath("/products/price-updates");
  revalidatePath("/products/templates");
  revalidatePath("/quotations", "layout");
}
/** Restores visibility/imported state, never overrides date/version applicability. */
export async function unarchiveSupplierSource(sourceId: string) {
  const { client } = await approver();
  await supplierWrite(client, "source_unarchive", { source_id: sourceId });
  revalidatePath(workspacePath);
  revalidatePath("/products/price-updates");
  revalidatePath("/products/templates");
  revalidatePath("/quotations", "layout");
}
export async function loadSupplierSourceStorage() {
  const { auth, client } = await reviewer();
  if (!canManageSupplierCapacity(auth.profile?.role, auth.profile?.account_status)) throw Error("Only the System Owner can view Supplier database capacity.");
  return supplierSourceStorage(client);
}
