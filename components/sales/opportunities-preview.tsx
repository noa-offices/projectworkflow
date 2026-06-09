"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/currencies";

type SalesOpportunityStage =
  | "Qualified"
  | "Site Visit"
  | "Design / Specification"
  | "Quotation Required"
  | "Quotation Sent"
  | "Negotiation"
  | "Won"
  | "Lost";

type SalesOpportunitySyncStatus = "local" | "pending" | "synced";
type SalesOpportunityRecordSource = "existing" | "local-pending";
type OpportunityClientMode = "existing" | "local-pending";
type OpportunityProjectMode = "existing" | "local-pending";
type StageFilter = "All stages" | SalesOpportunityStage | "Archived";
type ProbabilityFilter = "All probabilities" | "0-40%" | "41-70%" | "71-100%";

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
  projectId?: string;
  projectName: string;
  projectSource?: SalesOpportunityRecordSource;
  contactName?: string;
  phone?: string;
  email?: string;
  requirement: string;
  stage: SalesOpportunityStage;
  probability: number;
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
  projectMode: OpportunityProjectMode;
  projectId: string;
  projectName: string;
  projectSource: SalesOpportunityRecordSource;
  contactName: string;
  phone: string;
  email: string;
  requirement: string;
  stage: SalesOpportunityStage | "";
  probability: string;
  expectedValue: string;
  assignedTo: string;
  nextFollowUp: string;
  linkedEnquiryNo: string;
  notes: string;
};

const LOCAL_STORAGE_KEY = "projectworkflow.sales.opportunities.v1";

const STAGE_OPTIONS: SalesOpportunityStage[] = [
  "Qualified",
  "Site Visit",
  "Design / Specification",
  "Quotation Required",
  "Quotation Sent",
  "Negotiation",
  "Won",
  "Lost",
];

const STAGE_FILTER_OPTIONS: StageFilter[] = ["All stages", ...STAGE_OPTIONS, "Archived"];
const PROBABILITY_FILTER_OPTIONS: ProbabilityFilter[] = ["All probabilities", "0-40%", "41-70%", "71-100%"];

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
      stage: "Quotation Required",
      probability: 60,
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
      stage: "Design / Specification",
      probability: 40,
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
      stage: "Quotation Sent",
      probability: 80,
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
      stage: "Site Visit",
      probability: 40,
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
      stage: "Negotiation",
      probability: 80,
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
      stage: "Lost",
      probability: 20,
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

function isSalesOpportunityStage(value: unknown): value is SalesOpportunityStage {
  return typeof value === "string" && STAGE_OPTIONS.includes(value as SalesOpportunityStage);
}

function isSalesOpportunitySyncStatus(value: unknown): value is SalesOpportunitySyncStatus {
  return value === "local" || value === "pending" || value === "synced";
}

function isSalesOpportunityRecordSource(value: unknown): value is SalesOpportunityRecordSource {
  return value === "existing" || value === "local-pending";
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
  const projectName = safeString(data.projectName);
  const requirement = safeString(data.requirement);
  const stage = isSalesOpportunityStage(data.stage) ? data.stage : null;
  const probability = safeNumber(data.probability);

  if (!title || !clientName || !projectName || !requirement || !stage || probability === undefined) return null;

  const createdAt = safeString(data.createdAt) || new Date().toISOString();
  const updatedAt = safeString(data.updatedAt) || createdAt;

  return {
    id: safeString(data.id) || `opp-${index + 1}`,
    opportunityNo: safeString(data.opportunityNo) || `OPP-${new Date().getFullYear()}-${String(index + 1).padStart(3, "0")}`,
    title,
    clientId: safeString(data.clientId) || undefined,
    clientName,
    clientSource: isSalesOpportunityRecordSource(data.clientSource) ? data.clientSource : "local-pending",
    projectId: safeString(data.projectId) || undefined,
    projectName,
    projectSource: isSalesOpportunityRecordSource(data.projectSource) ? data.projectSource : "local-pending",
    contactName: safeString(data.contactName) || undefined,
    phone: safeString(data.phone) || undefined,
    email: safeString(data.email) || undefined,
    requirement,
    stage,
    probability: Math.max(0, Math.min(100, Math.round(probability))),
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
    clientMode: "local-pending",
    clientId: "",
    clientName: "",
    clientSource: "local-pending",
    projectMode: "local-pending",
    projectId: "",
    projectName: "",
    projectSource: "local-pending",
    contactName: "",
    phone: "",
    email: "",
    requirement: "",
    stage: "Qualified",
    probability: "40",
    expectedValue: "",
    assignedTo: "",
    nextFollowUp: "",
    linkedEnquiryNo: "",
    notes: "",
  };
}

