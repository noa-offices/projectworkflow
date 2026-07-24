"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { quotationFolderNumberFromQuotationNumber } from "@/lib/projectworkflow-numbering";
import {
  quotationStatusBadgeClassName,
  quotationStatusLabel,
  quotationStatuses,
} from "@/lib/quotation-status";
import { archiveFolderAction } from "@/lib/quotations/archive-folder-action";
import { deleteFolderAction } from "@/lib/quotations/delete-folder-action";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";

type Client = { id: string; company_name: string };

type SalespersonProfile = { id: string; full_name: string | null };

type Project = {
  id: string;
  client_id: string;
  project_name: string;
  project_number: string | null;
  project_code: string | null;
  project_year: number | null;
};

type Quotation = {
  client_id: string;
  currency: string;
  grand_total: number;
  id: string;
  is_active: boolean;
  layout_settings: Record<string, unknown> | null;
  project_id: string | null;
  legacy_reference: string | null;
  quotation_date: string;
  quotation_no: string | null;
  salesperson_id: string | null;
  status: string;
  title: string;
};

type QuotationListLiveFilterProps = {
  canDeleteFolders: boolean;
  children?: ReactNode;
  clients: Client[];
  initialFilters?: {
    client?: string;
    project?: string;
    q?: string;
    status?: string;
    year?: string;
  };
  projectYears: number[];
  projects: Project[];
  quotations: Quotation[];
  salespersonProfiles: SalespersonProfile[];
};

type QuotationFolder = {
  activeCount: number;
  allQuotationIds: string[];
  archiveAnchorId: string;
  archivedCount: number;
  clientName: string;
  confirmText: string;
  deleteBlockReason: string | null;
  folderNo: string | null;
  isFolderArchived: boolean;
  isFolderDeletable: boolean;
  key: string;
  latestQuotation: Quotation;
  projectName: string;
  quotationCount: number;
  salespersonName: string | null;
  statusSummary: string;
};

function matchesSearch(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}

function quotationFolderKey(quotation: Quotation) {
  const folderNo = quotationFolderNumberFromQuotationNumber(quotation.quotation_no);
  if (folderNo) return folderNo;
  if (quotation.project_id) return `project:${quotation.project_id}`;
  return `legacy:${quotation.id}`;
}

function isOriginalQuotation(quotation: Quotation) {
  return !quotation.quotation_no?.trim().match(/-(?:R|OPT)\d+/i);
}

function latestQuotation(left: Quotation, right: Quotation) {
  const leftTime = new Date(left.quotation_date).getTime();
  const rightTime = new Date(right.quotation_date).getTime();
  return rightTime > leftTime ? right : left;
}

function folderRepresentativeQuotation(quotations: Quotation[]) {
  const activeQuotations = quotations.filter((quotation) => quotation.is_active);
  const latestActive = activeQuotations.length ? activeQuotations.reduce(latestQuotation) : null;
  const originalQuotation = quotations.find(isOriginalQuotation) ?? null;
  const latestAny = quotations.reduce(latestQuotation);

  return latestActive ?? latestAny ?? originalQuotation ?? quotations[0];
}

function folderDisplayNo(quotations: Quotation[]) {
  return quotations
    .map((quotation) => quotationFolderNumberFromQuotationNumber(quotation.quotation_no))
    .find((value): value is string => Boolean(value)) ?? null;
}

