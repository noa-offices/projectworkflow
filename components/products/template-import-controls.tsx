"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { formatMoney, normalizeCurrency, defaultCurrency } from "@/lib/currencies";

export type QuotationRowImportDraft = {
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  model_snapshot: string | null;
  origin_snapshot: string | null;
  supplier_name_snapshot: string | null;
  specification_snapshot: string | null;
  size_snapshot: string | null;
  unit_label: string | null;
  currency: string | null;
  unit_price: number;
  proposed_image_url_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  notes: string | null;
};

export const TEMPLATE_IMPORT_APPLY_EVENT = "product-template:import-apply";
export const TEMPLATE_IMPORT_RESET_EVENT = "product-template:import-reset";
export const TEMPLATE_IMPORT_STATUS_EVENT = "product-template:import-status";

export type TemplateImportAction =
  | "basic"
  | "image"
  | "variant"
  | "workstation"
  | "accessory"
  | "finish";

type TemplateImportApplyDetail = {
  action: TemplateImportAction;
  draft: QuotationRowImportDraft;
  templateId: string;
};

type TemplateImportResetDetail = {
  templateId: string;
};

type TemplateImportStatusDetail = {
  action: TemplateImportAction;
  status: string;
  templateId: string;
};

function appendedImportSpecification(
  specification: string | null | undefined,
  dimension: string | null | undefined,
) {
  const lines = [specification?.trim() || ""].filter(Boolean);
  if (dimension?.trim()) {
    lines.push(`Dimension: ${dimension.trim()}`);
  }
  return lines.join("\n");
}

function dispatchTemplateImportStatus(detail: TemplateImportStatusDetail) {
  window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, { detail }));
}

export function TemplateImportBanner({
  cancelHref,
  importDraft,
  templateId,
}: {
  cancelHref: string;
  importDraft: QuotationRowImportDraft;
  templateId: string;
}) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">Quotation row import available</p>
          <p className="mt-1 text-xs leading-5 text-emerald-900">
            Nothing is applied until you use an import action inside the relevant section.
          </p>
          <p className="mt-2 text-xs text-emerald-900">
            {[
              importDraft.item_name_snapshot || importDraft.model_snapshot,
              importDraft.size_snapshot,
              formatMoney(
                normalizeCurrency(importDraft.currency || defaultCurrency),
                Number(importDraft.unit_price ?? 0),
              ),
            ].filter(Boolean).join(" / ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent<TemplateImportResetDetail>(TEMPLATE_IMPORT_RESET_EVENT, {
                  detail: { templateId },
                }),
              );
            }}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300"
          >
            Reset import choices
          </button>
          <Link
            href={cancelHref}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300"
          >
            Cancel import
          </Link>
        </div>
      </div>
    </section>
  );
}

export function TemplateImportActionButton({
  action,
  draft,
  label,
  templateId,
}: {
  action: TemplateImportAction;
  draft: QuotationRowImportDraft;
  label: string;
  templateId: string;
}) {
  const [statusMessage, setStatusMessage] = useState("");
  const originalSpecificationRef = useRef<string | null>(null);
  const hasAppliedRef = useRef(false);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<TemplateImportStatusDetail>).detail;
      if (!detail || detail.templateId !== templateId || detail.action !== action) {
        return;
      }
      setStatusMessage(detail.status);
    };

    const handleReset = () => {
      if (action !== "basic") {
        setStatusMessage("");
        return;
      }

      const form = document.querySelector<HTMLFormElement>('form');
      const specificationField = form?.querySelector<HTMLTextAreaElement>('textarea[name="default_specification"]');
      if (specificationField && hasAppliedRef.current && originalSpecificationRef.current !== null) {
        specificationField.value = originalSpecificationRef.current;
      }
      hasAppliedRef.current = false;
      setStatusMessage("");
    };

    window.addEventListener(TEMPLATE_IMPORT_STATUS_EVENT, handleStatus);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_STATUS_EVENT, handleStatus);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [action, templateId]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (action === "basic") {
      const form = event.currentTarget.closest("form");
      const specificationField = form?.querySelector<HTMLTextAreaElement>('textarea[name="default_specification"]');
      const nextValue = appendedImportSpecification(
        draft.specification_snapshot,
        draft.size_snapshot,
      );

      if (!specificationField || !nextValue) {
        const status = nextValue
          ? "Specification field was not found."
          : "No specification or dimension was available to import.";
        setStatusMessage(status);
        dispatchTemplateImportStatus({ action, status, templateId });
        return;
      }

      if (!hasAppliedRef.current) {
        originalSpecificationRef.current = specificationField.value;
      }

      specificationField.value = nextValue;
      hasAppliedRef.current = true;
      const status = "Specification copied.";
      setStatusMessage(status);
      dispatchTemplateImportStatus({ action, status, templateId });
      return;
    }

    window.dispatchEvent(
      new CustomEvent<TemplateImportApplyDetail>(TEMPLATE_IMPORT_APPLY_EVENT, {
        detail: {
          action,
          draft,
          templateId,
        },
      }),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2">
      <button
        type="button"
        onClick={handleClick}
        className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-400"
      >
        {label}
      </button>
      {statusMessage ? (
        <p className="text-xs font-medium text-emerald-900">{statusMessage}</p>
      ) : null}
    </div>
  );
}
