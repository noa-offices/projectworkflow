import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { OpportunitiesPreview } from "@/components/sales/opportunities-preview";
import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type Client = { id: string; company_name: string };

type Project = {
  id: string;
  client_id: string;
  project_name: string;
  project_number: string | null;
  project_code: string | null;
  project_year: number | null;
};

export default async function SalesOpportunitiesPage() {
  const { user, displayName } = await requireActiveUser();
  const supabase = await createSupabaseClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id,company_name")
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id,client_id,project_name,project_number,project_code,project_year")
    .order("project_name", { ascending: true })
    .returns<Project[]>();

  if (clientsError) console.error("SALES OPPORTUNITY CLIENTS LIST ERROR", clientsError.message);
  if (projectsError) console.error("SALES OPPORTUNITY PROJECTS LIST ERROR", projectsError.message);

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Opportunities"
      description="Capture furniture sales requests, client details, and quotation submission dates before quotation."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <OpportunitiesPreview clients={clients ?? []} projects={projects ?? []} />
      </div>
    </ErpAppShell>
  );
}
