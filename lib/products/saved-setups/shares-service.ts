/**
 * My Collection sharing service (PR 4-2). No "use server", no auth import: the server actions authenticate with
 * requireActiveUser and pass the SESSION user id plus the CALLER's own Supabase client (so RLS applies).
 * Never pass an elevated (RLS-bypassing) client here. Every change to a share goes through one of the SECURITY DEFINER
 * functions from 20261119100000_my_collection_shares.sql; the table itself is read-only for users.
 * These wrappers never throw and never log a payload, a price or raw database text (only an error code).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHARE_LIST_LIMIT,
  SHARE_SELECT_INCOMING,
  SHARE_SELECT_SENT,
  SHARE_TARGET_QUERY_MAX,
  SHARE_TARGET_QUERY_MIN,
  mapShareError,
  toIncomingShare,
  toSentShare,
  type IncomingShare,
  type SendShareInput,
  type SentShare,
  type ShareMessageKind,
  type ShareRow,
  type ShareTarget,
} from "./shares";
import type { CleanCustomItem } from "./custom-item";

export type ShareResult<T extends object = object> = ({ ok: true } & T) | { ok: false; kind: ShareMessageKind };

/** Only the error CODE is logged: never the message (it can carry values), a payload or a price. */
function logShareProblem(where: string, error: unknown) {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`my collection share (${where}) failed`, typeof code === "string" ? code : "");
  } catch {
    // logging must never fail an action
  }
}

function failed(where: string, error: unknown): { ok: false; kind: ShareMessageKind } {
  logShareProblem(where, error);
  return { ok: false, kind: mapShareError(error) };
}

function uuidFrom(data: unknown): string | null {
  return typeof data === "string" && data ? data : null;
}

/** Who can be chosen: display name only. Fewer than 2 characters means no search and no database call. */
export async function searchShareTargets(supabase: SupabaseClient, query: string): Promise<ShareResult<{ targets: ShareTarget[] }>> {
  const text = typeof query === "string" ? query.trim().slice(0, SHARE_TARGET_QUERY_MAX) : "";
  if (text.length < SHARE_TARGET_QUERY_MIN) return { ok: true, targets: [] };
  try {
    const { data, error } = await supabase.rpc("my_collection_share_targets", { p_query: text });
    if (error) return failed("targets", error);
    const rows = Array.isArray(data) ? (data as Array<{ id?: unknown; display_name?: unknown }>) : [];
    return {
      ok: true,
      targets: rows.flatMap((row) => (typeof row.id === "string" && typeof row.display_name === "string" ? [{ id: row.id, displayName: row.display_name }] : [])),
    };
  } catch (error) {
    return failed("targets", error);
  }
}

export async function sendShare(supabase: SupabaseClient, input: SendShareInput): Promise<ShareResult<{ shareId: string }>> {
  try {
    const { data, error } = await supabase.rpc("my_collection_send_share", {
      p_kind: input.kind,
      p_item_id: input.itemId,
      p_recipient_id: input.recipientId,
      p_note: input.note,
    });
    if (error) return failed("send", error);
    const shareId = uuidFrom(data);
    return shareId ? { ok: true, shareId } : { ok: false, kind: "unknown" };
  } catch (error) {
    return failed("send", error);
  }
}

/** true = the picture is attached; false = it is not (the share still stands). Never throws. */
export async function attachSharePicture(supabase: SupabaseClient, shareId: string, ok: boolean, note: string | null): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("my_collection_attach_share_picture", { p_share_id: shareId, p_ok: ok, p_note: note });
    if (error) {
      logShareProblem("attach", error);
      return false;
    }
    return data === true;
  } catch (error) {
    logShareProblem("attach", error);
    return false;
  }
}

export async function unsendShare(supabase: SupabaseClient, shareId: string): Promise<ShareResult> {
  try {
    const { data, error } = await supabase.rpc("my_collection_unsend_share", { p_share_id: shareId });
    if (error) return failed("unsend", error);
    return data === true ? { ok: true } : { ok: false, kind: "no_longer_available" };
  } catch (error) {
    return failed("unsend", error);
  }
}

export async function dismissShare(supabase: SupabaseClient, shareId: string): Promise<ShareResult> {
  try {
    const { data, error } = await supabase.rpc("my_collection_dismiss_share", { p_share_id: shareId });
    if (error) return failed("dismiss", error);
    return data === true ? { ok: true } : { ok: false, kind: "no_longer_available" };
  } catch (error) {
    return failed("dismiss", error);
  }
}

