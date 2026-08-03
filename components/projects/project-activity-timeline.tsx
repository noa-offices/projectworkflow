"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, CreditCard, ClipboardCheck, RefreshCw, StickyNote } from "lucide-react";
import {
  logProjectActivityAction,
  type ProjectActivityVendorScope,
} from "@/lib/projects/log-project-activity-action";

type TimelineEventType = "arrival" | "payment" | "confirmation" | "status_change" | "note";
type ActivityCategory = "General" | "Procurement" | "Logistics" | "Payment" | "Site" | "Installation" | "Document" | "Issue / Delay" | "Decision / Approval";

type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  actor: string;
  actorRole: string;
  action: string;
  detail?: string;
  timestamp: string;
  procurementFlag?: boolean;
  vendorKey?: string;
  vendorLabel?: string;
  vendorKeys?: string[];
  category: ActivityCategory;
};

export type ProjectActivityVendor = {
  vendorKey: string;
  vendorLabel: string;
  itemCount: number;
  formattedTotal: string;
  currentStage: string;
};

type ManualActivityKey = "general_note" | "client_communication" | "site_update" | "issue_delay" | "decision_approval" | "other";

type ManualActivityOption = {
  value: ManualActivityKey;
  label: string;
  eventType: TimelineEventType;
  category: ActivityCategory;
};

const MANUAL_ACTIVITY_OPTIONS: ManualActivityOption[] = [
  { value: "general_note", label: "General note", eventType: "note", category: "General" },
  { value: "client_communication", label: "Client communication", eventType: "note", category: "General" },
  { value: "site_update", label: "Site update", eventType: "status_change", category: "Site" },
  { value: "issue_delay", label: "Issue / delay", eventType: "status_change", category: "Issue / Delay" },
  { value: "decision_approval", label: "Decision / approval", eventType: "confirmation", category: "Decision / Approval" },
  { value: "other", label: "Other", eventType: "note", category: "General" },
];

const ACTIVITY_CATEGORIES: Array<"All" | ActivityCategory> = ["All", "General", "Procurement", "Logistics", "Payment", "Site", "Installation", "Document", "Issue / Delay", "Decision / Approval"];

type ProjectActivityTimelineProps = {
  canLog: boolean;
  orderNo: string;
  quotationId: string;
  initialEvents?: ActivityLogRow[];
  vendors?: ProjectActivityVendor[];
};

type ActivityLogRow = {
  id: string;
  entity_type: string;
  action: string;
  title: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
  metadata: unknown;
};

