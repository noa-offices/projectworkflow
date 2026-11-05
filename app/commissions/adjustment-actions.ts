"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCommissionViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function value(form: FormData, key: string) {
  const entry = form.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

export async function changeCommissionAdjustment(form: FormData) {
  await requireCommissionViewer();
  const parent = value(form,"commission_id");
  const path = /^[\da-f-]{36}$/i.test(parent) ? `/commissions/${parent}` : "/commissions";
  const adjustmentId = value(form,"adjustment_id");
  const variationId = value(form,"variation_id");
  const supabase = await createClient();
  // All authority and identity checks live in the guarded RPCs, including explicit regeneration.
  const { error } = variationId
    ? await supabase.rpc("generate_sales_commission_adjustment", { p_variation_id: variationId })
    : await supabase.rpc("transition_sales_commission_adjustment", {
        p_adjustment_id: adjustmentId,
        p_target_status: value(form,"target_status"),
        p_reason: value(form,"reason") || null,
      });
  if (error) redirect(`${path}?error=${encodeURIComponent(error.message || "Commission adjustment could not be updated.")}`);
  revalidatePath(path);
  revalidatePath("/commissions");
  revalidatePath("/settings/profile");
  redirect(`${path}?success=${encodeURIComponent("Commission adjustment updated.")}`);
}
