"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createProductTemplate, updateProductTemplate } from "@/app/products/templates/actions";
import {
  TemplateImportActionButton,
  TemplateImportBanner,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";
import {
  TemplateDetailImageGallery,
  TemplateReferenceImageFieldManager,
} from "@/components/products/template-image-galleries";
import { TemplatePricingSections } from "@/components/products/template-pricing-sections";
import {
  TemplateCategoryFields,
} from "@/components/products/template-category-fields";
import { TemplateFormShell } from "@/components/products/template-form-shell";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { countStandardCategoryPricingRows } from "@/lib/products/category-pricing-groups";

type ProductTemplateImageField =
  | "proposed_image_url_1"
  | "proposed_image_url_2"
  | "proposed_image_url_3"
  | "proposed_image_url_4"
  | "proposed_image_url_5"
  | "proposed_image_url_6"
  | "proposed_image_url_7"
  | "proposed_image_url_8"
  | "proposed_image_url_9"
  | "proposed_image_url_10"
  | "proposed_image_url_11"
  | "proposed_image_url_12"
  | "proposed_image_url_13"
  | "proposed_image_url_14"
  | "proposed_image_url_15"
  | "proposed_image_url_16"
  | "proposed_image_url_17"
  | "proposed_image_url_18"
  | "proposed_image_url_19"
  | "proposed_image_url_20";

type ProductTemplateImageDisplaySettings = {
  fit?: "contain" | "cover";
  zoom?: number;
  positionX?: number;
  positionY?: number;
};

type ProductTemplateImageSettings = {
  [key in ProductTemplateImageField]?: ProductTemplateImageDisplaySettings;
} & {
  default_image_url?: ProductTemplateImageDisplaySettings;
};

type BrandOption = {
  id: string;
  name: string;
  default_currency?: string | null;
};

type CategoryOption = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
};

type DeskingSizePricingRow = {
  id?: string;
  label?: string;
  supplier_price_list_code?: string;
  base_supplier_price_list_code?: string;
  length?: number;
  depth?: number;
  height?: number;
  dimension_unit?: string;
  layout_type?: string;
  default_price?: number;
  additional_price?: number;
  additional_supplier_price_list_code?: string;
  currency?: string;
  specification?: string;
  default_dimension?: string;
  sort_order?: number;
  is_active?: boolean;
};

type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type CategoryPricingRow = {
  id?: string;
  group_id?: string;
  group_name?: string;
  items?: CategoryPricingRow[];
  price_categories?: string[];
  pricing_type?: string | null;
  pricing_category_id?: string | null;
  pricing_category_name?: string | null;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number>;
  specification?: string;
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
  items?: Array<Record<string, unknown>>;
};

type ProductTemplate = {
  id: string;
  brand_id: string;
  main_category_id: string | null;
  sub_category_id: string | null;
  template_code: string | null;
  template_name: string;
  internal_selection_name: string | null;
  item_code: string | null;
  description: string | null;
  default_specification: string | null;
  origin: string | null;
  supplier_name: string | null;
  default_image_url: string | null;
  reference_image_url: string | null;
  proposed_image_url_1: string | null;
  proposed_image_url_2: string | null;
  proposed_image_url_3: string | null;
  proposed_image_url_4: string | null;
  proposed_image_url_5: string | null;
  proposed_image_url_6: string | null;
  proposed_image_url_7: string | null;
  proposed_image_url_8: string | null;
  proposed_image_url_9: string | null;
  proposed_image_url_10: string | null;
  proposed_image_url_11: string | null;
  proposed_image_url_12: string | null;
  proposed_image_url_13: string | null;
  proposed_image_url_14: string | null;
  proposed_image_url_15: string | null;
  proposed_image_url_16: string | null;
  proposed_image_url_17: string | null;
  proposed_image_url_18: string | null;
  proposed_image_url_19: string | null;
  proposed_image_url_20: string | null;
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  image_settings?: ProductTemplateImageSettings | null;
  unit_label?: string | null;
  currency: string;
  default_unit_price: number;
  price_notes?: string | null;
};

type SubmitMode = "create" | "update";
type FocusSection = "pricing" | "details";

