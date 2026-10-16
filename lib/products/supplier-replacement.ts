import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveApplicableSupplierSourceVersion, supplierBusinessDate, supplierRows, supplierWrite } from "./supplier-price-repository";

type VersionLike = { id: string; effective_from: string | null; created_at: string; status?: string };

export type ReplacementPreview = {
  becomesCurrent: boolean;
  /** The date from which the replacement is applicable (its effective date), or null when it is applicable immediately. */
  currentFrom: string | null;
  headline: string;
  warnings: string[];
};
const dateText = (date: string | null) => date ?? "immediately";

/**
 * What the existing resolver (resolveApplicableSupplierSourceVersion) will do with the proposed replacement: it is added to the definition's
 * imported versions as the newest import, and the resolver picks the winner. Nothing is rewritten; the effective date is the user's input.
 */
export function previewReplacement(input: { versions: VersionLike[]; current: { title: string; effectiveFrom: string | null; currency: string; basis: string } | null; proposed: { effectiveFrom: string; currency: string | null; basis: string | null }; today?: string }): ReplacementPreview {
  const today = input.today ?? supplierBusinessDate();
  const warnings: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.proposed.effectiveFrom) || Number.isNaN(Date.parse(input.proposed.effectiveFrom))) return { becomesCurrent: false, currentFrom: null, headline: "Choose the date this price list takes effect.", warnings };
  const imported = input.versions.filter((v) => (v.status ?? "imported") === "imported");
  const proposed = { id: "__replacement__", status: "imported", effective_from: input.proposed.effectiveFrom, created_at: "9999-12-31T00:00:00Z" };
  const winner = resolveApplicableSupplierSourceVersion([...imported.map((v) => ({ ...v, status: "imported" })), proposed], today);
  const becomesCurrent = winner?.id === proposed.id;
  const future = input.proposed.effectiveFrom > today;
  let headline: string;
  if (becomesCurrent) headline = `It becomes the current price list${input.current ? ` and replaces ${input.current.title}` : ""}.`;
  else if (future) headline = `It becomes current on ${input.proposed.effectiveFrom}. Until then ${input.current?.title ?? "the earlier list"} stays current.`;
  else headline = `It will NOT become current: ${input.current?.title ?? "the existing list"} has a later effective date (${dateText(input.current?.effectiveFrom ?? null)}). Choose a date on or after it.`;
  if (input.current && input.proposed.currency && input.proposed.currency !== input.current.currency) warnings.push(`Currency changes from ${input.current.currency} to ${input.proposed.currency}.`);
  if (input.proposed.basis !== "list" && input.proposed.basis !== "net") warnings.push("Price basis is not set to list or net; prices cannot be applied until it is confirmed.");
  else if (input.current && input.current.basis !== input.proposed.basis && (input.current.basis === "list" || input.current.basis === "net")) warnings.push(`Price basis changes from ${input.current.basis} to ${input.proposed.basis}.`);
  return { becomesCurrent, currentFrom: future ? input.proposed.effectiveFrom : null, headline, warnings };
}

/** The blocking source id named by the database when the same file exists with a different import profile; null for any other error. */
export function blockingSourceFromError(message: string): string | null {
  const match = /Supplier source already exists for this Brand and file \(([0-9a-f-]{36})\)\. It uses a different import profile/i.exec(message);
  return match ? match[1] : null;
}

/** Server-validated archive of the source that blocks "same file, different settings". Archive keeps all rows, reviews and history. */
export async function archiveBlockingSource(client: SupabaseClient, input: { brandId: string; sourceId: string; fileHash: string }) {
  const source = (await supplierRows<{ id: string; brand_id: string; file_hash: string; status: string; title: string; definition_id: string | null; effective_from: string | null; created_at: string }>(client, "supplier_source_versions", "id,brand_id,file_hash,status,title,definition_id,effective_from,created_at", { id: input.sourceId, brand_id: input.brandId })).at(0);
  if (!source || source.file_hash !== input.fileHash) throw Error("The earlier import of this file is unavailable for this Brand.");
  if (source.status === "archived") return { title: source.title, wasCurrent: false, alreadyArchived: true };
  if (!["imported", "uploading", "importing", "failed"].includes(source.status)) throw Error("The earlier import cannot be archived.");
  let wasCurrent = false;
  if (source.status === "imported" && source.definition_id) {
    const siblings = await supplierRows<VersionLike & { definition_id: string | null }>(client, "supplier_source_versions", "id,effective_from,created_at,status,definition_id", { brand_id: input.brandId, definition_id: source.definition_id, status: "imported" }, "created_at");
    wasCurrent = resolveApplicableSupplierSourceVersion(siblings.map((v) => ({ ...v, status: "imported" })), supplierBusinessDate())?.id === source.id;
  }
  await supplierWrite(client, "archive_source", { source_id: source.id });
  return { title: source.title, wasCurrent, alreadyArchived: false };
}

