"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProductLibraryManager } from "@/lib/auth";
import { materialTextForSubgroup } from "@/lib/products/material-subgroup-sync";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { materialPictureAction, materialPicturePath, type MaterialDeleteResult } from "@/lib/products/material-delete";

export async function deleteMaterialsPermanently(input: { groupId: string; ids: string[] }) {
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids.map((id) => typeof id === "string" ? id.toLowerCase() : id))] : [];
  const fail = (message: string) => ({ results: ids.map((id): MaterialDeleteResult => ({ id, status: "error", message })) });
  const results: MaterialDeleteResult[] = [];
  try { await requireProductLibraryManager(); } catch { return fail("You do not have permission to manage materials. Sign in with an allowed account."); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input?.groupId || "") || !Array.isArray(input?.ids) || input.ids.length > 100 || ids.some((id) => typeof id !== "string" || !uuid.test(id))) return fail("Choose a group and at most 100 valid material ids.");
  const notReady = "Delete is not ready: the database update has not been applied yet.";
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_unused_brand_materials", { p_group_id: input.groupId, p_ids: ids });
    if (error || !Array.isArray(data)) return fail(notReady);
    const pictures = new Map<string, { pictureRemoved?: boolean; pictureKept?: boolean; message?: string }>();
    for (const id of ids) {
      const row = data.find((row) => row.id === id);
      if (!row || !["deleted", "in_use", "not_found"].includes(row.status)) { results.push({ id, status: "error", message: "Could not confirm deletion. Refresh the group before trying again." }); continue; }
      const result: MaterialDeleteResult = { id, status: row.status };
      if (row.status === "in_use") result.message = "In use by a product template. Deactivate it instead.";
      const action = materialPictureAction({ status: row.status, imagePath: row.image_path, pictureInUse: row.picture_in_use !== false });
      if (action === "keep") Object.assign(result, { pictureKept: true, message: "Picture kept: still used elsewhere (for example a saved quotation)" });
      if (action === "remove") {
        const path = materialPicturePath(row.image_path);
        if (!path) Object.assign(result, { pictureKept: true, message: "Picture kept: its path is outside the supported Material Library folder." });
        else if (pictures.has(path)) Object.assign(result, pictures.get(path));
        else {
          try {
            let removal = await supabase.storage.from("product-images").remove([path]);
            const permissionError = removal.error && (/^(401|403|42501)$/.test(String((removal.error as { statusCode?: string; status?: number }).statusCode ?? (removal.error as { status?: number }).status)) || /permission|not authorized|unauthorized|row.level security|access denied/i.test(removal.error.message));
            if (permissionError) {
              const admin = createAdminClient();
              if (admin.client) removal = await admin.client.storage.from("product-images").remove([path]);
            }
            // Storage may return no error but no deleted objects when RLS hides the object.
            const removed = !removal.error && Boolean(removal.data?.some((object) => object.name === path));
            Object.assign(result, removed ? { pictureRemoved: true } : { pictureRemoved: false, message: "Picture could not be removed" });
          } catch { Object.assign(result, { pictureRemoved: false, message: "Picture could not be removed" }); }
          pictures.set(path, { pictureRemoved: result.pictureRemoved, message: result.message });
        }
      }
      results.push(result);
    }
  } catch { return fail(notReady); }
  try { revalidatePath("/products/materials"); revalidatePath(`/products/materials/groups/${input.groupId}`); } catch { /* Do not misreport completed deletes. */ }
  return { results };
}

