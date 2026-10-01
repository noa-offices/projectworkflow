import { ERPDashboard } from "@/components/dashboard/erp-dashboard";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import {
  canAccessProcurement,
  canManageProductLibrary,
  canSendNotifications,
  requireActiveUser,
} from "@/lib/auth";
import {
  getDashboardStats,
  getActiveProjects,
  getDashboardSalesData,
  getMonthlySalesData,
  getHrExpiryAlerts,
  getDashboardProcurementAttention,
  type DashboardProcurementAttention,
} from "@/lib/dashboard/actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, profile, displayName } = await requireActiveUser();

  const isManager =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  const canSeeProcurementAttention = canAccessProcurement(profile?.role);

  const [stats, projects, salesData, monthlyData, hrAlerts] = await Promise.all([
    getDashboardStats(),
    getActiveProjects(),
    getDashboardSalesData(),
    getMonthlySalesData(),
    isManager ? getHrExpiryAlerts() : Promise.resolve([]),
  ]);

  // Reuses the exact same active-order scope getActiveProjects() already established above -
  // no second "active" definition, and gated by the existing canAccessProcurement role check
  // (same convention as the isManager gate on HR alerts) rather than new role logic.
  const procurementAttention: DashboardProcurementAttention | null = canSeeProcurementAttention
    ? await getDashboardProcurementAttention(projects.map((project) => project.orderNo))
    : null;

  return (
    <ErpAppShell
      eyebrow="Dashboard"
      title="ERP Overview"
      description="Live view of projects, quotations, procurement pipeline, and recent activity."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <ERPDashboard
        stats={stats}
        projects={projects}
        salesData={salesData}
        monthlyData={monthlyData}
        hrAlerts={hrAlerts}
        role={profile?.role ?? null}
        canAccessProcurement={canSeeProcurementAttention}
        canManageProducts={canManageProductLibrary(profile?.role)}
        canSendNotifications={canSendNotifications(profile?.role)}
        procurementAttention={procurementAttention}
      />
    </ErpAppShell>
  );
}