type ProductTemplateFormProps = {
  brands: BrandOption[];
  categories: CategoryOption[];
  compactAccordionMode?: boolean;
  defaultBrandId?: string;
  defaultMainCategoryId?: string;
  defaultSubCategoryId?: string;
  extraHiddenFields?: ReactNode;
  existingImportDraft?: QuotationRowImportDraft | null;
  focusSection?: FocusSection;
  importDraft?: QuotationRowImportDraft | null;
  importMode?: "new" | "existing" | "";
  initialMessage?: string;
  mode?: SubmitMode;
  onCancel?: () => void;
  onSubmitAction?: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
  template?: ProductTemplate;
};

const proposedImageSlots: Array<{ field: ProductTemplateImageField; label: string }> = [
  { field: "proposed_image_url_1", label: "Image 1" },
  { field: "proposed_image_url_2", label: "Image 2" },
  { field: "proposed_image_url_3", label: "Image 3" },
  { field: "proposed_image_url_4", label: "Image 4" },
  { field: "proposed_image_url_5", label: "Image 5" },
  { field: "proposed_image_url_6", label: "Image 6" },
  { field: "proposed_image_url_7", label: "Image 7" },
  { field: "proposed_image_url_8", label: "Image 8" },
  { field: "proposed_image_url_9", label: "Image 9" },
  { field: "proposed_image_url_10", label: "Image 10" },
  { field: "proposed_image_url_11", label: "Image 11" },
  { field: "proposed_image_url_12", label: "Image 12" },
  { field: "proposed_image_url_13", label: "Image 13" },
  { field: "proposed_image_url_14", label: "Image 14" },
  { field: "proposed_image_url_15", label: "Image 15" },
  { field: "proposed_image_url_16", label: "Image 16" },
  { field: "proposed_image_url_17", label: "Image 17" },
  { field: "proposed_image_url_18", label: "Image 18" },
  { field: "proposed_image_url_19", label: "Image 19" },
  { field: "proposed_image_url_20", label: "Image 20" },
];

function fallbackTemplateId() {
  return globalThis.crypto?.randomUUID?.() ?? `template-${Date.now()}`;
}

function templateImageValue(
  template: ProductTemplate | undefined,
  field: ProductTemplateImageField,
) {
  return template?.[field] ?? null;
}

function templateImageDisplaySettings(
  template: ProductTemplate | undefined,
  field: ProductTemplateImageField,
) {
  const settings = template?.image_settings?.[field];
  return settings && typeof settings === "object" ? settings : undefined;
}

function quotationRowImportDescription(draft: QuotationRowImportDraft | null) {
  return [draft?.model_snapshot, draft?.notes]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");
}

function appendedImportSpecification(specification: string | null | undefined, size: string | null | undefined) {
  return [specification?.trim() || null, size?.trim() ? `Dimension: ${size.trim()}` : null]
    .filter(Boolean)
    .join("\n");
}

function cancelTemplateImportHref({
  returnTo,
  templateId,
}: {
  returnTo: string;
  templateId: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set("message", "Template import cancelled.");
  searchParams.set("editTemplate", templateId);
  searchParams.set("template", templateId);

  if (returnTo) {
    searchParams.set("returnTo", returnTo);
  }

  return `/products/templates?${searchParams.toString()}`;
}

function FormSection({
  children,
  description,
  isOpen = true,
  onToggle,
  summary,
  title,
}: {
  children: ReactNode;
  description?: string;
  isOpen?: boolean;
  onToggle?: () => void;
  summary?: string;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full px-5 py-4 text-left transition hover:bg-zinc-50 ${onToggle ? "" : "cursor-default"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
            ) : null}
            {summary ? (
              <p className="mt-2 text-xs font-medium leading-5 text-zinc-500">{summary}</p>
            ) : null}
          </div>
          {onToggle ? (
            <span className="shrink-0 text-xs font-semibold text-zinc-500">
              {isOpen ? "Hide" : "Show"}
            </span>
          ) : null}
        </div>
      </button>
      <div hidden={!isOpen} className="border-t border-zinc-100 p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
      </div>
    </section>
  );
}