export async function setMaterialsActive(input: { groupId: string; ids: string[]; active: boolean }) {
  type Result = { id: string; status: "updated" | "not_found" | "error"; message?: string };
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids.map((id) => typeof id === "string" ? id.toLowerCase() : id))] : [];
  const fail = (message: string) => ({ results: ids.map((id): Result => ({ id, status: "error", message })) });
  try { await requireProductLibraryManager(); } catch { return fail("You do not have permission to manage materials. Sign in with an allowed account."); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input?.groupId || "") || !Array.isArray(input?.ids) || input.ids.length > 100 || typeof input.active !== "boolean" || ids.some((id) => typeof id !== "string" || !uuid.test(id))) return fail("Choose a group and at most 100 valid material ids.");
  const results: Result[] = [];
  try {
    const supabase = await createClient();
    for (const id of ids) {
      try {
        const { data, error } = await supabase.from("brand_materials").update({ is_active: input.active }).eq("id", id).eq("material_group_id", input.groupId).select("id");
        results.push(error ? { id, status: "error", message: "Material could not be updated." } : { id, status: data?.length ? "updated" : "not_found" });
      } catch { results.push({ id, status: "error", message: "Material could not be updated." }); }
    }
  } catch { return fail("Materials could not be updated."); }
  try { revalidatePath("/products/materials"); revalidatePath(`/products/materials/groups/${input.groupId}`); } catch { /* Keep confirmed results. */ }
  return { results };
}

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function numberValue(formData: FormData, name: string) {
  const value = Number.parseInt(textValue(formData, name), 10);
  return Number.isFinite(value) ? value : 0;
}

function returnTo(formData: FormData) {
  const value = textValue(formData, "return_to");
  return value.startsWith("/products/materials") ? value : "/products/materials";
}

function redirectWithMessage(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}message=${encodeURIComponent(message)}`);
}

function materialCategoryValue(formData: FormData) {
  return optionalTextValue(formData, "material_price_category") ?? optionalTextValue(formData, "material_category");
}

function materialCollectionValue(formData: FormData) {
  return optionalTextValue(formData, "material_collection");
}

function friendlyMaterialMessage(message: string, fallback: string) {
  return message.includes("sub-group must belong")
    ? "That sub-group does not belong to the selected group."
    : fallback;
}

// undefined = the form has no sub-group field (classic dialogs): today's behaviour, nothing about sub-groups is touched.
// Otherwise the chosen sub-group (or none) plus the old text columns derived from it.
async function resolveSubgroupFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
  groupId: string,
  redirectPath: string,
) {
  if (!formData.has("subgroup_id")) return undefined;
  const subgroupId = textValue(formData, "subgroup_id");
  if (!subgroupId) return { subgroupId: null as string | null, text: null };

  const { data } = await supabase
    .from("brand_material_subgroups")
    .select("id,material_group_id,name,grade")
    .eq("id", subgroupId)
    .maybeSingle<{ id: string; material_group_id: string; name: string; grade: string | null }>();
  if (!data || data.material_group_id !== groupId) {
    redirectWithMessage(redirectPath, "That sub-group does not belong to the selected group.");
  }
  return { subgroupId: data.id as string | null, text: materialTextForSubgroup(data) };
}

function parseBatchRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code = "", ...nameParts] = line.split(/\s*[|,\t]\s*/);
      return {
        code: code.trim(),
        name: nameParts.join(" ").trim(),
      };
    })
    .filter((row) => row.code || row.name);
}

export async function createMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupName = textValue(formData, "group_name");
  const redirectPath = returnTo(formData);

  if (!brandId || !groupName) {
    redirectWithMessage(redirectPath, "Brand and group name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("brand_material_groups").insert({
    brand_id: brandId,
    group_name: groupName,
    description: optionalTextValue(formData, "description"),
    sort_order: numberValue(formData, "sort_order"),
    is_active: boolValue(formData, "is_active"),
  });

  if (error) {
    console.error("MATERIAL GROUP CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be created.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group created.");
}

export async function updateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const brandId = textValue(formData, "brand_id");
  const groupName = textValue(formData, "group_name");
  const redirectPath = returnTo(formData);

  if (!id || !brandId || !groupName) {
    redirectWithMessage(redirectPath, "Group id, brand, and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_material_groups")
    .update({
      brand_id: brandId,
      group_name: groupName,
      description: optionalTextValue(formData, "description"),
      sort_order: numberValue(formData, "sort_order"),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL GROUP UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be updated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group updated.");
}

export async function deactivateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Group id is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_material_groups")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL GROUP DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be deactivated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group deactivated.");
}

export async function createMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const materialName = textValue(formData, "material_name");
  const redirectPath = returnTo(formData);

  if (!brandId || !groupId || !materialName) {
    redirectWithMessage(redirectPath, "Brand, group, and material name are required.");
  }

  const supabase = await createClient();
  const sub = await resolveSubgroupFields(supabase, formData, groupId, redirectPath);
  // Optional (PDF import saves 'needs_review'); missing or any other value keeps today's behaviour (the column default).
  const reviewStatus = textValue(formData, "review_status");
  const { error } = await supabase.from("brand_materials").insert({
    brand_id: brandId,
    material_group_id: groupId,
    ...(reviewStatus === "needs_review" || reviewStatus === "confirmed" ? { review_status: reviewStatus } : {}),
    material_category: sub?.text ? sub.text.material_category : materialCategoryValue(formData),
    material_collection: sub?.text ? sub.text.material_collection : materialCollectionValue(formData),
    ...(sub ? { subgroup_id: sub.subgroupId } : {}),
    material_code: optionalTextValue(formData, "material_code"),
    material_name: materialName,
    color_family: optionalTextValue(formData, "color_family"),
    description: optionalTextValue(formData, "description"),
    image_url: optionalTextValue(formData, "image_url"),
    image_alt: optionalTextValue(formData, "image_alt"),
    sort_order: numberValue(formData, "sort_order"),
    is_active: boolValue(formData, "is_active"),
  });

  if (error) {
    console.error("MATERIAL CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, friendlyMaterialMessage(error.message, "Material could not be created."));
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${groupId}`);
  redirectWithMessage(redirectPath, "Material created.");
}

