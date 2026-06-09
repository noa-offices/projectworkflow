"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

type LocalOpportunity = {
  id?: unknown;
  opportunityNo?: unknown;
  title?: unknown;
  clientId?: unknown;
  clientName?: unknown;
  clientSource?: unknown;
  projectId?: unknown;
  projectName?: unknown;
  projectSource?: unknown;
  contactName?: unknown;
  phone?: unknown;
  email?: unknown;
  requirement?: unknown;
  expectedValue?: unknown;
  assignedTo?: unknown;
  notes?: unknown;
};

type OpportunityPrefill = {
  id: string;
  opportunityNo: string;
  title: string;
  clientId?: string;
  clientName: string;
  clientSource?: "existing" | "local-pending";
  projectId?: string;
  projectName: string;
  projectSource?: "existing" | "local-pending";
  contactName: string;
  phone?: string;
  email?: string;
  requirement: string;
  expectedValue?: number;
  assignedTo: string;
  notes: string;
};

type OpportunityMatch = {
  clientId: string | null;
  clientNameMatched: boolean;
  projectId: string | null;
  projectNameMatched: boolean;
  clientAmbiguous: boolean;
  projectAmbiguous: boolean;
};

const OPPORTUNITIES_STORAGE_KEY = "projectworkflow.sales.opportunities.v1";
const PREFILLED_MARKER = "opportunityPrefilled";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeSource(value: unknown) {
  return value === "existing" || value === "local-pending" ? value : undefined;
}

