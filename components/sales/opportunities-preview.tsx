"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/currencies";
import { normalizeClientName } from "@/lib/clients/client-payload";
import { createConfirmedClient } from "@/app/sales/opportunities/actions";

type SalesOpportunityStatus =
  | "New"
  | "Contacted"
  | "Qualified"
  | "Quotation Required"
  | "Quotation Sent"
  | "Negotiation"
  | "Won"
  | "Lost";

type SalesOpportunitySource = "Email" | "Website" | "Walk-in" | "Phone" | "WhatsApp" | "Referral" | "LinkedIn" | "Other";
type SalesOpportunitySyncStatus = "local" | "pending" | "synced";
type SalesOpportunityRecordSource = "existing" | "created" | "local" | "local-pending";
type OpportunityClientMode = "existing" | "local";
type StatusFilter = "All statuses" | SalesOpportunityStatus | "Archived";
type SourceFilter = "All sources" | SalesOpportunitySource;

type ClientOption = {
  id: string;
  company_name: string;
};

type ProjectOption = {
  id: string;
  client_id: string;
  project_name: string;
  project_number: string | null;
  project_code: string | null;
  project_year: number | null;
};

type SalesOpportunity = {
  id: string;
  opportunityNo: string;
  title: string;
  clientId?: string;
  clientName: string;
  clientSource?: SalesOpportunityRecordSource;
  clientConfirmed?: boolean;
  projectId?: string;
  referenceName?: string;
  projectName: string;
  projectSource?: SalesOpportunityRecordSource;
  contactName?: string;
  phone?: string;
  email?: string;
  location?: string;
  deliveryLocation?: string;
  requirement: string;
  source: SalesOpportunitySource;
  status: SalesOpportunityStatus;
  stage?: SalesOpportunityStatus;
  probability: number;
  enquiryDate?: string;
  quotationSubmissionDate?: string;
  expectedValue?: number;
  assignedTo: string;
  nextFollowUp?: string;
  linkedEnquiryId?: string;
  linkedEnquiryNo?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  localSyncStatus: SalesOpportunitySyncStatus;
  isArchived?: boolean;
};

type SalesOpportunityDraft = {
  title: string;
  clientMode: OpportunityClientMode;
  clientId: string;
  clientName: string;
  clientSource: SalesOpportunityRecordSource;
  referenceName: string;
  projectName: string;
  projectSource: SalesOpportunityRecordSource;
  contactName: string;
  phone: string;
  email: string;
  deliveryLocation: string;
  requirement: string;
  source: SalesOpportunitySource | "";
  status: SalesOpportunityStatus | "";
  probability: string;
  enquiryDate: string;
  quotationSubmissionDate: string;
  expectedValue: string;
  assignedTo: string;
  nextFollowUp: string;
  linkedEnquiryNo: string;
  notes: string;
};

const LOCAL_STORAGE_KEY = "projectworkflow.sales.opportunities.v1";

const STATUS_OPTIONS: SalesOpportunityStatus[] = [
  "New",
  "Contacted",
  "Qualified",
  "Quotation Required",
  "Quotation Sent",
  "Negotiation",
  "Won",
  "Lost",
];

const SOURCE_OPTIONS: SalesOpportunitySource[] = ["Email", "Website", "Walk-in", "Phone", "WhatsApp", "Referral", "LinkedIn", "Other"];
const STATUS_FILTER_OPTIONS: StatusFilter[] = ["All statuses", ...STATUS_OPTIONS, "Archived"];

const SYNC_LABELS: Record<SalesOpportunitySyncStatus, string> = {
  local: "Saved locally",
  pending: "Pending server sync",
  synced: "Synced ready",
};