export async function createMaterialsFromImport(input: {
  groupId: string;
  items: Array<{ code: string; name: string; imagePath: string | null; subgroupId: string | null; newSubgroup: { name: string; grade: string | null } | null }>;
}) {
  type Result = { index: number; status: "created" | "duplicate" | "error"; materialId?: string; message?: string };
  type Subgroup = { id: string; name: string; grade: string | null };
  const results: Result[] = [];
  const createdSubgroups: Subgroup[] = [];
  const items = Array.isArray(input?.items) ? input.items : [];
  const fail = (message: string) => ({ results: items.map((_, index): Result => ({ index, status: "error", message })), createdSubgroups });
  const key = (value: string | null) => (value || "").trim().toLowerCase();
  try {
    await requireProductLibraryManager();
    if (!input?.groupId || items.length > 40) return fail("Choose a group and send at most 40 materials at a time.");
    const supabase = await createClient();
    const { data: group, error: groupError } = await supabase.from("brand_material_groups").select("id,brand_id").eq("id", input.groupId).maybeSingle();
    if (groupError || !group) return fail("Material group could not be found.");
    const subgroups: Subgroup[] = [];
    const codes = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const subs = await supabase.from("brand_material_subgroups").select("id,name,grade").eq("material_group_id", group.id).order("id").range(offset, offset + 999);
      if (subs.error) return fail("Could not check existing sub-groups. Try again.");
      subgroups.push(...(subs.data || []));
      if ((subs.data?.length || 0) < 1000) break;
    }
    for (let offset = 0; ; offset += 1000) {
      const materials = await supabase.from("brand_materials").select("material_code,subgroup_id").eq("material_group_id", group.id).eq("is_active", true).order("id").range(offset, offset + 999);
      if (materials.error) return fail("Could not check existing materials. Try again.");
      // A code only collides inside the same sub-group (a null sub-group equals only null).
      for (const row of materials.data || []) if (key(row.material_code)) codes.add(`${key(row.material_code)}|${row.subgroup_id ?? ""}`);
      if ((materials.data?.length || 0) < 1000) break;
    }
    const queuedCodes = new Map<string, number>();
    const repeats: Array<{ index: number; original: number }> = [];
    const prepared: Array<{ index: number; row: { brand_id: string; material_group_id: string; subgroup_id: string | null; material_code: string | null; material_name: string; material_category: string | null; material_collection: string | null; color_family: null; description: null; image_url: string | null; image_alt: null; sort_order: number; is_active: boolean; review_status: string } }> = [];
    for (const [index, item] of items.entries()) {
      try {
        if (!item || typeof item.name !== "string" || !item.name.trim()) { results.push({ index, status: "error", message: "Name is required." }); continue; }
        if (typeof item.code !== "string") { results.push({ index, status: "error", message: "Enter a valid code." }); continue; }
        const code = key(item.code);
        let sub = item.subgroupId ? subgroups.find((s) => s.id === item.subgroupId) : undefined;
        if (item.subgroupId && !sub) { results.push({ index, status: "error", message: "That sub-group does not belong to this group." }); continue; }
        if (!item.subgroupId && item.newSubgroup) {
          const name = item.newSubgroup.name.trim(), grade = item.newSubgroup.grade?.trim() || null;
          if (!name) { results.push({ index, status: "error", message: "Sub-group name is required." }); continue; }
          sub = subgroups.find((s) => key(s.name) === key(name) && key(s.grade) === key(grade));
          if (!sub) {
            const inserted = await supabase.from("brand_material_subgroups").insert({ brand_id: group.brand_id, material_group_id: group.id, name, grade }).select("id,name,grade").single();
            if (inserted.error?.code === "23505") {
              const refreshed = await supabase.from("brand_material_subgroups").select("id,name,grade").eq("material_group_id", group.id);
              sub = refreshed.data?.find((s) => key(s.name) === key(name) && key(s.grade) === key(grade));
            } else if (!inserted.error && inserted.data) { sub = inserted.data; createdSubgroups.push(inserted.data); }
            if (!sub) { results.push({ index, status: "error", message: "Sub-group could not be created. Try again." }); continue; }
            subgroups.push(sub);
          }
        }
        // Same code + same target sub-group: an existing material, or an earlier row of this request. A sub-group created just now has none.
        const duplicateKey = code ? `${code}|${sub?.id ?? ""}` : "";
        if (duplicateKey && codes.has(duplicateKey)) { results.push({ index, status: "duplicate" }); continue; }
        if (duplicateKey && queuedCodes.has(duplicateKey)) { repeats.push({ index, original: queuedCodes.get(duplicateKey)! }); continue; }
        prepared.push({ index, row: {
          brand_id: group.brand_id, material_group_id: group.id,
          subgroup_id: sub?.id ?? null, ...(materialTextForSubgroup(sub) ?? { material_category: null, material_collection: null }),
          material_code: item.code.trim() || null, material_name: item.name.trim(), color_family: null, description: null,
          image_url: item.imagePath?.trim() || null, image_alt: null, sort_order: 0, is_active: true, review_status: "confirmed",
        } });
        if (duplicateKey) queuedCodes.set(duplicateKey, index);
      } catch { results.push({ index, status: "error", message: "This row could not be prepared. Check its values." }); }
    }
    if (prepared.length) {
      const batch = await supabase.from("brand_materials").insert(prepared.map(({ row }) => row));
      if (!batch.error) results.push(...prepared.map(({ index }): Result => ({ index, status: "created" })));
      else for (const { index, row } of prepared) {
        try {
          const { error } = await supabase.from("brand_materials").insert(row);
          results.push(error ? { index, status: "error", message: "Material could not be created. Check this row and retry." } : { index, status: "created" });
        } catch { results.push({ index, status: "error", message: "Could not confirm this save. Check the group before retrying." }); }
      }
    }
    for (const { index, original } of repeats) results.push(results.some((result) => result.index === original && result.status === "created")
      ? { index, status: "duplicate" } : { index, status: "error", message: "The earlier row with this code was not saved. Check the group before retrying." });
  } catch {
    for (const index of items.keys()) if (!results.some((result) => result.index === index)) results.push({ index, status: "error", message: "Could not complete the import. Check your access and try again." });
  }
  try { revalidatePath("/products/materials"); revalidatePath(`/products/materials/groups/${input.groupId}`); } catch { /* Saved rows still have their results. */ }
  return { results: results.sort((a, b) => a.index - b.index), createdSubgroups };
}

