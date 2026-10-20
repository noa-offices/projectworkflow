"use client";

import Link from "next/link";
import { Ellipsis, LayoutGrid, List } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { archiveProductTemplate, bulkArchiveProductTemplates, markProductTemplateDiscontinued, markTemplatePriceChecked } from "@/app/products/templates/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";
import { pruneSelectionToVisibleIds } from "@/lib/products/product-management-bulk-lifecycle";

type PriceStatusTone = "ok" | "notice" | "warning" | "neutral";

export type ProductManagementTemplateResult = {
  id: string;
  editHref: string;
  imageSettings?: {
    fit?: "contain" | "cover";
    zoom?: number;
    positionX?: number;
    positionY?: number;
  };
  imageValue: string | null;
  isSelected: boolean;
  lifecycleStatus: "active" | "archived" | "discontinued";
  openHref: string;
  path: string;
  brandName: string;
  categoryText: string;
  imageCount: number;
  priceStatusDetail: string;
  priceStatusLabel: string;
  priceStatusTone: PriceStatusTone;
  priceText: string;
  quoteName: string;
  searchText: string;
  templateCodeText: string;
  templateName: string;
};

type ProductManagementTemplateResultsProps = {
  emptyDescription: string;
  emptyTitle: string;
  returnTo: string;
  searchPlaceholder?: string;
  showCount?: boolean;
  templates: ProductManagementTemplateResult[];
};

function TemplateLifecycleBadge({
  status,
}: {
  status: ProductManagementTemplateResult["lifecycleStatus"];
}) {
  if (status === "archived") {
    return (
      <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
        archived
      </span>
    );
  }

  if (status === "discontinued") {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
        discontinued
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
      active
    </span>
  );
}

function TemplateRowActions({
  editHref,
  openHref,
}: {
  editHref: string;
  openHref: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link
        href={openHref}
        className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        View Details
      </Link>
      <Link
        href={editHref}
        className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Edit Template
      </Link>
    </div>
  );
}

