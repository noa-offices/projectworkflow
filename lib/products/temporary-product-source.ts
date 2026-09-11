const SOURCE_PATH = /^smart-source-qa\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function temporaryProductSourcePath(storagePath: string | null | undefined) {
  const path = storagePath?.trim() ?? "";
  return SOURCE_PATH.test(path) ? path : null;
}

export async function deleteTemporaryProductSource(storagePath: string | null | undefined) {
  const path = temporaryProductSourcePath(storagePath);
  if (!path) return { ok: false as const, reason: "invalid_path" as const };
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { error } = await createClient().storage.from("product-source-files").remove([path]);
    return error ? { ok: false as const, reason: "delete_failed" as const } : { ok: true as const };
  } catch {
    return { ok: false as const, reason: "delete_failed" as const };
  }
}