const SYNC_CLASSES: Record<SalesOpportunitySyncStatus, string> = {
  local: "border-sky-200 bg-sky-50 text-sky-900",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  synced: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

function seedOpportunities(): SalesOpportunity[] {
  return [
    {
      id: "opp-1",
      opportunityNo: "OPP-2026-021",
      title: "Executive office refresh package",
      clientName: "Gulf Meridian",
      projectName: "HQ refresh",
      contactName: "Noura Al Mansoori",
      requirement: "Executive desks, workstations, and meeting room storage with phased installation.",
      source: "Website",
      status: "Quotation Required",
      stage: "Quotation Required",
      probability: 60,
      enquiryDate: "2026-06-01",
      quotationSubmissionDate: "2026-06-14",
      expectedValue: 185000,
      assignedTo: "Aisha Khan",
      nextFollowUp: "2026-06-12",
      linkedEnquiryNo: "ENQ-2026-014",
      notes: "Scope is qualified. Prepare quotation options with standard and premium workstation alternates.",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "opp-2",
      opportunityNo: "OPP-2026-020",
      title: "Hotel lobby loose furniture",
      clientName: "Marina View Hotel",
      projectName: "Lobby renovation",
      contactName: "Daniel Foster",
      requirement: "Lobby lounge chairs, side tables, outdoor dining sets, and reception waiting area furniture.",
      source: "Referral",
      status: "Qualified",
      stage: "Qualified",
      probability: 40,
      enquiryDate: "2026-06-02",
      quotationSubmissionDate: "2026-06-18",
      expectedValue: 320000,
      assignedTo: "Omar Nasser",
      nextFollowUp: "2026-06-13",
      linkedEnquiryNo: "ENQ-2026-013",
      notes: "Design team is confirming fabric direction and commercial-grade outdoor options.",
      createdAt: "2026-06-02T10:00:00.000Z",
      updatedAt: "2026-06-02T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "opp-3",
      opportunityNo: "OPP-2026-019",
      title: "Clinic reception and staff storage",
      clientName: "Al Noor Clinic",
      projectName: "Reception upgrade",
      contactName: "Dr. Lina Haddad",
      requirement: "Reception counter, visitor seating, staff lockers, shelving, and back-office storage.",
      source: "Phone",
      status: "Quotation Sent",
      stage: "Quotation Sent",
      probability: 80,
      enquiryDate: "2026-06-03",
      quotationSubmissionDate: "2026-06-09",
      expectedValue: 96500,
      assignedTo: "Maya Thomas",
      nextFollowUp: "2026-06-11",
      linkedEnquiryNo: "ENQ-2026-012",
      notes: "Quotation has been shared. Follow up on alternate upholstery and delivery schedule approval.",
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z",
      localSyncStatus: "pending",
    },
    {
      id: "opp-4",
      opportunityNo: "OPP-2026-018",
      title: "Education campus furniture zones",
      clientName: "Northbridge Academy",
      projectName: "Campus expansion",
      contactName: "Khaled Saeed",
      requirement: "Classroom desks, library shelving, teacher stations, multipurpose hall chairs, and study pods.",
      source: "Email",
      status: "Contacted",
      stage: "Contacted",
      probability: 40,
      enquiryDate: "2026-06-04",
      quotationSubmissionDate: "2026-06-20",
      expectedValue: 410000,
      assignedTo: "Aisha Khan",
      nextFollowUp: "2026-06-15",
      linkedEnquiryNo: "ENQ-2026-011",
      notes: "Site visit scheduled. Capture room counts and separate requirements by learning zone.",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "opp-5",
      opportunityNo: "OPP-2026-017",
      title: "Co-working acoustic pods",
      clientName: "WorkNest",
      projectName: "Floor 8 expansion",
      contactName: "Sami Rahman",
      requirement: "Acoustic pods, modular benching, lockers, and breakout tables for a new shared floor.",
      source: "LinkedIn",
      status: "Negotiation",
      stage: "Negotiation",
      probability: 80,
      enquiryDate: "2026-06-05",
      quotationSubmissionDate: "2026-06-11",
      expectedValue: 275000,
      assignedTo: "Maya Thomas",
      nextFollowUp: "2026-06-10",
      linkedEnquiryNo: "ENQ-2026-009",
      notes: "Client requested a delivery discount and one alternate acoustic pod supplier.",
      createdAt: "2026-06-05T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
      localSyncStatus: "local",
    },
    {
      id: "opp-6",
      opportunityNo: "OPP-2026-016",
      title: "Villa joinery and loose furniture",
      clientName: "Private Client",
      projectName: "Villa fit-out",
      contactName: "Priya Menon",
      requirement: "Wardrobes, display wall, study desk, feature shelving, and loose furniture selection.",
      source: "Walk-in",
      status: "Lost",
      stage: "Lost",
      probability: 20,
      enquiryDate: "2026-06-06",
      quotationSubmissionDate: "2026-06-16",
      expectedValue: 140000,
      assignedTo: "Omar Nasser",
      nextFollowUp: "Closed",
      linkedEnquiryNo: "ENQ-2026-010",
      notes: "Client moved forward with a residential contractor. Keep relationship warm for future loose furniture.",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      localSyncStatus: "local",
    },
  ];
}

function cloneOpportunities(records: SalesOpportunity[]) {
  return records.map((record) => ({ ...record }));
}

function isSalesOpportunityStatus(value: unknown): value is SalesOpportunityStatus {
  return typeof value === "string" && STATUS_OPTIONS.includes(value as SalesOpportunityStatus);
}

function isSalesOpportunitySource(value: unknown): value is SalesOpportunitySource {
  return typeof value === "string" && SOURCE_OPTIONS.includes(value as SalesOpportunitySource);
}

function isSalesOpportunitySyncStatus(value: unknown): value is SalesOpportunitySyncStatus {
  return value === "local" || value === "pending" || value === "synced";
}

function isSalesOpportunityRecordSource(value: unknown): value is SalesOpportunityRecordSource {
  return value === "existing" || value === "created" || value === "local" || value === "local-pending";
}

function normalizeClientSource(value: unknown): SalesOpportunityRecordSource {
  if (value === "existing" || value === "created") return value;
  return "local";
}

function normalizeLegacyStatus(value: unknown): SalesOpportunityStatus | null {
  if (isSalesOpportunityStatus(value)) return value;
  if (value === "Site Visit") return "Contacted";
  if (value === "Design / Specification") return "Qualified";
  return null;
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

function normalizeOpportunity(raw: unknown, index: number): SalesOpportunity | null {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Record<string, unknown>;
  const title = safeString(data.title);
  const clientName = safeString(data.clientName);
  const referenceName = safeString(data.referenceName) || safeString(data.projectName);
  const projectName = referenceName;
  const requirement = safeString(data.requirement);
  const status = normalizeLegacyStatus(data.status) ?? normalizeLegacyStatus(data.stage);
  const source = isSalesOpportunitySource(data.source) ? data.source : "Email";
  const probability = safeNumber(data.probability) ?? 40;

  if (!title || !clientName || !requirement || !status) return null;

  const createdAt = safeString(data.createdAt) || new Date().toISOString();
  const updatedAt = safeString(data.updatedAt) || createdAt;
  const createdDate = createdAt.slice(0, 10);

  return {
    id: safeString(data.id) || `opp-${index + 1}`,
    opportunityNo: safeString(data.opportunityNo) || `OPP-${new Date().getFullYear()}-${String(index + 1).padStart(3, "0")}`,
    title,
    clientId: safeString(data.clientId) || undefined,
    clientName,
    clientSource: normalizeClientSource(data.clientSource),
    clientConfirmed: Boolean(data.clientConfirmed) || Boolean(safeString(data.clientId) && (data.clientSource === "existing" || data.clientSource === "created")),
    projectId: safeString(data.projectId) || undefined,
    referenceName,
    projectName,
    projectSource: isSalesOpportunityRecordSource(data.projectSource) ? data.projectSource : "local",
    contactName: safeString(data.contactName) || undefined,
    phone: safeString(data.phone) || undefined,
    email: safeString(data.email) || undefined,
    location: safeString(data.location) || safeString(data.deliveryLocation) || undefined,
    deliveryLocation: safeString(data.deliveryLocation) || safeString(data.location) || undefined,
    requirement,
    source,
    status,
    stage: status,
    probability: Math.max(0, Math.min(100, Math.round(probability))),
    enquiryDate: safeString(data.enquiryDate) || createdDate,
    quotationSubmissionDate: safeString(data.quotationSubmissionDate) || safeString(data.nextFollowUp) || undefined,
    expectedValue: safeNumber(data.expectedValue),
    assignedTo: safeString(data.assignedTo) || "Unassigned",
    nextFollowUp: safeString(data.nextFollowUp) || undefined,
    linkedEnquiryId: safeString(data.linkedEnquiryId) || undefined,
    linkedEnquiryNo: safeString(data.linkedEnquiryNo) || undefined,
    notes: safeString(data.notes) || undefined,
    createdAt,
    updatedAt,
    localSyncStatus: isSalesOpportunitySyncStatus(data.localSyncStatus) ? data.localSyncStatus : "local",
    isArchived: Boolean(data.isArchived),
  };
}

function normalizeOpportunityList(raw: unknown) {
  if (!Array.isArray(raw)) return cloneOpportunities(seedOpportunities());

  const normalized = raw
    .map((item, index) => normalizeOpportunity(item, index))
    .filter((item): item is SalesOpportunity => Boolean(item));

  return normalized.length ? normalized : cloneOpportunities(seedOpportunities());
}

function createEmptyDraft(): SalesOpportunityDraft {
  return {
    title: "",
    clientMode: "local",
    clientId: "",
    clientName: "",
    clientSource: "local",
    referenceName: "",
    projectName: "",
    projectSource: "local",
    contactName: "",
    phone: "",
    email: "",
    deliveryLocation: "",
    requirement: "",
    source: "Email",
    status: "New",
    probability: "40",
    enquiryDate: new Date().toISOString().slice(0, 10),
    quotationSubmissionDate: "",
    expectedValue: "",
    assignedTo: "",
    nextFollowUp: "",
    linkedEnquiryNo: "",
    notes: "",
  };
}

function draftFromOpportunity(opportunity: SalesOpportunity): SalesOpportunityDraft {
  const clientSource = opportunity.clientId && opportunity.clientSource === "existing" ? "existing" : "local";

  return {
    title: opportunity.title,
    clientMode: clientSource,
    clientId: clientSource === "existing" ? opportunity.clientId ?? "" : "",
    clientName: opportunity.clientName,
    clientSource,
    referenceName: opportunity.referenceName ?? opportunity.projectName,
    projectName: opportunity.referenceName ?? opportunity.projectName,
    projectSource: "local",
    contactName: opportunity.contactName ?? "",
    phone: opportunity.phone ?? "",
    email: opportunity.email ?? "",
    deliveryLocation: opportunity.deliveryLocation ?? opportunity.location ?? "",
    requirement: opportunity.requirement,
    source: opportunity.source,
    status: opportunity.status,
    probability: String(opportunity.probability),
    enquiryDate: opportunity.enquiryDate ?? "",
    quotationSubmissionDate: opportunity.quotationSubmissionDate ?? "",
    expectedValue: opportunity.expectedValue !== undefined ? String(opportunity.expectedValue) : "",
    assignedTo: opportunity.assignedTo,
    nextFollowUp: opportunity.nextFollowUp ?? "",
    linkedEnquiryNo: opportunity.linkedEnquiryNo ?? "",
    notes: opportunity.notes ?? "",
  };
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `opp-${Date.now()}`;
}

function nextOpportunityNo(opportunities: SalesOpportunity[]) {
  const year = new Date().getFullYear();
  const maxForYear = opportunities.reduce((max, opportunity) => {
    const match = opportunity.opportunityNo.match(new RegExp(`^OPP-${year}-(\\d+)$`));
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `OPP-${year}-${String(maxForYear + 1).padStart(3, "0")}`;
}

function statusClassName(status: SalesOpportunityStatus) {
  switch (status) {
    case "Won":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "Lost":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "Quotation Required":
    case "Quotation Sent":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Negotiation":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "Contacted":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "New":
      return "border-sky-200 bg-sky-50 text-sky-900";
    default:
      return "border-indigo-200 bg-indigo-50 text-indigo-900";
  }
}

function syncClassName(status: SalesOpportunitySyncStatus) {
  return SYNC_CLASSES[status];
}

function formatExpectedValue(value?: number) {
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

function plannedNextActions(opportunity: SalesOpportunity) {
  switch (opportunity.status) {
    case "New":
      return [
        "Confirm the enquiry details, decision maker, and furniture scope.",
        "Set ownership and move the opportunity to contacted once the client is reached.",
        "Keep client and project references accurate before quotation handoff.",
      ];
    case "Contacted":
      return [
        "Clarify the furniture scope, room count, and expected submission date.",
        "Collect missing drawings, dimensions, or material preferences.",
        "Move to qualified when budget, timeline, and scope are clear.",
      ];
    case "Qualified":
      return [
        "Confirm scope, project value, and buying timeline.",
        "Schedule the next discovery or site coordination step.",
        "Prepare the opportunity for design/specification review.",
      ];
    case "Quotation Required":
      return [
        "Create the quotation package in the existing quotation workflow later.",
        "Confirm pricing inputs and exclusions before sending.",
        "Keep follow-up date current while quotation is prepared.",
      ];
    case "Quotation Sent":
      return [
        "Follow up on quotation feedback and requested alternates.",
        "Track approval status in the client approvals workspace later.",
        "Update probability after commercial feedback.",
      ];
    case "Negotiation":
      return [
        "Record requested discounts, alternates, and delivery concessions.",
        "Hold pricing decisions for the quotation workflow.",
        "Move to won or lost after client decision.",
      ];
    case "Won":
      return [
        "Keep the opportunity as local sales history.",
        "Confirmed project conversion will be added in a later phase.",
        "Do not start procurement from this preview module.",
      ];
    case "Lost":
      return [
        "Capture useful loss notes for future sales follow-up.",
        "Keep the relationship warm where appropriate.",
        "Archive only when the record no longer needs attention.",
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

function sourceBadgeClassName(source?: SalesOpportunityRecordSource) {
  return source === "existing" || source === "created"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function sourceBadgeLabel(kind: "client" | "project", source?: SalesOpportunityRecordSource) {
  if (source === "existing") return kind === "client" ? "Existing client" : "Existing reference";
  if (source === "created") return kind === "client" ? "Created client" : "Existing reference";
  return kind === "client" ? "Local client" : "Opportunity reference";
}

function hasConfirmedClient(opportunity: SalesOpportunity) {
  return Boolean(opportunity.clientConfirmed && opportunity.clientName.trim());
}

function clientStatusClassName(opportunity: SalesOpportunity) {
  return hasConfirmedClient(opportunity)
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function clientStatusLabel(opportunity: SalesOpportunity) {
  return hasConfirmedClient(opportunity) ? "Confirmed client" : "Client not confirmed";
}

type ConfirmedClientRecord = {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

type CreateConfirmedClientFormState =
  | {
      status: "idle";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      requestId: string;
      client: ConfirmedClientRecord;
    };

function CreateConfirmedClientForm({
  opportunity,
  onCreated,
  existingClients,
}: {
  opportunity: SalesOpportunity;
  onCreated: (client: ConfirmedClientRecord) => void;
  existingClients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState<CreateConfirmedClientFormState, FormData>(
    createConfirmedClient,
    {
      status: "idle",
    },
  );
  const handledRequestId = useRef<string | null>(null);
  const exactExistingClient = existingClients.find(
    (client) => normalizeClientName(client.company_name) === normalizeClientName(opportunity.clientName),
  );
  const isDuplicateName = Boolean(exactExistingClient);

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    if (handledRequestId.current === state.requestId) {
      return;
    }

    handledRequestId.current = state.requestId;
    onCreated(state.client);
  }, [onCreated, state]);

  return (
    <form action={formAction} className="rounded-md border border-zinc-200 p-4">
      <h3 className="font-semibold text-zinc-950">Create new confirmed client</h3>
      <p className="mt-2 text-sm text-zinc-600">
        Creates the client record first, then confirms this opportunity against it.
      </p>

      <input type="hidden" name="country" value="UAE" />
      <input type="hidden" name="is_active" value="on" />

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Client name</span>
          <input
            name="company_name"
            defaultValue={opportunity.clientName}
            required
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Contact</span>
          <input
            name="contact_person"
            defaultValue={opportunity.contactName ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Phone</span>
          <input
            name="phone"
            defaultValue={opportunity.phone ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={opportunity.email ?? ""}
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
      </div>

      {isDuplicateName ? (
        <p className="mt-3 text-sm font-medium text-amber-700">
          A client with this exact name already exists. Link the existing client instead.
        </p>
      ) : null}

      {state.status === "error" ? <p className="mt-3 text-sm font-medium text-rose-700">{state.message}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {pending ? "Creating..." : "Create and confirm client"}
        </button>
      </div>
    </form>
  );
}

export function OpportunitiesPreview({
  clients,
}: {
  clients: ClientOption[];
  projects: ProjectOption[];
}) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>(() => cloneOpportunities(seedOpportunities()));
  const [clientOptions, setClientOptions] = useState<ClientOption[]>(() => clients);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All statuses");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All sources");
  const [assignedFilter, setAssignedFilter] = useState("All users");
  const [selectedId, setSelectedId] = useState(() => seedOpportunities()[0]?.id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalesOpportunityDraft>(() => createEmptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmClientOpportunityId, setConfirmClientOpportunityId] = useState<string | null>(null);
  const [confirmClientId, setConfirmClientId] = useState("");
  const [confirmClientError, setConfirmClientError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!saved) {
          setOpportunities(cloneOpportunities(seedOpportunities()));
          setHasLoaded(true);
          return;
        }

        setOpportunities(normalizeOpportunityList(JSON.parse(saved) as unknown));
      } catch {
        setOpportunities(cloneOpportunities(seedOpportunities()));
      } finally {
        setHasLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(opportunities));
  }, [hasLoaded, opportunities]);

  const assignedOptions = useMemo(() => {
    const users = new Set(opportunities.map((opportunity) => opportunity.assignedTo).filter(Boolean));
    return ["All users", ...Array.from(users).sort()];
  }, [opportunities]);

  const filteredOpportunities = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return opportunities.filter((opportunity) => {
      const matchesArchive = statusFilter === "Archived" ? opportunity.isArchived : !opportunity.isArchived;
      const matchesQuery =
        !normalizedQuery ||
        [
          opportunity.opportunityNo,
          opportunity.title,
          opportunity.clientName,
          opportunity.projectName,
          opportunity.contactName,
          opportunity.phone,
          opportunity.email,
          opportunity.deliveryLocation,
          opportunity.location,
          opportunity.requirement,
          opportunity.source,
          opportunity.status,
          opportunity.enquiryDate,
          opportunity.quotationSubmissionDate,
          opportunity.expectedValue !== undefined ? String(opportunity.expectedValue) : "",
          opportunity.assignedTo,
          opportunity.linkedEnquiryNo,
          opportunity.notes,
        ].some((value) => (value ?? "").toLowerCase().includes(normalizedQuery));

      return (
        matchesArchive &&
        matchesQuery &&
        (statusFilter === "All statuses" || statusFilter === "Archived" || opportunity.status === statusFilter) &&
        (sourceFilter === "All sources" || opportunity.source === sourceFilter) &&
        (assignedFilter === "All users" || opportunity.assignedTo === assignedFilter)
      );
    });
  }, [assignedFilter, opportunities, searchQuery, sourceFilter, statusFilter]);

  const activeOpportunities = opportunities.filter((opportunity) => !opportunity.isArchived);
  const selectedOpportunity =
    opportunities.find((opportunity) => opportunity.id === selectedId) ??
    filteredOpportunities[0] ??
    activeOpportunities[0] ??
    opportunities[0];
  const confirmClientOpportunity = confirmClientOpportunityId
    ? opportunities.find((opportunity) => opportunity.id === confirmClientOpportunityId) ?? null
    : null;

  function applyCreatedClient(client: ConfirmedClientRecord) {
    setClientOptions((current) =>
      current.some((item) => item.id === client.id)
        ? current
        : [{ id: client.id, company_name: client.company_name }, ...current],
    );

    if (!confirmClientOpportunity) {
      return;
    }

    const now = new Date().toISOString();
    setOpportunities((current) =>
      current.map((opportunity) =>
        opportunity.id === confirmClientOpportunity.id
          ? {
              ...opportunity,
              clientId: client.id,
              clientName: client.company_name,
              clientSource: "created",
              clientConfirmed: true,
              contactName: client.contact_person ?? opportunity.contactName,
              phone: client.phone ?? opportunity.phone,
              email: client.email ?? opportunity.email,
              updatedAt: now,
              localSyncStatus: "pending",
            }
          : opportunity,
      ),
    );

    setSelectedId(confirmClientOpportunity.id);
    closeConfirmClient();
  }

  function resetFilters() {
    setSearchQuery("");
    setStatusFilter("All statuses");
    setSourceFilter("All sources");
    setAssignedFilter("All users");
    setSelectedId(activeOpportunities[0]?.id ?? opportunities[0]?.id ?? "");
  }

  function openNewForm() {
    setEditingId(null);
    setDraft(createEmptyDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(opportunity: SalesOpportunity) {
    setEditingId(opportunity.id);
    setDraft(draftFromOpportunity(opportunity));
    setFormError(null);
    setFormOpen(true);
  }

  function openConfirmClient(opportunity: SalesOpportunity) {
    setConfirmClientOpportunityId(opportunity.id);
    setConfirmClientError(null);
    const exactMatch = clientOptions.find(
      (client) => normalizeClientName(client.company_name) === normalizeClientName(opportunity.clientName),
    );
    setConfirmClientId(exactMatch?.id ?? "");
  }

  function closeConfirmClient() {
    setConfirmClientOpportunityId(null);
    setConfirmClientId("");
    setConfirmClientError(null);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(createEmptyDraft());
    setFormError(null);
  }

  function confirmExistingClient() {
    if (!confirmClientOpportunity) return;
    if (!confirmClientId) {
      setConfirmClientError("Select an existing client to confirm.");
      return;
    }

    const client = clientOptions.find((item) => item.id === confirmClientId);
    if (!client) {
      setConfirmClientError("Select a valid existing client.");
      return;
    }

    const now = new Date().toISOString();
    setOpportunities((current) =>
      current.map((opportunity) =>
        opportunity.id === confirmClientOpportunity.id
          ? {
              ...opportunity,
              clientId: client.id,
              clientName: client.company_name,
              clientSource: "existing",
              clientConfirmed: true,
              updatedAt: now,
              localSyncStatus: "pending",
            }
          : opportunity,
      ),
    );
    setSelectedId(confirmClientOpportunity.id);
    closeConfirmClient();
  }

  function updateDraft<Field extends keyof SalesOpportunityDraft>(field: Field, value: SalesOpportunityDraft[Field]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function saveDraft() {
    const title = draft.title.trim();
    const requirement = draft.requirement.trim();
    const source = draft.source;
    const status = draft.status;
    const probability = Number(draft.probability);
    const expectedValue = draft.expectedValue.trim() ? Number(draft.expectedValue) : undefined;
    const existingClient = draft.clientMode === "existing"
      ? clientOptions.find((client) => client.id === draft.clientId)
      : undefined;
    const clientName = draft.clientMode === "existing"
      ? existingClient?.company_name.trim() ?? ""
      : draft.clientName.trim();
    const clientId = draft.clientMode === "existing" ? existingClient?.id : undefined;
    const clientSource: SalesOpportunityRecordSource = draft.clientMode === "existing" ? "existing" : "local";
    const clientConfirmed = draft.clientMode === "existing" && Boolean(clientId);
    const referenceName = draft.referenceName.trim() || draft.projectName.trim();
    const projectName = referenceName;
    const projectSource: SalesOpportunityRecordSource = "local";

    if (!title || !clientName || !requirement || !source || !status || !draft.enquiryDate || !draft.quotationSubmissionDate || !draft.assignedTo.trim()) {
      setFormError("Add a title, client, requirement, status, enquiry date, quotation submission date, and assigned user before saving locally.");
      return;
    }

    if (draft.clientMode === "existing" && !clientId) {
      setFormError("Select an existing client or switch to New client.");
      return;
    }

    if (expectedValue !== undefined && !Number.isFinite(expectedValue)) {
      setFormError("Expected value must be a valid number.");
      return;
    }

    const now = new Date().toISOString();

    if (editingId) {
      setOpportunities((current) =>
        current.map((opportunity) =>
          opportunity.id === editingId
            ? {
                ...opportunity,
                title,
                clientId,
                clientName,
                clientSource,
                clientConfirmed,
                projectId: undefined,
                referenceName,
                projectName,
                projectSource,
                contactName: draft.contactName.trim() || undefined,
                phone: draft.phone.trim() || undefined,
                email: draft.email.trim() || undefined,
                location: draft.deliveryLocation.trim() || undefined,
                deliveryLocation: draft.deliveryLocation.trim() || undefined,
                requirement,
                source,
                status,
                stage: status,
                probability: Math.max(0, Math.min(100, Math.round(probability))),
                enquiryDate: draft.enquiryDate,
                quotationSubmissionDate: draft.quotationSubmissionDate || undefined,
                expectedValue,
                assignedTo: draft.assignedTo.trim() || "Unassigned",
                nextFollowUp: draft.nextFollowUp.trim() || undefined,
                linkedEnquiryNo: draft.linkedEnquiryNo.trim() || undefined,
                notes: draft.notes.trim() || undefined,
                updatedAt: now,
                localSyncStatus: "pending",
              }
            : opportunity,
        ),
      );
    } else {
      const newOpportunity: SalesOpportunity = {
        id: createLocalId(),
        opportunityNo: nextOpportunityNo(opportunities),
        title,
        clientId,
        clientName,
        clientSource,
        clientConfirmed,
        projectId: undefined,
        referenceName,
        projectName,
        projectSource,
        contactName: draft.contactName.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        location: draft.deliveryLocation.trim() || undefined,
        deliveryLocation: draft.deliveryLocation.trim() || undefined,
        requirement,
        source,
        status,
        stage: status,
        probability: Math.max(0, Math.min(100, Math.round(probability))),
        enquiryDate: draft.enquiryDate,
        quotationSubmissionDate: draft.quotationSubmissionDate || undefined,
        expectedValue,
        assignedTo: draft.assignedTo.trim() || "Unassigned",
        nextFollowUp: draft.nextFollowUp.trim() || undefined,
        linkedEnquiryNo: draft.linkedEnquiryNo.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        localSyncStatus: "local",
      };

      setOpportunities((current) => [newOpportunity, ...current]);
      setSelectedId(newOpportunity.id);
    }

    closeForm();
  }

  function toggleArchive(opportunity: SalesOpportunity) {
    setOpportunities((current) =>
      current.map((record) =>
        record.id === opportunity.id
          ? {
              ...record,
              isArchived: !record.isArchived,
              updatedAt: new Date().toISOString(),
              localSyncStatus: "pending",
            }
          : record,
      ),
    );
  }

  const summary = {
    open: activeOpportunities.filter((opportunity) => opportunity.status !== "Won" && opportunity.status !== "Lost").length,
    quotationRequired: activeOpportunities.filter((opportunity) => opportunity.status === "Quotation Required").length,
    quotationSent: activeOpportunities.filter((opportunity) => opportunity.status === "Quotation Sent").length,
    wonLost: activeOpportunities.filter((opportunity) => opportunity.status === "Won" || opportunity.status === "Lost").length,
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-2">
          <span className="w-fit rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            Local-first opportunity records are saved in this browser.
          </span>
          <span className="w-fit rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950">
            Future server sync can be added later without changing this workflow.
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            + New Opportunity
          </button>
          <Link
            href="/sales/quotations"
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            Open Quotations
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Open Opportunities" value={summary.open} />
        <SummaryCard label="Quotation Required" value={summary.quotationRequired} />
        <SummaryCard label="Quotation Sent" value={summary.quotationSent} />
        <SummaryCard label="Won / Lost" value={summary.wonLost} />
      </div>

      {formOpen ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">{editingId ? "Edit opportunity" : "New opportunity"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Saved locally in this browser. Server sync will be added later.</p>
            </div>
            <button type="button" onClick={closeForm} className="text-sm font-semibold text-zinc-500 transition hover:text-zinc-950">
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <FieldLabel label="Title" />
              <input
                value={draft.title}
                onChange={(event) => updateDraft("title", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <fieldset className="rounded-lg border border-zinc-200 p-4 md:col-span-2">
              <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Client</legend>
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="opportunity-client-mode"
                      checked={draft.clientMode === "existing"}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          clientMode: "existing",
                          clientSource: "existing",
                          clientName: "",
                        }))
                      }
                      className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20"
                    />
                    Existing client
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="opportunity-client-mode"
                      checked={draft.clientMode === "local"}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          clientMode: "local",
                          clientId: "",
                          clientSource: "local",
                          projectSource: "local",
                        }))
                      }
                      className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20"
                    />
                    New client
                  </label>
                </div>

                {draft.clientMode === "existing" ? (
                  <label className="block">
                    <FieldLabel label="Existing Client" />
                    <select
                      value={draft.clientId}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          clientId: event.target.value,
                          projectSource: "local",
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="">Select existing client</option>
                      {clientOptions.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.company_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <FieldLabel label="New Client Name" />
                    <input
                      value={draft.clientName}
                      onChange={(event) => updateDraft("clientName", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                    <span className="mt-1 block text-xs text-amber-700">
                      Saved locally for now. Select an existing client to enable quotation creation.
                    </span>
                  </label>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block">
                    <FieldLabel label="Contact Person" />
                    <input
                      value={draft.contactName}
                      onChange={(event) => updateDraft("contactName", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                  <label className="block">
                    <FieldLabel label="Phone" />
                    <input
                      value={draft.phone}
                      onChange={(event) => updateDraft("phone", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                  <label className="block">
                    <FieldLabel label="Email" />
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) => updateDraft("email", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                </div>
              </div>
            </fieldset>

            <label className="block">
              <FieldLabel label="Location / Delivery Location" />
              <input
                value={draft.deliveryLocation}
                onChange={(event) => updateDraft("deliveryLocation", event.target.value)}
                placeholder="Site, showroom, tower, city..."
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block md:col-span-2">
              <FieldLabel label="Project / Reference Name" />
              <input
                value={draft.referenceName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    referenceName: event.target.value,
                    projectName: event.target.value,
                    projectSource: "local",
                  }))
                }
                placeholder="Client reference, room package, quote reference..."
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
              <span className="mt-1 block text-xs text-zinc-500">
                This is a sales reference only. Confirmed project/order creation happens after client approval.
              </span>
            </label>
            <label className="block">
              <FieldLabel label="Source" />
              <select
                value={draft.source}
                onChange={(event) => updateDraft("source", event.target.value as SalesOpportunitySource)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
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
                onChange={(event) => updateDraft("status", event.target.value as SalesOpportunityStatus)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel label="Expected Value" />
              <input
                type="number"
                min="0"
                value={draft.expectedValue}
                onChange={(event) => updateDraft("expectedValue", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Assigned To" />
              <input
                value={draft.assignedTo}
                onChange={(event) => updateDraft("assignedTo", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Enquiry Date" />
              <input
                type="date"
                value={draft.enquiryDate}
                onChange={(event) => updateDraft("enquiryDate", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Quotation Submission Date" />
              <input
                type="date"
                value={draft.quotationSubmissionDate}
                onChange={(event) => updateDraft("quotationSubmissionDate", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Optional Follow-up" />
              <input
                type="date"
                value={draft.nextFollowUp}
                onChange={(event) => updateDraft("nextFollowUp", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block">
              <FieldLabel label="Linked Enquiry No." />
              <input
                value={draft.linkedEnquiryNo}
                onChange={(event) => updateDraft("linkedEnquiryNo", event.target.value)}
                placeholder="ENQ-2026-014"
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block md:col-span-2">
              <FieldLabel label="Requirement / Furniture Scope" />
              <textarea
                value={draft.requirement}
                onChange={(event) => updateDraft("requirement", event.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <label className="block md:col-span-2 xl:col-span-3">
              <FieldLabel label="Notes" />
              <textarea
                value={draft.notes}
                onChange={(event) => updateDraft("notes", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
          </div>

          {formError ? <p className="mt-3 text-sm font-medium text-rose-700">{formError}</p> : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeForm}
              className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Save Locally
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <FieldLabel label="Search" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search opportunity, client, project, requirement..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <FieldLabel label="Status" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
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
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
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
              onClick={resetFilters}
              className="h-10 w-full rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">ERP sales flow</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Opportunity &gt; Quotation &gt; Client Approval &gt; Confirmed Project &gt; Procurement
            </p>
          </div>
          <p className="max-w-xl text-sm text-zinc-500">
            This workspace is local-first. Quotation creation still requires the normal user action after review.
          </p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Opportunity cards</h2>
              <p className="text-sm text-zinc-500">{filteredOpportunities.length} local record(s) shown.</p>
            </div>
            {!hasLoaded ? <span className="text-xs font-semibold text-zinc-500">Loading local workspace...</span> : null}
          </div>

          <div className="mt-4 grid gap-3">
            {filteredOpportunities.map((opportunity) => (
              <article
                key={opportunity.id}
                className={[
                  "rounded-lg border p-4 transition",
                  selectedOpportunity?.id === opportunity.id
                    ? "border-emerald-800 bg-emerald-50/50"
                    : "border-zinc-200 bg-white hover:border-emerald-900/25",
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <button type="button" onClick={() => setSelectedId(opportunity.id)} className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        {opportunity.opportunityNo}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(opportunity.status)}`}>
                        {opportunity.status}
                      </span>
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                        {opportunity.source}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${syncClassName(opportunity.localSyncStatus)}`}>
                        {SYNC_LABELS[opportunity.localSyncStatus]}
                      </span>
                      {opportunity.isArchived ? (
                        <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                          Archived
                        </span>
                      ) : null}
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(opportunity.clientSource)}`}>
                        {sourceBadgeLabel("client", opportunity.clientSource)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${clientStatusClassName(opportunity)}`}>
                        {clientStatusLabel(opportunity)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(opportunity.projectSource)}`}>
                        {sourceBadgeLabel("project", opportunity.projectSource)}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-zinc-950">{opportunity.title}</h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      {opportunity.clientName}
                      {opportunity.referenceName || opportunity.projectName ? ` / ${opportunity.referenceName || opportunity.projectName}` : ""}
                    </p>
                    {opportunity.deliveryLocation || opportunity.location ? (
                      <p className="mt-1 text-sm text-zinc-500">
                        Location: {opportunity.deliveryLocation || opportunity.location}
                      </p>
                    ) : null}
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-600">{opportunity.requirement}</p>
                  </button>

                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[280px] lg:grid-cols-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Quotation due</span>
                      <span className="font-medium text-zinc-950">{formatDisplayDate(opportunity.quotationSubmissionDate)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Expected value</span>
                      <span className="font-medium text-zinc-950">{formatExpectedValue(opportunity.expectedValue)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Contact</span>
                      <span className="font-medium text-zinc-950">{opportunity.contactName ?? "Not set"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Assigned</span>
                      <span className="font-medium text-zinc-950">{opportunity.assignedTo}</span>
                    </div>
                  </div>
                </div>

              <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(opportunity.id)}
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
                  >
                    Preview
                  </button>
                  {!hasConfirmedClient(opportunity) ? (
                    <button
                      type="button"
                      onClick={() => openConfirmClient(opportunity)}
                      className="h-9 rounded-md border border-amber-200 px-3 text-sm font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-50"
                    >
                      Confirm Client
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openEditForm(opportunity)}
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleArchive(opportunity)}
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-rose-900/25 hover:text-rose-800"
                  >
                    {opportunity.isArchived ? "Restore" : "Archive"}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {!filteredOpportunities.length ? (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center">
              <p className="text-sm font-semibold text-zinc-950">No opportunities match the current filters.</p>
              <p className="mt-1 text-sm text-zinc-500">Try clearing filters or creating a new local opportunity.</p>
            </div>
          ) : null}
        </section>

        <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Detail preview</p>
          {selectedOpportunity ? (
            <div className="mt-4 grid gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-950">{selectedOpportunity.title}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {selectedOpportunity.opportunityNo} / {selectedOpportunity.clientName}
                  {selectedOpportunity.referenceName || selectedOpportunity.projectName ? ` / ${selectedOpportunity.referenceName || selectedOpportunity.projectName}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(selectedOpportunity.status)}`}>
                    {selectedOpportunity.status}
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                    {selectedOpportunity.source}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(selectedOpportunity.clientSource)}`}>
                    {sourceBadgeLabel("client", selectedOpportunity.clientSource)}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${clientStatusClassName(selectedOpportunity)}`}>
                    {clientStatusLabel(selectedOpportunity)}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(selectedOpportunity.projectSource)}`}>
                    {sourceBadgeLabel("project", selectedOpportunity.projectSource)}
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase text-zinc-500">Requirement notes</p>
                <p className="mt-2 text-sm text-zinc-700">{selectedOpportunity.requirement}</p>
                {selectedOpportunity.notes ? <p className="mt-3 text-sm text-zinc-600">{selectedOpportunity.notes}</p> : null}
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Project / reference</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.referenceName || selectedOpportunity.projectName || "Not set"}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Status</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.status}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Source</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.source}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Expected value</dt>
                  <dd className="font-medium text-zinc-950">{formatExpectedValue(selectedOpportunity.expectedValue)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Enquiry date</dt>
                  <dd className="font-medium text-zinc-950">{formatDisplayDate(selectedOpportunity.enquiryDate)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Quotation submission</dt>
                  <dd className="font-medium text-zinc-950">{formatDisplayDate(selectedOpportunity.quotationSubmissionDate)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Optional follow-up</dt>
                  <dd className="font-medium text-zinc-950">{formatDisplayDate(selectedOpportunity.nextFollowUp)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Assigned user</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.assignedTo}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Contact</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.contactName ?? "Not set"}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Phone</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.phone ?? "Not set"}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Email</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.email ?? "Not set"}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Location / delivery</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.deliveryLocation ?? selectedOpportunity.location ?? "Not set"}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Linked enquiry</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.linkedEnquiryNo ?? "Not linked"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Local sync</dt>
                  <dd className="font-medium text-zinc-950">{SYNC_LABELS[selectedOpportunity.localSyncStatus]}</dd>
                </div>
              </dl>
              <div className="rounded-md border border-zinc-200 p-4">
                <p className="text-sm font-semibold text-zinc-950">Planned next actions</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                  {plannedNextActions(selectedOpportunity).map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>
              <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                {hasConfirmedClient(selectedOpportunity)
                  ? "Confirmed client can safely prefill the quotation client field. Please review before creating the quotation."
                  : "Add or select a confirmed client before creating a quotation. Edit this opportunity and select an existing client first."}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {!hasConfirmedClient(selectedOpportunity) ? (
                  <button
                    type="button"
                    onClick={() => openConfirmClient(selectedOpportunity)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-amber-200 px-4 text-sm font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-50"
                  >
                    Confirm Client
                  </button>
                ) : null}
                {hasConfirmedClient(selectedOpportunity) ? (
                  <Link
                    href={`/sales/quotations?fromOpportunity=${encodeURIComponent(selectedOpportunity.id)}`}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  >
                    Create Quotation
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
                  >
                    Create Quotation
                  </button>
                )}
                <button type="button" disabled className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400">
                  Mark Won
                </button>
                <button type="button" disabled className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400">
                  Mark Lost
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">Select an opportunity to preview details.</p>
          )}
        </aside>
      </div>

      {confirmClientOpportunity ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 px-4 py-6">
          <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Confirm Client</p>
                <h2 className="text-lg font-semibold text-zinc-950">{confirmClientOpportunity.opportunityNo}</h2>
              </div>
              <button
                type="button"
                onClick={closeConfirmClient}
                className="text-sm font-semibold text-zinc-500 transition hover:text-zinc-950"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <p className="font-semibold text-zinc-950">{confirmClientOpportunity.title}</p>
                <dl className="mt-3 grid gap-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Client</dt>
                    <dd className="font-medium text-zinc-950">{confirmClientOpportunity.clientName || "Not set"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Contact</dt>
                    <dd className="font-medium text-zinc-950">{confirmClientOpportunity.contactName ?? "Not set"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Phone</dt>
                    <dd className="font-medium text-zinc-950">{confirmClientOpportunity.phone ?? "Not set"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Email</dt>
                    <dd className="font-medium text-zinc-950">{confirmClientOpportunity.email ?? "Not set"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Opportunity</dt>
                    <dd className="font-medium text-zinc-950">{confirmClientOpportunity.opportunityNo}</dd>
                  </div>
                </dl>
              </div>

              <div className="grid gap-4">
                <section className="rounded-md border border-zinc-200 p-4">
                  <h3 className="font-semibold text-zinc-950">Link existing client</h3>
                  <label className="mt-3 block">
                    <span className="text-xs font-semibold uppercase text-zinc-500">Existing client</span>
                    <select
                      value={confirmClientId}
                      onChange={(event) => setConfirmClientId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="">Select existing client</option>
                      {clientOptions.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.company_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {confirmClientError ? <p className="mt-2 text-sm font-medium text-rose-700">{confirmClientError}</p> : null}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={confirmExistingClient}
                      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                      Confirm client
                    </button>
                  </div>
                </section>

                <CreateConfirmedClientForm
                  opportunity={confirmClientOpportunity}
                  onCreated={applyCreatedClient}
                  existingClients={clientOptions}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
