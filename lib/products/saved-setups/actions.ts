"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  clearRemovedSetupsForUser,
  deleteSetupForUser,
  listUsableSetupsForUser,
  loadSetupForUse,
  markSetupUsedForUser,
  renameSetupForUser,
  saveSetupForUser,
  type PickerSetup,
  type SaveSetupInput,
  type SetupActionResult,
  type SetupForUse,
} from "./saved-setups-service";

// Server Actions are public POST endpoints: every action authenticates inside, derives the owner from the
// session (never from client input), uses the CALLER's Supabase client (RLS stays on), and returns only
// { ok, id?, count?, error? }. Any active user may use My Collection (private, owner-only, ids only).
const MY_COLLECTION_PATH = "/products/my-collection";

export async function saveSetup(input: SaveSetupInput): Promise<SetupActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await saveSetupForUser(supabase, user.id, {
    templateId: String(input?.templateId ?? ""),
    setupName: String(input?.setupName ?? ""),
    note: typeof input?.note === "string" ? input.note : null,
    state: input?.state,
  });
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function renameSetup(setupId: string, setupName: string): Promise<SetupActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await renameSetupForUser(supabase, user.id, String(setupId ?? ""), String(setupName ?? ""));
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function deleteSetup(setupId: string): Promise<SetupActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await deleteSetupForUser(supabase, user.id, String(setupId ?? ""));
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function clearRemovedSetups(): Promise<SetupActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await clearRemovedSetupsForUser(supabase, user.id);
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

// ── Use (PR 1b-2). Read-only picker data and replay data come from the caller's own rows (RLS stays on). ──

export async function listPickerSetups(): Promise<PickerSetup[]> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  return listUsableSetupsForUser(supabase, user.id);
}

export async function loadSetupForReplay(setupId: string): Promise<{ ok: true; setup: SetupForUse } | { ok: false; error: string }> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  return loadSetupForUse(supabase, user.id, String(setupId ?? ""));
}

function isNextRedirect(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Best effort. A failure must never block the user, so only an authentication redirect is rethrown. */
export async function markSetupUsed(setupId: string): Promise<SetupActionResult> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    return await markSetupUsedForUser(supabase, user.id, String(setupId ?? ""));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { ok: false, error: "Usage could not be recorded." };
  }
}
