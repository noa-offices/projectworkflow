"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  clearRemovedSetupsForUser,
  deleteSetupForUser,
  renameSetupForUser,
  saveSetupForUser,
  type SaveSetupInput,
  type SetupActionResult,
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
