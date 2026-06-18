"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, CreditCard, ClipboardCheck, RefreshCw, StickyNote } from "lucide-react";
import { logProjectActivityAction } from "@/lib/projects/log-project-activity-action";

type TimelineEventType = "arrival" | "payment" | "confirmation" | "status_change" | "note";

type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  actor: string;
  actorRole: string;
  action: string;
  detail?: string;
  timestamp: string;
  procurementFlag?: boolean;
};

type MilestoneKey =
  | "advance_payment_received"
  | "order_placed"
  | "production_started"
  | "goods_ready_for_shipment"
  | "goods_on_transit"
  | "goods_arrived"
  | "ready_for_delivery"
  | "delivered_at_site"
  | "installation_in_progress"
  | "final_payment_received"
  | "project_closed";

type MilestoneOption = {
  value: MilestoneKey;
  label: string;
  eventType: TimelineEventType;
};

const MILESTONE_OPTIONS: MilestoneOption[] = [
  { value: "advance_payment_received", label: "💰 Advance Payment Received",       eventType: "payment" },
  { value: "order_placed",             label: "📋 Order Placed",                   eventType: "confirmation" },
  { value: "production_started",       label: "🏭 Production Started at Factory",  eventType: "status_change" },
  { value: "goods_ready_for_shipment", label: "📦 Goods Ready for Shipment",       eventType: "status_change" },
  { value: "goods_on_transit",         label: "🚢 Goods on Transit",               eventType: "arrival" },
  { value: "goods_arrived",            label: "🛬 Goods Arrived",                  eventType: "arrival" },
  { value: "ready_for_delivery",       label: "🚛 Ready for Delivery",             eventType: "status_change" },
  { value: "delivered_at_site",        label: "✅ Delivered at Site",              eventType: "arrival" },
  { value: "installation_in_progress", label: "🔧 Installation in Progress",       eventType: "status_change" },
  { value: "final_payment_received",   label: "💳 Final Payment Received",         eventType: "payment" },
  { value: "project_closed",           label: "🎉 Project Closed",                 eventType: "confirmation" },
];

type ProjectActivityTimelineProps = {
  canLog: boolean;
  orderNo: string;
  quotationId: string;
  initialEvents?: ActivityLogRow[];
};

const PLACEHOLDER_EVENTS: TimelineEvent[] = [
  {
    id: "1",
    type: "arrival",
    actor: "Procurement Manager",
    actorRole: "procurement_manager",
    action: "Expected Goods Arrival updated",
    detail: "Revised delivery window: 15 Aug – 22 Aug 2026",
    timestamp: "2026-06-10T09:30:00Z",
  },
  {
    id: "2",
    type: "confirmation",
    actor: "Admin Manager",
    actorRole: "admin_manager",
    action: "Factory Order Confirmation received",
    detail: "Supplier: Al Rashed Furniture — OC-0107-001 filed",
    timestamp: "2026-06-08T14:15:00Z",
  },
  {
    id: "3",
    type: "payment",
    actor: "Admin Manager",
    actorRole: "admin_manager",
    action: "Deposit Payment Details logged",
    detail: "AED 10,670 — 50% deposit via bank transfer",
    timestamp: "2026-06-05T11:00:00Z",
  },
];

type ActivityLogRow = {
  id: string;
  entity_type: string;
  action: string;
  title: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};

function mapLogToEvent(log: ActivityLogRow): TimelineEvent {
  let type: TimelineEventType = "note";
  if (log.action === "vendor_milestone_updated" || log.entity_type === "project_activity") {
    if (log.title.includes("💰") || log.title.includes("💳")) type = "payment";
    else if (log.title.includes("🚢") || log.title.includes("🛬") || log.title.includes("🚛") || log.title.includes("✅")) type = "arrival";
    else if (log.title.includes("🏭") || log.title.includes("🔧") || log.title.includes("📦")) type = "status_change";
    else if (log.title.includes("📋") || log.title.includes("🎉")) type = "confirmation";
    else type = "status_change";
  }
  const isProjectActivity = log.entity_type === "project_activity";
  return {
    id: log.id,
    type,
    actor: isProjectActivity ? "Project Team" : "Procurement Manager",
    actorRole: isProjectActivity ? "manual_entry" : "procurement_manager",
    action: log.title,
    detail: log.description ?? undefined,
    timestamp: log.created_at,
  };
}

function eventIcon(type: TimelineEventType) {
  switch (type) {
    case "arrival": return Truck;
    case "payment": return CreditCard;
    case "confirmation": return ClipboardCheck;
    case "status_change": return RefreshCw;
    case "note": return StickyNote;
  }
}

