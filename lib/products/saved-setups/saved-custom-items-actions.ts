"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomItemForUser,
  deleteCustomItemForUser,
  listCustomItemsForUser,
  markCustomItemUsedForUser,
  updateCustomItemForUser,
  type CustomItemActionResult,
} from "./saved-custom-items-service";
import type { CustomItemInput, CustomItemListItem } from "./custom-item";

// Server Actions are public POST endpoints: every action authenticates inside, derives the owner from the session
// (never from client input), uses the CALLER's Supabase client (RLS stays on), and returns { ok, id?, error?, fieldErrors? }.
// Only the form fields below are read: ownership and sharing columns can never come from the client.
const MY_COLLECTION_PATH = "/products/my-collection";

function pickInput(input: CustomItemInput | null | undefined): CustomItemInput {
  return {
    brandName: input?.brandName,
    itemName: input?.itemName,
    itemCode: input?.itemCode,
    specification: input?.specification,
    unitLabel: input?.unitLabel,
    sellingPrice: input?.sellingPrice,
    currency: input?.currency,
  };
}

export async function createCustomItem(input: CustomItemInput): Promise<CustomItemActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await createCustomItemForUser(supabase, user.id, pickInput(input));
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function updateCustomItem(itemId: string, input: CustomItemInput): Promise<CustomItemActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await updateCustomItemForUser(supabase, user.id, String(itemId ?? ""), pickInput(input));
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function deleteCustomItem(itemId: string): Promise<CustomItemActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await deleteCustomItemForUser(supabase, user.id, String(itemId ?? ""));
  if (result.ok) revalidatePath(MY_COLLECTION_PATH);
  return result;
}

export async function listCustomItems(): Promise<CustomItemListItem[]> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  return listCustomItemsForUser(supabase, user.id);
}

function isNextRedirect(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Best effort. A failure must never block the user, so only an authentication redirect is rethrown. */
export async function markCustomItemUsed(itemId: string): Promise<CustomItemActionResult> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    return await markCustomItemUsedForUser(supabase, user.id, String(itemId ?? ""));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { ok: false, error: "Usage could not be recorded." };
  }
}
