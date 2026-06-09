"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/currencies";

type SalesEnquiryStatus =
  | "New"
  | "Contacted"
  | "Need More Details"
  | "Qualified"
  | "Lost"
  | "Converted to Opportunity";

type SalesEnquirySource = "Website" | "Email" | "Phone" | "WhatsApp" | "Referral" | "Walk-in" | "LinkedIn" | "Other";
type SalesEnquirySyncStatus = "local" | "pending" | "synced";
type SalesEnquiryFilterStatus = "All statuses" | SalesEnquiryStatus | "Archived";
type SalesEnquirySourceFilter = "All sources" | SalesEnquirySource;

type SalesEnquiry = {
  id: string;
  enquiryNo: string;
  title: string;
  clientName: string;
  contactName: string;
  phone?: string;
  email?: string;
  requirement: string;
  source: SalesEnquirySource;
  status: SalesEnquiryStatus;
  estimatedValue?: number;
  assignedTo: string;
  nextFollowUp?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  localSyncStatus: SalesEnquirySyncStatus;
  isArchived?: boolean;
};

type SalesEnquiryDraft = {
  title: string;
  clientName: string;
  contactName: string;
  phone: string;
  email: string;
  requirement: string;
  source: SalesEnquirySource | "";
  status: SalesEnquiryStatus | "";
  estimatedValue: string;
  assignedTo: string;
  nextFollowUp: string;
  notes: string;
};

const LOCAL_STORAGE_KEY = "projectworkflow.sales.enquiries.v1";

const STATUS_OPTIONS: SalesEnquiryStatus[] = [
  "New",
  "Contacted",
  "Need More Details",
  "Qualified",
  "Lost",
  "Converted to Opportunity",
];

const FILTER_STATUS_OPTIONS: SalesEnquiryFilterStatus[] = ["All statuses", ...STATUS_OPTIONS, "Archived"];
const SOURCE_OPTIONS: SalesEnquirySource[] = ["Website", "Email", "Phone", "WhatsApp", "Referral", "Walk-in", "LinkedIn", "Other"];

const SYNC_LABELS: Record<SalesEnquirySyncStatus, string> = {
  local: "Saved locally",
  pending: "Pending server sync",
  synced: "Synced ready",
};

