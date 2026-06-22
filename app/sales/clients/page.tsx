import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ClientsManager } from "@/components/sales/clients-manager";

export const dynamic = "force-dynamic";

export type ClientRow = {
  id: string;
  company_name: string;
  client_number: string | null;
  client_code: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string;
  trn: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export type ClientWithCount = ClientRow & { quotationCount: number; projectCount: number };

export default async function ClientsPage() {
  const { user, profile, displayName } = await requireActiveUser();

  const adminResult = createAdminClient();
  if (!adminResult.client) throw new Error(adminResult.error ?? "Admin client unavailable");
  const admin = adminResult.client;

  const [{ data: clients }, { data: quotations }, { data: projects }] = await Promise.all([
    admin
      .from("clients")
      .select(
        "id,company_name,client_number,client_code,contact_person,email,phone,website,address,city,country,trn,notes,is_active,created_at",
      )
      .order("company_name", { ascending: true })
      .returns<ClientRow[]>(),
    admin
      .from("quotations")
      .select("client_id")
      .returns<Array<{ client_id: string }>>(),
    admin
      .from("projects")
      .select("client_id")
      .returns<Array<{ client_id: string }>>(),
  ]);

  const countMap = new Map<string, number>();
  for (const q of quotations ?? []) {
    if (q.client_id) countMap.set(q.client_id, (countMap.get(q.client_id) ?? 0) + 1);
  }

  const projectCountMap = new Map<string, number>();
  for (const p of projects ?? []) {
    if (p.client_id) projectCountMap.set(p.client_id, (projectCountMap.get(p.client_id) ?? 0) + 1);
  }

  const clientsWithCounts: ClientWithCount[] = (clients ?? []).map((c) => ({
    ...c,
    quotationCount: countMap.get(c.id) ?? 0,
    projectCount: projectCountMap.get(c.id) ?? 0,
  }));

  const canManage =
    profile?.role === "system_owner" || profile?.role === "admin_manager";

  return (
    <ErpAppShell
      title="Clients"
      description="Manage client records, merge duplicates, and deactivate inactive clients."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <ClientsManager clients={clientsWithCounts} canManage={canManage} />
      </div>
    </ErpAppShell>
  );
}
