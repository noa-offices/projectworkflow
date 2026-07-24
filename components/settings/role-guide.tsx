type RoleGuideAccess = "Full" | "Limited" | "Read-only" | "No access";

const ROLE_GUIDE_ROLES = [
  "System Owner",
  "Admin Manager",
  "Procurement Manager",
  "Sales Manager",
  "Sales Coordinator",
  "Designer",
  "Viewer",
] as const;

const ROLE_GUIDE_ROWS: Array<{
  feature: string;
  access: readonly RoleGuideAccess[];
}> = [
  {
    feature: "View quotations",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "Read-only"],
  },
  {
    feature: "Create/edit quotation folders and builder",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "No access"],
  },
  {
    feature: "Revisions, options, copies, status and reassignment",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "No access"],
  },
  {
    feature: "Archive/delete, project files and quotation documents",
    access: ["Full", "Full", "Full", "Full", "Full", "Limited", "No access"],
  },
  {
    feature: "Clients and enquiries",
    access: ["Full", "Full", "No access", "Full", "Full", "No access", "No access"],
  },
  {
    feature: "Product templates, components and brands",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "No access"],
  },
  {
    feature: "Material Library",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "No access"],
  },
  {
    feature: "Price Updates",
    access: ["Full", "Full", "Full", "No access", "No access", "Full", "No access"],
  },
  {
    feature: "Company Settings",
    access: ["Full", "Full", "Full", "Read-only", "Read-only", "Read-only", "No access"],
  },
  {
    feature: "Procurement workspace, purchase orders and vendor progress",
    access: ["Full", "Full", "Full", "No access", "No access", "No access", "No access"],
  },
  {
    feature: "Team Overview",
    access: ["Full", "No access", "No access", "No access", "No access", "No access", "No access"],
  },
  {
    feature: "HR and workers management",
    access: ["Full", "Full", "No access", "No access", "No access", "No access", "No access"],
  },
  {
    feature: "User and role management",
    access: ["Full", "No access", "No access", "No access", "No access", "No access", "No access"],
  },
  {
    feature: "System administration",
    access: ["Full", "No access", "No access", "No access", "No access", "No access", "No access"],
  },
  {
    feature: "Send notifications",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "No access"],
  },
  {
    feature: "Sales Report / Insights",
    access: ["Full", "Full", "Full", "Full", "Full", "Full", "Full"],
  },
];

function roleGuideAccessClassName(access: RoleGuideAccess) {
  if (access === "Full") return "text-emerald-700";
  if (access === "Limited") return "text-amber-700";
  if (access === "Read-only") return "text-sky-700";
  return "text-zinc-400";
}

export function RoleGuide() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-zinc-500">
        Feature-level effective permissions across all roles.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead>
            <tr>
              <th className="min-w-72 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Feature
              </th>
              {ROLE_GUIDE_ROLES.map((role) => (
                <th
                  key={role}
                  className="min-w-32 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {ROLE_GUIDE_ROWS.map((row) => (
              <tr key={row.feature} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">{row.feature}</td>
                {row.access.map((access, index) => (
                  <td
                    key={ROLE_GUIDE_ROLES[index]}
                    className={`px-4 py-3 text-center text-sm font-semibold ${roleGuideAccessClassName(access)}`}
                  >
                    {access}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
