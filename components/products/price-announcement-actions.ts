"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { addBrandPriceAnnouncement, endBrandPriceAnnouncement, parseAnnouncementPercent } from "@/lib/products/price-announcements";
import { createClient } from "@/lib/supabase/server";

// Announced price change notices. Authorization is checked here and again by the database functions; no price is changed by any of this.
async function approver() {
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  return createClient();
}
const refresh = () => { revalidatePath("/products/price-updates"); revalidatePath("/products/templates"); revalidatePath("/products/manage"); };
const idText = (value: unknown, what: string) => { if (typeof value !== "string" || !value.trim() || value.length > 100) throw Error(`${what} is required.`); return value.trim(); };

export async function announcePriceChangeAction(input: { brandId: string; percent: string; effectiveFrom: string; note: string; approximate: boolean }): Promise<void> {
  const parsed = parseAnnouncementPercent(input.percent);
  if ("error" in parsed) throw Error(parsed.error);
  if (typeof input.effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(Date.parse(`${input.effectiveFrom}T00:00:00Z`))) throw Error("Choose the date the price change starts.");
  if (typeof input.note !== "string" || input.note.trim().length > 200) throw Error("The note is too long (200 characters at most).");
  const client = await approver();
  await addBrandPriceAnnouncement(client, { brandId: idText(input.brandId, "Brand"), percent: parsed.percent, effectiveFrom: input.effectiveFrom, note: input.note.trim(), approximate: input.approximate !== false });
  refresh();
}

export async function endPriceAnnouncementAction(id: string, how: "cancel" | "close"): Promise<void> {
  if (how !== "cancel" && how !== "close") throw Error("Choose cancel or close.");
  const client = await approver();
  await endBrandPriceAnnouncement(client, idText(id, "Notice"), how);
  refresh();
}
