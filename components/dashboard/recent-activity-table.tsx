import { DashboardCard } from "@/components/dashboard/dashboard-card";

export type RecentActivity = {
  module: string;
  owner: string;
  status: string;
  time: string;
  title: string;
};

export function RecentActivityTable({ activities }: { activities: RecentActivity[] }) {
  return (
    <DashboardCard className="overflow-hidden">
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-950">Recent Activity</p>
        <p className="mt-1 text-xs text-zinc-500">Latest cached workspace actions and document updates.</p>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[680px] table-fixed border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold">Activity</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold">Module</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold">Owner</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold">Status</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => (
              <tr key={`${activity.title}-${activity.time}`} className="hover:bg-zinc-50">
                <td className="border-b border-zinc-100 px-4 py-3 font-medium text-zinc-950">{activity.title}</td>
                <td className="border-b border-zinc-100 px-4 py-3 text-zinc-600">{activity.module}</td>
                <td className="border-b border-zinc-100 px-4 py-3 text-zinc-600">{activity.owner}</td>
                <td className="border-b border-zinc-100 px-4 py-3">
                  <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                    {activity.status}
                  </span>
                </td>
                <td className="border-b border-zinc-100 px-4 py-3 text-zinc-500">{activity.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}
