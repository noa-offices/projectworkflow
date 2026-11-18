"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DuplicateInfo } from "./duplicates";
import { buildRecipe, isUuid, type SavedSetupPlainState } from "./recipe";
import { findSetupDuplicateForUser, listSetupsForUser, type SetupListItem } from "./saved-setups-service";

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

/**
 * Duplicate warning for "Save to My Collection" (configured setups). READ-ONLY: it writes nothing. The screen asks this
 * first; only when it finds nothing (or the user chose "Save as new anyway") does it call the existing saveSetup action.
 * It looks only at the caller's own live setups of the same product and compares the canonical recipe (no prices exist in it).
 * It never throws; a problem means "no warning" and the save itself still authenticates and validates as before.
 */
export async function checkSetupDuplicate(input: { templateId: string; state: SavedSetupPlainState }): Promise<{ ok: true; duplicate: DuplicateInfo | null } | { ok: false; error: string }> {
  try {
    const { user } = await requireActiveUser();
    if (!isUuid(input?.templateId) || !input.state || typeof input.state !== "object") return { ok: true, duplicate: null };
    const { recipe, specOverrides } = buildRecipe({ ...input.state, templateId: input.templateId });
    const supabase = await createClient();
    return { ok: true, duplicate: await findSetupDuplicateForUser(supabase, user.id, input.templateId, recipe, specOverrides) };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
