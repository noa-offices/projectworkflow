"use client";

import { useRouter } from "next/navigation";
import { ProfileActivity } from "@/components/settings/profile-activity";
import type { TeamMemberStat } from "@/lib/settings/profile-stats-loader";

type ActivityEntry = {
  id: string;
  action: string;
  title: string;
  description: string | null;
  entity_type: string;
  created_at: string;
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
  initialPreset: string;
  totalQuotations: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
  role: string | null;
  recentActivity: ActivityEntry[];
  recentQuotations: QuotationEntry[];
  teamStats?: TeamMemberStat[] | null;
  monthlyData: MonthlyDataPoint[];
  allQuotations: AllQuotationEntry[];
  topClients: TopClient[];
};

const VALID_PRESETS = ["this_month", "last_3_months", "last_6_months", "this_year"] as const;
type Preset = (typeof VALID_PRESETS)[number];

export function ProfileDashboardShell({
  initialPreset,
  totalQuotations,
  approvedQuotations,
  totalValue,
  currency,
  role,
  recentActivity,
  recentQuotations,
  monthlyData,
  allQuotations,
  topClients,
}: ProfileDashboardShellProps) {
  const router = useRouter();

  function handlePresetChange(preset: Preset) {
    router.push(`/settings/profile?preset=${preset}`);
  }

  return (
    <ProfileActivity
      totalQuotations={totalQuotations}
      approvedQuotations={approvedQuotations}
      totalValue={totalValue}
      currency={currency}
      role={role}
      recentActivity={recentActivity}
      recentQuotations={recentQuotations}
      monthlyData={monthlyData}
      allQuotations={allQuotations}
      topClients={topClients}
      selectedPreset={initialPreset}
      onPresetChange={handlePresetChange}
    />
  );
}
