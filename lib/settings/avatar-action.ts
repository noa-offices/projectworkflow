"use server";

import { revalidatePath } from "next/cache";
import { requireInventoryUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveAvatarUrl(avatarUrl: string): Promise<ActionResult> {
  const { user } = await requireInventoryUser();
  // Storage RLS only lets people write inside their own folder; refuse anything else early.
  if (typeof avatarUrl !== "string" || !avatarUrl.startsWith(`${user.id}/`) || avatarUrl.includes("..") || avatarUrl.includes("\\")) return { ok: false, error: "Invalid avatar path." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl } as never)
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/profile");
  revalidatePath("/inventory", "layout");
  return { ok: true };
}
