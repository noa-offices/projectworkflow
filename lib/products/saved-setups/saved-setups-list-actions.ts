"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listSetupsForUser, type SetupListItem } from "./saved-setups-service";

// Public POST endpoint: authenticates inside, owner from the session, the CALLER's client (RLS stays on), read-only.
// Separate from actions.ts so that file keeps its exact set of authenticated actions.

/**
 * For the "Removed products" section of the My Collection popup: the caller's own setups whose product is no longer
 * available (the same rows the My Collection page lists under Removed products). Renaming, deleting and clearing them
 * use the existing renameSetup, deleteSetup and clearRemovedSetups actions.
 */
export async function listRemovedSetups(): Promise<SetupListItem[]> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  return (await listSetupsForUser(supabase, user.id, { withImages: false })).filter((item) => !item.usable);
}