export async function createMaterialsBatch(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const redirectPath = returnTo(formData);
  const rows = parseBatchRows(textValue(formData, "batch_material_rows"));

  if (!brandId || !groupId || rows.length === 0) {
    redirectWithMessage(redirectPath, "Brand, group, and at least one batch row are required.");
  }

  const invalidRows = rows.filter((row) => !row.code || !row.name);
  if (invalidRows.length) {
    redirectWithMessage(redirectPath, "Each batch row must include code and name, for example 503 | White.");
  }

  const normalizedCodes = rows.map((row) => row.code.toLowerCase());
  const duplicateRowCode = normalizedCodes.find((code, index) => normalizedCodes.indexOf(code) !== index);
  if (duplicateRowCode) {
    redirectWithMessage(redirectPath, `Duplicate batch code found: ${duplicateRowCode}.`);
  }

  const supabase = await createClient();
  const codes = rows.map((row) => row.code);
  const { data: existing, error: duplicateError } = await supabase
    .from("brand_materials")
    .select("material_code")
    .eq("brand_id", brandId)
    .eq("material_group_id", groupId)
    .in("material_code", codes);

  if (duplicateError) {
    console.error("MATERIAL BATCH DUPLICATE CHECK ERROR", duplicateError.message);
    redirectWithMessage(redirectPath, "Batch duplicates could not be checked.");
  }

  const duplicateCodes = Array.from(new Set((existing ?? []).map((row) => row.material_code).filter(Boolean)));
  if (duplicateCodes.length) {
    redirectWithMessage(redirectPath, `Duplicate material code already exists: ${duplicateCodes.join(", ")}.`);
  }

  const sub = await resolveSubgroupFields(supabase, formData, groupId, redirectPath);
  const { error } = await supabase.from("brand_materials").insert(
    rows.map((row, index) => ({
      brand_id: brandId,
      material_group_id: groupId,
      material_category: sub?.text ? sub.text.material_category : materialCategoryValue(formData),
      material_collection: sub?.text ? sub.text.material_collection : materialCollectionValue(formData),
      ...(sub ? { subgroup_id: sub.subgroupId } : {}),
      material_code: row.code,
      material_name: row.name,
      sort_order: index,
      is_active: boolValue(formData, "is_active"),
    })),
  );

  if (error) {
    console.error("MATERIAL BATCH CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, friendlyMaterialMessage(error.message, "Batch materials could not be created."));
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${groupId}`);
  redirectWithMessage(redirectPath, `${rows.length} materials created.`);
}

export async function updateMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const materialName = textValue(formData, "material_name");
  const redirectPath = returnTo(formData);

  if (!id || !brandId || !groupId || !materialName) {
    redirectWithMessage(redirectPath, "Material id, brand, group, and name are required.");
  }

  const supabase = await createClient();
  const sub = await resolveSubgroupFields(supabase, formData, groupId, redirectPath);
  const { error } = await supabase
    .from("brand_materials")
    .update({
      brand_id: brandId,
      material_group_id: groupId,
      material_category: sub?.text ? sub.text.material_category : materialCategoryValue(formData),
      material_collection: sub?.text ? sub.text.material_collection : materialCollectionValue(formData),
      ...(sub ? { subgroup_id: sub.subgroupId } : {}),
      material_code: optionalTextValue(formData, "material_code"),
      material_name: materialName,
      color_family: optionalTextValue(formData, "color_family"),
      description: optionalTextValue(formData, "description"),
      image_url: optionalTextValue(formData, "image_url"),
      image_alt: optionalTextValue(formData, "image_alt"),
      sort_order: numberValue(formData, "sort_order"),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, friendlyMaterialMessage(error.message, "Material could not be updated."));
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${groupId}`);
  redirectWithMessage(redirectPath, "Material updated.");
}

export async function deactivateMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Material id is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_materials")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material could not be deactivated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material deactivated.");
}

