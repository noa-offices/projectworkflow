"use server";

import { revalidatePath } from "next/cache";
import { requireProductLibraryManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeArchivedTemplateLink, type ArchivedLinkInput } from "@/lib/products/archived-template-link-deletion";
import { deactivateArchivedLink } from "@/lib/products/archived-link-deactivation";
import { canRemoveArchiveLinks } from "@/lib/products/archive-family-links";

export async function deactivateArchivedProductFamilyLink(input: ArchivedLinkInput) {
  // Use the existing cookie client and table RLS; never use a service-role client.
  const supabase = await createClient();
  return deactivateArchivedLink(input, {
    authorize: async () => {
      const { profile } = await requireProductLibraryManager();
      if (!canRemoveArchiveLinks(profile?.role, profile?.account_status)) throw new Error("Forbidden");
    },
    template: async (id) => supabase.from("product_templates").select("is_active,lifecycle_status").eq("id", id).maybeSingle(),
    relationship: async (id) => supabase.from("product_template_linked_families")
      .select("id,parent_template_id,linked_template_id,is_active,updated_at").eq("id", id).maybeSingle(),
    update: async (link) => supabase.from("product_template_linked_families")
      .update({ is_active: false }).eq("id", link.id).eq("is_active", true)
      .eq("parent_template_id", link.parent_template_id).eq("linked_template_id", link.linked_template_id)
      .eq("updated_at", link.updated_at).select("id,parent_template_id,linked_template_id,is_active"),
    refresh: () => { revalidatePath("/products/templates"); },
  });
}

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
