"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveAvatarUrl(avatarUrl: string): Promise<ActionResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl } as never)
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/profile");
  return { ok: true };
}
