"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renameCustomBrandForUser, type RenameBrandResult } from "./saved-custom-items-service";

// Public POST endpoint: authenticates inside, owner from the session, the CALLER's client (RLS stays on).
// Only the two brand names come from the client; no owner or item ids are accepted.
export async function renameCustomBrand(fromBrand: string, toBrand: string): Promise<RenameBrandResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  const result = await renameCustomBrandForUser(supabase, user.id, String(fromBrand ?? ""), String(toBrand ?? ""));
  if (result.ok) revalidatePath("/products/my-collection");
  return result;
}