const SYNC_CLASSES: Record<SalesEnquirySyncStatus, string> = {
  local: "border-sky-200 bg-sky-50 text-sky-900",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  synced: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

function seedEnquiries(): SalesEnquiry[] {
  return [
    {
      id: "enq-1",
      enquiryNo: "ENQ-2026-014",
      title: "Executive office refresh",
      clientName: "Gulf Meridian",
      contactName: "Noura Al Mansoori",
      phone: "+971 50 555 0140",
      email: "noura@gulfmeridian.ae",
      requirement: "Workstations, executive desks, and meeting room storage for a partial office refresh.",
      source: "Website",
      status: "New",
      estimatedValue: 185000,
      assignedTo: "Aisha Khan",
      nextFollowUp: "2026-06-12",
      notes: "Client asked for a budget range and lead time before confirming a site visit.",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "enq-2",
      enquiryNo: "ENQ-2026-013",
      title: "Hospitality loose furniture package",
      clientName: "Marina View Hotel",
      contactName: "Daniel Foster",
      phone: "+971 55 555 0131",
      email: "daniel@marinaviewhotel.com",
      requirement: "Lobby lounge chairs, side tables, and outdoor dining furniture for renovation phase one.",
      source: "Referral",
      status: "Contacted",
      estimatedValue: 320000,
      assignedTo: "Omar Nasser",
      nextFollowUp: "2026-06-10",
      notes: "Follow up with revised seating count and request current floor plan from the operator.",
      createdAt: "2026-06-02T10:00:00.000Z",
      updatedAt: "2026-06-02T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "enq-3",
      enquiryNo: "ENQ-2026-012",
      title: "Clinic reception and storage",
      clientName: "Al Noor Clinic",
      contactName: "Dr. Lina Haddad",
      phone: "+971 50 555 0122",
      email: "lina@alnoorclinic.ae",
      requirement: "Reception counter, visitor seating, staff lockers, and back-office shelving.",
      source: "Phone",
      status: "Qualified",
      estimatedValue: 96500,
      assignedTo: "Maya Thomas",
      nextFollowUp: "2026-06-14",
      notes: "Budget and timeline confirmed. Ready for a quotation scope review.",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z",
      localSyncStatus: "pending",
    },
    {
      id: "enq-4",
      enquiryNo: "ENQ-2026-011",
      title: "Education campus furniture inquiry",
      clientName: "Northbridge Academy",
      contactName: "Khaled Saeed",
      phone: "+971 52 555 0114",
      email: "khaled@northbridgeacademy.edu",
      requirement: "Classroom desks, library shelving, teacher stations, and multipurpose hall chairs.",
      source: "Email",
      status: "Need More Details",
      estimatedValue: 410000,
      assignedTo: "Aisha Khan",
      nextFollowUp: "2026-06-11",
      notes: "Procurement team requested catalogue options grouped by learning zone.",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "enq-5",
      enquiryNo: "ENQ-2026-010",
      title: "Residential villa custom joinery",
      clientName: "Private Client",
      contactName: "Priya Menon",
      phone: "+971 56 555 0107",
      email: "priya@example.com",
      requirement: "Wardrobes, display wall, study desk, and feature shelving for a private villa.",
      source: "Walk-in",
      status: "Lost",
      estimatedValue: 140000,
      assignedTo: "Omar Nasser",
      nextFollowUp: "Closed",
      notes: "Client selected a residential contractor. Keep the contact for future loose furniture requests.",
      createdAt: "2026-06-05T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "enq-6",
      enquiryNo: "ENQ-2026-009",
      title: "Co-working pod expansion",
      clientName: "WorkNest",
      contactName: "Sami Rahman",
      phone: "+971 54 555 0098",
      email: "sami@worknest.co",
      requirement: "Acoustic pods, modular benching, lockers, and breakout tables for new floor expansion.",
      source: "LinkedIn",
      status: "Converted to Opportunity",
      estimatedValue: 275000,
      assignedTo: "Maya Thomas",
      nextFollowUp: "2026-06-13",
      notes: "Decision maker confirmed. Keep the record for workflow history.",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      localSyncStatus: "pending",
    },
  ];
}

function cloneEnquiries(records: SalesEnquiry[]) {
  return records.map((record) => ({ ...record }));
}

function isSalesEnquiryStatus(value: unknown): value is SalesEnquiryStatus {
  return typeof value === "string" && STATUS_OPTIONS.includes(value as SalesEnquiryStatus);
}

function isSalesEnquirySource(value: unknown): value is SalesEnquirySource {
  return typeof value === "string" && SOURCE_OPTIONS.includes(value as SalesEnquirySource);
}

function isSalesEnquirySyncStatus(value: unknown): value is SalesEnquirySyncStatus {
  return value === "local" || value === "pending" || value === "synced";
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeEnquiry(raw: unknown, index: number): SalesEnquiry | null {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Record<string, unknown>;
  const title = safeString(data.title);
  const clientName = safeString(data.clientName);
  const requirement = safeString(data.requirement);
  const source = isSalesEnquirySource(data.source) ? data.source : null;
  const status = isSalesEnquiryStatus(data.status) ? data.status : null;

  if (!title || !clientName || !requirement || !source || !status) return null;

  const createdAt = safeString(data.createdAt) || new Date().toISOString();
  const updatedAt = safeString(data.updatedAt) || createdAt;

  return {
    id: safeString(data.id) || `enq-${index + 1}`,
    enquiryNo: safeString(data.enquiryNo) || `ENQ-${new Date().getFullYear()}-${String(index + 1).padStart(3, "0")}`,
    title,
    clientName,
    contactName: safeString(data.contactName),
    phone: safeString(data.phone) || undefined,
    email: safeString(data.email) || undefined,
    requirement,
    source,
    status,
    estimatedValue: safeNumber(data.estimatedValue),
    assignedTo: safeString(data.assignedTo) || "Unassigned",
    nextFollowUp: safeString(data.nextFollowUp) || undefined,
    notes: safeString(data.notes) || undefined,
    createdAt,
    updatedAt,
    localSyncStatus: isSalesEnquirySyncStatus(data.localSyncStatus) ? data.localSyncStatus : "local",
    isArchived: Boolean(data.isArchived),
  };
}

function normalizeEnquiryList(raw: unknown) {
  if (!Array.isArray(raw)) return cloneEnquiries(seedEnquiries());

  const normalized = raw
    .map((item, index) => normalizeEnquiry(item, index))
    .filter((item): item is SalesEnquiry => Boolean(item));

  return normalized.length ? normalized : cloneEnquiries(seedEnquiries());
}

function createEmptyDraft(): SalesEnquiryDraft {
  return {
    title: "",
    clientName: "",
    contactName: "",
    phone: "",
    email: "",
    requirement: "",
    source: "Website",
    status: "New",
    estimatedValue: "",
    assignedTo: "",
    nextFollowUp: "",
    notes: "",
  };
}

function draftFromEnquiry(enquiry: SalesEnquiry): SalesEnquiryDraft {
  return {
    title: enquiry.title,
    clientName: enquiry.clientName,
    contactName: enquiry.contactName,
    phone: enquiry.phone ?? "",
    email: enquiry.email ?? "",
    requirement: enquiry.requirement,
    source: enquiry.source,
    status: enquiry.status,
    estimatedValue: enquiry.estimatedValue !== undefined ? String(enquiry.estimatedValue) : "",
    assignedTo: enquiry.assignedTo,
    nextFollowUp: enquiry.nextFollowUp ?? "",
    notes: enquiry.notes ?? "",
  };
}

function statusClassName(status: SalesEnquiryStatus) {
  switch (status) {
    case "New":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "Contacted":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "Need More Details":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Qualified":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "Lost":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "Converted to Opportunity":
      return "border-indigo-200 bg-indigo-50 text-indigo-900";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }
}

function syncClassName(status: SalesEnquirySyncStatus) {
  return SYNC_CLASSES[status];
}

function formatEstimatedValue(value?: number) {
  if (value === undefined) return "Not set";
  return formatMoney("AED", value, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function formatDisplayDate(value?: string) {
  if (!value) return "Not set";
  if (value === "Closed") return "Closed";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function plannedNextActions(enquiry: SalesEnquiry) {
  switch (enquiry.status) {
    case "New":
      return [
        "Confirm the contact details and client requirement summary.",
        "Set the next follow-up and prepare a discovery call.",
        "Qualify budget, timeline, and decision maker.",
      ];
    case "Contacted":
      return [
        "Capture follow-up notes from the latest conversation.",
        "Clarify scope and request missing requirement details.",
        "Move to qualification once enough detail is confirmed.",
      ];
    case "Need More Details":
      return [
        "Request the missing dimensions, quantities, or specification notes.",
        "Update the enquiry after the client responds.",
        "Prepare a qualification summary for future quoting.",
      ];
    case "Qualified":
      return [
        "Keep the record warm and maintain follow-up discipline.",
        "Prepare the enquiry for quotation planning in a later phase.",
        "Track commercial interest and decision maker feedback.",
      ];
    case "Lost":
      return [
        "Record the loss reason for sales history.",
        "Keep the contact warm for future opportunities.",
        "Retain the enquiry locally for reference and follow-up context.",
      ];
    case "Converted to Opportunity":
      return [
        "Hold the record as a local history item.",
        "Opportunity conversion will be connected in a later phase.",
        "Keep the source enquiry available for reference.",
      ];
    default:
      return [];
  }
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-zinc-950">{value}</p>
    </section>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>;
}

export function EnquiriesPreview() {
  const [enquiries, setEnquiries] = useState<SalesEnquiry[]>(() => cloneEnquiries(seedEnquiries()));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SalesEnquiryFilterStatus>("All statuses");
  const [sourceFilter, setSourceFilter] = useState<SalesEnquirySourceFilter>("All sources");
  const [assignedFilter, setAssignedFilter] = useState("All users");
  const [selectedId, setSelectedId] = useState(() => seedEnquiries()[0]?.id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalesEnquiryDraft>(() => createEmptyDraft());
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!saved) {
          setEnquiries(cloneEnquiries(seedEnquiries()));
          setHasLoaded(true);
          return;
        }

        setEnquiries(normalizeEnquiryList(JSON.parse(saved) as unknown));
      } catch {
        setEnquiries(cloneEnquiries(seedEnquiries()));
      } finally {
        setHasLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(enquiries));
  }, [enquiries, hasLoaded]);

  const activeEnquiries = useMemo(() => enquiries.filter((enquiry) => !enquiry.isArchived), [enquiries]);

  const assignedOptions = useMemo(() => {
    const options = new Set<string>(["All users"]);
    enquiries.forEach((enquiry) => {
      if (enquiry.assignedTo.trim()) options.add(enquiry.assignedTo.trim());
    });
    return Array.from(options);
  }, [enquiries]);

  const filteredEnquiries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return enquiries.filter((enquiry) => {
      const archivedMatch = statusFilter === "Archived" ? enquiry.isArchived : !enquiry.isArchived;
      if (!archivedMatch) return false;

      if (statusFilter !== "All statuses" && statusFilter !== "Archived" && enquiry.status !== statusFilter) {
        return false;
      }

      if (sourceFilter !== "All sources" && enquiry.source !== sourceFilter) {
        return false;
      }

      if (assignedFilter !== "All users" && enquiry.assignedTo !== assignedFilter) {
        return false;
      }

      if (!normalizedQuery) return true;

      return [
        enquiry.enquiryNo,
        enquiry.title,
        enquiry.clientName,
        enquiry.contactName,
        enquiry.phone,
        enquiry.email,
        enquiry.requirement,
        enquiry.source,
        enquiry.status,
        enquiry.assignedTo,
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [assignedFilter, enquiries, searchQuery, sourceFilter, statusFilter]);

  const selectedEnquiry =
    filteredEnquiries.find((enquiry) => enquiry.id === selectedId) ??
    filteredEnquiries[0] ??
    enquiries.find((enquiry) => enquiry.id === selectedId) ??
    null;

  const summaryCounts = useMemo(
    () => ({
      new: activeEnquiries.filter((enquiry) => enquiry.status === "New").length,
      followUpDue: activeEnquiries.filter((enquiry) => enquiry.status === "Contacted" || enquiry.status === "Need More Details").length,
      qualified: activeEnquiries.filter((enquiry) => enquiry.status === "Qualified" || enquiry.status === "Converted to Opportunity").length,
      lost: activeEnquiries.filter((enquiry) => enquiry.status === "Lost").length,
    }),
    [activeEnquiries],
  );

  function openCreateForm() {
    setEditingId(null);
    setDraft(createEmptyDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(enquiry: SalesEnquiry) {
    setEditingId(enquiry.id);
    setDraft(draftFromEnquiry(enquiry));
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
  }

  function handleSaveEnquiry() {
    const title = draft.title.trim();
    const clientName = draft.clientName.trim();
    const requirement = draft.requirement.trim();
    const source = draft.source;
    const status = draft.status;

    if (!title || !clientName || !requirement || !source || !status) {
      setFormError("Title, client name, requirement, source, and status are required.");
      return;
    }

    const now = new Date().toISOString();

    if (editingId) {
      let updatedId = editingId;

      setEnquiries((current) =>
        current.map((enquiry) => {
          if (enquiry.id !== editingId) return enquiry;
          updatedId = enquiry.id;
          return {
            ...enquiry,
            title,
            clientName,
            contactName: draft.contactName.trim(),
            phone: draft.phone.trim() || undefined,
            email: draft.email.trim() || undefined,
            requirement,
            source,
            status,
            estimatedValue: draft.estimatedValue.trim() ? Number(draft.estimatedValue) : undefined,
            assignedTo: draft.assignedTo.trim() || "Unassigned",
            nextFollowUp: draft.nextFollowUp || undefined,
            notes: draft.notes.trim() || undefined,
            updatedAt: now,
            localSyncStatus: "pending",
          };
        }),
      );

      setSelectedId(updatedId);
      closeForm();
      return;
    }

    const existingNumbers = enquiries
      .map((enquiry) => Number(enquiry.enquiryNo.replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const nextNumber = Math.max(0, ...existingNumbers) + 1;
    const newEnquiry: SalesEnquiry = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `enq-${Date.now()}`,
      enquiryNo: `ENQ-${new Date().getFullYear()}-${String(nextNumber).padStart(3, "0")}`,
      title,
      clientName,
      contactName: draft.contactName.trim(),
      phone: draft.phone.trim() || undefined,
      email: draft.email.trim() || undefined,
      requirement,
      source,
      status,
      estimatedValue: draft.estimatedValue.trim() ? Number(draft.estimatedValue) : undefined,
      assignedTo: draft.assignedTo.trim() || "Unassigned",
      nextFollowUp: draft.nextFollowUp || undefined,
      notes: draft.notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      localSyncStatus: "pending",
      isArchived: false,
    };

    setEnquiries((current) => [newEnquiry, ...current]);
    setSelectedId(newEnquiry.id);
    closeForm();
  }

  function toggleArchive(enquiry: SalesEnquiry) {
    if (!enquiry.isArchived && !window.confirm(`Archive ${enquiry.enquiryNo}?`)) {
      return;
    }

    const now = new Date().toISOString();
    setEnquiries((current) =>
      current.map((item) =>
        item.id === enquiry.id
          ? {
              ...item,
              isArchived: !item.isArchived,
              updatedAt: now,
              localSyncStatus: "pending",
            }
          : item,
      ),
    );
  }

  function resetDemoData() {
    if (!window.confirm("Reset local enquiry data back to the demo seed records?")) return;

    const seed = cloneEnquiries(seedEnquiries());
    setEnquiries(seed);
    setSearchQuery("");
    setStatusFilter("All statuses");
    setSourceFilter("All sources");
    setAssignedFilter("All users");
    setSelectedId(seed[0]?.id ?? "");
    closeForm();
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  function handleDraftChange<K extends keyof SalesEnquiryDraft>(key: K, value: SalesEnquiryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">SALES</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950">Leads / Enquiries</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">
              Capture new client enquiries before they become qualified sales opportunities.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              + New Enquiry
            </button>
            <button
              type="button"
              onClick={resetDemoData}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset demo/local enquiries
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
            Saved locally. Server sync will be added in the next phase.
          </span>
          <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">
            Local-only preview
          </span>
        </div>
      </section>

      {formOpen ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Enquiry form</p>
              <h2 className="text-lg font-semibold text-zinc-950">{editingId ? "Edit enquiry" : "Create enquiry"}</h2>
            </div>
            <span className={`inline-flex rounded-md border px-3 py-2 text-xs font-semibold ${syncClassName("pending")}`}>
              {SYNC_LABELS.pending}
            </span>
          </div>

          {formError ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{formError}</p>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <FieldLabel label="Title" />
              <input
                value={draft.title}
                onChange={(event) => handleDraftChange("title", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Client name" />
              <input
                value={draft.clientName}
                onChange={(event) => handleDraftChange("clientName", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Contact name" />
              <input
                value={draft.contactName}
                onChange={(event) => handleDraftChange("contactName", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Phone" />
              <input
                value={draft.phone}
                onChange={(event) => handleDraftChange("phone", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Email" />
              <input
                type="email"
                value={draft.email}
                onChange={(event) => handleDraftChange("email", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block md:col-span-2 xl:col-span-3">
              <FieldLabel label="Requirement" />
              <textarea
                value={draft.requirement}
                onChange={(event) => handleDraftChange("requirement", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Source" />
              <select
                value={draft.source}
                onChange={(event) => handleDraftChange("source", event.target.value as SalesEnquirySource | "")}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                <option value="">Select source</option>
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel label="Status" />
              <select
                value={draft.status}
                onChange={(event) => handleDraftChange("status", event.target.value as SalesEnquiryStatus | "")}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                <option value="">Select status</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel label="Estimated value" />
              <input
                type="number"
                min="0"
                value={draft.estimatedValue}
                onChange={(event) => handleDraftChange("estimatedValue", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Assigned to" />
              <input
                value={draft.assignedTo}
                onChange={(event) => handleDraftChange("assignedTo", event.target.value)}
                list="enquiry-assignees"
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
              <datalist id="enquiry-assignees">
                {assignedOptions
                  .filter((option) => option !== "All users")
                  .map((option) => (
                    <option key={option} value={option} />
                  ))}
              </datalist>
            </label>
            <label className="block">
              <FieldLabel label="Next follow-up" />
              <input
                type="date"
                value={draft.nextFollowUp}
                onChange={(event) => handleDraftChange("nextFollowUp", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block md:col-span-2 xl:col-span-3">
              <FieldLabel label="Notes" />
              <textarea
                value={draft.notes}
                onChange={(event) => handleDraftChange("notes", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEnquiry}
              className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Save enquiry
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="New Enquiries" value={summaryCounts.new} />
        <SummaryCard label="Follow-up Due" value={summaryCounts.followUpDue} />
        <SummaryCard label="Qualified" value={summaryCounts.qualified} />
        <SummaryCard label="Lost / Closed" value={summaryCounts.lost} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <FieldLabel label="Search" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search enquiry number, title, client, contact, requirement..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <FieldLabel label="Status" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as SalesEnquiryFilterStatus)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {FILTER_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel label="Source" />
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SalesEnquirySourceFilter)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="All sources">All sources</option>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel label="Assigned To" />
            <select
              value={assignedFilter}
              onChange={(event) => setAssignedFilter(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {assignedOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("All statuses");
                setSourceFilter("All sources");
                setAssignedFilter("All users");
              }}
              className="h-10 w-full rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Enquiry list</h2>
              <p className="text-sm text-zinc-500">Local-first records only. Refresh-safe and ready for future sync.</p>
            </div>
            <span className={`rounded-md border px-3 py-2 text-xs font-semibold ${syncClassName("local")}`}>
              Saved locally. Server sync will be added in the next phase.
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            {filteredEnquiries.map((enquiry) => {
              const isSelected = selectedEnquiry?.id === enquiry.id;

              return (
                <article
                  key={enquiry.id}
                  className={[
                    "rounded-lg border bg-white p-4 shadow-sm transition",
                    isSelected
                      ? "border-emerald-300 bg-emerald-50/50 shadow-md"
                      : "border-zinc-200 hover:border-emerald-200 hover:shadow-md",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                          {enquiry.enquiryNo}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(enquiry.status)}`}>
                          {enquiry.status}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${syncClassName(enquiry.localSyncStatus)}`}>
                          {SYNC_LABELS[enquiry.localSyncStatus]}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-zinc-950">{enquiry.clientName}</h3>
                      <p className="mt-1 text-sm text-zinc-500">{enquiry.contactName || "No contact name"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(enquiry.id)}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(enquiry)}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleArchive(enquiry)}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-rose-200 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        {enquiry.isArchived ? "Restore" : "Archive"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-zinc-700">{enquiry.requirement}</p>

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                      <dt className="text-xs font-semibold uppercase text-zinc-500">Source</dt>
                      <dd className="mt-1 font-medium text-zinc-950">{enquiry.source}</dd>
                    </div>
                    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                      <dt className="text-xs font-semibold uppercase text-zinc-500">Next Follow-up</dt>
                      <dd className="mt-1 font-medium text-zinc-950">{formatDisplayDate(enquiry.nextFollowUp)}</dd>
                    </div>
                    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                      <dt className="text-xs font-semibold uppercase text-zinc-500">Assigned To</dt>
                      <dd className="mt-1 font-medium text-zinc-950">{enquiry.assignedTo}</dd>
                    </div>
                    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                      <dt className="text-xs font-semibold uppercase text-zinc-500">Estimated Value</dt>
                      <dd className="mt-1 font-medium text-zinc-950">{formatEstimatedValue(enquiry.estimatedValue)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>

          {!filteredEnquiries.length ? (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center">
              <p className="text-sm font-semibold text-zinc-950">No enquiries match these filters.</p>
              <p className="mt-1 text-sm text-zinc-500">Try clearing filters to return to the local enquiry list.</p>
            </div>
          ) : null}
        </section>

        <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Detail preview</p>
          {selectedEnquiry ? (
            <div className="mt-4 grid gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-950">{selectedEnquiry.title}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {selectedEnquiry.clientName}
                  {selectedEnquiry.contactName ? ` / ${selectedEnquiry.contactName}` : ""}
                </p>
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase text-zinc-500">Requirement notes</p>
                <p className="mt-2 text-sm text-zinc-700">{selectedEnquiry.notes || "No notes yet."}</p>
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Enquiry no.</dt>
                  <dd className="font-medium text-zinc-950">{selectedEnquiry.enquiryNo}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Phone / Email</dt>
                  <dd className="text-right font-medium text-zinc-950">
                    <div>{selectedEnquiry.phone || "Not set"}</div>
                    <div>{selectedEnquiry.email || "Not set"}</div>
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Source</dt>
                  <dd className="font-medium text-zinc-950">{selectedEnquiry.source}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Status</dt>
                  <dd className="font-medium text-zinc-950">{selectedEnquiry.status}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Estimated value</dt>
                  <dd className="font-medium text-zinc-950">{formatEstimatedValue(selectedEnquiry.estimatedValue)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Next follow-up</dt>
                  <dd className="font-medium text-zinc-950">{formatDisplayDate(selectedEnquiry.nextFollowUp)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Assigned user</dt>
                  <dd className="font-medium text-zinc-950">{selectedEnquiry.assignedTo}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Local sync status</dt>
                  <dd className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${syncClassName(selectedEnquiry.localSyncStatus)}`}>
                    {SYNC_LABELS[selectedEnquiry.localSyncStatus]}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Archived</dt>
                  <dd className="font-medium text-zinc-950">{selectedEnquiry.isArchived ? "Yes" : "No"}</dd>
                </div>
              </dl>
              <div className="rounded-md border border-zinc-200 p-4">
                <p className="text-sm font-semibold text-zinc-950">Planned next actions</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                  {plannedNextActions(selectedEnquiry).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400">
                  Convert to Opportunity
                </button>
                <button type="button" disabled className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400">
                  Create Quotation
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
              No enquiry selected.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