function draftFromOpportunity(opportunity: SalesOpportunity): SalesOpportunityDraft {
  const clientSource = opportunity.clientId && opportunity.clientSource === "existing" ? "existing" : "local-pending";
  const projectSource = opportunity.projectId && opportunity.projectSource === "existing" ? "existing" : "local-pending";

  return {
    title: opportunity.title,
    clientMode: clientSource,
    clientId: clientSource === "existing" ? opportunity.clientId ?? "" : "",
    clientName: opportunity.clientName,
    clientSource,
    projectMode: projectSource,
    projectId: projectSource === "existing" ? opportunity.projectId ?? "" : "",
    projectName: opportunity.projectName,
    projectSource,
    contactName: opportunity.contactName ?? "",
    phone: opportunity.phone ?? "",
    email: opportunity.email ?? "",
    requirement: opportunity.requirement,
    stage: opportunity.stage,
    probability: String(opportunity.probability),
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

function stageClassName(stage: SalesOpportunityStage) {
  switch (stage) {
    case "Won":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "Lost":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "Quotation Required":
    case "Quotation Sent":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Negotiation":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "Site Visit":
      return "border-blue-200 bg-blue-50 text-blue-900";
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

function probabilityMatchesFilter(probability: number, filter: ProbabilityFilter) {
  if (filter === "All probabilities") return true;
  if (filter === "0-40%") return probability <= 40;
  if (filter === "41-70%") return probability >= 41 && probability <= 70;
  return probability >= 71;
}

function plannedNextActions(opportunity: SalesOpportunity) {
  switch (opportunity.stage) {
    case "Qualified":
      return [
        "Confirm scope, project value, and buying timeline.",
        "Schedule the next discovery or site coordination step.",
        "Prepare the opportunity for design/specification review.",
      ];
    case "Site Visit":
      return [
        "Capture site notes, dimensions, and room-by-room quantities.",
        "Update the requirement summary after the visit.",
        "Move to design/specification once the scope is clear.",
      ];
    case "Design / Specification":
      return [
        "Finalize specification choices and alternates.",
        "Prepare commercial assumptions before quotation.",
        "Confirm any long-lead items with the product team.",
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
  return source === "existing"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function sourceBadgeLabel(kind: "client" | "project", source?: SalesOpportunityRecordSource) {
  if (source === "existing") return kind === "client" ? "Existing client" : "Existing project";
  return kind === "client" ? "Local client" : "Local project";
}

function projectOptionLabel(project: ProjectOption) {
  return [
    project.project_name,
    project.project_number ? ` - ${project.project_number}` : project.project_code ? ` - ${project.project_code}` : "",
    project.project_year ? ` (${project.project_year})` : "",
  ].join("");
}

export function OpportunitiesPreview({
  clients,
  projects,
}: {
  clients: ClientOption[];
  projects: ProjectOption[];
}) {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>(() => cloneOpportunities(seedOpportunities()));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("All stages");
  const [probabilityFilter, setProbabilityFilter] = useState<ProbabilityFilter>("All probabilities");
  const [assignedFilter, setAssignedFilter] = useState("All users");
  const [selectedId, setSelectedId] = useState(() => seedOpportunities()[0]?.id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalesOpportunityDraft>(() => createEmptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const draftProjects = useMemo(
    () => (draft.clientMode === "existing" && draft.clientId ? projects.filter((project) => project.client_id === draft.clientId) : []),
    [draft.clientId, draft.clientMode, projects],
  );

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
      const matchesArchive = stageFilter === "Archived" ? opportunity.isArchived : !opportunity.isArchived;
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
          opportunity.requirement,
          opportunity.stage,
          opportunity.expectedValue !== undefined ? String(opportunity.expectedValue) : "",
          opportunity.assignedTo,
          opportunity.linkedEnquiryNo,
          opportunity.notes,
        ].some((value) => (value ?? "").toLowerCase().includes(normalizedQuery));

      return (
        matchesArchive &&
        matchesQuery &&
        (stageFilter === "All stages" || stageFilter === "Archived" || opportunity.stage === stageFilter) &&
        probabilityMatchesFilter(opportunity.probability, probabilityFilter) &&
        (assignedFilter === "All users" || opportunity.assignedTo === assignedFilter)
      );
    });
  }, [assignedFilter, opportunities, probabilityFilter, searchQuery, stageFilter]);

  const activeOpportunities = opportunities.filter((opportunity) => !opportunity.isArchived);
  const selectedOpportunity =
    opportunities.find((opportunity) => opportunity.id === selectedId) ??
    filteredOpportunities[0] ??
    activeOpportunities[0] ??
    opportunities[0];

  function resetFilters() {
    setSearchQuery("");
    setStageFilter("All stages");
    setProbabilityFilter("All probabilities");
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

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(createEmptyDraft());
    setFormError(null);
  }

  function updateDraft<Field extends keyof SalesOpportunityDraft>(field: Field, value: SalesOpportunityDraft[Field]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function saveDraft() {
    const title = draft.title.trim();
    const requirement = draft.requirement.trim();
    const stage = draft.stage;
    const probability = Number(draft.probability);
    const expectedValue = draft.expectedValue.trim() ? Number(draft.expectedValue) : undefined;
    const existingClient = draft.clientMode === "existing"
      ? clients.find((client) => client.id === draft.clientId)
      : undefined;
    const clientName = draft.clientMode === "existing"
      ? existingClient?.company_name.trim() ?? ""
      : draft.clientName.trim();
    const clientId = draft.clientMode === "existing" ? existingClient?.id : undefined;
    const clientSource: SalesOpportunityRecordSource = draft.clientMode === "existing" ? "existing" : "local-pending";
    const existingProject = draft.projectMode === "existing" && clientId
      ? projects.find((project) => project.id === draft.projectId && project.client_id === clientId)
      : undefined;
    const projectName = draft.projectMode === "existing"
      ? existingProject?.project_name.trim() ?? ""
      : draft.projectName.trim();
    const projectId = draft.projectMode === "existing" ? existingProject?.id : undefined;
    const projectSource: SalesOpportunityRecordSource = draft.projectMode === "existing" ? "existing" : "local-pending";

    if (!title || !clientName || !projectName || !requirement || !stage || !Number.isFinite(probability)) {
      setFormError("Add a title, client, project, requirement, stage, and probability before saving locally.");
      return;
    }

    if (draft.clientMode === "existing" && !clientId) {
      setFormError("Select an existing client or switch to New local client.");
      return;
    }

    if (draft.projectMode === "existing" && !projectId) {
      setFormError("Select an existing project or switch to New local project.");
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
                projectId,
                projectName,
                projectSource,
                contactName: draft.contactName.trim() || undefined,
                phone: draft.phone.trim() || undefined,
                email: draft.email.trim() || undefined,
                requirement,
                stage,
                probability: Math.max(0, Math.min(100, Math.round(probability))),
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
        projectId,
        projectName,
        projectSource,
        contactName: draft.contactName.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        requirement,
        stage,
        probability: Math.max(0, Math.min(100, Math.round(probability))),
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
    open: activeOpportunities.filter((opportunity) => opportunity.stage !== "Won" && opportunity.stage !== "Lost").length,
    quotationRequired: activeOpportunities.filter((opportunity) => opportunity.stage === "Quotation Required").length,
    quotationSent: activeOpportunities.filter((opportunity) => opportunity.stage === "Quotation Sent").length,
    wonLost: activeOpportunities.filter((opportunity) => opportunity.stage === "Won" || opportunity.stage === "Lost").length,
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-2">
          <span className="w-fit rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            UI preview only - opportunity records are saved in this browser only.
          </span>
          <span className="w-fit rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950">
            Future version will save locally first, then sync to Supabase.
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
            href="/sales/enquiries"
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            Open Enquiries
          </Link>
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
                          projectMode: "existing",
                          projectSource: "existing",
                          clientName: "",
                          projectName: "",
                          projectId: "",
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
                      checked={draft.clientMode === "local-pending"}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          clientMode: "local-pending",
                          clientId: "",
                          clientSource: "local-pending",
                          projectMode: "local-pending",
                          projectId: "",
                          projectSource: "local-pending",
                        }))
                      }
                      className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20"
                    />
                    New local client
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
                          projectId: "",
                          projectName: "",
                          projectMode: "existing",
                          projectSource: "existing",
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="">Select existing client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.company_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <FieldLabel label="Local Client Name" />
                    <input
                      value={draft.clientName}
                      onChange={(event) => updateDraft("clientName", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block">
                    <FieldLabel label="Contact" />
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

            <fieldset className="rounded-lg border border-zinc-200 p-4 md:col-span-2">
              <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Project</legend>
              <div className="grid gap-3">
                {draft.clientMode === "existing" ? (
                  <div className="flex flex-wrap gap-3 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="opportunity-project-mode"
                        checked={draft.projectMode === "existing"}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            projectMode: "existing",
                            projectSource: "existing",
                            projectName: "",
                          }))
                        }
                        className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20"
                      />
                      Existing project
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="opportunity-project-mode"
                        checked={draft.projectMode === "local-pending"}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            projectMode: "local-pending",
                            projectId: "",
                            projectSource: "local-pending",
                          }))
                        }
                        className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20"
                      />
                      New local project
                    </label>
                  </div>
                ) : null}

                {draft.clientMode === "existing" && draft.projectMode === "existing" ? (
                  <label className="block">
                    <FieldLabel label="Existing Project" />
                    <select
                      value={draft.projectId}
                      disabled={!draft.clientId}
                      onChange={(event) => updateDraft("projectId", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:bg-zinc-50 disabled:text-zinc-400"
                    >
                      <option value="">{draft.clientId ? "Select existing project" : "Select client first"}</option>
                      {draftProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {projectOptionLabel(project)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <FieldLabel label="Local Project Name" />
                    <input
                      value={draft.projectName}
                      onChange={(event) => updateDraft("projectName", event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                )}
              </div>
            </fieldset>
            <label className="block">
              <FieldLabel label="Stage" />
              <select
                value={draft.stage}
                onChange={(event) => updateDraft("stage", event.target.value as SalesOpportunityStage)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                {STAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel label="Probability" />
              <input
                type="number"
                min="0"
                max="100"
                value={draft.probability}
                onChange={(event) => updateDraft("probability", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
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
              <FieldLabel label="Next Follow-up" />
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
              <FieldLabel label="Requirement" />
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
            <FieldLabel label="Stage" />
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value as StageFilter)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {STAGE_FILTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel label="Probability" />
            <select
              value={probabilityFilter}
              onChange={(event) => setProbabilityFilter(event.target.value as ProbabilityFilter)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {PROBABILITY_FILTER_OPTIONS.map((option) => (
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
              Enquiry &gt; Opportunity &gt; Quotation &gt; Client Approval &gt; Confirmed Project &gt; Procurement
            </p>
          </div>
          <p className="max-w-xl text-sm text-zinc-500">
            This workspace is local-first and intentionally disconnected from quotation creation, project conversion, and procurement.
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
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${stageClassName(opportunity.stage)}`}>
                        {opportunity.stage}
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
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(opportunity.projectSource)}`}>
                        {sourceBadgeLabel("project", opportunity.projectSource)}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-zinc-950">{opportunity.title}</h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      {opportunity.clientName} / {opportunity.projectName}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-600">{opportunity.requirement}</p>
                  </button>

                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[280px] lg:grid-cols-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Probability</span>
                      <span className="font-medium text-zinc-950">{opportunity.probability}%</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Expected value</span>
                      <span className="font-medium text-zinc-950">{formatExpectedValue(opportunity.expectedValue)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Next follow-up</span>
                      <span className="font-medium text-zinc-950">{formatDisplayDate(opportunity.nextFollowUp)}</span>
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
                  {selectedOpportunity.opportunityNo} / {selectedOpportunity.clientName} / {selectedOpportunity.projectName}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClassName(selectedOpportunity.clientSource)}`}>
                    {sourceBadgeLabel("client", selectedOpportunity.clientSource)}
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
                  <dt className="text-zinc-500">Stage</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.stage}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Probability</dt>
                  <dd className="font-medium text-zinc-950">{selectedOpportunity.probability}%</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Expected value</dt>
                  <dd className="font-medium text-zinc-950">{formatExpectedValue(selectedOpportunity.expectedValue)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Next follow-up</dt>
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
                {selectedOpportunity.clientSource === "existing" && selectedOpportunity.projectSource === "existing"
                  ? "Existing linked client/project can safely prefill quotation dropdowns. Please review before creating the quotation."
                  : "Local pending client/project are reference only until converted to real records later. Select or create the real client/project before creating the quotation."}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Link
                  href={`/sales/quotations?fromOpportunity=${encodeURIComponent(selectedOpportunity.id)}`}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                  Create Quotation
                </Link>
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
    </div>
  );
}
