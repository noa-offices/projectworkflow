import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkImportFile, linkNeedsReplacement, openReviewConflict, planReplacement, type FileCheck, type LiveBatch, type LiveVersion } from "./supplier-live-list";
import { supplierBusinessDate, supplierRows, supplierWrite } from "./supplier-price-repository";

// Server-side enforcement of "one live price list per Supplier source". The screens show the messages; these checks cannot be skipped by
// calling an action directly. Reads go through the caller's RLS; archive and leave review use the existing database operations.
const versionColumns = "id,definition_id,title,filename,file_hash,status,effective_from,created_at";
const loadVersions = (client: SupabaseClient, brandId: string) => supplierRows<LiveVersion>(client, "supplier_source_versions", versionColumns, { brand_id: brandId }, "created_at");
const loadBatches = (client: SupabaseClient, brandId: string) => supplierRows<LiveBatch>(client, "supplier_price_batches", "id,source_id,status,completed_at", { brand_id: brandId }, "created_at");
async function brandOfSource(client: SupabaseClient, sourceId: string) {
  const rows = await supplierRows<{ id: string; brand_id: string; definition_id: string | null }>(client, "supplier_source_versions", "id,brand_id,definition_id", { id: sourceId });
  if (!rows[0]) throw Error("Supplier price list unavailable.");
  return rows[0];
}

/** Linking a list to a Supplier source that already has a live list is a replacement: it needs the explicit confirmation. */
export async function assertLinkAllowed(client: SupabaseClient, sourceId: string, definitionId: string | null, replaceConfirmed: boolean) {
  if (!definitionId) return;
  const source = await brandOfSource(client, sourceId);
  const verdict = linkNeedsReplacement({ versions: await loadVersions(client, source.brand_id), source, definitionId });
  if (verdict.kind === "replace" && !replaceConfirmed) throw Error(`${verdict.message} Use Replace price list on that source and confirm the replacement; a Supplier source keeps one live price list.`);
}

/** One open review per Supplier source: a review cannot start while another list of the same source has one open. */
export async function assertNoOtherOpenReview(client: SupabaseClient, sourceId: string) {
  const source = await brandOfSource(client, sourceId);
  const reason = openReviewConflict({ versions: await loadVersions(client, source.brand_id), batches: await loadBatches(client, source.brand_id), sourceId });
  if (reason) throw Error(reason);
}

/** Same exact file? Read-only. RLS limits what is read. */
export async function checkImportFileForBrand(client: SupabaseClient, brandId: string, fileHash: string, fileName: string): Promise<FileCheck> {
  return checkImportFile({ versions: await loadVersions(client, brandId), fileHash, fileName });
}
/**
 * An exact copy of this file (same content, same import settings) is already a live list: a deliberate re-import must be confirmed.
 * A file with different settings is left to the database, which reports it so the screen can offer "Import with new settings".
 */
export async function assertFileNotAlreadyImported(client: SupabaseClient, input: { brandId: string; fileHash: string; fileName: string; expectedProfile: unknown; confirmed: boolean }) {
  if (input.confirmed) return;
  const same = await supplierRows<{ id: string; status: string; profile: unknown }>(client, "supplier_source_versions", "id,status,profile", { brand_id: input.brandId, file_hash: input.fileHash });
  if (!same.some((item) => item.status === "imported" && isDeepStrictEqual(item.profile, input.expectedProfile))) return;
  const found = await checkImportFileForBrand(client, input.brandId, input.fileHash, input.fileName);
  throw Error(`${found.exact?.message ?? "This exact file was already imported."} Confirm a deliberate re-import to create another price list.`);
}

/**
 * After the replacement is fully imported: closes the unfinished reviews of the older lists and archives them. Recomputed here from the stored
 * rows, so the browser cannot choose what is archived. Nothing is deleted; applied prices and Product history are never touched.
 */
export async function completeReplacement(client: SupabaseClient, input: { newSourceId: string; confirmed: boolean }) {
  if (input.confirmed !== true) throw Error("Explicit replacement confirmation required.");
  const source = await brandOfSource(client, input.newSourceId);
  if (!source.definition_id) throw Error("The new price list is not linked to a Supplier source.");
  const versions = await loadVersions(client, source.brand_id);
  const created = versions.find((item) => item.id === source.id);
  if (!created || created.status !== "imported") throw Error("The import has not finished, so nothing was replaced.");
  const plan = planReplacement({ versions, batches: await loadBatches(client, source.brand_id), definitionId: source.definition_id, newList: created, businessDate: supplierBusinessDate() });
  for (const review of plan.leaveReviews) await supplierWrite(client, "review_abandon", { batch_id: review.batchId, confirmed: true });
  for (const item of plan.archive) await supplierWrite(client, "archive_source", { source_id: item.id });
  return { becomesCurrent: plan.becomesCurrent, archived: plan.archive.map((item) => item.title), reviewsClosed: plan.leaveReviews.length, kept: plan.kept };
}