export async function createMaterialSubgroup(formData: FormData) {
  await requireProductLibraryManager();
  const groupId = textValue(formData, "material_group_id");
  const name = textValue(formData, "name");
  const grade = optionalTextValue(formData, "grade");
  const redirectPath = returnTo(formData);

  if (!groupId || !name) {
    redirectWithMessage(redirectPath, "Group and sub-group name are required.");
  }

  const supabase = await createClient();
  const { data: group, error: groupError } = await supabase
    .from("brand_material_groups")
    .select("id,brand_id")
    .eq("id", groupId)
    .maybeSingle<{ id: string; brand_id: string }>();

  if (groupError || !group) {
    console.error("MATERIAL SUBGROUP GROUP LOOKUP ERROR", groupError?.message);
    redirectWithMessage(redirectPath, "Material group could not be found.");
  }

  const { error } = await supabase.from("brand_material_subgroups").insert({
    brand_id: group.brand_id,
    material_group_id: group.id,
    name,
    grade,
  });

  if (error) {
    console.error("MATERIAL SUBGROUP CREATE ERROR", error.message);
    redirectWithMessage(
      redirectPath,
      error.code === "23505" ? "This sub-group already exists in the group." : "Sub-group could not be created.",
    );
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${group.id}`);
  redirectWithMessage(redirectPath, "Sub-group created.");
}

async function subgroupGroupId(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase
    .from("brand_material_subgroups")
    .select("material_group_id")
    .eq("id", id)
    .maybeSingle<{ material_group_id: string }>();
  return data?.material_group_id ?? null;
}

export async function updateMaterialSubgroup(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const name = textValue(formData, "name");
  const grade = optionalTextValue(formData, "grade");
  const redirectPath = returnTo(formData);

  if (!id || !name) {
    redirectWithMessage(redirectPath, "Sub-group and name are required.");
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("brand_material_subgroups")
    .update({ name, grade, sort_order: numberValue(formData, "sort_order") })
    .eq("id", id)
    .select("id,material_group_id,name,grade")
    .maybeSingle<{ id: string; material_group_id: string; name: string; grade: string | null }>();

  if (error || !updated) {
    console.error("MATERIAL SUBGROUP UPDATE ERROR", error?.message);
    redirectWithMessage(
      redirectPath,
      error?.code === "23505" ? "This sub-group already exists in the group." : "Sub-group could not be updated.",
    );
  }

  // Keep the old text columns of its materials in step with the new name / grade.
  const text = materialTextForSubgroup(updated);
  if (text) {
    const { error: syncError } = await supabase.from("brand_materials").update(text).eq("subgroup_id", updated.id);
    if (syncError) {
      console.error("MATERIAL SUBGROUP TEXT SYNC ERROR", syncError.message);
      redirectWithMessage(redirectPath, "Sub-group saved, but its materials could not be updated. Save it again.");
    }
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${updated.material_group_id}`);
  redirectWithMessage(redirectPath, "Sub-group updated.");
}

