"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currencyRateCode, isCurrencyRate } from "./gallery/gallery-aed";

type SessionClient = Awaited<ReturnType<typeof createClient>>;
type RateRow = { currency: string; rate_to_aed: number; updated_at: string; updated_by: string | null };
type Result = { ok: true } | { ok: false; message: string };

async function canEdit(client: SessionClient) {
  const { data, error } = await client.rpc("product_library_rates_can_edit");
  return !error && data === true;
}

// Read side for the quotation Product Library popup (a later task).
export async function listProductLibraryDefaultRatesAction() {
  try {
    await requireActiveUser();
    const client = await createClient();
    const permission = await client.rpc("product_library_rates_can_view");
    if (permission.error || permission.data !== true) return [];
    const { data, error } = await client.from("product_library_default_rates").select("currency,rate_to_aed,updated_at")
      .returns<Omit<RateRow, "updated_by">[]>();
    if (error) return [];
    return (data ?? []).map(({ currency, rate_to_aed, updated_at }) => ({ currency, rate: rate_to_aed, updatedAt: updated_at }));
  } catch {
    return [];
  }
}

export async function getProductLibraryRateSettings() {
  try {
    const { user, displayName } = await requireActiveUser();
    const client = await createClient();
    if (!await canEdit(client)) return null;
    const { data, error } = await client.from("product_library_default_rates").select("currency,rate_to_aed,updated_at,updated_by")
      .order("currency").returns<RateRow[]>();
    if (error) return null;
    const rows = data ?? [];
    const ids = [...new Set(rows.flatMap(({ updated_by }) => updated_by ? [updated_by] : []))];
    const names = new Map([[user.id, displayName]]);
    if (ids.length) {
      const { data: profiles } = await client.from("profiles").select("id,full_name").in("id", ids)
        .returns<{ id: string; full_name: string | null }[]>();
      for (const profile of profiles ?? []) {
        if (profile.full_name) names.set(profile.id, profile.full_name);
      }
    }
    return rows.map(({ currency, rate_to_aed, updated_at, updated_by }) => ({
      currency,
      rate: rate_to_aed,
      updatedAt: updated_at,
      updatedBy: updated_by ? names.get(updated_by) ?? null : null,
    }));
  } catch {
    return null;
  }
}

async function writeRate(currency: unknown, change: { rate: unknown } | "remove"): Promise<Result> {
  try {
    await requireActiveUser();
    const client = await createClient();
    if (!await canEdit(client)) return { ok: false, message: "You cannot manage currency rates." };
    const code = currencyRateCode(currency);
    if (!code) return { ok: false, message: "Enter a three-letter currency code other than AED." };
    if (change !== "remove" && !isCurrencyRate(change.rate)) {
      return { ok: false, message: "Enter a rate from 0.0001 to 100000 with up to six decimal places." };
    }
    const { error } = change === "remove"
      ? await client.rpc("remove_product_library_default_rate", { p_currency: code })
      : await client.rpc("set_product_library_default_rate", { p_currency: code, p_rate: change.rate });
    if (error) return { ok: false, message: "Could not update the currency rate." };
    revalidatePath("/settings/company");
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not update the currency rate." };
  }
}

export async function setProductLibraryDefaultRateAction(currency: string, rate: number) {
  return writeRate(currency, { rate });
}

export async function removeProductLibraryDefaultRateAction(currency: string) {
  return writeRate(currency, "remove");
}
