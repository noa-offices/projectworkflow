"use client";

import { useState } from "react";

const MILESTONE_OPTIONS = [
  { value: "deposit_paid", label: "💰 Deposit paid to factory" },
  { value: "production_initiated", label: "🏭 Factory production initiated" },
  { value: "containers_shipped", label: "🚢 Containers loaded & shipped" },
  { value: "goods_received", label: "📦 Goods received at warehouse" },
  { value: "installation_started", label: "🔧 Installation started on site" },
];

type ProcurementMilestoneFormProps = {
  orderNo: string;
};

export function ProcurementMilestoneForm({ orderNo }: ProcurementMilestoneFormProps) {
  const [selectedMilestone, setSelectedMilestone] = useState("deposit_paid");
  const [remark, setRemark] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function handleSubmit() {
    if (isPending) return;
    setIsPending(true);

    // INTEGRATION HOOK: BROADCAST TO PROJECT_ACTIVITY_TIMELINE
    // When Phase 3B persistence is ready, this submit handler should:
    // 1. INSERT into project_activity_logs:
    //    { order_no: orderNo, type: "status_change", milestone_key: selectedMilestone,
    //      action: label, detail: remark, created_by: auth.uid(),
    //      procurement_flag: true }
    // 2. The project activity timeline on /projects/orders/{orderNo} subscribes
    //    to this table via Supabase Realtime on channel project-activity-{orderNo}
    //    and will surface this entry automatically with the amber "Message to Procurement" badge.

    const label = MILESTONE_OPTIONS.find((o) => o.value === selectedMilestone)?.label ?? selectedMilestone;
    setSubmitted(`${label}${remark.trim() ? ` — ${remark.trim()}` : ""}`);
    setRemark("");
    setIsPending(false);
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">Log Procurement Action</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Post a milestone update for this project. This will broadcast to the Project Activity Timeline.
      </p>

      {submitted ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-sm text-emerald-800">✅ Posted: {submitted}</p>
          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
          >
            Post another
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <select
              value={selectedMilestone}
              onChange={(e) => setSelectedMilestone(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {MILESTONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="Optional remark (e.g. Batch 1 chairs only, 40ft container)..."
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="h-9 self-end rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300 sm:self-start sm:mt-0"
          >
            Post Status Update
          </button>
        </div>
      )}

      <p className="mt-2 text-[10px] text-zinc-400">
        {/* INTEGRATION HOOK: BROADCAST TO PROJECT_ACTIVITY_TIMELINE — see handler above */}
        Updates are local in Phase 3A. Live broadcast to Project Timeline ships in Phase 3B.
      </p>
    </section>
  );
}
