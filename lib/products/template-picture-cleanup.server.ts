import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupPictures, collectPicturePaths, templatePicturePath } from "./template-picture-cleanup";

export async function collectTemplatePictures(client: SupabaseClient, id: string, template: Record<string, unknown>): Promise<string[] | null> {
  try {
    const values: unknown[] = Object.entries(template).filter(([key]) => /image_url(?:_\d+)?$/.test(key)).map(([, value]) => value);
    for (const table of ["product_template_group_references", "product_template_row_references", "product_template_subgroup_references"]) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from(table).select("storage_path").eq("template_id", id).order("id").range(offset, offset + 999);
        if (error || !data) throw Error("references unavailable");
        values.push(...data.map((row) => row.storage_path));
        if (data.length < 1000) break;
      }
    }
    const visit = async (prefix: string, depth = 0): Promise<void> => {
      if (depth > 20) throw Error("Unexpected directory depth");
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from("product-images").list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error || !data) throw Error("listing unavailable");
        for (const entry of data) {
          if (!entry.name || entry.name.includes("/") || entry.name === "." || entry.name === "..") throw Error("Unexpected storage entry");
          const path = `${prefix}/${entry.name}`;
          if (entry.id) {
            if (!templatePicturePath(path, id)) throw Error("Unsupported storage path");
            values.push(path);
          } else await visit(path, depth + 1);
        }
        if (data.length < 1000) break;
      }
    };
    await visit(`product-templates/${id}`);
    return collectPicturePaths(values, id);
  } catch { console.warn("PRODUCT PICTURE CLEANUP: collection failed; files retained."); return null; }
}

// Only pass the plan collected above after an exactly-one-row database deletion.
export async function removeTemplatePictures(client: SupabaseClient, paths: string[] | null) {
  const remove = async (storageClient: SupabaseClient, batch: string[]) => {
    const { data, error } = await storageClient.storage.from("product-images").remove(batch);
    return { paths: (data ?? []).map((file) => file.name), error: Boolean(error) };
  };
  return cleanupPictures(paths, {
    guard: async (batch) => {
      const { data, error } = await client.rpc("product_picture_paths_in_use", { p_paths: batch });
      if (error || !Array.isArray(data)) throw Error("Picture guard unavailable");
      return data as string[];
    },
    userRemove: (batch) => remove(client, batch),
    adminRemove: async (batch) => {
      const admin = createAdminClient();
      if (!admin.client) throw Error("Admin storage unavailable");
      return remove(admin.client, batch);
    },
  });
}
