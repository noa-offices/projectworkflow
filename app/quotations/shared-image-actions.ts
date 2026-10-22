"use server";

import { requireQuotationManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { prepareSharedImagePaths } from "@/lib/quotation-shared-image";

// Prepare before a publication attempt is frozen: retries must keep identical payloads.
export async function prepareQuotationSharedImages(values: unknown[]): Promise<Record<string, string>> {
  await requireQuotationManager();
  if (!Array.isArray(values) || values.length > 10000) return {};
  try { return await prepareSharedImagePaths(await createClient(), values); }
  catch {
    console.warn("SHARED QUOTATION IMAGE: preparation failed; originals kept.");
    return {};
  }
}
