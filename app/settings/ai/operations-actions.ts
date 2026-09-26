"use server";

import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listAiProviderConfigs } from "@/lib/ai/provider-config";
import { checkProviderHealth } from "@/lib/ai/provider-health.server";
import type { ProviderHealth } from "@/lib/ai/provider-operations";

export async function refreshProviderStatus(): Promise<{ ok: true; results: ProviderHealth[] } | { ok: false; message: string }> {
  try {
    await requireSystemOwner();
    const supabase = await createClient();
    const { data, error } = await supabase.from("ai_provider_settings").select("provider_id,default_model");
    if (error) return { ok: false, message: "Provider settings could not be loaded." };
    const results = await Promise.all(listAiProviderConfigs().map((provider) => checkProviderHealth(provider.id,
      data?.find((row) => row.provider_id === provider.id)?.default_model ?? null)));
    return { ok: true, results };
  } catch {
    return { ok: false, message: "Provider status could not be refreshed. Check your access and try again." };
  }
}