function nodeColor(type: TimelineEventType): string {
  switch (type) {
    case "arrival": return "bg-blue-100 text-blue-700 border-blue-200";
    case "payment": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "confirmation": return "bg-violet-100 text-violet-700 border-violet-200";
    case "status_change": return "bg-amber-100 text-amber-700 border-amber-200";
    case "note": return "bg-zinc-100 text-zinc-600 border-zinc-200";
  }
}

function formatTs(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ProjectActivityTimeline({ canLog, orderNo, quotationId: _quotationId, initialEvents }: ProjectActivityTimelineProps) {
  const router = useRouter();
  const hasLiveEvents = (initialEvents ?? []).length > 0;
  const currentEvents = useMemo(() => {
    const live = (initialEvents ?? []).map(mapLogToEvent);
    return live.length > 0 ? live : PLACEHOLDER_EVENTS;
  }, [initialEvents]);
  const [showAll, setShowAll] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneKey>("advance_payment_received");
  const [remarkText, setRemarkText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const displayedEvents = showAll ? currentEvents : currentEvents.slice(0, 4);

  async function handleLogSubmit() {
    setIsSubmitting(true);
    setPostError(null);

    const milestone = MILESTONE_OPTIONS.find((m) => m.value === selectedMilestone)!;
    const result = await logProjectActivityAction(
      orderNo,
      milestone.value,
      milestone.label,
      remarkText.trim() || null,
    );

    if (!result.ok) {
      setPostError(result.error);
      setIsSubmitting(false);
      return;
    }

    setRemarkText("");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-950">Project Activity</h2>
        <span className="text-xs text-zinc-400">
          {showAll ? currentEvents.length : Math.min(4, currentEvents.length)} of {currentEvents.length} events
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">Timeline of project milestones and procurement events.</p>

      {canLog ? (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Add Activity Update
          </p>

          <div className="mt-2 grid gap-2">

            {/* Milestone dropdown */}
            <select
              value={selectedMilestone}
              onChange={(e) => setSelectedMilestone(e.target.value as MilestoneKey)}
              disabled={isSubmitting}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {MILESTONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Optional remark + Post button */}
            <div className="flex gap-2">
              <input
                type="text"
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogSubmit(); }}
                placeholder="Optional remark or detail..."
                disabled={isSubmitting}
                className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
              <button
                type="button"
                onClick={handleLogSubmit}
                disabled={isSubmitting}
                className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Posting…" : "Post"}
              </button>
            </div>

          </div>

          {postError ? (
            <p className="mt-2 rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {postError}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-zinc-400">
            ⚡ Updates are permanently logged to the project activity history.
          </p>
        </div>
      ) : null}

      <ol className="mt-6 space-y-0">
        {displayedEvents.map((event, index) => {
          const Icon = eventIcon(event.type);
          const colorClass = nodeColor(event.type);
          const isLast = index === displayedEvents.length - 1;

          return (
            <li key={event.id} className="relative flex gap-4 group">

              {/* Vertical line */}
              {!isLast && (
                <div className="absolute left-[19px] top-10 bottom-0 w-px bg-zinc-200" aria-hidden="true" />
              )}

              {/* Node icon */}
              <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${colorClass} transition group-hover:scale-110`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>

              {/* Content */}
              <div className={`mb-6 flex-1 rounded-lg border px-4 py-3 transition group-hover:shadow-sm ${
                event.procurementFlag
                  ? "border-amber-200 bg-amber-50 group-hover:border-amber-300 group-hover:bg-amber-50"
                  : "border-zinc-100 bg-zinc-50 group-hover:border-zinc-200 group-hover:bg-white"
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{event.action}</p>
                    {event.detail && (
                      <p className="mt-0.5 text-sm text-zinc-500">{event.detail}</p>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-zinc-400" dateTime={event.timestamp}>
                    {formatTs(event.timestamp)}
                  </time>
                </div>
                {event.procurementFlag ? (
                  <span className="mt-1.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Message to Procurement
                  </span>
                ) : null}
                <p className="mt-2 text-xs font-medium text-zinc-400">
                  {/* FUTURE PROCUREMENT HOOK: actor name will come from profiles join
                      on the activity log record's created_by UUID */}
                  by {event.actor}
                </p>
              </div>

            </li>
          );
        })}
      </ol>

      {currentEvents.length > 4 ? (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 w-full rounded-md border border-zinc-200 py-2 text-xs font-semibold text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
        >
          {showAll ? "Show less" : `Show all ${currentEvents.length} events`}
        </button>
      ) : null}

      {!hasLiveEvents ? (
        <p className="mt-2 rounded-md border border-dashed border-zinc-200 px-3 py-2 text-center text-xs text-zinc-400">
          No activity logged yet. Use the composer above to record the first milestone.
        </p>
      ) : null}
    </section>
  );
}
