"use client";

import { ProfileActivity } from "@/components/settings/profile-activity";
import type { ProfileCommissionRow, ProfileProjectRow, TeamMemberStat } from "@/lib/settings/profile-stats-loader";

type ActivityEntry = {
  id: string;
  action: string;
  title: string;
  description: string | null;
  entity_type: string;
  created_at: string;
  actor_name?: string | null;
  actor_role?: string | null;
  quotation_id?: string | null;
  quotation_no?: string | null;
};

type QuotationEntry = {
  id: string;
  quotation_no: string | null;
  title: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
  created_at: string;
};

type MonthlyDataPoint = {
  month: string;
  year: number;
  monthKey: string;
  total: number;
  approved: number;
  value: number;
};

type TopClient = {
  clientName: string;
  total: number;
  count: number;
};

type AllQuotationEntry = {
  status: string;
};

type ProfileDashboardShellProps = {
  totalQuotations: number;
  quotationsPrepared: number;
  revisionsPrepared: number;
  optionsPrepared: number;
  personalActivityCount: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
  role: string | null;
  recentActivity: ActivityEntry[];
  salesActivity: ActivityEntry[];
  recentQuotations: QuotationEntry[];
  recentPreparedQuotations: QuotationEntry[];
  teamStats?: TeamMemberStat[] | null;
  monthlyData: MonthlyDataPoint[];
  allQuotations: AllQuotationEntry[];
  topClients: TopClient[];
  projects: ProfileProjectRow[];
  projectSummary: {
    approvedValue: number;
    averageApprovedValue: number;
    averageQuotedValue: number;
    pendingQuotedValue: number;
    quotedValue: number;
    uniqueClients: number;
    uniqueProjects: number;
  };
  commissions: ProfileCommissionRow[];
};

export function ProfileDashboardShell({
  totalQuotations,
  quotationsPrepared,
  revisionsPrepared,
  optionsPrepared,
  personalActivityCount,
  approvedQuotations,
  totalValue,
  currency,
  role,
  recentActivity,
  salesActivity,
  recentQuotations,
  recentPreparedQuotations,
  monthlyData,
  allQuotations,
  topClients,
  projects,
  projectSummary,
  commissions,
}: ProfileDashboardShellProps) {
  return (
    <ProfileActivity
      totalQuotations={totalQuotations}
      quotationsPrepared={quotationsPrepared}
      revisionsPrepared={revisionsPrepared}
      optionsPrepared={optionsPrepared}
      personalActivityCount={personalActivityCount}
      approvedQuotations={approvedQuotations}
      totalValue={totalValue}
      currency={currency}
      role={role}
      recentActivity={recentActivity}
      salesActivity={salesActivity}
      recentQuotations={recentQuotations}
      recentPreparedQuotations={recentPreparedQuotations}
      monthlyData={monthlyData}
      allQuotations={allQuotations}
      topClients={topClients}
      projects={projects}
      projectSummary={projectSummary}
      commissions={commissions}
    />
  );
}
