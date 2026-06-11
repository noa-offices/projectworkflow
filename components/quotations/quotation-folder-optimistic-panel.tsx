"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  archiveFolderQuotation,
  createQuotationOptionOptimistic,
  createQuotationRevisionOptimistic,
  updateQuotationStatus,
} from "@/app/quotations/actions";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { quotationStatusBadgeClassName, quotationStatusLabel } from "@/lib/quotation-status";

export type OptimisticFolderQuotation = {
  currency: string;
  grand_total: number;
  id: string;
  is_active?: boolean;
  option_no: number;
  quotation_date: string;
  quotation_no: string | null;
  revision_no: number | null;
  status: string;
  title: string;
};

type ActionResult<T> =
  | { ok: true; data: T; message: string }
  | { ok: false; error: string };

type Props = {
  canManageRecords: boolean;
  currentQuotationId: string;
  folderNextStep: string;
  initialQuotations: OptimisticFolderQuotation[];
  returnTo: string;
  statusOptions: ReadonlyArray<readonly [string, string]>;
  variantsAvailable: boolean;
};

function isActionResult<T>(value: unknown): value is ActionResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

function formatFolderDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function branchTokens(quotationNo: string | null | undefined) {
  return Array.from(quotationNo?.trim().matchAll(/-(R|OPT)(\d+)/gi) ?? [])
    .map((match) => ({ type: match[1].toUpperCase() as "R" | "OPT", sequence: Number(match[2]) }))
    .filter((token) => Number.isFinite(token.sequence));
}

function folderTypeLabel(quotation: OptimisticFolderQuotation) {
  const tokens = branchTokens(quotation.quotation_no);
  if (tokens.length) {
    return tokens.map((token) => token.type === "OPT" ? `Option ${token.sequence}` : `Revision ${token.sequence}`).join(" / ");
  }
  if ((quotation.option_no ?? 1) > 1) return `Option ${Math.max((quotation.option_no ?? 1) - 1, 1)}`;
  return "Original";
}

function branchSortKey(quotationNo: string | null | undefined) {
  const root = quotationNo?.trim().match(/^(QN-\d{4}-\d{3})/i)?.[1] ?? quotationNo ?? "";
  const suffix = branchTokens(quotationNo)
    .map((token) => `${token.type === "OPT" ? "1" : "2"}-${String(token.sequence).padStart(4, "0")}`)
    .join("/");
  return `${root}/${suffix}`;
}

function isDirectChild(candidateNo: string | null | undefined, parentNo: string | null | undefined) {
  const parent = parentNo?.trim();
  const candidate = candidateNo?.trim();
  if (!parent || !candidate) return false;
  return new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?:R\\d+|OPT\\d+)$`, "i").test(candidate);
}

function childSequence(candidateNo: string | null | undefined, parentNo: string, type: "revision" | "option") {
  const suffix = type === "revision" ? "R" : "OPT";
  const match = candidateNo?.trim().match(new RegExp(`^${parentNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-${suffix}(\\d+)$`, "i"));
  return match ? Number(match[1]) : null;
}

function nextChildNo(items: OptimisticFolderQuotation[], parentNo: string, type: "revision" | "option") {
  const next = Math.max(
    0,
    ...items
      .map((item) => childSequence(item.quotation_no, parentNo, type))
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  ) + 1;
  return {
    sequence: next,
    quotationNo: `${parentNo}-${type === "revision" ? "R" : "OPT"}${next}`,
  };
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${quotationStatusBadgeClassName(status)}`}>
      {quotationStatusLabel(status)}
    </span>
  );
}

