import { ERPDashboard } from "@/components/dashboard/erp-dashboard";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import {
  getDashboardStats,
  getActiveProjects,
  getDashboardSalesData,
  getMonthlySalesData,
} from "@/lib/dashboard/actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, profile, displayName } = await requireActiveUser();

  const [stats, projects, salesData, monthlyData] = await Promise.all([
    getDashboardStats(),
    getActiveProjects(),
    getDashboardSalesData(),
    getMonthlySalesData(),
  ]);

  return (
    <ErpAppShell
      eyebrow="Dashboard"
      title="ERP Overview"
      description="Live view of projects, quotations, procurement pipeline, and recent activity."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <ERPDashboard
        stats={stats}
        projects={projects}
        salesData={salesData}
        monthlyData={monthlyData}
        fetchedAt={new Date().toISOString()}
      />
    </ErpAppShell>
  );
}
