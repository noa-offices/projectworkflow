"use server";

import { requireActiveUser, requireRecordsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addHistoryItemToQuotation } from "@/app/quotations/actions";
import { isUuid } from "@/lib/products/saved-setups/recipe";
import {
  clientHistoryMessage,
  isSafeRowId,
  type ClientHistoryListItem,
  type ClientHistoryMessageKind,
} from "./client-history";
import {
  copyHistoryPictureToQuoteRow,
  deleteClientHistoryItem,
  getClientHistoryItemForAdd,
  listClientHistory,
  type ClientHistoryAddItem,
} from "./client-history-service";

// Server Actions are public POST endpoints: every action authenticates FIRST with requireActiveUser, takes the user from the SESSION,
// uses the CALLER's Supabase client (RLS and storage policies stay on) and never an admin client. An action never throws to the
// browser: it returns { ok: true, ... } or { ok: false, message } with a message from CLIENT_HISTORY_MESSAGES. Raw database text,
// recipes, prices and payloads are never returned in a failure and never logged. Extra input fields are ignored.
export type ClientHistoryActionFailure = { ok: false; message: string };

function failure(kind: ClientHistoryMessageKind, problem?: unknown): ClientHistoryActionFailure {
  // A sign-in redirect thrown by requireActiveUser / requireRecordsManager becomes the "not allowed" message instead of an exception.
  const digest = (problem as { digest?: unknown } | null)?.digest;
  const redirected = typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
  try {
    if (problem !== undefined && !redirected) console.error("client history action failed", problem instanceof Error ? problem.name : typeof problem);
  } catch {
    // logging must never fail an action
  }
  return { ok: false, message: clientHistoryMessage(redirected ? "not_allowed" : kind) };
}

export async function listClientHistoryAction(input: {
  clientId: string;
  query?: string;
  kind?: string;
  page?: number;
}): Promise<
  { ok: true; items: ClientHistoryListItem[]; total: number; page: number; pageSize: number; hasMore: boolean } | ClientHistoryActionFailure
> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await listClientHistory(supabase, { clientId: input?.clientId, query: input?.query, kind: input?.kind, page: input?.page });
    if (!result.ok) return failure(result.kind);
    return { ok: true, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, hasMore: result.hasMore };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

/**
 * Everything needed to add ONE row. configured -> item.setup (same shape as a My Collection setup: feed it to the existing
 * openSetupFromCollection replay); library -> item.templateId (open the product); custom -> the field values and pictureRef.
 */
export async function getClientHistoryItemForAddAction(input: {
  historyId: string;
  clientId: string;
}): Promise<{ ok: true; item: ClientHistoryAddItem } | ClientHistoryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await getClientHistoryItemForAdd(supabase, { id: input?.historyId, clientId: input?.clientId });
    if (!result.ok) return failure(result.kind);
    return { ok: true, item: result.item };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

export async function deleteClientHistoryAction(input: { historyId: string }): Promise<{ ok: true } | ClientHistoryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await deleteClientHistoryItem(supabase, input?.historyId);
    if (!result.ok) return failure(result.kind);
    return { ok: true };
  } catch (problem) {
    return failure("delete_failed", problem);
  }
}

/** Server builder: add a MANUAL history item to the quote (see addHistoryItemToQuotation). Returns the new row id and an optional note. */
export async function addHistoryItemToQuotationAction(input: {
  quotationId: string;
  sectionId?: string | null;
  historyId: string;
}): Promise<{ ok: true; itemId: string; message: string; note: string | null } | ClientHistoryActionFailure> {
  try {
    await requireActiveUser();
    if (!isUuid(input?.quotationId) || !isUuid(input?.historyId) || (input.sectionId != null && !isUuid(input.sectionId))) return failure("invalid_request");
    const form = new FormData();
    form.set("quotation_id", input.quotationId);
    if (input.sectionId) form.set("section_id", input.sectionId);
    form.set("history_id", input.historyId);
    const result = await addHistoryItemToQuotation(form);
    if (!result.ok) return { ok: false, message: typeof result.message === "string" && result.message ? result.message : clientHistoryMessage("add_failed") };
    return { ok: true, itemId: result.itemId, message: result.message, note: result.note };
  } catch (problem) {
    return failure("add_failed", problem);
  }
}

/**
 * Local builder: copy a MANUAL history item's picture into quote-images under the new row's own path and return the row's
 * "bucket:path" reference (like copyCustomItemImageToQuote for My Collection). The history row must belong to the quotation's own client.
 * A missing or uncopyable picture is a normal failure ({ ok: false, message }): the row stays without a picture.
 */
export async function copyHistoryPictureToLocalRowAction(input: {
  historyId: string;
  quotationId: string;
  rowId: string;
}): Promise<{ ok: true; ref: string } | ClientHistoryActionFailure> {
  try {
    await requireActiveUser();
    await requireRecordsManager();
    if (!isUuid(input?.historyId) || !isUuid(input?.quotationId) || !isSafeRowId(input?.rowId)) return failure("invalid_request");
    const supabase = await createClient();
    const { data: quotation } = await supabase.from("quotations").select("client_id").eq("id", input.quotationId).maybeSingle();
    const clientId = (quotation as { client_id: string | null } | null)?.client_id;
    if (!clientId) return failure("invalid_request");
    const loaded = await getClientHistoryItemForAdd(supabase, { id: input.historyId, clientId });
    if (!loaded.ok) return failure(loaded.kind);
    if (loaded.item.kind !== "custom" || !loaded.item.pictureRef) return failure("picture_gone");
    const copied = await copyHistoryPictureToQuoteRow(supabase, { pictureRef: loaded.item.pictureRef, quotationId: input.quotationId, rowId: input.rowId });
    if (!copied.ok) return failure(copied.kind);
    return { ok: true, ref: copied.ref };
  } catch (problem) {
    return failure("picture_failed", problem);
  }
}