function normalizeMatchValue(value: string) {
  return value.trim().toLowerCase();
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeOpportunity(raw: unknown): OpportunityPrefill | null {
  if (!raw || typeof raw !== "object") return null;

  const opportunity = raw as LocalOpportunity;
  const id = safeString(opportunity.id);
  const title = safeString(opportunity.title);

  if (!id || !title) return null;

  return {
    id,
    opportunityNo: safeString(opportunity.opportunityNo) || "Opportunity",
    title,
    clientId: safeString(opportunity.clientId) || undefined,
    clientName: safeString(opportunity.clientName),
    clientSource: safeSource(opportunity.clientSource),
    projectId: safeString(opportunity.projectId) || undefined,
    projectName: safeString(opportunity.projectName),
    projectSource: safeSource(opportunity.projectSource),
    contactName: safeString(opportunity.contactName),
    phone: safeString(opportunity.phone) || undefined,
    email: safeString(opportunity.email) || undefined,
    requirement: safeString(opportunity.requirement),
    expectedValue: safeNumber(opportunity.expectedValue),
    assignedTo: safeString(opportunity.assignedTo),
    notes: safeString(opportunity.notes),
  };
}

function formatExpectedValue(value?: number) {
  if (value === undefined) return "";
  return `AED ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildNotesPrefill(opportunity: OpportunityPrefill) {
  return [
    `Prefilled from ${opportunity.opportunityNo}: ${opportunity.title}`,
    opportunity.clientName ? `Client: ${opportunity.clientName}` : "",
    opportunity.projectName ? `Project: ${opportunity.projectName}` : "",
    opportunity.contactName ? `Contact: ${opportunity.contactName}` : "",
    opportunity.phone ? `Phone: ${opportunity.phone}` : "",
    opportunity.email ? `Email: ${opportunity.email}` : "",
    opportunity.requirement ? `Requirement: ${opportunity.requirement}` : "",
    opportunity.notes ? `Opportunity notes: ${opportunity.notes}` : "",
    opportunity.expectedValue !== undefined ? `Expected value reference: ${formatExpectedValue(opportunity.expectedValue)}` : "",
    opportunity.assignedTo ? `Assigned to: ${opportunity.assignedTo}` : "",
  ].filter(Boolean).join("\n");
}

function setFieldValue(form: HTMLFormElement, selector: string, value: string) {
  const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) return;

  if (field.value && field.dataset[PREFILLED_MARKER] !== "true") return;

  field.value = value;
  field.dataset[PREFILLED_MARKER] = "true";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearPrefilledField(form: HTMLFormElement, selector: string) {
  const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field || field.dataset[PREFILLED_MARKER] !== "true") return;

  field.value = "";
  delete field.dataset[PREFILLED_MARKER];
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectPrefill(form: HTMLFormElement, selector: string, value: string, markerKey: string) {
  const field = form.querySelector<HTMLSelectElement>(selector);
  if (!field) return;

  field.value = value;
  field.dataset[PREFILLED_MARKER] = "true";
  field.dataset.prefillValue = value;
  field.dataset.prefillField = markerKey;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearPrefilledSelect(form: HTMLFormElement, selector: string, markerKey: string) {
  const field = form.querySelector<HTMLSelectElement>(selector);
  if (!field || field.dataset.prefillField !== markerKey || field.dataset[PREFILLED_MARKER] !== "true") return;

  if (field.value === field.dataset.prefillValue) {
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  delete field.dataset[PREFILLED_MARKER];
  delete field.dataset.prefillValue;
  delete field.dataset.prefillField;
}

function findOpportunityMatch(
  opportunity: OpportunityPrefill,
  clients: ClientOption[],
  projects: ProjectOption[],
): OpportunityMatch {
  const existingClientById = opportunity.clientSource === "existing" && opportunity.clientId
    ? clients.find((client) => client.id === opportunity.clientId)
    : undefined;
  const clientIdFromId = existingClientById?.id ?? null;
  const isLocalPendingClient = opportunity.clientSource === "local-pending";
  const normalizedClientName = normalizeMatchValue(opportunity.clientName);
  const matchingClients = !clientIdFromId && !isLocalPendingClient && normalizedClientName
    ? clients.filter((client) => normalizeMatchValue(client.company_name) === normalizedClientName)
    : [];

  const clientId = clientIdFromId ?? (matchingClients.length === 1 ? matchingClients[0]?.id ?? null : null);
  const clientNameMatched = Boolean(clientId);
  const existingProjectById = opportunity.projectSource === "existing" && opportunity.projectId && clientId
    ? projects.find((project) => project.id === opportunity.projectId && project.client_id === clientId)
    : undefined;
  const projectIdFromId = existingProjectById?.id ?? null;
  const isLocalPendingProject = opportunity.projectSource === "local-pending";

  const normalizedProjectName = normalizeMatchValue(opportunity.projectName);
  const matchingProjects = clientId && !projectIdFromId && !isLocalPendingProject && normalizedProjectName
    ? projects.filter(
        (project) =>
          project.client_id === clientId &&
          normalizeMatchValue(project.project_name) === normalizedProjectName,
      )
    : [];

  const projectId = projectIdFromId ?? (matchingProjects.length === 1 ? matchingProjects[0]?.id ?? null : null);

  return {
    clientId,
    clientNameMatched,
    projectId,
    projectNameMatched: Boolean(projectId),
    clientAmbiguous: matchingClients.length > 1,
    projectAmbiguous: matchingProjects.length > 1,
  };
}

export function OpportunityQuotationPrefill({
  clients,
  projects,
}: {
  clients: ClientOption[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromOpportunity = searchParams.get("fromOpportunity")?.trim() ?? "";
  const [opportunity, setOpportunity] = useState<OpportunityPrefill | null>(null);
  const [status, setStatus] = useState<"idle" | "found" | "missing" | "invalid">("idle");
  const [showHelper, setShowHelper] = useState(false);
  const match = useMemo(
    () => (opportunity ? findOpportunityMatch(opportunity, clients, projects) : null),
    [clients, opportunity, projects],
  );

  const clearHref = useMemo(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("fromOpportunity");
    const query = nextParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!fromOpportunity) {
        setOpportunity(null);
        setStatus("idle");
        return;
      }

      try {
        const raw = window.localStorage.getItem(OPPORTUNITIES_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        if (!Array.isArray(parsed)) {
          setOpportunity(null);
          setStatus("missing");
          return;
        }

        const matched = parsed.map(normalizeOpportunity).find((item) => item?.id === fromOpportunity) ?? null;
        if (!matched) {
          setOpportunity(null);
          setStatus("missing");
          return;
        }

        setOpportunity(matched);
        setStatus("found");
      } catch {
        setOpportunity(null);
        setStatus("invalid");
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fromOpportunity]);

  useEffect(() => {
    if (!opportunity || !match) return;

    const form = document.querySelector<HTMLFormElement>("[data-quotation-create-form]");
    if (!form) return;

    setFieldValue(form, 'input[name="title"]', opportunity.title);
    setFieldValue(form, 'textarea[name="notes"]', buildNotesPrefill(opportunity));

    if (match.clientId) {
      setSelectPrefill(form, 'select[name="client_id"]', match.clientId, "client_id");
    }

    window.setTimeout(() => {
      if (match.projectId) {
        setSelectPrefill(form, 'select[name="project_id"]', match.projectId, "project_id");
      }
    }, 0);
  }, [match, opportunity]);

  function clearPrefill() {
    const form = document.querySelector<HTMLFormElement>("[data-quotation-create-form]");
    if (form) {
      clearPrefilledField(form, 'input[name="title"]');
      clearPrefilledField(form, 'textarea[name="notes"]');
      clearPrefilledSelect(form, 'select[name="project_id"]', "project_id");
      clearPrefilledSelect(form, 'select[name="client_id"]', "client_id");
    }
    setOpportunity(null);
    setStatus("idle");
    setShowHelper(false);
    router.replace(clearHref, { scroll: false });
  }

  if (!fromOpportunity || status === "idle") return null;

  if (status === "missing" || status === "invalid") {
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Opportunity prefill was requested, but the local opportunity could not be found. The quotation form is unchanged.
        <button type="button" onClick={clearPrefill} className="ml-2 font-semibold underline">
          Clear opportunity prefill
        </button>
      </div>
    );
  }

  if (!opportunity) return null;

  const matchedClientLabel = match?.clientNameMatched && match.clientId ? "matched existing client" : "manual client selection needed";
  const matchedProjectLabel = match?.projectNameMatched && match.projectId ? "matched existing project" : "manual project selection needed";
  const noticeText =
    opportunity.clientSource === "local-pending" || opportunity.projectSource === "local-pending"
      ? "This opportunity uses local-only client/project names. Select or create the real client/project before creating the quotation."
      : match?.clientNameMatched && match?.projectNameMatched
        ? "Existing client/project matched from opportunity. Please review before creating the quotation."
        : match?.clientNameMatched
          ? "Existing client matched from opportunity. Select the matching existing project before creating the quotation."
          : "Client/project are shown as reference only. Select the matching existing client and project before creating the quotation.";

  return (
    <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            Prefilled from opportunity: {opportunity.opportunityNo} / {opportunity.title}
          </p>
          <p className="mt-1 text-emerald-900">{noticeText}</p>
          <p className="mt-1 text-xs text-emerald-900">
            Client: {opportunity.clientName || "Not set"} ({matchedClientLabel})
            <br />
            Project: {opportunity.projectName || "Not set"} ({matchedProjectLabel})
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <button type="button" onClick={clearPrefill} className="text-left text-sm font-semibold underline sm:text-right">
            Clear opportunity prefill
          </button>
          {opportunity.clientSource === "local-pending" || opportunity.projectSource === "local-pending" || (!match?.clientId || !match?.projectId) ? (
            <button
              type="button"
              onClick={() => setShowHelper((current) => !current)}
              className="text-left text-sm font-semibold underline sm:text-right"
            >
              Create real client/project
            </button>
          ) : null}
        </div>
      </div>

      {showHelper ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-white p-4 text-sm text-zinc-700">
          <p className="font-semibold text-zinc-950">Create real client/project</p>
          <p className="mt-1">
            This opportunity is using local-only client/project names. Open Clients &amp; Projects, create or select the real records, then return here to continue.
          </p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
              <dt className="text-zinc-500">Opportunity</dt>
              <dd className="font-medium text-zinc-950">{opportunity.opportunityNo}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
              <dt className="text-zinc-500">Client</dt>
              <dd className="font-medium text-zinc-950">{opportunity.clientName || "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
              <dt className="text-zinc-500">Project</dt>
              <dd className="font-medium text-zinc-950">{opportunity.projectName || "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
              <dt className="text-zinc-500">Contact</dt>
              <dd className="font-medium text-zinc-950">{opportunity.contactName || "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
              <dt className="text-zinc-500">Requirement</dt>
              <dd className="font-medium text-zinc-950">{opportunity.requirement || "Not set"}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/clients"
              className="inline-flex h-9 items-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Open Clients &amp; Projects
            </Link>
            <Link
              href="/clients?tab=clients&addClient=1"
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Add Client
            </Link>
            <Link
              href="/clients?tab=projects&addProject=1"
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Add Project
            </Link>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            After the real records are created or selected, return here and select them in the quotation form before clicking Add quotation.
          </p>
        </div>
      ) : null}
    </div>
  );
}