function TemplateMoreMenu({
  returnTo,
  templateId,
}: {
  returnTo: string;
  templateId: string;
}) {
  return (
    <details className="relative z-30 shrink-0">
      <summary aria-label="More actions" className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800">
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-[80] mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
        <div className="mb-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Template actions
        </div>
        <form action={markTemplatePriceChecked} className="mb-1">
          <input type="hidden" name="id" value={templateId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <PendingSubmitButton
            className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            pendingLabel="Marking checked..."
          >
            Mark price checked
          </PendingSubmitButton>
        </form>
        <form action={archiveProductTemplate} className="mb-1">
          <input type="hidden" name="id" value={templateId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message="This will move the product template to Archive. You can restore it later."
            className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            pendingLabel="Archiving..."
          >
            Archive
          </ConfirmSubmitButton>
        </form>
        <form action={markProductTemplateDiscontinued}>
          <input type="hidden" name="id" value={templateId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message="This will hide the product from active Product Library and future quotations. Existing quotations will not be affected."
            className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            pendingLabel="Discontinuing..."
          >
            Discontinue
          </ConfirmSubmitButton>
        </form>
      </div>
    </details>
  );
}

function BulkArchiveBar({
  checkedIds,
  onClearSelection,
  onSelectAllVisible,
  returnTo,
}: {
  checkedIds: Set<string>;
  onClearSelection: () => void;
  onSelectAllVisible: () => void;
  returnTo: string;
}) {
  if (!checkedIds.size) {
    return null;
  }

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <span className="font-semibold text-emerald-900">{checkedIds.size} selected</span>
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
      <form action={bulkArchiveProductTemplates} className="ml-auto">
        {Array.from(checkedIds).map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
        <input type="hidden" name="return_to" value={returnTo} />
        <ConfirmSubmitButton
          message={`Archive ${checkedIds.size} selected product template${checkedIds.size === 1 ? "" : "s"}?`}
          className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          pendingLabel="Archiving..."
        >
          Archive selected
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

function CompactPriceCheckStatus({
  detail,
  label,
  tone,
}: {
  detail: string;
  label: string;
  tone: PriceStatusTone;
}) {
  const className = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : tone === "notice"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : tone === "neutral"
        ? "border-zinc-200 bg-zinc-50 text-zinc-700"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${className}`}>
        {label}
      </span>
      <span>{detail}</span>
    </div>
  );
}

export function ProductManagementTemplateResults({
  emptyDescription,
  emptyTitle,
  returnTo,
  searchPlaceholder,
  showCount = true,
  templates,
}: ProductManagementTemplateResultsProps) {
  const [localSearch, setLocalSearch] = useState("");
  // "default" keeps the server order (brand, then name); the other two only reorder the rows already loaded.
  const [sortMode, setSortMode] = useState<"default" | "name_asc" | "name_desc">("default");
  const deferredLocalSearch = useDeferredValue(localSearch);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = deferredLocalSearch.trim().toLowerCase();
    const matching = normalizedSearch
      ? templates.filter((template) => template.searchText.includes(normalizedSearch))
      : templates;

    if (sortMode === "default") return matching;
    const direction = sortMode === "name_asc" ? 1 : -1;
    return [...matching].sort((left, right) => direction * left.templateName.localeCompare(right.templateName));
  }, [deferredLocalSearch, sortMode, templates]);

  const visibleIdsSignature = filteredTemplates.map((template) => template.id).join("|");
  const [prunedForVisibleIdsSignature, setPrunedForVisibleIdsSignature] = useState(visibleIdsSignature);

  // Never leave a selected id pointing at a row that's no longer visible - covers both a full
  // result-context change (brand/category/global search) and the component's own local in-panel
  // search narrowing what's shown. Adjusted during render (not an effect) so the prune is visible
  // in the same render pass instead of causing an extra one.
  if (visibleIdsSignature !== prunedForVisibleIdsSignature) {
    setPrunedForVisibleIdsSignature(visibleIdsSignature);
    setCheckedIds((previousCheckedIds) =>
      pruneSelectionToVisibleIds(previousCheckedIds, visibleIdsSignature ? visibleIdsSignature.split("|") : []));
  }

  return (
    <div className="space-y-4">
      <BulkArchiveBar
        checkedIds={checkedIds}
        onClearSelection={() => setCheckedIds(new Set())}
        onSelectAllVisible={() => setCheckedIds(new Set(filteredTemplates.map((template) => template.id)))}
        returnTo={returnTo}
      />

      {searchPlaceholder ? (
        <div className="flex justify-end">
          <input
            aria-label="Search within current selection"
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 sm:max-w-xs"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-700">
          {showCount ? `${filteredTemplates.length} ${filteredTemplates.length === 1 ? "product found" : "products found"}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-500">
            Sort by
            <select
              aria-label="Sort by"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="default">Brand, then name</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
            </select>
          </label>
          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <button type="button" aria-label="Grid view" aria-pressed="true" className="inline-flex h-9 w-9 items-center justify-center bg-emerald-50 text-emerald-900">
              <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" aria-label="List view (not available yet)" title="List view is not available yet" disabled className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center text-zinc-300">
              <List aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredTemplates.length ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}
        >
          {filteredTemplates.map((template) => (
            <article
              key={template.id}
              className={`flex h-full flex-col overflow-visible rounded-2xl border bg-white shadow-sm transition hover:border-zinc-300 hover:shadow-md ${
                template.isSelected
                  ? "border-emerald-200 bg-emerald-50/30"
                  : "border-zinc-200"
              }`}
            >
              <div className="p-3 pb-0">
                <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                  <ProductTemplateImageUploader
                    imageSettings={template.imageSettings}
                    label={template.templateName}
                    templateId={template.id}
                    value={template.imageValue}
                  />
                  <input
                    type="checkbox"
                    aria-label={`Select ${template.templateName}`}
                    checked={checkedIds.has(template.id)}
                    onChange={(event) => {
                      setCheckedIds((previousCheckedIds) => {
                        const nextCheckedIds = new Set(previousCheckedIds);
                        if (event.target.checked) {
                          nextCheckedIds.add(template.id);
                        } else {
                          nextCheckedIds.delete(template.id);
                        }
                        return nextCheckedIds;
                      });
                    }}
                    className="absolute left-2 top-2 z-10 h-4 w-4 rounded border-zinc-300 text-emerald-900"
                  />
                  <span className="pointer-events-none absolute right-2 top-2 z-10">
                    <TemplateLifecycleBadge status={template.lifecycleStatus} />
                  </span>
                  <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full border border-zinc-200 bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
                    {template.imageCount} {template.imageCount === 1 ? "image" : "images"}
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start gap-2">
                  <h3 className="min-w-0 flex-1 text-sm font-bold text-zinc-950">
                    {template.templateName}
                  </h3>
                  <TemplateMoreMenu returnTo={returnTo} templateId={template.id} />
                </div>
                {template.templateName !== template.quoteName ? (
                  <p className="text-xs font-medium text-zinc-500">
                    Quote name: {template.quoteName}
                  </p>
                ) : null}
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{template.brandName}</p>
                <p className="text-xs leading-5 text-zinc-500">{template.categoryText}</p>
                <div>
                  <CompactPriceCheckStatus
                    detail={template.priceStatusDetail}
                    label={template.priceStatusLabel}
                    tone={template.priceStatusTone}
                  />
                </div>
                <div className="mt-auto pt-2">
                  <TemplateRowActions
                    editHref={template.editHref}
                    openHref={template.openHref}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-10 text-center shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-950">{emptyTitle}</h3>
          <p className="mt-2 text-sm text-zinc-500">{emptyDescription}</p>
        </section>
      )}
    </div>
  );
}
