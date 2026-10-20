import { Suspense } from "react";
import { ERPDashboard } from "@/components/dashboard/erp-dashboard";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ListPageSkeleton } from "@/components/layout/list-page-skeleton";
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
  getDashboardUpcomingDeliveries,
  type DashboardProcurementAttention,
  type UpcomingDelivery,
} from "@/lib/dashboard/actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Auth, status checks and redirects run here, before the Suspense boundary.
  const { user, profile, displayName } = await requireActiveUser();

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
      <Suspense fallback={<ListPageSkeleton />}>
        <DashboardContent profile={profile} />
      </Suspense>
    </ErpAppShell>
  );
}

async function DashboardContent({ profile }: { profile: Awaited<ReturnType<typeof requireActiveUser>>["profile"] }) {

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

  // Both reuse the exact same active-order scope getActiveProjects() already established above -
  // no second "active" definition, and both are gated by the existing canAccessProcurement role
  // check (same convention as the isManager gate on HR alerts) rather than new role logic.
  const [procurementAttention, upcomingDeliveries]: [DashboardProcurementAttention | null, UpcomingDelivery[]] = canSeeProcurementAttention
    ? await Promise.all([getDashboardProcurementAttention(projects), getDashboardUpcomingDeliveries(projects)])
    : [null, []];

  return (
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
        upcomingDeliveries={upcomingDeliveries}
      />
  );
}