function Field({
  defaultValue,
  hint,
  label,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  hint?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        step={type === "number" ? "0.01" : undefined}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
}) {
  return (
    <label className="block md:col-span-2 xl:col-span-3">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        rows={4}
        defaultValue={defaultValue ?? ""}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function CurrencySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Currency</span>
      <select
        name="currency"
        defaultValue={normalizeCurrency(defaultValue ?? defaultCurrency)}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProductTemplateForm({
  brands,
  categories,
  compactAccordionMode = false,
  defaultBrandId,
  defaultMainCategoryId,
  defaultSubCategoryId,
  extraHiddenFields,
  existingImportDraft,
  focusSection = "details",
  importDraft,
  importMode = "",
  initialMessage,
  mode,
  onCancel,
  onSubmitAction,
  returnTo = "/products/templates",
  template,
}: ProductTemplateFormProps) {
  const templateId = useMemo(() => template?.id ?? fallbackTemplateId(), [template?.id]);
  const pricingRef = useRef<HTMLDivElement | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState(template?.brand_id ?? defaultBrandId ?? "");
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) ?? null;
  const brandDefaultCurrency = selectedBrand?.default_currency ?? defaultCurrency;
  const allowImportPrefill = !template && importMode === "new";
  const templateCurrency = template?.currency ?? (allowImportPrefill ? importDraft?.currency : null) ?? brandDefaultCurrency;
  const selectedMainCategoryId = template?.main_category_id ?? defaultMainCategoryId ?? "";
  const selectedSubCategoryId = template?.sub_category_id ?? defaultSubCategoryId ?? "";
  const showExistingImportBanner = Boolean(template && existingImportDraft);
  const submitMode = mode ?? (template ? "update" : "create");
  const [expandedSections, setExpandedSections] = useState({
    details: !compactAccordionMode,
    gallery: !compactAccordionMode,
    pricing: !compactAccordionMode,
    summaryPricing: !compactAccordionMode,
  });
  const imageCount = proposedImageSlots.filter((slot) => Boolean(templateImageValue(template, slot.field))).length;
  const pricingRowCount =
    (template?.desking_size_pricing?.length ?? 0) +
    (template?.variant_pricing?.length ?? 0) +
    (template?.accessory_pricing?.length ?? 0) +
    countStandardCategoryPricingRows(template?.category_pricing);

  useEffect(() => {
    if (focusSection !== "pricing") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      pricingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusSection, template?.id]);

  function setAllSectionsOpen(nextValue: boolean) {
    setExpandedSections({
      details: nextValue,
      gallery: nextValue,
      pricing: nextValue,
      summaryPricing: nextValue,
    });
  }

  function handleInvalidFieldName(fieldName: string) {
    if ([
      "brand_id",
      "main_category_id",
      "sub_category_id",
      "template_name",
      "internal_selection_name",
      "template_code",
      "item_code",
      "default_specification",
      "origin",
      "supplier_name",
      "description",
      "price_notes",
    ].includes(fieldName)) {
      setExpandedSections((current) => ({ ...current, details: true }));
      return;
    }

    if ([
      "reference_image_url",
      ...proposedImageSlots.map((slot) => slot.field),
    ].includes(fieldName)) {
      setExpandedSections((current) => ({ ...current, gallery: true }));
      return;
    }

    if (["unit_label", "currency", "default_unit_price"].includes(fieldName)) {
      setExpandedSections((current) => ({ ...current, summaryPricing: true }));
      return;
    }

    if ([
      "desking_size_pricing",
      "variant_pricing",
      "accessory_pricing",
      "category_pricing",
    ].includes(fieldName)) {
      setExpandedSections((current) => ({ ...current, pricing: true }));
    }
  }

  return (
    <TemplateFormShell
      action={onSubmitAction ?? (submitMode === "update" ? updateProductTemplate : createProductTemplate)}
      cancelHref={onCancel ? undefined : returnTo}
      initialMessage={initialMessage}
      onInvalidFieldName={handleInvalidFieldName}
      onCancel={onCancel}
      pendingLabel={submitMode === "update" ? "Saving template..." : "Adding template..."}
      pendingMessage={submitMode === "update" ? "Saving template..." : "Adding product to library..."}
      submitLabel={submitMode === "update" ? "Save template" : "Add template"}
    >
      <input type="hidden" name="id" value={templateId} />
      <input type="hidden" name="return_to" value={returnTo} />
      {extraHiddenFields}
      {!template && importDraft && importMode === "new" ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
          <p className="font-semibold">Quotation row imported into the existing Add Template form.</p>
          <p className="mt-1 text-xs leading-5 text-emerald-900">
            Review the normal Product Library form below, then save when you are ready.
          </p>
        </section>
      ) : null}
      {compactAccordionMode ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setAllSectionsOpen(true)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setAllSectionsOpen(false)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900"
          >
            Collapse all
          </button>
        </div>
      ) : null}
      {showExistingImportBanner && existingImportDraft ? (
        <TemplateImportBanner
          cancelHref={cancelTemplateImportHref({
            returnTo,
            templateId,
          })}
          importDraft={existingImportDraft}
          templateId={templateId}
        />
      ) : null}
      <FormSection
        title="Template Details"
        description="Set the core product identity, category placement, quotation defaults, and internal notes for this template."
        isOpen={expandedSections.details}
        onToggle={compactAccordionMode ? () => setExpandedSections((current) => ({ ...current, details: !current.details })) : undefined}
        summary={compactAccordionMode
          ? [template?.template_name, selectedBrand?.name].filter(Boolean).join(" / ") || "Basic product identity and notes."
          : undefined}
      >
        {existingImportDraft ? (
          <div className="md:col-span-2 xl:col-span-3">
            <TemplateImportActionButton
              action="basic"
              draft={existingImportDraft}
              label="Use specification / dimension"
              templateId={templateId}
            />
          </div>
        ) : null}
        <TemplateCategoryFields
          allowQuickCreate={!template}
          brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
          categories={categories}
          defaultBrandId={selectedBrandId}
          defaultMainCategoryId={selectedMainCategoryId}
          defaultSubCategoryId={selectedSubCategoryId}
          onBrandChange={setSelectedBrandId}
        />
        <Field
          name="template_name"
          label="Item Name / Template Name"
          defaultValue={template?.template_name ?? (allowImportPrefill ? importDraft?.item_name_snapshot ?? importDraft?.model_snapshot : null)}
          required
        />
        <Field
          name="internal_selection_name"
          label="Internal Selection Name"
          defaultValue={template?.internal_selection_name}
          placeholder="Vintage Executive / Vintage Conference / Vintage Visitor"
          hint="Used only inside the software to help users identify similar templates. Client documents still use Item Name / Template Name."
        />
        <Field
          name="template_code"
          label="Template Code"
          defaultValue={template?.template_code ?? (allowImportPrefill ? importDraft?.item_code_snapshot : null)}
        />
        <Field
          name="item_code"
          label="Item Code"
          defaultValue={template?.item_code ?? (allowImportPrefill ? importDraft?.item_code_snapshot : null)}
        />
        <TextArea
          name="default_specification"
          label="Specifications"
          defaultValue={template?.default_specification ?? (allowImportPrefill
            ? appendedImportSpecification(importDraft?.specification_snapshot, importDraft?.size_snapshot)
            : null)}
        />
        <Field
          name="origin"
          label="Origin override"
          defaultValue={template?.origin ?? (allowImportPrefill ? importDraft?.origin_snapshot : null)}
        />
        <Field
          name="supplier_name"
          label="Supplier override"
          defaultValue={template?.supplier_name ?? (allowImportPrefill ? importDraft?.supplier_name_snapshot : null)}
        />
        <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 md:col-span-2 xl:col-span-1">
          Dimension is calculated from workstation size pricing when available.
          Finish and accessory choices still come from Template Options.
        </div>
        <TextArea
          name="description"
          label="Description"
          defaultValue={template?.description ?? (allowImportPrefill ? quotationRowImportDescription(importDraft ?? null) : null)}
        />
        <TextArea
          name="price_notes"
          label="Pricing / Formula Notes"
          defaultValue={template?.price_notes}
        />
      </FormSection>

      <div ref={pricingRef} className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FormSection
          title="Pricing"
          description="Define the base commercial values used before optional rows, materials, and linked product families are applied."
          isOpen={expandedSections.summaryPricing}
          onToggle={compactAccordionMode ? () => setExpandedSections((current) => ({ ...current, summaryPricing: !current.summaryPricing })) : undefined}
          summary={compactAccordionMode
            ? `${templateCurrency} ${Number(template?.default_unit_price ?? 0).toFixed(2)} default unit price`
            : undefined}
        >
          <Field
            name="unit_label"
            label="Unit"
            defaultValue={template?.unit_label ?? (allowImportPrefill ? importDraft?.unit_label : null) ?? "Pc"}
          />
          <CurrencySelect defaultValue={templateCurrency} />
          <Field
            name="default_unit_price"
            label="Default U.Price"
            type="number"
            defaultValue={template?.default_unit_price ?? (allowImportPrefill ? importDraft?.unit_price : null) ?? 0}
          />
          <div className="flex items-end">
            <p className="text-xs leading-5 text-zinc-500">
              New templates are created as active. Use Archive or Discontinue from the Product Library when the lifecycle changes.
            </p>
          </div>
        </FormSection>

        <FormSection
          title="Reference Images"
          description="Add product reference images. Click an image card or paste a PNG, JPG, JPEG, or WebP image from the clipboard."
          isOpen={expandedSections.gallery}
          onToggle={compactAccordionMode ? () => setExpandedSections((current) => ({ ...current, gallery: !current.gallery })) : undefined}
          summary={compactAccordionMode ? `${imageCount} images` : undefined}
        >
          {existingImportDraft ? (
            <div className="md:col-span-2 xl:col-span-3">
              <TemplateImportActionButton
                action="image"
                draft={existingImportDraft}
                label="Add row image to gallery"
                templateId={templateId}
              />
            </div>
          ) : null}
          <input
            type="hidden"
            name="reference_image_url"
            defaultValue={template?.reference_image_url ?? (allowImportPrefill ? importDraft?.specified_image_url_snapshot : null) ?? ""}
          />
          <div className="md:col-span-2 xl:col-span-3">
            <TemplateReferenceImageFieldManager
              importDraft={existingImportDraft}
              initialSlots={proposedImageSlots.map((slot) => ({
                ...slot,
                sessionUploadInfo: null,
                settings: templateImageDisplaySettings(template, slot.field),
                value: templateImageValue(template, slot.field) ?? (
                  slot.field === "proposed_image_url_1" && allowImportPrefill
                    ? importDraft?.proposed_image_url_snapshot ?? importDraft?.specified_image_url_snapshot ?? null
                    : null
                ),
              }))}
              templateExists={Boolean(template)}
              templateId={templateId}
            />
          </div>
        </FormSection>
      </div>

      {template ? (
        <div
          hidden={!expandedSections.gallery}
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Current Gallery</p>
          <div className="mt-3">
            <TemplateDetailImageGallery
              templateId={template.id}
              visibleSlots={proposedImageSlots
                .map((slot) => ({
                  ...slot,
                  settings: templateImageDisplaySettings(template, slot.field),
                  value: templateImageValue(template, slot.field),
                }))
                .filter((slot): slot is typeof slot & { value: string } => Boolean(slot.value))}
            />
          </div>
        </div>
      ) : null}

      <FormSection
        title="Detailed Pricing"
        description="Maintain workstation pricing, base variants, accessories, and finish-category pricing in one dedicated pricing area."
        isOpen={expandedSections.pricing}
        onToggle={compactAccordionMode ? () => setExpandedSections((current) => ({ ...current, pricing: !current.pricing })) : undefined}
        summary={compactAccordionMode
          ? `${pricingRowCount} pricing rows across base, sizes, accessories, and finish pricing`
          : undefined}
      >
        <TemplatePricingSections
          key={[
            template?.id ?? "new",
            template?.desking_size_pricing?.length ?? 0,
            template?.variant_pricing?.length ?? 0,
            template?.accessory_pricing?.length ?? 0,
            template?.category_pricing?.length ?? 0,
            (template?.category_pricing ?? [])
              .map((row) => Object.keys(row.prices ?? {}).join(","))
              .join("|"),
          ].join(":")}
          accessoryPricingRows={template?.accessory_pricing}
          brandDefaultCurrency={brandDefaultCurrency}
          categoryPricingRows={template?.category_pricing}
          compactAccordionMode={compactAccordionMode}
          deskingSizePricingRows={template?.desking_size_pricing}
          importDraft={existingImportDraft}
          templateCurrency={template?.currency}
          templateId={templateId}
          variantPricingRows={template?.variant_pricing}
        />
      </FormSection>
    </TemplateFormShell>
  );
}
