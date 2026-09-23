"use client";

import { useState } from "react";
import {
  bulkPermanentlyDeleteProductTemplates,
  bulkRestoreProductTemplates,
  archiveProductTemplate,
  permanentlyDeleteProductTemplate,
  restoreProductTemplate,
} from "@/app/products/templates/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  buildBulkDeleteConfirmationMessage,
  computeDeleteEligibilityPreview,
  type ArchivedTemplateResult,
} from "@/lib/products/product-management-bulk-lifecycle";

export type { ArchivedTemplateResult };

type ProductManagementArchiveResultsProps = {
  emptyMessage: string;
  mode: "archive" | "discontinued";
  returnTo: string;
  templates: ArchivedTemplateResult[];
};

const deleteBlockedNotice = "Linked to product families - cannot delete";
const usedInQuotationsNotice =
  "Used in historical quotations. Permanent deletion will preserve saved quotation snapshots, but live source repricing and source navigation will no longer be available.";

function deleteConfirmMessage(usedInQuotations: boolean, mode: ProductManagementArchiveResultsProps["mode"]) {
  if (usedInQuotations) {
    return "This Product Template has been used in historical quotations.\nSaved quotation names, specifications, prices, selections and totals will be preserved.\nLive source repricing/navigation for those quotation items will no longer be available.\n\nContinue with permanent deletion?";
  }

  return mode === "discontinued"
    ? "Permanently delete this discontinued product template? This cannot be undone."
    : "Permanently delete this product template? This cannot be undone.";
}

function ArchiveBulkBar({
  onClearSelection,
  onSelectAllVisible,
  preview,
  returnTo,
  selectedIds,
}: {
  onClearSelection: () => void;
  onSelectAllVisible: () => void;
  preview: { eligibleCount: number; historicalCount: number; linkedBlockedCount: number };
  returnTo: string;
  selectedIds: Set<string>;
}) {
  if (!selectedIds.size) {
    return null;
  }

  const ids = Array.from(selectedIds);
  const canDelete = preview.eligibleCount > 0;

  return (
    <div className="sticky top-0 z-20 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-emerald-900">{selectedIds.size} selected</span>
        <button
          type="button"
          onClick={onSelectAllVisible}
          className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-900 transition hover:border-emerald-300"
        >
          Select all visible
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300"
        >
          Clear selection
        </button>
        <form action={bulkRestoreProductTemplates} className="ml-auto">
          {ids.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message={`Restore ${selectedIds.size} selected template${selectedIds.size === 1 ? "" : "s"}?`}
            className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
            pendingLabel="Restoring..."
          >
            Restore selected
          </ConfirmSubmitButton>
        </form>
        <form action={bulkPermanentlyDeleteProductTemplates}>
          {ids.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message={buildBulkDeleteConfirmationMessage(preview)}
            disabled={!canDelete}
            className="inline-flex h-8 items-center rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            pendingLabel="Deleting..."
          >
            Delete permanently selected
          </ConfirmSubmitButton>
        </form>
      </div>
      <p className="text-xs text-emerald-900">
        {canDelete
          ? `${preview.eligibleCount} ready to delete${preview.historicalCount ? `, ${preview.historicalCount} used in historical quotations` : ""}${preview.linkedBlockedCount ? `, ${preview.linkedBlockedCount} linked to product families - will be skipped` : ""}.`
          : "No selected templates can be permanently deleted."}
      </p>
    </div>
  );
}

export function ProductManagementArchiveResults({
  emptyMessage,
  mode,
  returnTo,
  templates,
}: ProductManagementArchiveResultsProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const preview = computeDeleteEligibilityPreview(selectedIds, templates);

  return (
    <div className="space-y-2">
      <ArchiveBulkBar
        onClearSelection={() => setSelectedIds(new Set())}
        onSelectAllVisible={() => setSelectedIds(new Set(templates.map((template) => template.id)))}
        preview={preview}
        returnTo={returnTo}
        selectedIds={selectedIds}
      />

      <div className="divide-y divide-zinc-100">
        {templates.map((template) => (
          <div
            key={template.id}
            className="grid gap-3 p-4 md:grid-cols-[auto_1fr_auto] md:items-center"
          >
            <input
              type="checkbox"
              aria-label={`Select ${template.name}`}
              checked={selectedIds.has(template.id)}
              onChange={(event) => {
                setSelectedIds((previousSelectedIds) => {
                  const nextSelectedIds = new Set(previousSelectedIds);
                  if (event.target.checked) {
                    nextSelectedIds.add(template.id);
                  } else {
                    nextSelectedIds.delete(template.id);
                  }
                  return nextSelectedIds;
                });
              }}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-zinc-950">{template.name}</h3>
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    template.lifecycleStatus === "discontinued"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-zinc-200 bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {template.lifecycleStatus}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                {template.brandName ?? "Unknown brand"} / {template.code ?? "No template code"}
              </p>
              {mode === "archive" ? (
                <p className="mt-1 text-xs text-zinc-500">Keep archived to preserve quotation history.</p>
              ) : null}
              {!template.linked && template.usedInQuotations ? (
                <p className="mt-1 text-xs font-semibold text-amber-700">{usedInQuotationsNotice}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <form action={restoreProductTemplate}>
                <input type="hidden" name="id" value={template.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <PendingSubmitButton
                  className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  pendingLabel="Restoring..."
                >
                  {mode === "discontinued" ? "Reactivate" : "Restore"}
                </PendingSubmitButton>
              </form>
              {mode === "discontinued" ? (
                <form action={archiveProductTemplate}>
                  <input type="hidden" name="id" value={template.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <PendingSubmitButton
                    className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                    pendingLabel="Archiving..."
                  >
                    Move to Archive
                  </PendingSubmitButton>
                </form>
              ) : null}
              {template.linked ? (
                <span className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-500">
                  {deleteBlockedNotice}
                </span>
              ) : (
                <form action={permanentlyDeleteProductTemplate}>
                  <input type="hidden" name="id" value={template.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <ConfirmSubmitButton
                    message={deleteConfirmMessage(template.usedInQuotations, mode)}
                    className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                  >
                    Delete permanently
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>
          </div>
        ))}
        {!templates.length ? <p className="p-6 text-sm text-zinc-500">{emptyMessage}</p> : null}
      </div>
    </div>
  );
}
