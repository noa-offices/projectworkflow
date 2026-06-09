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
  clientConfirmed?: unknown;
  projectId?: unknown;
  referenceName?: unknown;
  projectName?: unknown;
  projectSource?: unknown;
  contactName?: unknown;
  phone?: unknown;
  email?: unknown;
  location?: unknown;
  deliveryLocation?: unknown;
  requirement?: unknown;
  source?: unknown;
  status?: unknown;
  stage?: unknown;
  enquiryDate?: unknown;
  quotationSubmissionDate?: unknown;
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
  clientSource?: "existing" | "created" | "local";
  clientConfirmed: boolean;
  projectId?: string;
  referenceName: string;
  projectName: string;
  projectSource?: "existing" | "local-pending";
  contactName: string;
  phone?: string;
  email?: string;
  location?: string;
  deliveryLocation?: string;
  requirement: string;
  source?: string;
  status?: string;
  enquiryDate?: string;
  quotationSubmissionDate?: string;
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

function safeClientSource(value: unknown) {
  return value === "existing" || value === "created" || value === "local" || value === "local-pending"
    ? (value === "local-pending" ? "local" : value)
    : undefined;
}

function safeProjectSource(value: unknown) {
  return value === "existing" || value === "local-pending" || value === "local"
    ? (value === "local" ? "local-pending" : value)
    : undefined;
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
    clientSource: safeClientSource(opportunity.clientSource),
    clientConfirmed:
      opportunity.clientConfirmed === true ||
      Boolean(safeString(opportunity.clientId) && (safeString(opportunity.clientSource) === "existing" || safeString(opportunity.clientSource) === "created")),
    projectId: safeString(opportunity.projectId) || undefined,
    referenceName: safeString(opportunity.referenceName) || safeString(opportunity.projectName),
    projectName: safeString(opportunity.projectName) || safeString(opportunity.referenceName),
    projectSource: safeProjectSource(opportunity.projectSource),
    contactName: safeString(opportunity.contactName),
    phone: safeString(opportunity.phone) || undefined,
    email: safeString(opportunity.email) || undefined,
    location: safeString(opportunity.location) || safeString(opportunity.deliveryLocation) || undefined,
    deliveryLocation: safeString(opportunity.deliveryLocation) || safeString(opportunity.location) || undefined,
    requirement: safeString(opportunity.requirement),
    source: safeString(opportunity.source) || undefined,
    status: safeString(opportunity.status) || safeString(opportunity.stage) || undefined,
    enquiryDate: safeString(opportunity.enquiryDate) || undefined,
    quotationSubmissionDate: safeString(opportunity.quotationSubmissionDate) || undefined,
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
    opportunity.referenceName ? `Project / reference: ${opportunity.referenceName}` : "",
    opportunity.contactName ? `Contact: ${opportunity.contactName}` : "",
    opportunity.phone ? `Phone: ${opportunity.phone}` : "",
    opportunity.email ? `Email: ${opportunity.email}` : "",
    opportunity.deliveryLocation || opportunity.location ? `Location / delivery: ${opportunity.deliveryLocation || opportunity.location}` : "",
    opportunity.requirement ? `Requirement: ${opportunity.requirement}` : "",
    opportunity.source ? `Source: ${opportunity.source}` : "",
    opportunity.status ? `Status: ${opportunity.status}` : "",
    opportunity.enquiryDate ? `Enquiry date: ${opportunity.enquiryDate}` : "",
    opportunity.quotationSubmissionDate ? `Quotation submission date: ${opportunity.quotationSubmissionDate}` : "",
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
  const existingClientById = (opportunity.clientSource === "existing" || opportunity.clientSource === "created") && opportunity.clientId
    ? clients.find((client) => client.id === opportunity.clientId)
    : undefined;
  const clientIdFromId = existingClientById?.id ?? null;
  const normalizedClientName = normalizeMatchValue(opportunity.clientName);
  const matchingClients = opportunity.clientConfirmed && !clientIdFromId && normalizedClientName
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
    setFieldValue(form, 'input[name="legacy_reference"]', opportunity.referenceName || opportunity.projectName || opportunity.title);
    setFieldValue(form, 'input[name="from_opportunity_no"]', opportunity.opportunityNo);
    setFieldValue(form, 'textarea[name="notes"]', buildNotesPrefill(opportunity));

    if (opportunity.clientConfirmed && match.clientId) {
      setSelectPrefill(form, 'select[name="client_id"]', match.clientId, "client_id");
    }
  }, [match, opportunity]);

  function clearPrefill() {
    const form = document.querySelector<HTMLFormElement>("[data-quotation-create-form]");
    if (form) {
      clearPrefilledField(form, 'input[name="title"]');
      clearPrefilledField(form, 'input[name="legacy_reference"]');
      clearPrefilledField(form, 'input[name="from_opportunity_no"]');
      clearPrefilledField(form, 'textarea[name="notes"]');
      clearPrefilledSelect(form, 'select[name="project_id"]', "project_id");
      clearPrefilledSelect(form, 'select[name="client_id"]', "client_id");
    }
    setOpportunity(null);
    setStatus("idle");
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

  const hasConfirmedClient = Boolean(opportunity.clientConfirmed && match?.clientId);
  const matchedClientLabel = hasConfirmedClient ? "matched confirmed client" : "confirmed client missing";
  const noticeText = hasConfirmedClient
    ? "Prefilled from opportunity. Please review before creating the quotation."
    : "This opportunity does not have a confirmed client. Please return to Opportunities and update the client before creating the quotation.";

  return (
    <div className={`mb-4 rounded-md border p-3 text-sm ${
      hasConfirmedClient
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-amber-200 bg-amber-50 text-amber-950"
    }`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            Prefilled from opportunity: {opportunity.opportunityNo} / {opportunity.title}
          </p>
          <p className={hasConfirmedClient ? "mt-1 text-emerald-900" : "mt-1 text-amber-900"}>{noticeText}</p>
          <p className={hasConfirmedClient ? "mt-1 text-xs text-emerald-900" : "mt-1 text-xs text-amber-900"}>
            Client: {opportunity.clientName || "Not set"} ({matchedClientLabel})
            <br />
            Project / reference: {opportunity.referenceName || opportunity.projectName || "Not set"}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Link href="/sales/opportunities" className="text-left text-sm font-semibold underline sm:text-right">
            Back to Opportunities
          </Link>
          <button type="button" onClick={clearPrefill} className="text-left text-sm font-semibold underline sm:text-right">
            Clear opportunity prefill
          </button>
        </div>
      </div>
    </div>
  );
}