export function QuotationFolderOptimisticPanel({
  canManageRecords,
  currentQuotationId,
  folderNextStep,
  initialQuotations,
  returnTo,
  statusOptions,
  variantsAvailable,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialQuotations);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, string>>({});
  const [statusValue, setStatusValue] = useState(
    initialQuotations.find((item) => item.id === currentQuotationId)?.status ?? "draft",
  );
  const [, startTransition] = useTransition();

  const sortedItems = useMemo(() => [...items].sort((left, right) => branchSortKey(left.quotation_no).localeCompare(branchSortKey(right.quotation_no))), [items]);
  const currentQuotation = sortedItems.find((item) => item.id === currentQuotationId);
  const currentPending = pendingIds[currentQuotationId];

  function refreshQuietly() {
    startTransition(() => router.refresh());
  }

  async function createChild(parent: OptimisticFolderQuotation, type: "revision" | "option") {
    if (!parent.quotation_no || pendingIds[parent.id]) return;
    const confirmMessage = type === "revision"
      ? "Create Revision\n\nThis will copy this quotation into a new revision. The parent quotation will remain unchanged."
      : "Create Option\n\nThis will copy this quotation into a new option quotation. The parent quotation will remain unchanged.";
    if (!window.confirm(confirmMessage)) return;

    const expected = nextChildNo(items, parent.quotation_no, type);
    const tempId = `temp-${type}-${parent.id}-${expected.sequence}`;
    const tempItem: OptimisticFolderQuotation = {
      ...parent,
      id: tempId,
      option_no: type === "option" ? expected.sequence + 1 : parent.option_no,
      quotation_no: expected.quotationNo,
      quotation_date: new Date().toISOString().slice(0, 10),
      revision_no: type === "revision" ? expected.sequence : 0,
      status: "creating",
      title: `${parent.title} ${type === "revision" ? `Rev ${expected.sequence}` : `Option ${expected.sequence}`}`,
    };
    const previous = items;
    setError(null);
    setMessage(type === "revision" ? "Creating revision..." : "Creating option...");
    setPendingIds((current) => ({ ...current, [parent.id]: type }));
    setItems((current) => [...current, tempItem]);

    const formData = new FormData();
    formData.set("quotation_id", parent.id);
    formData.set("return_to", returnTo);
    formData.set("result_mode", "optimistic");
    const action = type === "revision" ? createQuotationRevisionOptimistic : createQuotationOptionOptimistic;

    try {
      const result = await action(formData) as ActionResult<OptimisticFolderQuotation>;
      if (!isActionResult<OptimisticFolderQuotation>(result) || !result.ok) {
        setItems(previous);
        setError(!result.ok ? result.error : (type === "revision" ? "Could not create revision. The original quotation was not changed." : "Could not create option. The original quotation was not changed."));
        setMessage(null);
        return;
      }

      setItems((current) => current.map((item) => item.id === tempId ? result.data : item));
      setMessage(result.message);
      refreshQuietly();
    } catch (caught) {
      console.error(caught);
      setItems(previous);
      setError(type === "revision" ? "Could not create revision. The original quotation was not changed." : "Could not create option. The original quotation was not changed.");
      setMessage(null);
    } finally {
      setPendingIds((current) => {
        const next = { ...current };
        delete next[parent.id];
        return next;
      });
    }
  }

  async function archiveQuote(quotation: OptimisticFolderQuotation) {
    if (pendingIds[quotation.id]) return;
    if (!window.confirm("Archive quotation\n\nThis will remove this quotation from the active folder view. The original quotation and other revisions/options will not be changed.")) return;

    const previous = items;
    setError(null);
    setMessage("Archiving...");
    setPendingIds((current) => ({ ...current, [quotation.id]: "archive" }));
    setItems((current) => current.filter((item) => item.id !== quotation.id));

    const formData = new FormData();
    formData.set("quotation_id", quotation.id);
    formData.set("return_to", returnTo);
    formData.set("result_mode", "optimistic");

    try {
      const result = await archiveFolderQuotation(formData);
      if (!isActionResult<{ id: string }>(result) || !result.ok) {
        setItems(previous);
        setError(result?.error ?? "Could not archive quotation. The quotation was restored.");
        setMessage(null);
        return;
      }
      setMessage(result.message);
      refreshQuietly();
    } catch (caught) {
      console.error(caught);
      setItems(previous);
      setError("Could not archive quotation. The quotation was restored.");
      setMessage(null);
    } finally {
      setPendingIds((current) => {
        const next = { ...current };
        delete next[quotation.id];
        return next;
      });
    }
  }

  async function saveStatus() {
    const previousStatus = currentQuotation?.status ?? statusValue;
    setError(null);
    setMessage("Saving status...");
    setPendingIds((current) => ({ ...current, [currentQuotationId]: "status" }));
    setItems((current) => current.map((item) => item.id === currentQuotationId ? { ...item, status: statusValue } : item));

    const formData = new FormData();
    formData.set("quotation_id", currentQuotationId);
    formData.set("status", statusValue);
    formData.set("return_to", returnTo);
    formData.set("result_mode", "optimistic");

    try {
      const result = await updateQuotationStatus(formData);
      if (!isActionResult<{ id: string; status: string }>(result) || !result.ok) {
        setItems((current) => current.map((item) => item.id === currentQuotationId ? { ...item, status: previousStatus } : item));
        setStatusValue(previousStatus);
        setError("Could not update status. Previous status was restored.");
        setMessage(null);
        return;
      }
      setMessage(result.message);
      refreshQuietly();
    } catch (caught) {
      console.error(caught);
      setItems((current) => current.map((item) => item.id === currentQuotationId ? { ...item, status: previousStatus } : item));
      setStatusValue(previousStatus);
      setError("Could not update status. Previous status was restored.");
      setMessage(null);
    } finally {
      setPendingIds((current) => {
        const next = { ...current };
        delete next[currentQuotationId];
        return next;
      });
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-[1fr_300px]">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Selected quotation status</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={currentQuotation?.status ?? statusValue} />
            {currentPending === "status" ? <span className="text-sm font-semibold text-emerald-800">Saving...</span> : null}
            <span className="text-sm text-zinc-600">{folderNextStep}</span>
          </div>
        </div>
        {canManageRecords ? (
          <div className="rounded-md border border-zinc-200 bg-white p-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Change status</span>
              <select value={statusValue} onChange={(event) => setStatusValue(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={saveStatus} disabled={currentPending === "status"} className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-400">
                {currentPending === "status" ? "Saving status..." : "Update"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {(message || error) ? (
        <p className={`mt-3 rounded-md border px-3 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
          {error ?? message}
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Quotations in this folder</h2>
            <p className="mt-1 text-sm text-zinc-500">Original quotation, revisions, and options stay grouped under one folder.</p>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{sortedItems.length} {sortedItems.length === 1 ? "quotation" : "quotations"}</p>
        </div>
        <div className="mt-4 grid gap-3">
          {sortedItems.map((folderQuotation) => {
            const isCurrent = folderQuotation.id === currentQuotationId;
            const isTemp = folderQuotation.id.startsWith("temp-");
            const folderQuotationIsOriginal = folderTypeLabel(folderQuotation) === "Original";
            const hasActiveChildren = sortedItems.some((candidate) => candidate.id !== folderQuotation.id && isDirectChild(candidate.quotation_no, folderQuotation.quotation_no));
            const canArchive = canManageRecords && !isTemp && !folderQuotationIsOriginal && !hasActiveChildren;
            const pending = pendingIds[folderQuotation.id];

            return (
              <article key={folderQuotation.id} className={`rounded-lg border shadow-sm transition ${isTemp ? "border-emerald-200 bg-emerald-50/70 opacity-80" : isCurrent ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200 bg-white hover:border-emerald-300 hover:shadow-md"}`}>
                {isTemp ? (
                  <div className="block px-4 py-4">
                    <CardContent folderQuotation={folderQuotation} isCurrent={false} isTemp />
                  </div>
                ) : (
                  <Link href={`/quotations/${folderQuotation.id}`} className="block px-4 py-4">
                    <CardContent folderQuotation={folderQuotation} isCurrent={isCurrent} isTemp={false} />
                  </Link>
                )}
                <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 py-3">
                  <ActionLink disabled={isTemp} href={`/quotations/${folderQuotation.id}/local-builder`} label="Open Builder" />
                  <ActionLink disabled={isTemp} href={`/quotations/${folderQuotation.id}/pdf`} label="Preview" />
                  <ActionLink disabled={isTemp} href={`/quotations/${folderQuotation.id}/download-pdf`} label="Download PDF" />
                  {canManageRecords && variantsAvailable ? (
                    <>
                      <button type="button" disabled={isTemp || Boolean(pending)} onClick={() => createChild(folderQuotation, "revision")} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400">
                        {pending === "revision" ? "Creating revision..." : "Create Revision"}
                      </button>
                      <button type="button" disabled={isTemp || Boolean(pending)} onClick={() => createChild(folderQuotation, "option")} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400">
                        {pending === "option" ? "Creating option..." : "Create Option"}
                      </button>
                    </>
                  ) : null}
                  {canArchive ? (
                    <button type="button" disabled={pending === "archive"} onClick={() => archiveQuote(folderQuotation)} className="inline-flex h-9 items-center rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400">
                      {pending === "archive" ? "Archiving..." : "Archive Quote"}
                    </button>
                  ) : (
                    <span className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-400" title={folderQuotationIsOriginal ? "Original quotation is protected." : hasActiveChildren ? "Archive child quotations before archiving this parent." : "Archive is unavailable."}>
                      Archive Quote
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function CardContent({ folderQuotation, isCurrent, isTemp }: { folderQuotation: OptimisticFolderQuotation; isCurrent: boolean; isTemp: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">{folderTypeLabel(folderQuotation)}</span>
          {isTemp ? <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">Creating...</span> : <StatusBadge status={folderQuotation.status} />}
          {isCurrent ? <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">Current</span> : null}
        </div>
        <h3 className="mt-2 text-base font-semibold text-zinc-950">{folderQuotation.quotation_no ?? "Legacy quotation"}</h3>
        <p className="mt-1 text-sm text-zinc-500">{formatFolderDate(folderQuotation.quotation_date)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
        <p className="mt-1 text-lg font-semibold text-zinc-950">{formatQuotationMoney(folderQuotation.currency, folderQuotation.grand_total)}</p>
      </div>
    </div>
  );
}

function ActionLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) {
    return <span className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-400">{label}</span>;
  }
  return <Link href={href} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">{label}</Link>;
}