function statusSummary(quotations: Quotation[]) {
  const counts = new Map<string, number>();
  for (const quotation of quotations) {
    const label = quotation.is_active ? quotationStatusLabel(quotation.status) : "Archived";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${label} x${count}` : label))
    .join(", ");
}

function formatListDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

type DeletingFolderState = {
  key: string;
  confirmText: string;
  allQuotationIds: string[];
};

export function QuotationListLiveFilter({
  canDeleteFolders,
  children,
  clients,
  initialFilters,
  projectYears,
  projects,
  quotations,
  salespersonProfiles,
}: QuotationListLiveFilterProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialFilters?.q?.trim() ?? "");
  const [selectedStatus, setSelectedStatus] = useState(initialFilters?.status ?? "");
  const [selectedClientId, setSelectedClientId] = useState(initialFilters?.client ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(initialFilters?.project ?? "");
  const [selectedYear, setSelectedYear] = useState(initialFilters?.year ?? "");
  const [showArchived, setShowArchived] = useState(false);
  const [archivingKey, setArchivingKey] = useState<string | null>(null);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [deletingFolder, setDeletingFolder] = useState<DeletingFolderState | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.company_name])), [clients]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const salespersonMap = useMemo(
    () => new Map(salespersonProfiles.map((p) => [p.id, p.full_name])),
    [salespersonProfiles],
  );

  const folders = useMemo<QuotationFolder[]>(() => {
    const folderMap = new Map<string, Quotation[]>();
    for (const quotation of quotations) {
      const key = quotationFolderKey(quotation);
      folderMap.set(key, [...(folderMap.get(key) ?? []), quotation]);
    }

    return Array.from(folderMap.entries())
      .map(([key, folderQuotations]) => {
        const latest = folderRepresentativeQuotation(folderQuotations);
        const project = latest.project_id ? projectMap.get(latest.project_id) : undefined;
        const derivedFolderNo = folderDisplayNo(folderQuotations);
        const activeCount = folderQuotations.filter((quotation) => quotation.is_active).length;
        const archivedCount = folderQuotations.length - activeCount;

        // Folder-level archive: any quotation in the folder has folderArchivedAt set
        const folderArchivedAnchor = folderQuotations.find(
          (q) => typeof q.layout_settings?.folderArchivedAt === "string",
        );
        const isFolderArchived = Boolean(folderArchivedAnchor);
        // Anchor for archive: existing anchor (for unarchive) or root quotation (for archive)
        const rootQuotation = folderQuotations.find(isOriginalQuotation) ?? folderQuotations[0];
        const archiveAnchorId = folderArchivedAnchor?.id ?? rootQuotation.id;

        // Delete eligibility: blocked if any quotation has a non-cancelled project file
        const allQuotationIds = folderQuotations.map((q) => q.id);
        const confirmText =
          derivedFolderNo ??
          latest.quotation_no ??
          latest.legacy_reference ??
          key.slice(0, 16);
        let isFolderDeletable = true;
        let deleteBlockReason: string | null = null;
        for (const q of folderQuotations) {
          const hasFile =
            Boolean(projectFileFromLayoutSettings(q.layout_settings)) ||
            Boolean(clientApprovalDraftFromLayoutSettings(q.layout_settings)?.confirmedOrder);
          if (hasFile) {
            const isCancelled = typeof q.layout_settings?.projectCancelledAt === "string";
            if (!isCancelled) {
              isFolderDeletable = false;
              deleteBlockReason =
                "A Project File was created from this folder. Cancel the project before deleting.";
              break;
            }
          }
        }

        return {
          activeCount,
          allQuotationIds,
          archiveAnchorId,
          archivedCount,
          clientName: clientMap.get(latest.client_id) ?? "Unknown client",
          confirmText,
          deleteBlockReason,
          folderNo: derivedFolderNo,
          isFolderArchived,
          isFolderDeletable,
          key,
          latestQuotation: latest,
          projectName: project?.project_name ?? latest.legacy_reference ?? "Opportunity reference",
          quotationCount: folderQuotations.length,
          salespersonName: latest.salesperson_id ? (salespersonMap.get(latest.salesperson_id) ?? null) : null,
          statusSummary: statusSummary(folderQuotations),
        };
      })
      .sort((left, right) => new Date(right.latestQuotation.quotation_date).getTime() - new Date(left.latestQuotation.quotation_date).getTime());
  }, [clientMap, projectMap, quotations, salespersonMap]);

  const filteredFolders = useMemo(
    () =>
      folders.filter((folder) => {
        // Folder-level archive filter
        if (!showArchived && folder.isFolderArchived) return false;
        if (showArchived && !folder.isFolderArchived) return false;

        const quotation = folder.latestQuotation;
        const project = quotation.project_id ? projectMap.get(quotation.project_id) : undefined;
        const displayYear = project?.project_year ?? new Date(quotation.quotation_date).getFullYear();

        return (
          (!selectedStatus ||
            quotation.status === selectedStatus ||
            (selectedStatus === "archived" && folder.archivedCount > 0)) &&
          (!selectedClientId || quotation.client_id === selectedClientId) &&
          (!selectedProjectId || quotation.project_id === selectedProjectId) &&
          (!selectedYear || String(displayYear) === selectedYear) &&
          matchesSearch(
            [
              quotation.quotation_no,
              folder.folderNo,
              quotation.title,
              quotation.status,
              quotationStatusLabel(quotation.status),
              folder.clientName,
              folder.projectName,
              quotation.legacy_reference,
              project?.project_number,
              project?.project_code,
              project?.project_year,
            ],
            query.trim(),
          )
        );
      }),
    [
      folders,
      projectMap,
      query,
      selectedClientId,
      selectedProjectId,
      selectedStatus,
      selectedYear,
      showArchived,
    ],
  );

  function resetFilters() {
    setQuery("");
    setSelectedStatus("");
    setSelectedClientId("");
    setSelectedProjectId("");
    setSelectedYear("");
    setShowArchived(false);
  }

  async function handleFolderArchive(folderKey: string, quotationId: string, archive: boolean) {
    setArchivingKey(folderKey);
    const result = await archiveFolderAction(quotationId, archive);
    setArchivingKey(null);
    if (!result.ok) return;
    // Wrap router.refresh() in a transition so isRefreshing stays true until
    // the server re-render completes and new quotations props propagate down.
    // Without this, the component updates with stale isFolderArchived values
    // if the user clicks the Archived toggle before the refresh settles.
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  async function handleDeleteConfirm() {
    if (!deletingFolder || deleteConfirmInput !== deletingFolder.confirmText) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteFolderAction(
      deletingFolder.allQuotationIds,
      deletingFolder.confirmText,
    );
    if (!result.ok) {
      setDeleteError(result.error);
      setIsDeleting(false);
      return;
    }
    setDeletingFolder(null);
    setDeleteConfirmInput("");
    setIsDeleting(false);
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  function openDeleteModal(folder: QuotationFolder) {
    setDeletingFolder({
      key: folder.key,
      confirmText: folder.confirmText,
      allQuotationIds: folder.allQuotationIds,
    });
    setDeleteConfirmInput("");
    setDeleteError(null);
  }

  function closeDeleteModal() {
    if (isDeleting) return;
    setDeletingFolder(null);
    setDeleteConfirmInput("");
    setDeleteError(null);
  }

  function openFolder(quotationId: string) {
    router.push(`/quotations/${quotationId}`);
  }

  function handleFolderRowKeyDown(event: React.KeyboardEvent, quotationId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openFolder(quotationId);
  }

  return (
    <>
      {/* ── Delete confirmation modal ────────────────────────────── */}
      {deletingFolder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl"
          >
            <h3 className="text-lg font-semibold text-zinc-950">Permanently delete folder?</h3>
            <p className="mt-2 text-sm text-zinc-600">
              This will permanently delete{" "}
              <span className="font-semibold text-zinc-950">{deletingFolder.confirmText}</span>{" "}
              and all its quotations, revisions, procurement documents, and associated files.{" "}
              <span className="font-semibold text-red-700">This action cannot be undone.</span>
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700">
                Type{" "}
                <span className="font-mono font-semibold text-zinc-950">
                  {deletingFolder.confirmText}
                </span>{" "}
                to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => {
                  setDeleteConfirmInput(e.target.value);
                  setDeleteError(null);
                }}
                placeholder={deletingFolder.confirmText}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 font-mono text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-200"
              />
            </div>
            {deleteError ? (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={isDeleting || deleteConfirmInput !== deletingFolder.confirmText}
                onClick={handleDeleteConfirm}
                className="h-10 flex-1 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDeleting ? "Deleting…" : "Permanently Delete"}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={closeDeleteModal}
                className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search quotation no, title, client, project..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All statuses</option>
              {quotationStatuses.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Project</span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {clientMap.get(project.client_id) ?? "Unknown client"} - {project.project_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Year</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All years</option>
              {projectYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 flex-1 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      {/* ── View mode toggle: Active vs Archived folders ─────────── */}
      <div className="mt-4 flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm w-fit">
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          className={[
            "h-8 rounded-md px-4 text-sm font-semibold transition",
            !showArchived
              ? "bg-zinc-950 text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-800",
          ].join(" ")}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className={[
            "h-8 rounded-md px-4 text-sm font-semibold transition",
            showArchived
              ? "bg-amber-600 text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-800",
          ].join(" ")}
        >
          Archived
        </button>
      </div>

      {children}

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              {showArchived ? "Archived Folders" : "Quotation folders"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {showArchived
                ? "Folders hidden from the default view. Unarchive to restore."
                : "Folder-first view for originals, revisions, options, and builder access."}
            </p>
          </div>
          <p className="text-xs font-semibold uppercase text-zinc-500">
            {isRefreshing ? (
              <span className="text-zinc-400">Updating…</span>
            ) : (
              <>{filteredFolders.length} {filteredFolders.length === 1 ? "folder" : "folders"}</>
            )}
          </p>
        </div>

        {!filteredFolders.length ? (
          <p className="mx-5 mb-5 rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            {showArchived ? "No archived folders." : "No quotation folders match filters."}
          </p>
        ) : null}

        {/* ── Mobile cards ────────────────────────────────────────── */}
        <div className="grid gap-3 px-5 pb-5 pt-1 lg:hidden">
          {filteredFolders.map((folder) => {
            const quotation = folder.latestQuotation;

            return (
              <article
                key={folder.key}
                aria-label={`Open ${folder.folderNo ?? folder.projectName}`}
                className="cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50 p-4 transition hover:border-emerald-900/25 hover:bg-emerald-50/30"
                onClick={() => openFolder(quotation.id)}
                onKeyDown={(event) => handleFolderRowKeyDown(event, quotation.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-zinc-500">Folder No</p>
                    <h3 className="mt-1 text-base font-semibold text-zinc-950">
                      {folder.folderNo ?? "Legacy"}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-600">{folder.clientName}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{folder.projectName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">
                      {formatQuotationMoney(quotation.currency, quotation.grand_total)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Latest quotation</p>
                    <p className="mt-1 font-medium text-zinc-950">{quotation.quotation_no ?? quotation.legacy_reference ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Status</p>
                    <span className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${quotationStatusBadgeClassName(quotation.status)}`}>
                      {quotationStatusLabel(quotation.status)}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Quotes</p>
                    <p className="mt-1 text-zinc-700">
                      {folder.activeCount} active / {folder.archivedCount} archived
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Last updated</p>
                    <p className="mt-1 text-zinc-700">{formatListDate(quotation.quotation_date)}</p>
                  </div>
                </div>
                {canDeleteFolders ? (
                <details
                  className="relative mt-4 inline-block"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                    Actions <span aria-hidden="true">&#9662;</span>
                  </summary>
                  <div className="absolute left-0 z-20 mt-2 grid min-w-44 gap-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                    <button
                      type="button"
                      disabled={archivingKey === folder.key}
                      onClick={() => handleFolderArchive(folder.key, folder.archiveAnchorId, !folder.isFolderArchived)}
                      className="rounded-md px-3 py-2 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                    >
                      {archivingKey === folder.key ? "..." : folder.isFolderArchived ? "Unarchive" : "Archive"}
                    </button>
                    {
                      folder.isFolderDeletable ? (
                        <button
                          type="button"
                          onClick={() => openDeleteModal(folder)}
                          className="rounded-md px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      ) : (
                        <span
                          title={folder.deleteBlockReason ?? undefined}
                          className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-semibold text-zinc-400 select-none"
                        >
                          Delete
                        </span>
                      )
                    }
                  </div>
                </details>
                ) : null}
              </article>
            );
          })}
        </div>

        {/* ── Desktop table ───────────────────────────────────────── */}
        <div className="hidden overflow-visible border-t border-zinc-100 lg:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
                <th className="px-4 py-3">Folder</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Sales Person</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Latest</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.map((folder, folderIndex) => {
                const quotation = folder.latestQuotation;

                return (
                  <tr
                    key={folder.key}
                    aria-label={`Open ${folder.folderNo ?? folder.projectName}`}
                    className="cursor-pointer border-b border-zinc-100 align-top transition-colors hover:bg-emerald-50/30 last:border-0"
                    onClick={() => openFolder(quotation.id)}
                    onKeyDown={(event) => handleFolderRowKeyDown(event, quotation.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-zinc-950">{folder.folderNo ?? "Legacy"}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {folder.activeCount} active{folder.archivedCount > 0 ? ` / ${folder.archivedCount} archived` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">{folder.clientName}</td>
                    <td className="px-4 py-3">
                      {folder.salespersonName ? (
                        <span className="text-zinc-700">{folder.salespersonName}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="max-w-[200px] px-4 py-3 text-zinc-600">{folder.projectName}</td>
                    <td className="px-4 py-3 font-medium text-zinc-950">{quotation.quotation_no ?? quotation.legacy_reference ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${quotationStatusBadgeClassName(quotation.status)}`}>
                        {quotationStatusLabel(quotation.status)}
                      </span>
                      {folder.quotationCount > 1 ? (
                        <p className="mt-1 text-[11px] text-zinc-400">{folder.quotationCount} versions</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-semibold text-zinc-950">{formatQuotationMoney(quotation.currency, quotation.grand_total)}</td>
                    <td className="px-4 py-3 text-zinc-500">{formatListDate(quotation.quotation_date)}</td>
                    <td className="px-4 py-3">
                      {canDeleteFolders ? (
                      <details
                        className="relative inline-block"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                          Actions <span aria-hidden="true">&#9662;</span>
                        </summary>
                        <div className={`absolute right-0 z-20 grid min-w-44 gap-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg ${folderIndex === filteredFolders.length - 1 ? "bottom-full mb-2" : "mt-2"}`}>
                          <button
                            type="button"
                            disabled={archivingKey === folder.key}
                            onClick={() => handleFolderArchive(folder.key, folder.archiveAnchorId, !folder.isFolderArchived)}
                            className="rounded-md px-3 py-2 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                          >
                            {archivingKey === folder.key ? "..." : folder.isFolderArchived ? "Unarchive" : "Archive"}
                          </button>
                          {
                            folder.isFolderDeletable ? (
                              <button
                                type="button"
                                onClick={() => openDeleteModal(folder)}
                                className="rounded-md px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
                              >
                                Delete
                              </button>
                            ) : (
                              <span
                                title={folder.deleteBlockReason ?? undefined}
                                className="cursor-not-allowed rounded-md px-3 py-2 text-sm font-semibold text-zinc-400 select-none"
                              >
                                Delete
                              </span>
                            )
                          }
                        </div>
                      </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