/** Accepting twice is harmless: the database returns the same new item id. imagePath is already inside the recipient's folder. */
export async function acceptCustomItemShare(supabase: SupabaseClient, shareId: string, value: CleanCustomItem, imagePath: string | null): Promise<ShareResult<{ itemId: string }>> {
  try {
    const { data, error } = await supabase.rpc("my_collection_accept_custom_item", {
      p_share_id: shareId,
      p_brand: value.brand_name,
      p_name: value.item_name,
      p_code: value.item_code,
      p_spec: value.specification,
      p_unit: value.unit_label,
      p_price: value.selling_price,
      p_currency: value.currency,
      p_image_path: imagePath,
    });
    if (error) return failed("accept custom item", error);
    const itemId = uuidFrom(data);
    return itemId ? { ok: true, itemId } : { ok: false, kind: "unknown" };
  } catch (error) {
    return failed("accept custom item", error);
  }
}

export async function acceptSetupShare(supabase: SupabaseClient, shareId: string, setupName: string, note: string | null): Promise<ShareResult<{ setupId: string }>> {
  try {
    const { data, error } = await supabase.rpc("my_collection_accept_setup", { p_share_id: shareId, p_setup_name: setupName, p_note: note });
    if (error) return failed("accept setup", error);
    const setupId = uuidFrom(data);
    return setupId ? { ok: true, setupId } : { ok: false, kind: "unknown" };
  } catch (error) {
    return failed("accept setup", error);
  }
}

/** The caller's received shares (owner filter + RLS), newest first. The recipe of a setup is not part of the result. */
export async function listIncomingShares(supabase: SupabaseClient, userId: string): Promise<ShareResult<{ shares: IncomingShare[] }>> {
  try {
    const { data, error } = await supabase
      .from("my_collection_shares")
      .select(SHARE_SELECT_INCOMING)
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(SHARE_LIST_LIMIT);
    if (error) return failed("list incoming", error);
    return { ok: true, shares: ((data ?? []) as unknown as ShareRow[]).flatMap((row) => toIncomingShare(row) ?? []) };
  } catch (error) {
    return failed("list incoming", error);
  }
}

/** One received share by id (recipient only), used before accepting to know its status and picture. */
export async function loadIncomingShare(supabase: SupabaseClient, userId: string, shareId: string): Promise<IncomingShare | null> {
  try {
    const { data, error } = await supabase
      .from("my_collection_shares")
      .select(SHARE_SELECT_INCOMING)
      .eq("id", shareId)
      .eq("recipient_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return toIncomingShare(data as unknown as ShareRow);
  } catch {
    return null;
  }
}

/** The caller's sent shares (owner filter + RLS). No payload: a sender only needs names, status and dates. */
export async function listSentShares(supabase: SupabaseClient, userId: string): Promise<ShareResult<{ shares: SentShare[] }>> {
  try {
    const { data, error } = await supabase
      .from("my_collection_shares")
      .select(SHARE_SELECT_SENT)
      .eq("sender_id", userId)
      .order("created_at", { ascending: false })
      .limit(SHARE_LIST_LIMIT);
    if (error) return failed("list sent", error);
    return { ok: true, shares: ((data ?? []) as unknown as ShareRow[]).flatMap((row) => toSentShare(row) ?? []) };
  } catch (error) {
    return failed("list sent", error);
  }
}

/** One sent share (sender only): the recipient and picture path, needed to unsend. Not part of any list result. */
export async function loadSentShareRouting(supabase: SupabaseClient, userId: string, shareId: string): Promise<{ recipientId: string; hasPicture: boolean } | null> {
  try {
    const { data, error } = await supabase
      .from("my_collection_shares")
      .select("recipient_id,picture_path")
      .eq("id", shareId)
      .eq("sender_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { recipient_id?: unknown; picture_path?: unknown };
    return typeof row.recipient_id === "string" ? { recipientId: row.recipient_id, hasPicture: Boolean(row.picture_path) } : null;
  } catch {
    return null;
  }
}

/** Cheap count of pending received shares for the sidebar badge. Never throws. */
export async function countPendingIncoming(supabase: SupabaseClient, userId: string): Promise<ShareResult<{ count: number }>> {
  try {
    const { count, error } = await supabase
      .from("my_collection_shares")
      .select("id", { count: "exact" })
      .eq("recipient_id", userId)
      .eq("status", "pending")
      .limit(0);
    if (error) return failed("count", error);
    return { ok: true, count: count ?? 0 };
  } catch (error) {
    return failed("count", error);
  }
}

/** Lazy 30-day cleanup (no cron in this project). Returns the picture paths of the deleted rows. A failure returns []. */
export async function purgeFinishedShares(supabase: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("my_collection_purge_finished_shares");
    if (error) {
      logShareProblem("purge", error);
      return [];
    }
    return (Array.isArray(data) ? (data as Array<{ picture_path?: unknown }>) : []).flatMap((row) => (typeof row.picture_path === "string" && row.picture_path ? [row.picture_path] : []));
  } catch (error) {
    logShareProblem("purge", error);
    return [];
  }
}
