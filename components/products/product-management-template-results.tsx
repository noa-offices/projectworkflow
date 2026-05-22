"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { archiveProductTemplate, markProductTemplateDiscontinued, markTemplatePriceChecked } from "@/app/products/templates/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";

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
  templateId,
}: {
  editHref: string;
  openHref: string;
  templateId: string;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-2 md:justify-end">
      <Link
        href={openHref}
        className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        View
      </Link>
      <Link
        href={editHref}
        className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Edit Template
      </Link>
      <details className="relative z-30 shrink-0">
        <summary className="inline-flex h-9 cursor-pointer list-none items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
          More
        </summary>
        <div className="absolute right-0 z-[80] mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="mb-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Template actions
          </div>
          <form action={markTemplatePriceChecked} className="mb-1">
            <input type="hidden" name="id" value={templateId} />
            <PendingSubmitButton
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              pendingLabel="Marking checked..."
            >
              Mark price checked
            </PendingSubmitButton>
          </form>
          <form action={archiveProductTemplate} className="mb-1">
            <input type="hidden" name="id" value={templateId} />
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
  searchPlaceholder,
  showCount = true,
  templates,
}: ProductManagementTemplateResultsProps) {
  const [localSearch, setLocalSearch] = useState("");
  const deferredLocalSearch = useDeferredValue(localSearch);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = deferredLocalSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return templates;
    }

    return templates.filter((template) => template.searchText.includes(normalizedSearch));
  }, [deferredLocalSearch, templates]);

  return (
    <div className="space-y-4">
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

      {showCount ? (
        <p className="text-sm text-zinc-500">
          {filteredTemplates.length} {filteredTemplates.length === 1 ? "product found" : "products found"}
        </p>
      ) : null}

      {filteredTemplates.length ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}
        >
          {filteredTemplates.map((template) => (
            <article
              key={template.id}
              className={`flex h-full flex-col overflow-visible rounded-xl border bg-white shadow-sm transition hover:border-zinc-300 hover:shadow-md ${
                template.isSelected
                  ? "border-emerald-200 bg-emerald-50/30"
                  : "border-zinc-200"
              }`}
            >
              <div className="border-b border-zinc-200 bg-zinc-50 p-3">
                <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  <ProductTemplateImageUploader
                    imageSettings={template.imageSettings}
                    label={template.templateName}
                    templateId={template.id}
                    value={template.imageValue}
                  />
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-950">
                    {template.templateName}
                  </h3>
                  <TemplateLifecycleBadge status={template.lifecycleStatus} />
                </div>
                {template.templateName !== template.quoteName ? (
                  <p className="text-xs font-medium text-zinc-500">
                    Quote name: {template.quoteName}
                  </p>
                ) : null}
                <p className="text-xs leading-5 text-zinc-500">{template.path}</p>
                <div className="text-sm font-semibold text-zinc-950">{template.priceText}</div>
                <div className="text-[11px] text-zinc-500">{template.templateCodeText}</div>
                <div>
                  <CompactPriceCheckStatus
                    detail={template.priceStatusDetail}
                    label={template.priceStatusLabel}
                    tone={template.priceStatusTone}
                  />
                </div>
                <div className="mt-auto border-t border-zinc-100 pt-3">
                  <TemplateRowActions
                    editHref={template.editHref}
                    openHref={template.openHref}
                    templateId={template.id}
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