async function setMaterialSubgroupActive(formData: FormData, isActive: boolean) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Sub-group id is required.");

  const supabase = await createClient();
  const groupId = await subgroupGroupId(supabase, id);
  const { error } = await supabase.from("brand_material_subgroups").update({ is_active: isActive }).eq("id", id);

  if (error) {
    console.error("MATERIAL SUBGROUP ACTIVE ERROR", error.message);
    redirectWithMessage(redirectPath, isActive ? "Sub-group could not be activated." : "Sub-group could not be deactivated.");
  }

  revalidatePath("/products/materials");
  if (groupId) revalidatePath(`/products/materials/groups/${groupId}`);
  redirectWithMessage(redirectPath, isActive ? "Sub-group activated." : "Sub-group deactivated.");
}

export async function deactivateMaterialSubgroup(formData: FormData) {
  await setMaterialSubgroupActive(formData, false);
}

export async function activateMaterialSubgroup(formData: FormData) {
  await setMaterialSubgroupActive(formData, true);
}

export async function confirmMaterialReview(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Material id is required.");

  const supabase = await createClient();
  const { data: material, error } = await supabase
    .from("brand_materials")
    .update({ review_status: "confirmed" })
    .eq("id", id)
    .select("material_group_id")
    .maybeSingle<{ material_group_id: string }>();

  if (error || !material) {
    console.error("MATERIAL CONFIRM REVIEW ERROR", error?.message);
    redirectWithMessage(redirectPath, "Material could not be confirmed.");
  }

  revalidatePath("/products/materials");
  revalidatePath(`/products/materials/groups/${material.material_group_id}`);
  redirectWithMessage(redirectPath, "Material confirmed.");
}
