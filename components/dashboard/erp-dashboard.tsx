"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  FileText,
  Library,
  PackageSearch,
  ReceiptText,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { AlertsPanel, type DashboardAlert } from "@/components/dashboard/alerts-panel";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { KPIWidget } from "@/components/dashboard/kpi-widget";
import { LocalStatusCard } from "@/components/dashboard/local-status-card";
import { RecentActivityTable, type RecentActivity } from "@/components/dashboard/recent-activity-table";

type DashboardSnapshot = {
  activities: RecentActivity[];
  kpis: {
    activeOrders: string;
    pendingQuotations: string;
    stockAlerts: string;
    totalProjects: string;
  };
  lastSyncLabel: string;
  pendingWrites: number;
  source: string;
};

const CACHE_KEY = "projectworkflow.dashboard.snapshot.v1";

const defaultSnapshot: DashboardSnapshot = {
  activities: [
    { title: "Local quotation workspace updated", module: "Quotation Builder", owner: "Sales", status: "Cached", time: "2 min ago" },
    { title: "Supplier RFQ draft prepared", module: "Procurement", owner: "Operations", status: "Queued", time: "18 min ago" },
    { title: "Product template price check flagged", module: "Product Library", owner: "Admin", status: "Review", time: "42 min ago" },
    { title: "Order confirmation settings synced", module: "Order Confirmation", owner: "Sales", status: "Synced", time: "Today" },
    { title: "Presentation export settings saved", module: "Reports", owner: "Design", status: "Local", time: "Yesterday" },
  ],
  kpis: {
    activeOrders: "18",
    pendingQuotations: "27",
    stockAlerts: "6",
    totalProjects: "142",
  },
  lastSyncLabel: "Local cache",
  pendingWrites: 3,
  source: "IndexedDB/localStorage cache",
};

function readCachedSnapshot() {
  if (typeof window === "undefined") return defaultSnapshot;

  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (!cached) return defaultSnapshot;
    const parsed = JSON.parse(cached) as Partial<DashboardSnapshot>;

    return {
      activities: Array.isArray(parsed.activities) ? parsed.activities : defaultSnapshot.activities,
      kpis: {
        ...defaultSnapshot.kpis,
        ...(parsed.kpis && typeof parsed.kpis === "object" ? parsed.kpis : {}),
      },
      lastSyncLabel: typeof parsed.lastSyncLabel === "string" ? parsed.lastSyncLabel : defaultSnapshot.lastSyncLabel,
      pendingWrites: Number.isFinite(Number(parsed.pendingWrites)) ? Number(parsed.pendingWrites) : defaultSnapshot.pendingWrites,
      source: typeof parsed.source === "string" ? parsed.source : defaultSnapshot.source,
    };
  } catch {
    return defaultSnapshot;
  }
}

function writeCachedSnapshot(snapshot: DashboardSnapshot) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

const alerts: DashboardAlert[] = [
  {
    title: "Stock alerts pending",
    detail: "Six product lines need procurement review before the next supplier RFQ cycle.",
    icon: AlertTriangle,
    tone: "bg-red-50 text-red-700",
  },
  {
    title: "Offline writes queued",
    detail: "Local workspace changes are ready to sync when the server connection is stable.",
    icon: Bell,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    title: "Price review due",
    detail: "Several product templates are past their price check interval.",
    icon: ShieldCheck,
    tone: "bg-blue-50 text-blue-700",
  },
];

const moduleShortcuts = [
  {
    title: "Quotation Builder",
    description: "Create, price, and save client quotation workspaces.",
    href: "/quotations",
    icon: FileText,
  },
  {
    title: "Product Library",
    description: "Maintain templates, finishes, product images, and source pricing.",
    href: "/products",
    icon: Library,
  },
  {
    title: "Procurement",
    description: "Review supplier RFQs and purchasing work in progress.",
    href: "/quotations",
    icon: PackageSearch,
  },
  {
    title: "Order Confirmation",
    description: "Prepare client approval documents and order handoff details.",
    href: "/quotations",
    icon: ReceiptText,
  },
];

export function ERPDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => readCachedSnapshot());
  const [online, setOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }

    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncDashboardSnapshot() {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      if (cancelled) return;

      const syncedSnapshot: DashboardSnapshot = {
        ...defaultSnapshot,
        lastSyncLabel: "Just now",
        pendingWrites: 0,
        source: "Local cache + Supabase sync",
      };

      writeCachedSnapshot(syncedSnapshot);
      setSnapshot(syncedSnapshot);
    }

    syncDashboardSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = useMemo(
    () => [
      {
        label: "Total Projects",
        value: snapshot.kpis.totalProjects,
        description: "Active and archived project records.",
        trend: "Local cache ready",
        icon: Building2,
        accent: "bg-blue-50 text-blue-700",
      },
      {
        label: "Pending Quotations",
        value: snapshot.kpis.pendingQuotations,
        description: "Draft and awaiting-review quotations.",
        trend: "Synced after local render",
        icon: FileText,
        accent: "bg-emerald-50 text-emerald-800",
      },
      {
        label: "Active Orders / RFQs",
        value: snapshot.kpis.activeOrders,
        description: "Supplier and order documents in motion.",
        trend: "Procurement queue healthy",
        icon: Truck,
        accent: "bg-violet-50 text-violet-700",
      },
      {
        label: "Stock Alerts",
        value: snapshot.kpis.stockAlerts,
        description: "Items needing stock or price review.",
        trend: "Requires review",
        icon: AlertTriangle,
        accent: "bg-red-50 text-red-700",
      },
    ],
    [snapshot],
  );

  return (
    <div className="grid gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KPIWidget key={kpi.label} {...kpi} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-5">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {moduleShortcuts.map((shortcut) => {
              const Icon = shortcut.icon;
              const card = (
                <DashboardCard className="h-full p-4 transition group-hover:border-emerald-900 group-hover:shadow-md">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 group-hover:bg-emerald-50 group-hover:text-emerald-900">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-zinc-950">{shortcut.title}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-600">{shortcut.description}</p>
                </DashboardCard>
              );

              return shortcut.href ? (
                <Link key={shortcut.title} href={shortcut.href} className="group">
                  {card}
                </Link>
              ) : (
                <div key={shortcut.title} className="group">
                  {card}
                </div>
              );
            })}
          </section>

          <RecentActivityTable activities={snapshot.activities} />
        </div>

        <aside className="grid gap-5 xl:content-start">
          <AlertsPanel alerts={alerts} />
          <LocalStatusCard
            lastSyncLabel={snapshot.lastSyncLabel}
            online={online}
            pendingWrites={snapshot.pendingWrites}
            source={snapshot.source}
          />
          <DashboardCard className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-zinc-950">Sync Policy</p>
                <p className="mt-1 text-xs text-zinc-500">Render cached data first, refresh quietly, keep work moving.</p>
              </div>
            </div>
          </DashboardCard>
        </aside>
      </section>
    </div>
  );
}