function activityMetadata(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function displayCategory(log: ActivityLogRow, metadata: Record<string, unknown>): ActivityCategory {
  const storedCategory = metadata.eventCategory;
  if (typeof storedCategory === "string" && ACTIVITY_CATEGORIES.includes(storedCategory as ActivityCategory)) {
    return storedCategory as ActivityCategory;
  }

  const stepKey = typeof metadata.stepKey === "string" ? metadata.stepKey : "";
  const text = `${log.action} ${log.title}`.toLowerCase();
  if (log.entity_type === "procurement_vendor") {
    if (["in_transit"].includes(stepKey)) return "Logistics";
    if (["delivered_installed"].includes(stepKey)) return "Installation";
    return "Procurement";
  }
  if (text.includes("payment")) return "Payment";
  if (text.includes("transit") || text.includes("shipment") || text.includes("arrived") || text.includes("delivery")) return "Logistics";
  if (text.includes("install")) return "Installation";
  if (text.includes("document") || text.includes("file")) return "Document";
  if (text.includes("issue") || text.includes("delay")) return "Issue / Delay";
  if (text.includes("decision") || text.includes("approval")) return "Decision / Approval";
  if (text.includes("site")) return "Site";
  return "General";
}

function mapLogToEvent(log: ActivityLogRow): TimelineEvent {
  const metadata = activityMetadata(log.metadata);
  const category = displayCategory(log, metadata);
  let type: TimelineEventType = "note";
  if (log.action === "vendor_milestone_updated" || log.entity_type === "project_activity") {
    const manualOption = MANUAL_ACTIVITY_OPTIONS.find((option) => option.value === log.action);
    if (manualOption) type = manualOption.eventType;
    else if (log.title.includes("💰") || log.title.includes("💳")) type = "payment";
    else if (log.title.includes("🚢") || log.title.includes("🛬") || log.title.includes("🚛") || log.title.includes("✅")) type = "arrival";
    else if (log.title.includes("🏭") || log.title.includes("🔧") || log.title.includes("📦")) type = "status_change";
    else if (log.title.includes("📋") || log.title.includes("🎉")) type = "confirmation";
    else type = "status_change";
  }
  const isProjectActivity = log.entity_type === "project_activity";
  const vendorKey = typeof metadata.vendorKey === "string" ? metadata.vendorKey : undefined;
  const vendorLabel = typeof metadata.vendorLabel === "string" ? metadata.vendorLabel : undefined;
  const vendorKeys = Array.isArray(metadata.vendors)
    ? metadata.vendors.flatMap((vendor) => {
        if (!vendor || typeof vendor !== "object") return [];
        const key = (vendor as Record<string, unknown>).vendorKey;
        return typeof key === "string" ? [key] : [];
      })
    : undefined;
  const allVendors = metadata.vendorScope === "all_vendors";
  const multipleVendors = metadata.vendorScope === "vendors";
  return {
    id: log.id,
    type,
    actor: isProjectActivity ? "Project Team" : "Procurement Manager",
    actorRole: isProjectActivity ? "manual_entry" : "procurement_manager",
    action: log.title,
    detail: log.description ?? undefined,
    timestamp: log.created_at,
    procurementFlag: log.entity_type === "procurement_vendor",
    vendorKey,
    vendorLabel: allVendors ? "All vendors" : multipleVendors ? `${vendorKeys?.length ?? 0} vendors` : vendorLabel,
    vendorKeys,
    category,
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

export function ProjectActivityTimeline({ canLog, orderNo, initialEvents, vendors = [] }: ProjectActivityTimelineProps) {
  const router = useRouter();
  const hasLiveEvents = (initialEvents ?? []).length > 0;
  const currentEvents = useMemo(() => {
    return (initialEvents ?? []).map(mapLogToEvent);
  }, [initialEvents]);
  const [showAll, setShowAll] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ManualActivityKey>("general_note");
  const [remarkText, setRemarkText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"All" | ActivityCategory>("All");
  const [visibleVendorKey, setVisibleVendorKey] = useState("all");
  const [selectedVendorKeys, setSelectedVendorKeys] = useState<string[]>([]);

  const filteredEvents = useMemo(() => currentEvents.filter((event) => {
    if (categoryFilter !== "All" && event.category !== categoryFilter) return false;
    if (visibleVendorKey === "all") return true;
    return event.vendorKey === visibleVendorKey || event.vendorKeys?.includes(visibleVendorKey);
  }), [categoryFilter, currentEvents, visibleVendorKey]);
  const selectedVisibleVendor = vendors.find((vendor) => vendor.vendorKey === visibleVendorKey) ?? null;
  const displayedEvents = showAll ? filteredEvents : filteredEvents.slice(0, 4);

  async function handleLogSubmit() {
    setIsSubmitting(true);
    setPostError(null);

    const activity = MANUAL_ACTIVITY_OPTIONS.find((option) => option.value === selectedActivity)!;
    let vendorScope: ProjectActivityVendorScope = { kind: "project" };
    const selectedVendors = vendors.filter((vendor) => selectedVendorKeys.includes(vendor.vendorKey));
    if (selectedVendors.length === vendors.length && vendors.length > 0) {
      if (!window.confirm(`Post this update for all ${vendors.length} vendors?`)) {
        setIsSubmitting(false);
        return;
      }
      vendorScope = {
        kind: "all_vendors",
        vendors: vendors.map((vendor) => ({ vendorKey: vendor.vendorKey, vendorLabel: vendor.vendorLabel })),
      };
    } else if (selectedVendors.length === 1) {
      vendorScope = { kind: "vendor", vendorKey: selectedVendors[0].vendorKey, vendorLabel: selectedVendors[0].vendorLabel };
    } else if (selectedVendors.length > 1) {
      vendorScope = {
        kind: "vendors",
        vendors: selectedVendors.map((vendor) => ({ vendorKey: vendor.vendorKey, vendorLabel: vendor.vendorLabel })),
      };
    }
    const result = await logProjectActivityAction(
      orderNo,
      activity.value,
      activity.label,
      remarkText.trim() || null,
      vendorScope,
      activity.category,
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
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-950">Project Activity</h2>
        <span className="text-xs text-zinc-400">
          {showAll ? filteredEvents.length : Math.min(4, filteredEvents.length)} of {filteredEvents.length} events
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">Timeline of project milestones and procurement events.</p>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "All" | ActivityCategory)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-emerald-800">
            {ACTIVITY_CATEGORIES.map((category) => <option key={category} value={category}>{category === "All" ? "All activity" : category}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Vendor</span>
          <select value={visibleVendorKey} onChange={(event) => setVisibleVendorKey(event.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-emerald-800">
            <option value="all">All project and vendor activity</option>
            {vendors.map((vendor) => <option key={vendor.vendorKey} value={vendor.vendorKey}>{vendor.vendorLabel}</option>)}
          </select>
        </label>
      </div>

      {selectedVisibleVendor ? (
        <div className="mt-3 rounded-md border border-violet-100 bg-violet-50 px-3 py-2">
          <p className="truncate text-sm font-semibold text-violet-950" title={selectedVisibleVendor.vendorLabel}>{selectedVisibleVendor.vendorLabel}</p>
          <p className="mt-0.5 text-xs text-violet-700">{selectedVisibleVendor.itemCount} items &middot; {selectedVisibleVendor.formattedTotal}</p>
          <p className="mt-0.5 text-xs font-medium text-violet-800">Current procurement stage: {selectedVisibleVendor.currentStage}</p>
        </div>
      ) : null}

      {canLog ? (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Add Activity Update
          </p>

          <div className="mt-2 grid gap-2">

            {vendors.length > 0 ? (
              <fieldset className="min-w-0">
                <legend className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Vendor scope</legend>
                <p className="mt-1 text-[11px] text-zinc-400">Leave all unchecked for a project-wide note, or select one or more vendors.</p>
                <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 sm:grid-cols-2">
                  {vendors.map((vendor) => (
                    <label key={vendor.vendorKey} className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">
                      <input
                        type="checkbox"
                        checked={selectedVendorKeys.includes(vendor.vendorKey)}
                        disabled={isSubmitting}
                        onChange={(event) => setSelectedVendorKeys((current) => event.target.checked ? [...current, vendor.vendorKey] : current.filter((key) => key !== vendor.vendorKey))}
                        className="h-4 w-4 shrink-0 accent-emerald-800"
                      />
                      <span className="truncate" title={vendor.vendorLabel}>{vendor.vendorLabel}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <label className="block min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Manual activity type</span>
              <select
                value={selectedActivity}
                onChange={(e) => setSelectedActivity(e.target.value as ManualActivityKey)}
                disabled={isSubmitting}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 xl:h-9"
              >
                {MANUAL_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            {/* Optional remark + Post button */}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Optional remark</span>
                <input
                  type="text"
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleLogSubmit(); }}
                  placeholder="Optional remark or detail..."
                  disabled={isSubmitting}
                  className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 xl:h-9"
                />
              </label>
              <button
                type="button"
                onClick={handleLogSubmit}
                disabled={isSubmitting}
                className="h-10 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 xl:h-9"
              >
                {isSubmitting ? "Posting…" : "Post update"}
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
            <li key={event.id} className="group relative flex gap-2.5 sm:gap-4">

              {/* Vertical line */}
              {!isLast && (
                <div className="absolute bottom-0 left-[15px] top-8 w-px bg-zinc-200 sm:left-[19px] sm:top-10" aria-hidden="true" />
              )}

              {/* Node icon */}
              <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 sm:h-10 sm:w-10 ${colorClass} transition group-hover:scale-110`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>

              {/* Content */}
              <div className={`mb-4 min-w-0 flex-1 rounded-lg border px-3 py-2.5 transition group-hover:shadow-sm sm:mb-6 sm:px-4 sm:py-3 ${
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
                <span className="mt-1.5 inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-600">{event.category}</span>
                {event.procurementFlag ? (
                  <span className="mt-1.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Procurement
                  </span>
                ) : null}
                {event.vendorLabel ? (
                  <span className="mt-1.5 ml-1 inline-flex max-w-full truncate rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800" title={event.vendorLabel}>
                    {event.vendorLabel}
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

      {filteredEvents.length > 4 ? (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 w-full rounded-md border border-zinc-200 py-2 text-xs font-semibold text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700"
        >
          {showAll ? "Show less" : `Show all ${filteredEvents.length} events`}
        </button>
      ) : null}

      {!hasLiveEvents ? (
        <p className="mt-2 rounded-md border border-dashed border-zinc-200 px-3 py-2 text-center text-xs text-zinc-400">
          No activity logged yet. Use the composer above to record the first project update.
        </p>
      ) : null}
      {hasLiveEvents && filteredEvents.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">No activity matches the selected filters.</p>
      ) : null}
    </section>
  );
}
