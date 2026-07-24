"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

function adminClient() {
  const result = createAdminClient();
  if (!result.client) return { client: null, error: result.error ?? "Admin client unavailable" };
  return { client: result.client, error: null };
}

async function requireManager(): Promise<{ ok: false; error: string } | null> {
  const { profile } = await requireActiveUser();
  if (
    profile?.role !== "system_owner" &&
    profile?.role !== "admin_manager" &&
    profile?.role !== "sales_designer" &&
    profile?.role !== "sales_coordinator"
  ) {
    return { ok: false, error: "Permission denied." };
  }
  return null;
}

export async function updateClient(
  id: string,
  fields: {
    company_name: string;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string;
    trn?: string | null;
    client_code?: string | null;
    notes?: string | null;
  },
): Promise<Result> {
  const denied = await requireManager();
  if (denied) return denied;

  const { client, error: initErr } = adminClient();
  if (!client) return { ok: false, error: initErr! };

  const { error } = await client.from("clients").update(fields as never).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/sales/clients");
  return { ok: true };
}

export async function deactivateClient(id: string): Promise<Result> {
  const denied = await requireManager();
  if (denied) return denied;

  const { client, error: initErr } = adminClient();
  if (!client) return { ok: false, error: initErr! };

  const { data: existing } = await client
    .from("quotations")
    .select("id")
    .eq("client_id", id)
    .limit(1);

  if ((existing?.length ?? 0) > 0) {
    return { ok: false, error: "Client has quotations and cannot be deleted." };
  }

  const { error } = await client.from("clients").update({ is_active: false } as never).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/sales/clients");
  return { ok: true };
}

export async function permanentlyDeleteClient(id: string): Promise<Result> {
  const denied = await requireManager();
  if (denied) return denied;

  const { client, error: initErr } = adminClient();
  if (!client) return { ok: false, error: initErr! };

  const { data: quotations } = await client
    .from("quotations")
    .select("id")
    .eq("client_id", id)
    .limit(1);
  if ((quotations?.length ?? 0) > 0) {
    return { ok: false, error: "Client has quotations and cannot be permanently deleted." };
  }

  const { data: projects } = await client
    .from("projects")
    .select("id")
    .eq("client_id", id)
    .limit(1);
  if ((projects?.length ?? 0) > 0) {
    return { ok: false, error: "Client has projects and cannot be permanently deleted." };
  }

  const { data: row } = await client
    .from("clients")
    .select("is_active")
    .eq("id", id)
    .maybeSingle<{ is_active: boolean }>();
  if (row?.is_active) {
    return { ok: false, error: "Only inactive clients can be permanently deleted. Deactivate first." };
  }

  const { error } = await client.from("clients").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/sales/clients");
  return { ok: true };
}

export async function mergeClients(primaryId: string, duplicateId: string): Promise<Result> {
  const denied = await requireManager();
  if (denied) return denied;

  const { client, error: initErr } = adminClient();
  if (!client) return { ok: false, error: initErr! };

  const { error: qErr } = await client
    .from("quotations")
    .update({ client_id: primaryId } as never)
    .eq("client_id", duplicateId);
  if (qErr) return { ok: false, error: `Failed to move quotations: ${qErr.message}` };

  const { error: pErr } = await client
    .from("projects")
    .update({ client_id: primaryId } as never)
    .eq("client_id", duplicateId);
  if (pErr) return { ok: false, error: `Failed to move projects: ${pErr.message}` };

  const { error: dErr } = await client
    .from("clients")
    .update({ is_active: false } as never)
    .eq("id", duplicateId);
  if (dErr) return { ok: false, error: `Failed to deactivate duplicate: ${dErr.message}` };

  revalidatePath("/sales/clients");
  return { ok: true };
}