export type ReplacementCheck = { definitionName: string; versions: Array<{ id: string; title: string; effective_from: string | null; created_at: string }>; applicable: { id: string; title: string; filename: string; currency: string; basis: string; effectiveFrom: string | null } | null };
/** Definition ownership + the definition's imported versions, read through the caller's RLS. Used to validate and to verify a replacement. */
export async function loadReplacementContext(client: SupabaseClient, input: { brandId: string; definitionId: string }): Promise<ReplacementCheck> {
  const definition = (await supplierRows<{ id: string; name: string }>(client, "supplier_source_definitions", "id,name", { id: input.definitionId, brand_id: input.brandId, is_active: true })).at(0);
  if (!definition) throw Error("Supplier price list unavailable for this Brand.");
  const versions = await supplierRows<{ id: string; title: string; filename: string; currency: string; basis: string; effective_from: string | null; created_at: string; status: string }>(client, "supplier_source_versions", "id,title,filename,currency,basis,effective_from,created_at,status", { brand_id: input.brandId, definition_id: input.definitionId, status: "imported" }, "created_at");
  const applicable = resolveApplicableSupplierSourceVersion(versions, supplierBusinessDate());
  return { definitionName: definition.name, versions, applicable: applicable ? { id: applicable.id, title: applicable.title, filename: applicable.filename, currency: applicable.currency, basis: applicable.basis, effectiveFrom: applicable.effective_from } : null };
}

/** Before importing: the definition belongs to the Brand and the effective date is a real date. */
export async function validateReplacementRequest(client: SupabaseClient, input: { brandId: string; definitionId: string; effectiveFrom: unknown }) {
  if (typeof input.effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(Date.parse(input.effectiveFrom))) throw Error("Choose the date this price list takes effect.");
  return loadReplacementContext(client, input);
}

export type ReplacementVerdict = { status: "current" | "scheduled" | "not_current" | "not_imported"; applicableTitle: string | null; message: string };
/** After importing: is the new source fully imported AND the applicable version of this definition? Never claims success otherwise. */
export async function verifyReplacement(client: SupabaseClient, input: { brandId: string; definitionId: string; sourceId: string }): Promise<ReplacementVerdict> {
  const source = (await supplierRows<{ id: string; status: string; title: string; effective_from: string | null; definition_id: string | null }>(client, "supplier_source_versions", "id,status,title,effective_from,definition_id", { id: input.sourceId, brand_id: input.brandId })).at(0);
  if (!source || source.definition_id !== input.definitionId) return { status: "not_imported", applicableTitle: null, message: "The new price list is not linked to this supplier price list." };
  if (source.status !== "imported") return { status: "not_imported", applicableTitle: null, message: "The import has not finished, so nothing was replaced." };
  const context = await loadReplacementContext(client, input);
  if (context.applicable?.id === source.id) return { status: "current", applicableTitle: source.title, message: `${source.title} is now the current price list.` };
  if (source.effective_from && source.effective_from > supplierBusinessDate()) return { status: "scheduled", applicableTitle: context.applicable?.title ?? null, message: `${source.title} is imported and becomes current on ${source.effective_from}. Until then ${context.applicable?.title ?? "the earlier list"} stays current.` };
  return { status: "not_current", applicableTitle: context.applicable?.title ?? null, message: `${source.title} is imported but is not current: ${context.applicable?.title ?? "another list"} has a later effective date.` };
}

/** Context for "Replace Price List" on one supplier price list: its current version and the definition's imported versions. */
export type ReplaceContext = { definitionId: string; definitionName: string; current: { title: string; filename: string; effectiveFrom: string | null; currency: string; basis: string } | null; versions: Array<{ id: string; effective_from: string | null; created_at: string }> };
