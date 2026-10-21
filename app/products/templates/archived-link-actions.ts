"use server";

import { revalidatePath } from "next/cache";
import { requireProductLibraryManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeArchivedTemplateLink, type ArchivedLinkInput } from "@/lib/products/archived-template-link-deletion";

export async function removeArchivedProductFamilyLink(input: ArchivedLinkInput) {
  return removeArchivedTemplateLink(input, {
    authorize: async () => { await requireProductLibraryManager(); },
    rpc: async ({ templateId, relationshipId }) => {
      const supabase = await createClient();
      return supabase.rpc("remove_archived_template_family_link", {
        p_template_id: templateId, p_relationship_id: relationshipId,
      });
    },
    refresh: () => { revalidatePath("/products/templates"); },
  });
}
