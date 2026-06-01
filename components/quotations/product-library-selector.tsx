"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { addProductTemplateToQuotation } from "@/app/quotations/actions";
import {
  markTemplatePriceCheckedForQuotationModal,
  updateProductTemplateForQuotationModal,
} from "@/app/products/templates/actions";
import type { ImageDisplaySettings } from "@/components/images/image-adjustment-dialog";
import { ProductTemplateForm } from "@/components/products/product-template-form";
import {
  FinishSelectionsEditor,
  type FinishSelectionEditorRow,
  type FinishMaterial,
  type FinishMaterialBrand,
  type FinishMaterialGroup,
  type ProductTemplateMaterialGroupItemLink,
  type ProductTemplateMaterialGroupLink,
} from "@/components/quotations/finish-selections-editor";
import { formatMoney, normalizeCurrency } from "@/lib/currencies";
import { createLocalId, localNow, type LocalQuotationItem } from "@/lib/local/quotation-workspace";
import { productTemplatePriceCheckState } from "@/lib/product-price-check";
import {
  modularItemPricingRows,
  modularPricingDefaultsFromRows,
  standardCategoryPricingRows,
} from "@/lib/products/modular-pricing";
import { formatQuotationMoney, quotationMoneyValue } from "@/lib/quotation-pricing";
import {
  buildCompanyStyleProductSpecification,
  resolveProductDimensionSnapshot,
  resolveProductOriginSnapshot,
  resolveProductSpecificationSnapshot,
} from "@/lib/quotations/product-template-snapshot";
import {
  markQuotationImagePathFailed,
  normalizeProductImageSnapshotPath,
  resolveQuotationImageUrl,
} from "@/lib/quotation-image-path";

export type ProductLibraryBrand = {
  default_currency?: string | null;
  id: string;
  name: string;
  origin?: string | null;
  last_price_list_checked_at?: string | null;
};

export type ProductLibraryCategory = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
};

export type ProductLibraryTemplate = {
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
  image_settings?: Record<string, Partial<ImageDisplaySettings> | undefined> | null;
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  unit_label?: string | null;
  currency: string;
  default_unit_price: number;
  created_at: string | null;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
  price_check_note?: string | null;
  price_notes?: string | null;
  brand_latest_price_list_at?: string | null;
  latest_brand_price_list_update?: {
    title?: string | null;
    effective_from: string | null;
    received_at: string | null;
    created_at: string | null;
    status: string;
  } | null;
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
  items?: AccessoryPricingItem[];
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type ProductLibraryComponent = {
  id: string;
  template_id: string;
  option_type: string;
  component_group: string;
  component_code: string | null;
  component_name: string;
  description: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  currency: string;
  is_optional: boolean;
  is_default_selected: boolean;
  sort_order: number;
  calculation_data: {
    desking_role?: string;
    base_cluster_seats?: number;
    module_length?: number;
    depth?: number;
    height?: number;
    dimension_unit?: string;
    price_role?: string;
    seats_per_cluster?: number;
    modules_per_cluster?: number;
    label?: string;
    allow_manual_quantity?: boolean;
  } | null;
};

export type ProductLibraryLinkedFamily = {
  id: string;
  parent_template_id: string;
  linked_template_id: string;
  label: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  add_to_parent_price: boolean;
  append_to_specification: boolean;
  default_qty: number;
  sort_order: number;
  is_active: boolean;
};

const optionTypeLabels = new Map([
  ["material_finish", "Material / Finish"],
  ["fabric_category", "Fabric Category"],
  ["size_variant", "Size Variant"],
  ["cluster_preset", "Cluster Preset"],
  ["linked_addon", "Linked Add-on"],
  ["other", "Other"],
]);

const optionTypeOrder = [
  "material_finish",
  "fabric_category",
  "size_variant",
  "cluster_preset",
  "linked_addon",
  "other",
];

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseSizeLabel(label?: string | null) {
  const normalized = (label ?? "")
    .replace(/[A-Za-z]+$/g, "")
    .trim();
  const parts = normalized
    .split(/\s*x\s*/i)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (parts.length !== 3) {
    return null;
  }

  return {
    depth: parts[1],
    height: parts[2],
    length: parts[0],
  };
}

function normalizedWorkstationLayoutType(value: unknown) {
  return value === "Linear" || value === "Cluster" || value === "Both" ? value : "Linear";
}

function normalizedSizePricingRow(row: DeskingSizePricingRow, index: number): DeskingSizePricingRow {
  const parsedLabel = parseSizeLabel(
    typeof row.default_dimension === "string" && row.default_dimension.trim()
      ? row.default_dimension
      : row.label,
  );
  const length = parsedLabel?.length ?? numberValue(row.length);
  const depth = parsedLabel?.depth ?? numberValue(row.depth);
  const height = parsedLabel?.height ?? numberValue(row.height);
  const baseSupplierPriceListCode = row.base_supplier_price_list_code?.trim() || row.supplier_price_list_code?.trim() || "";

  return {
    ...row,
    additional_supplier_price_list_code: row.additional_supplier_price_list_code?.trim() || "",
    base_supplier_price_list_code: baseSupplierPriceListCode,
    currency: normalizeCurrency(row.currency ?? "AED"),
    default_dimension: row.default_dimension?.trim() || (length && depth && height ? `${length}x${depth}x${height}` : ""),
    depth,
    height,
    id: row.id ?? `size-${index}`,
    is_active: row.is_active !== false,
    label: row.label?.trim() || `${length}x${depth}x${height}`,
    length,
    layout_type: normalizedWorkstationLayoutType(row.layout_type),
    specification: row.specification?.trim() || "",
    supplier_price_list_code: baseSupplierPriceListCode,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function formatPriceCheckDate(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function finishSnapshotValue(finishes: FinishSelectionEditorRow[]) {
  const visibleFinishes = finishes.filter((finish) => finish.show_in_quotation === true);

  if (!visibleFinishes.length) return null;

  const groups = new Map<string, { label: string; items: string[] }>();

  visibleFinishes.forEach((finish, index) => {
    const groupKey =
      finish.product_template_material_group_id ||
      finish.material_group_id ||
      finish.group_label ||
      `group-${index}`;
    const groupLabel = finish.group_label || "Finish";
    const itemLabel = [finish.finish_code, finish.finish_name].filter(Boolean).join(" ").trim() ||
      finish.finish_description ||
      "Selected finish";
    const existing = groups.get(groupKey);

    if (existing) {
      existing.items.push(itemLabel);
      return;
    }

    groups.set(groupKey, {
      label: groupLabel,
      items: [itemLabel],
    });
  });

  return Array.from(groups.values())
    .map((group) => `${group.label}: ${group.items.join(", ")}`)
    .join("\n");
}

function finishSelectionLabel(finish: FinishSelectionEditorRow) {
  const itemLabel = [finish.finish_code, finish.finish_name].filter(Boolean).join(" | ").trim() ||
    finish.finish_description ||
    "Selected finish";

  return `${finish.group_label || "Finish"} - ${itemLabel}`;
}

function priceCheckState(template: ProductLibraryTemplate) {
  return productTemplatePriceCheckState({
    brandPriceBaselineAt: template.brand_latest_price_list_at,
    formatDate: formatPriceCheckDate,
    latestBrandPriceListUpdate: template.latest_brand_price_list_update,
    template,
  });
}

function PriceCheckBadge({
  compact = false,
  template,
}: {
  compact?: boolean;
  template: ProductLibraryTemplate;
}) {
  const status = priceCheckState(template);
  const badgeClass = status.tone === "ok"
    ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-900"
    : status.tone === "notice"
      ? "inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-900"
      : status.tone === "neutral"
        ? "inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-700"
        : "inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900";

  return (
    <span className={compact ? "mt-1 block" : "grid gap-1"}>
      <span className={badgeClass}>{status.label}</span>
      {!compact ? <span className="block text-[11px] font-medium text-zinc-500">{status.detail}</span> : null}
    </span>
  );
}

function activeSizePricingRows(rows?: DeskingSizePricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizedSizePricingRow(row, index))
    .filter((row) => row.is_active !== false)
    .filter((row) =>
      Boolean(
        row.label?.trim() ||
        row.default_dimension?.trim() ||
        numberValue(row.default_price) > 0 ||
        numberValue(row.additional_price) > 0,
      ))
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeVariantRows(rows?: VariantPricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.display_name || row.dimension || numberValue(row.price) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeCategoryRows(rows?: CategoryPricingRow[] | null) {
  return standardCategoryPricingRows(rows)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.display_name || row.dimension || Object.values(row.prices ?? {}).some((price) => numberValue(price) > 0))
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeModularRows(rows?: CategoryPricingRow[] | null) {
  return modularItemPricingRows(rows)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.display_name || row.dimension || Object.values(row.prices ?? {}).some((price) => numberValue(price) > 0))
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function pricingDisplayName(row?: { display_name?: string; variant_name?: string } | null) {
  return row?.display_name?.trim() || row?.variant_name?.trim() || "";
}

function pricingOptionLabel({
  currency,
  dimension,
  displayName,
  price,
}: {
  currency: string;
  dimension?: string | null;
  displayName: string;
  price?: number;
}) {
  const parts = [
    displayName,
    dimension?.trim() || "",
    typeof price === "number" ? formatMoney(currency, price) : "",
  ].filter(Boolean);
  return parts.join(" - ");
}

function InternalMetaLine({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value?.trim()) {
    return null;
  }

  return (
    <p className="text-xs leading-5 text-zinc-500">
      <span className="font-semibold text-zinc-700">{label}:</span> {value}
    </p>
  );
}

function categoryPriceColumns(rows?: CategoryPricingRow[] | null) {
  const columns = ["Cat A", "Cat B", "Cat C", "Cat D"];

  [...activeCategoryRows(rows), ...activeModularRows(rows)].forEach((row) => {
    Object.keys(row.prices ?? {}).forEach((category) => {
      if (!columns.includes(category)) {
        columns.push(category);
      }
    });
  });

  return columns;
}

function activeAccessoryRows(rows?: AccessoryPricingRow[] | null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const groups = sourceRows
    .filter((row) => row.group_name || row.items)
    .map((group, groupIndex) => ({
      id: group.id ?? `add-on-group-${groupIndex}`,
      group_name: group.group_name?.trim() || "Accessories",
      is_active: group.is_active !== false,
      sort_order: numberValue(group.sort_order, groupIndex),
      items: (group.items ?? [])
        .filter((item) => item.is_active !== false)
        .filter((item) => item.item_name || item.supplier_price_list_code || numberValue(item.price) > 0)
        .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order)),
    }))
    .filter((group) => group.is_active && group.items.length)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
  const flatRows = sourceRows
    .filter((row) => !row.group_name && !row.items)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.item_name || numberValue(row.price) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));

  return flatRows.length
    ? [
        ...groups,
        {
          id: "accessories",
          group_name: "Accessories",
          is_active: true,
          sort_order: groups.length,
          items: flatRows,
        },
      ]
    : groups;
}

function matchesTemplateSearch({
  brandNameById,
  categoryNameById,
  normalizedSearch,
  template,
}: {
  brandNameById: Map<string, string>;
  categoryNameById: Map<string, string>;
  normalizedSearch: string;
  template: ProductLibraryTemplate;
}) {
  return [
    template.internal_selection_name,
    template.template_name,
    template.item_code,
    template.template_code,
    template.description,
    template.default_specification,
    template.origin,
    template.supplier_name,
    brandNameById.get(template.brand_id),
    template.main_category_id ? categoryNameById.get(template.main_category_id) : null,
    template.sub_category_id ? categoryNameById.get(template.sub_category_id) : null,
    ...(template.desking_size_pricing ?? []).flatMap((row) => [
      row.label,
      row.supplier_price_list_code,
    ]),
    ...(template.variant_pricing ?? []).flatMap((row) => [
      row.variant_name,
      row.display_name,
      row.supplier_price_list_code,
      row.specification,
    ]),
    ...(template.category_pricing ?? []).flatMap((row) => [
      row.modular_default_specification,
      row.modular_default_dimension,
      row.variant_name,
      row.display_name,
      row.supplier_price_list_code,
      row.specification,
    ]),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function templateSelectionName(template: Pick<ProductLibraryTemplate, "internal_selection_name" | "template_name">) {
  return template.internal_selection_name?.trim() || template.template_name;
}

function deskingRole(component: ProductLibraryComponent) {
  return component.calculation_data?.desking_role ?? "";
}

function isDeskingTemplate({
  mainCategory,
  subCategory,
  templateComponents,
}: {
  mainCategory: string | null | undefined;
  subCategory: string | null | undefined;
  templateComponents: ProductLibraryComponent[];
}) {
  return (
    /workstation|desking/.test(mainCategory?.toLowerCase() ?? "") ||
    /workstation|desking/.test(subCategory?.toLowerCase() ?? "") ||
    templateComponents.some((component) => Boolean(deskingRole(component)))
  );
}

function deskingSizePricingCalculation({
  accessoryQuantities,
  additionalClusterQty,
  configuredDimension,
  selectedLayoutType,
  selectedSize,
  template,
  templateComponents,
}: {
  accessoryQuantities: Record<string, number>;
  additionalClusterQty: number;
  configuredDimension?: string | null;
  selectedLayoutType?: string | null;
  selectedSize: DeskingSizePricingRow;
  template: ProductLibraryTemplate;
  templateComponents: ProductLibraryComponent[];
}) {
  const accessoryLines = templateComponents
    .filter((component) => component.option_type === "linked_addon" || deskingRole(component) === "accessory")
    .map((component) => ({
      component,
      qty: Math.max(0, Math.trunc(numberValue(accessoryQuantities[component.id], 0))),
    }))
    .filter((line) => line.qty > 0);
  const baseSeats = 2;
  const seatsPerCluster = 2;
  const modulesPerCluster = 1;
  const additionalSeats = additionalClusterQty * seatsPerCluster;
  const totalSeats = baseSeats + additionalSeats;
  const baseModules = 1;
  const additionalModules = additionalClusterQty * modulesPerCluster;
  const totalModules = baseModules + additionalModules;
  const moduleLength = numberValue(selectedSize.length, 0);
  const depth = numberValue(selectedSize.depth, 0);
  const height = numberValue(selectedSize.height, 0);
  const dimensionUnit = selectedSize.dimension_unit ?? "cm";
  const calculatedDimension =
    moduleLength && depth && height && totalModules
      ? `${moduleLength * totalModules} x ${depth} x ${height} ${dimensionUnit}`
      : "";
  const dimension = configuredDimension?.trim() || selectedSize.default_dimension?.trim() || calculatedDimension;
  const clusterName = "CL2";
  const clusterLabel =
    additionalClusterQty > 0
      ? `${clusterName} + ${additionalClusterQty} additional / Cluster of ${totalSeats}`
      : `Cluster of ${totalSeats}`;
  const basePrice = numberValue(selectedSize.default_price, numberValue(template.default_unit_price));
  const additionalPrice = numberValue(selectedSize.additional_price, basePrice);
  const accessoryPrice = accessoryLines.reduce(
    (total, line) => total + line.qty * numberValue(line.component.unit_price),
    0,
  );
  const unitPrice = basePrice + additionalPrice * additionalClusterQty + accessoryPrice;
  const selectedOptionNames = [
    selectedSize.label || `${moduleLength} x ${depth} x ${height}`,
    clusterName,
    ...accessoryLines.map((line) => `${line.component.component_name} x${line.qty}`),
  ];

  return {
    accessoryLines,
    accessoryPrice,
    additionalClusterQty,
    additionalPrice,
    additionalSupplierPriceListCode: selectedSize.additional_supplier_price_list_code ?? null,
    basePrice,
    baseSupplierPriceListCode: selectedSize.base_supplier_price_list_code ?? selectedSize.supplier_price_list_code ?? null,
    clusterLabel,
    clusterName,
    dimension,
    layoutType: selectedLayoutType || selectedSize.layout_type || "Linear",
    mainCurrency: selectedSize.currency ?? template.currency,
    formula:
      additionalClusterQty > 0
        ? `${formatMoney(selectedSize.currency ?? template.currency, basePrice)} + (${formatMoney(selectedSize.currency ?? template.currency, additionalPrice)} x ${additionalClusterQty}) = ${formatMoney(selectedSize.currency ?? template.currency, unitPrice)}`
        : `${formatMoney(selectedSize.currency ?? template.currency, basePrice)} x 1 = ${formatMoney(selectedSize.currency ?? template.currency, unitPrice)}`,
    finishNames: [] as string[],
    selectedOptionNames,
    sizeLabel: selectedSize.label ?? `${moduleLength}x${depth}x${height}`,
    totalModules,
    totalSeats,
    unitPrice: unitPrice || numberValue(template.default_unit_price),
  };
}

function ProductThumbnail({
  label,
  path,
  selected,
}: {
  label?: string;
  path: string | null;
  selected?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!path) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void resolveQuotationImageUrl(normalizeProductImageSnapshotPath(path) ?? path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div
      className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border bg-white text-center text-[10px] ${
        selected ? "border-emerald-900 ring-2 ring-emerald-900/20" : "border-dashed border-zinc-300"
      } text-zinc-400`}
      title={label}
    >
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Product template"
          onError={() => {
            if (path) markQuotationImagePathFailed(normalizeProductImageSnapshotPath(path) ?? path);
            setPreviewUrl("");
          }}
          className="block h-full w-full object-contain"
        />
      ) : (
        <span className="px-1">No image</span>
      )}
    </div>
  );
}

function ProductImagePreviewDialog({
  currentIndex,
  images,
  onClose,
  onNavigate,
  onSelect,
  templateName,
}: {
  currentIndex: number;
  images: Array<{ label: string; path: string }>;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
  onSelect: (path: string) => void;
  templateName: string;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const currentImage = images[currentIndex] ?? null;

  useEffect(() => {
    let cancelled = false;
    const path = currentImage?.path ?? null;

    if (!path) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void resolveQuotationImageUrl(normalizeProductImageSnapshotPath(path) ?? path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [currentImage?.path]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        onNavigate(currentIndex - 1);
        return;
      }

      if (event.key === "ArrowRight" && currentIndex < images.length - 1) {
        event.preventDefault();
        onNavigate(currentIndex + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, images.length, onClose, onNavigate]);

  if (!currentImage) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 px-4 py-6">
      <div className="w-full max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{currentImage.label}</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-white">{templateName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`${templateName} ${currentImage.label}`}
                className="max-h-[72vh] w-full object-contain"
              />
            ) : (
              <div className="flex h-[360px] w-full items-center justify-center text-sm text-zinc-400">Image preview unavailable</div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate(currentIndex - 1)}
                disabled={currentIndex === 0}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => onNavigate(currentIndex + 1)}
                disabled={currentIndex >= images.length - 1}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSelect(currentImage.path)}
              className="rounded-md bg-emerald-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              Use this image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProductLibrarySelector({
  brands,
  canManageProductLibrary = false,
  categories,
  components,
  linkedFamilies,
  materialGroups,
  materials,
  onAddLocalItem,
  quotationId,
  returnTo,
  sectionId,
  templateMaterialGroupItems,
  templateMaterialGroups,
  templates,
}: {
  brands: ProductLibraryBrand[];
  canManageProductLibrary?: boolean;
  categories: ProductLibraryCategory[];
  components: ProductLibraryComponent[];
  linkedFamilies: ProductLibraryLinkedFamily[];
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  onAddLocalItem?: (item: LocalQuotationItem) => void;
  quotationId: string;
  returnTo: string;
  sectionId: string;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
  templates: ProductLibraryTemplate[];
}) {
  const isLocalMode = Boolean(onAddLocalItem);
  const [isTemplateActionPending, startTemplateActionTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [templateRecords, setTemplateRecords] = useState(() => templates);
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, string | string[]>>>({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [imagePreview, setImagePreview] = useState<{ templateId: string; imageIndex: number } | null>(null);
  const [additionalClusterQuantities, setAdditionalClusterQuantities] = useState<Record<string, number>>({});
  const [accessoryQuantities, setAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [selectedDeskingSizes, setSelectedDeskingSizes] = useState<Record<string, string>>({});
  const [selectedVariantRows, setSelectedVariantRows] = useState<Record<string, string>>({});
  const [selectedCategoryRows, setSelectedCategoryRows] = useState<Record<string, string>>({});
  const [selectedFabricCategories, setSelectedFabricCategories] = useState<Record<string, string>>({});
  const [selectedModularQuantities, setSelectedModularQuantities] = useState<Record<string, Record<string, number>>>({});
  const [configuredDimensions, setConfiguredDimensions] = useState<Record<string, string>>({});
  const [configuredSpecifications, setConfiguredSpecifications] = useState<Record<string, string>>({});
  const [selectedWorkstationLayouts, setSelectedWorkstationLayouts] = useState<Record<string, string>>({});
  const [pricingAccessoryQuantities, setPricingAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [linkedProductQuantities, setLinkedProductQuantities] = useState<Record<string, number>>({});
  const [linkedAccessoryQuantities, setLinkedAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [selectedLinkedVariants, setSelectedLinkedVariants] = useState<Record<string, string>>({});
  const [selectedLinkedCategories, setSelectedLinkedCategories] = useState<Record<string, string>>({});
  const [selectedLinkedFabricCategories, setSelectedLinkedFabricCategories] = useState<Record<string, string>>({});
  const [exchangeRates, setExchangeRates] = useState<Record<string, Record<string, string>>>({});
  const [discountTypes, setDiscountTypes] = useState<Record<string, string>>({});
  const [discountValues, setDiscountValues] = useState<Record<string, string>>({});
  const [selectedFinishesByTemplate, setSelectedFinishesByTemplate] = useState<Record<string, FinishSelectionEditorRow[]>>({});
  const [templatePriceOverrides, setTemplatePriceOverrides] = useState<Record<string, number | undefined>>({});
  const [templateEditor, setTemplateEditor] = useState<{
    currentPreviewUnitPrice: number;
    mode: "edit" | "price_check";
    templateId: string;
  } | null>(null);
  const [templateActionMessageById, setTemplateActionMessageById] = useState<Record<string, string>>({});
  const [pendingPriceUpdateChoice, setPendingPriceUpdateChoice] = useState<{
    previousUnitPrice: number;
    templateId: string;
  } | null>(null);

  const brandNameById = useMemo(
    () => new Map(brands.map((brand) => [brand.id, brand.name])),
    [brands],
  );
  const brandOriginById = useMemo(
    () => new Map(brands.map((brand) => [brand.id, brand.origin ?? null])),
    [brands],
  );
  const templateById = useMemo(
    () => new Map(templateRecords.map((template) => [template.id, template])),
    [templateRecords],
  );
  const linkedFamiliesByParent = useMemo(() => {
    const map = new Map<string, ProductLibraryLinkedFamily[]>();

    for (const link of linkedFamilies) {
      if (!link.is_active) continue;

      const list = map.get(link.parent_template_id) ?? [];
      list.push(link);
      map.set(link.parent_template_id, list);
    }

    for (const list of map.values()) {
      list.sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
    }

    return map;
  }, [linkedFamilies]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const mainCategories = categories.filter((category) => !category.parent_id);
  const subcategories = categories.filter((category) => category.parent_id);
  const componentsByTemplate = useMemo(() => {
    const map = new Map<string, ProductLibraryComponent[]>();

    for (const component of components) {
      const templateComponents = map.get(component.template_id) ?? [];
      templateComponents.push(component);
      map.set(component.template_id, templateComponents);
    }

    return map;
  }, [components]);
  const normalizedSearch = search.trim().toLowerCase();
  const hasSearch = normalizedSearch.length > 0;
  const filteredTemplates = templateRecords.filter((template) => {
    const matchesSearch = !hasSearch || matchesTemplateSearch({
      brandNameById,
      categoryNameById,
      normalizedSearch,
      template,
    });

    if (hasSearch) {
      return matchesSearch;
    }

    if (brandId && template.brand_id !== brandId) return false;
    if (categoryId && template.main_category_id !== categoryId) return false;
    if (subcategoryId && template.sub_category_id !== subcategoryId) return false;

    return true;
  });
  const selectedTemplate = selectedTemplateId
    ? templateById.get(selectedTemplateId) ?? null
    : null;
  const finishBrands: FinishMaterialBrand[] = brands;
  const productCountByBrand = useMemo(() => {
    const map = new Map<string, number>();

    for (const template of templateRecords) {
      map.set(template.brand_id, (map.get(template.brand_id) ?? 0) + 1);
    }

    return map;
  }, [templateRecords]);
  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();

    for (const template of templateRecords) {
      if (template.main_category_id) {
        map.set(template.main_category_id, (map.get(template.main_category_id) ?? 0) + 1);
      }
      if (template.sub_category_id) {
        map.set(template.sub_category_id, (map.get(template.sub_category_id) ?? 0) + 1);
      }
    }

    return map;
  }, [templateRecords]);
  const visibleMainCategories = mainCategories.filter((category) => {
    if (brandId && category.brand_id !== brandId) return false;

    return (productCountByCategory.get(category.id) ?? 0) > 0;
  });
  const visibleSubcategories = subcategories.filter((category) => {
    if (brandId && category.brand_id !== brandId) return false;
    if (categoryId && category.parent_id !== categoryId) return false;

    return (productCountByCategory.get(category.id) ?? 0) > 0;
  });

  const updateTemplateRecord = (nextTemplate: ProductLibraryTemplate) => {
    setTemplateRecords((current) =>
      current.map((template) => (template.id === nextTemplate.id ? nextTemplate : template)),
    );
    setTemplateActionMessageById((current) => ({
      ...current,
      [nextTemplate.id]: "",
    }));
  };

  const closeTemplateEditor = () => {
    setTemplateEditor(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50"
      >
        Add from Product Library
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 px-4 py-6">
          <div className="flex h-[90vh] w-[min(1200px,96vw)] flex-col border border-zinc-300 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950">
                  Product Library
                </h2>
                <p className="text-xs text-zinc-500">
                  Add a reusable template as an editable quotation snapshot.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-950"
              >
                Close
              </button>
            </div>

            {!selectedTemplate ? (
              <>
                <div className="grid shrink-0 gap-2 border-b border-zinc-200 bg-zinc-50 p-3 md:grid-cols-[minmax(220px,1fr)_170px_170px_170px_80px]">
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search products..."
                    className="h-9 border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-800"
                  />
                  <select
                    value={brandId}
                    onChange={(event) => {
                      setBrandId(event.target.value);
                      setCategoryId("");
                      setSubcategoryId("");
                    }}
                    className={`h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 ${hasSearch ? "opacity-60" : ""}`}
                  >
                    <option value="">All brands</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={categoryId}
                    onChange={(event) => {
                      setCategoryId(event.target.value);
                      setSubcategoryId("");
                    }}
                    className={`h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 ${hasSearch ? "opacity-60" : ""}`}
                  >
                    <option value="">All categories</option>
                    {visibleMainCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={subcategoryId}
                    onChange={(event) => setSubcategoryId(event.target.value)}
                    className={`h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 ${hasSearch ? "opacity-60" : ""}`}
                  >
                    <option value="">All subcategories</option>
                    {visibleSubcategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandId("");
                      setCategoryId("");
                      setSubcategoryId("");
                      setSearch("");
                      setSelectedTemplateId("");
                    }}
                    className="h-9 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400"
                  >
                    Reset
                  </button>
                </div>
                {hasSearch ? (
                  <div className="shrink-0 border-b border-zinc-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                    Searching across all products
                  </div>
                ) : null}
              </>
            ) : null}

            <div className={`grid min-h-0 flex-1 overflow-hidden ${selectedTemplate ? "grid-cols-1" : "lg:grid-cols-[220px_minmax(320px,1fr)_420px]"}`}>
              <aside className={`${selectedTemplate ? "hidden" : "min-h-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50 p-3 lg:border-b-0 lg:border-r"}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase text-zinc-500">Library</p>
                  <span className="text-[11px] font-semibold text-zinc-500">{templateRecords.length} products</span>
                </div>
                <div className="space-y-2">
                  {brands.map((brand) => {
                    const brandCategories = mainCategories.filter(
                      (category) =>
                        category.brand_id === brand.id && (productCountByCategory.get(category.id) ?? 0) > 0,
                    );
                    const brandCount = productCountByBrand.get(brand.id) ?? 0;

                    if (!brandCount && !brandCategories.length) return null;

                    return (
                      <details key={brand.id} className="border border-zinc-200 bg-white">
                        <summary
                          className="cursor-pointer px-2 py-2 text-xs font-bold text-zinc-800 transition hover:text-emerald-900"
                          onClick={() => {
                            setBrandId(brand.id);
                            setCategoryId("");
                            setSubcategoryId("");
                          }}
                        >
                          {brand.name} <span className="font-semibold text-zinc-400">({brandCount})</span>
                        </summary>
                        <div className="border-t border-zinc-100 py-1">
                          {brandCategories.map((category) => {
                            const categorySubcategories = subcategories.filter(
                              (child) =>
                                child.parent_id === category.id && (productCountByCategory.get(child.id) ?? 0) > 0,
                            );
                            const categoryCount = productCountByCategory.get(category.id) ?? 0;

                            return (
                              <details key={category.id} className="border-t border-zinc-100">
                                <summary
                                  className={`cursor-pointer px-3 py-1.5 text-xs transition hover:bg-emerald-50 hover:text-emerald-900 ${
                                    categoryId === category.id ? "bg-emerald-50 font-bold text-emerald-950" : "text-zinc-600"
                                  }`}
                                  onClick={() => {
                                    setBrandId(brand.id);
                                    setCategoryId(category.id);
                                    setSubcategoryId("");
                                  }}
                                >
                                  {category.name} <span className="text-zinc-400">({categoryCount})</span>
                                </summary>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBrandId(brand.id);
                                    setCategoryId(category.id);
                                    setSubcategoryId("");
                                  }}
                                  className="block w-full px-5 py-1 text-left text-[11px] font-semibold text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-900"
                                >
                                  All {category.name}
                                </button>
                                {categorySubcategories.map((subcategory) => (
                                  <button
                                    key={subcategory.id}
                                    type="button"
                                    onClick={() => {
                                      setBrandId(brand.id);
                                      setCategoryId(category.id);
                                      setSubcategoryId(subcategory.id);
                                    }}
                                    className={`block w-full px-5 py-1 text-left text-[11px] transition hover:bg-emerald-50 hover:text-emerald-900 ${
                                      subcategoryId === subcategory.id ? "bg-emerald-50 font-bold text-emerald-950" : "text-zinc-500"
                                    }`}
                                  >
                                    {subcategory.name} <span className="text-zinc-400">({productCountByCategory.get(subcategory.id) ?? 0})</span>
                                  </button>
                                ))}
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </aside>

              <section className={`${selectedTemplate ? "hidden" : "min-h-0 overflow-y-auto border-b border-zinc-200 p-3 lg:border-b-0 lg:border-r"}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase text-zinc-500">Products</p>
                  <span className="text-xs font-semibold text-zinc-500">{filteredTemplates.length} found</span>
                </div>
                <div className="space-y-2">
                  {filteredTemplates.map((template) => {
                    const mainCategory = template.main_category_id
                      ? categoryNameById.get(template.main_category_id)
                      : null;
                    const subCategory = template.sub_category_id
                      ? categoryNameById.get(template.sub_category_id)
                      : null;
                    const thumbnailPath = [
                      template.proposed_image_url_1 ?? template.default_image_url,
                      template.proposed_image_url_2,
                      template.proposed_image_url_3,
                      template.proposed_image_url_4,
                      template.proposed_image_url_5,
                      template.proposed_image_url_6,
                      template.proposed_image_url_7,
                      template.proposed_image_url_8,
                      template.proposed_image_url_9,
                      template.proposed_image_url_10,
                      template.proposed_image_url_11,
                      template.proposed_image_url_12,
                      template.proposed_image_url_13,
                      template.proposed_image_url_14,
                      template.proposed_image_url_15,
                      template.proposed_image_url_16,
                      template.proposed_image_url_17,
                      template.proposed_image_url_18,
                      template.proposed_image_url_19,
                      template.proposed_image_url_20,
                      template.reference_image_url,
                    ].find((value) => Boolean(value)) ?? null;
                    const selected = selectedTemplateId === template.id;

                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`flex w-full gap-3 border p-2 text-left transition hover:border-emerald-700 hover:bg-emerald-50 ${
                          selected ? "border-emerald-900 bg-emerald-50" : "border-zinc-200 bg-white"
                        }`}
                      >
                        <ProductThumbnail path={thumbnailPath ?? null} selected={selected} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-950">
                            {templateSelectionName(template)}
                          </span>
                          {template.internal_selection_name ? (
                            <span className="mt-1 block text-[11px] font-medium text-zinc-500">
                              Quote name: {template.template_name}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-xs text-zinc-500">
                            {brandNameById.get(template.brand_id) ?? "Unknown brand"}
                            {mainCategory ? ` / ${mainCategory}` : ""}
                            {subCategory ? ` / ${subCategory}` : ""}
                          </span>
                          <span className="mt-1 block text-[11px] font-semibold text-zinc-500">
                            {template.item_code ?? template.template_code ?? "No code"}
                          </span>
                          <PriceCheckBadge compact template={template} />
                        </span>
                        <span className="shrink-0 text-right text-xs font-bold text-zinc-700">
                          {formatMoney(template.currency, numberValue(template.default_unit_price))}
                        </span>
                      </button>
                    );
                  })}

                  {!filteredTemplates.length ? (
                    <p className="border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
                      No products found. Try changing search or filters.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className={`min-h-0 overflow-y-auto bg-white ${selectedTemplate ? "" : ""}`}>
                {!selectedTemplate ? (
                  <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
                    Select a product to configure and add it.
                  </div>
                ) : null}
                {selectedTemplate ? [selectedTemplate].map((template) => {
                  const mainCategory = template.main_category_id
                    ? categoryNameById.get(template.main_category_id)
                    : null;
                  const subCategory = template.sub_category_id
                    ? categoryNameById.get(template.sub_category_id)
                    : null;
                  const templateComponents = componentsByTemplate.get(template.id) ?? [];
                  const sizePricingRows = activeSizePricingRows(template.desking_size_pricing);
                  const workstationCurrencies = Array.from(
                    new Set(sizePricingRows.map((row) => normalizeCurrency(row.currency ?? template.currency))),
                  );
                  const variantRows = activeVariantRows(template.variant_pricing);
                  const categoryRows = activeCategoryRows(template.category_pricing);
                  const modularRows = activeModularRows(template.category_pricing);
                  const modularDefaults = modularPricingDefaultsFromRows(template.category_pricing);
                  const accessoryGroups = activeAccessoryRows(template.accessory_pricing);
                  const templateLinkedFamilies = linkedFamiliesByParent.get(template.id) ?? [];
                  const usesWorkstationFlow = sizePricingRows.length > 0;
                  const usesVariantPricing = !usesWorkstationFlow && variantRows.length > 0;
                  const usesModularPricing = modularRows.length > 0;
                  const usesCategoryPricing = !usesVariantPricing && !usesModularPricing && categoryRows.length > 0;
                  const templatePricingAccessoryQuantities = pricingAccessoryQuantities[template.id] ?? {};
                  const templateModularQuantities = selectedModularQuantities[template.id] ?? {};
                  const selectedVariantRow =
                    usesVariantPricing
                      ? variantRows.find((row) => row.id === selectedVariantRows[template.id]) ??
                        variantRows[0] ??
                        null
                      : null;
                  const selectedWorkstationVariantRow =
                    usesWorkstationFlow
                      ? variantRows.find((row) => row.id === selectedVariantRows[template.id]) ?? null
                      : null;
                  const selectedCategoryRow =
                    usesCategoryPricing
                      ? categoryRows.find((row) => row.id === selectedCategoryRows[template.id]) ??
                        categoryRows[0] ??
                        null
                      : null;
                  const availableCategoryColumns = usesModularPricing
                    ? categoryPriceColumns(modularRows)
                    : categoryPriceColumns(template.category_pricing);
                  const selectedFabricCategory =
                    selectedFabricCategories[template.id] ?? availableCategoryColumns[0] ?? "Cat A";
                  const selectedCategoryPrice = selectedCategoryRow
                    ? numberValue(selectedCategoryRow.prices?.[selectedFabricCategory])
                    : 0;
                  const selectedModularItems = modularRows
                    .map((row) => {
                      const id = row.id ?? row.variant_name ?? row.display_name ?? "";
                      const qty = Math.max(0, Math.trunc(numberValue(templateModularQuantities[id])));
                      const price = numberValue(row.prices?.[selectedFabricCategory]);

                      return {
                        id,
                        qty,
                        row,
                        total: qty * price,
                        unitPrice: price,
                      };
                    })
                    .filter((line) => line.qty > 0);
                  const groupedOptions = new Map<string, ProductLibraryComponent[]>();
                  const templateSelections = selectedOptions[template.id] ?? {};
                  const additionalClusterQty = Math.max(
                    0,
                    Math.trunc(numberValue(additionalClusterQuantities[template.id], 0)),
                  );
                  const templateAccessoryQuantities = accessoryQuantities[template.id] ?? {};
                  const isDesking = usesWorkstationFlow || (!usesVariantPricing && !usesCategoryPricing && (
                    isDeskingTemplate({
                      mainCategory,
                      subCategory,
                      templateComponents,
                    })
                  ));
                  const selectedSizeRow =
                    sizePricingRows.find((row) => row.id === selectedDeskingSizes[template.id]) ??
                    sizePricingRows[0] ??
                    null;
                  const configuredDimension = usesModularPricing
                    ? configuredDimensions[template.id] ?? modularDefaults.defaultDimension ?? ""
                    : configuredDimensions[template.id] ?? selectedSizeRow?.default_dimension ?? selectedSizeRow?.label ?? "";
                  const configuredSpecification = usesWorkstationFlow
                    ? configuredSpecifications[template.id] ?? selectedSizeRow?.specification ?? template.default_specification ?? template.description ?? ""
                    : "";
                  const selectedWorkstationLayout = usesWorkstationFlow
                    ? (
                        selectedSizeRow?.layout_type === "Both"
                          ? selectedWorkstationLayouts[template.id] ?? "Linear"
                          : selectedSizeRow?.layout_type ?? "Linear"
                      )
                    : "";
                  const hasMixedWorkstationCurrencies = usesWorkstationFlow && workstationCurrencies.length > 1;
                  const missingRequiredWorkstationSelection = usesWorkstationFlow && !selectedSizeRow;
                  const missingRequiredModularSelection = usesModularPricing && selectedModularItems.length === 0;
                  const derivedDesking = isDesking && selectedSizeRow
                    ? deskingSizePricingCalculation({
                        accessoryQuantities: templateAccessoryQuantities,
                        additionalClusterQty,
                        configuredDimension,
                        selectedLayoutType: selectedWorkstationLayout,
                        selectedSize: selectedSizeRow,
                        template,
                        templateComponents,
                      })
                    : null;
                  const rowCurrency = derivedDesking?.mainCurrency ??
                    selectedModularItems[0]?.row.currency ??
                    selectedCategoryRow?.currency ??
                    selectedVariantRow?.currency ??
                    template.currency;
                  const selectedWorkstationVariantPrice = selectedWorkstationVariantRow
                    ? numberValue(selectedWorkstationVariantRow.price)
                    : 0;
                  const selectedPricingAccessories = accessoryGroups
                    .flatMap((group) =>
                      group.items.map((accessory) => {
                        const id = accessory.id ?? accessory.item_name ?? "";

                        return {
                          accessory,
                          groupName: group.group_name,
                          qty: Math.max(0, Math.trunc(numberValue(templatePricingAccessoryQuantities[id]))),
                        };
                      }),
                    )
                    .filter((line) => line.qty > 0);
                  const matchingAccessoryTotal = selectedPricingAccessories
                    .filter((line) => normalizeCurrency(line.accessory.currency ?? rowCurrency) === normalizeCurrency(rowCurrency))
                    .reduce((total, line) => total + line.qty * numberValue(line.accessory.price), 0);
                  const hasMixedAccessoryCurrencies = selectedPricingAccessories.some(
                    (line) => normalizeCurrency(line.accessory.currency ?? rowCurrency) !== normalizeCurrency(rowCurrency),
                  );
                  const previewUnitPrice =
                    (usesModularPricing
                      ? selectedModularItems.reduce((total, line) => total + line.total, 0)
                      : derivedDesking?.unitPrice ??
                      (selectedCategoryRow ? selectedCategoryPrice : undefined) ??
                      selectedVariantRow?.price ??
                      template.default_unit_price) +
                    selectedWorkstationVariantPrice +
                    matchingAccessoryTotal;
                  const selectedLinkedProducts = templateLinkedFamilies
                    .map((link) => {
                      const childTemplate = templateById.get(link.linked_template_id);
                      if (!childTemplate) return null;

                      const childCategoryRows = activeCategoryRows(childTemplate.category_pricing);
                      const childVariantRows = activeVariantRows(childTemplate.variant_pricing);
                      const childAccessoryGroups = activeAccessoryRows(childTemplate.accessory_pricing);
                      const childAccessoryQuantities = linkedAccessoryQuantities[link.id] ?? {};
                      const childCategoryRow =
                        childCategoryRows.find((row) => row.id === selectedLinkedCategories[link.id]) ??
                        childCategoryRows[0] ??
                        null;
                      const childVariantRow =
                        !childCategoryRow
                          ? childVariantRows.find((row) => row.id === selectedLinkedVariants[link.id]) ??
                            childVariantRows[0] ??
                            null
                          : null;
                      const childCategoryColumns = categoryPriceColumns(childTemplate.category_pricing);
                      const childCategory = selectedLinkedFabricCategories[link.id] ?? childCategoryColumns[0] ?? "Cat A";
                      const unitPrice = childCategoryRow
                        ? numberValue(childCategoryRow.prices?.[childCategory])
                        : childVariantRow
                          ? numberValue(childVariantRow.price)
                          : numberValue(childTemplate.default_unit_price);
                      const currency = childCategoryRow?.currency ?? childVariantRow?.currency ?? childTemplate.currency;
                      const qty = Math.max(0, Math.trunc(numberValue(
                        linkedProductQuantities[link.id],
                        numberValue(link.default_qty),
                      )));
                      const selectedAccessories = childAccessoryGroups
                        .flatMap((group) =>
                          group.items.map((accessory) => {
                            const id = accessory.id ?? accessory.item_name ?? "";
                            const accessoryQty = Math.max(0, Math.trunc(numberValue(childAccessoryQuantities[id])));

                            return {
                              accessory,
                              groupName: group.group_name,
                              id,
                              qty: accessoryQty,
                            };
                          }),
                        )
                        .filter((line) => line.qty > 0);
                      const baseLineTotal = qty * unitPrice;
                      const matchingAccessoryTotal = selectedAccessories
                        .filter((line) => normalizeCurrency(line.accessory.currency ?? currency) === normalizeCurrency(currency))
                        .reduce((total, line) => total + line.qty * numberValue(line.accessory.price), 0);
                      const accessoryTotal = selectedAccessories.reduce(
                        (total, line) => total + line.qty * numberValue(line.accessory.price),
                        0,
                      );
                      const hasMixedAccessoryCurrencies = selectedAccessories.some(
                        (line) => normalizeCurrency(line.accessory.currency ?? currency) !== normalizeCurrency(currency),
                      );

                      return {
                        accessoryTotal,
                        baseLineTotal,
                        childCategory,
                        childCategoryRow,
                        childAccessoryGroups,
                        childTemplate,
                        childVariantRow,
                        currency,
                        hasMixedAccessoryCurrencies,
                        link,
                        matchingAccessoryTotal,
                        qty,
                        selectedAccessories,
                        unitPrice,
                      };
                    })
                    .filter((line): line is NonNullable<typeof line> => Boolean(line));
                  const matchingLinkedProductTotal = selectedLinkedProducts
                    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
                    .filter((line) => normalizeCurrency(line.currency) === normalizeCurrency(rowCurrency))
                    .reduce((total, line) => total + line.baseLineTotal + line.matchingAccessoryTotal, 0);
                  const hasMixedLinkedProductCurrencies = selectedLinkedProducts
                    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
                    .some((line) =>
                      normalizeCurrency(line.currency) !== normalizeCurrency(rowCurrency) ||
                      line.selectedAccessories.some(
                        (accessoryLine) =>
                          normalizeCurrency(accessoryLine.accessory.currency ?? line.currency) !== normalizeCurrency(rowCurrency),
                      ),
                    );
                  const totalPreviewUnitPrice = previewUnitPrice + matchingLinkedProductTotal;
                  const baseProductPrice =
                    usesModularPricing
                      ? selectedModularItems.reduce((total, line) => total + line.total, 0)
                      : derivedDesking?.unitPrice ??
                        (selectedCategoryRow ? selectedCategoryPrice : undefined) ??
                        selectedVariantRow?.price ??
                        template.default_unit_price;
                  const originalCurrencyTotals = new Map<string, number>();
                  const addCurrencyTotal = (currency: string | undefined, amount: number) => {
                    const normalizedCurrency = normalizeCurrency(currency ?? "AED");
                    originalCurrencyTotals.set(
                      normalizedCurrency,
                      (originalCurrencyTotals.get(normalizedCurrency) ?? 0) + amount,
                    );
                  };

                  addCurrencyTotal(rowCurrency, baseProductPrice);
                  if (selectedWorkstationVariantRow) {
                    addCurrencyTotal(
                      selectedWorkstationVariantRow.currency ?? rowCurrency,
                      selectedWorkstationVariantPrice,
                    );
                  }
                  for (const line of selectedPricingAccessories) {
                    addCurrencyTotal(line.accessory.currency ?? rowCurrency, line.qty * numberValue(line.accessory.price));
                  }
                  for (const line of selectedLinkedProducts) {
                    if (line.qty > 0 && line.link.add_to_parent_price) {
                      addCurrencyTotal(line.currency, line.baseLineTotal);
                      for (const accessoryLine of line.selectedAccessories) {
                        addCurrencyTotal(
                          accessoryLine.accessory.currency ?? line.currency,
                          accessoryLine.qty * numberValue(accessoryLine.accessory.price),
                        );
                      }
                    }
                  }

                  const templateExchangeRates = exchangeRates[template.id] ?? {};
                  const nonAedCurrencies = Array.from(originalCurrencyTotals.keys())
                    .filter((currency) => currency !== "AED" && (originalCurrencyTotals.get(currency) ?? 0) > 0);
                  const missingExchangeRate = nonAedCurrencies.some(
                    (currency) => numberValue(templateExchangeRates[currency]) <= 0,
                  );
                  const convertedPreviewTotal = Array.from(originalCurrencyTotals.entries()).reduce(
                    (total, [currency, amount]) =>
                      currency === "AED"
                        ? total + amount
                        : total + amount * numberValue(templateExchangeRates[currency]),
                    0,
                  );
                  const previewCurrency = nonAedCurrencies.length ? "AED" : rowCurrency;
                  const rawPreviewUnitPriceWithConversion = nonAedCurrencies.length
                    ? convertedPreviewTotal
                    : totalPreviewUnitPrice;
                  const previewUnitPriceWithConversion = quotationMoneyValue(rawPreviewUnitPriceWithConversion);
                  const effectiveQuoteUnitPrice = quotationMoneyValue(
                    templatePriceOverrides[template.id] ?? previewUnitPriceWithConversion,
                  );
                  const previousQuotedPrice =
                    pendingPriceUpdateChoice?.templateId === template.id
                      ? pendingPriceUpdateChoice.previousUnitPrice
                      : null;
                  const pendingUpdatedPrice =
                    pendingPriceUpdateChoice?.templateId === template.id
                      ? quotationMoneyValue(previewUnitPriceWithConversion)
                      : null;
                  const needsUpdatedPriceDecision = pendingUpdatedPrice !== null &&
                    previousQuotedPrice !== null &&
                    Math.abs(pendingUpdatedPrice - previousQuotedPrice) > 0.009;
                  const selectedDiscountType = discountTypes[template.id] ?? "none";
                  const rawDiscountValue = Math.max(0, numberValue(discountValues[template.id], 0));
                  const selectedDiscountValue = selectedDiscountType === "percent"
                    ? Math.min(rawDiscountValue, 100)
                    : selectedDiscountType === "amount"
                      ? rawDiscountValue
                      : 0;
                  const unitDiscountAmount = quotationMoneyValue(
                    selectedDiscountType === "percent"
                      ? effectiveQuoteUnitPrice * selectedDiscountValue / 100
                      : selectedDiscountType === "amount"
                        ? selectedDiscountValue
                        : 0,
                  );
                  const netPricePreview = quotationMoneyValue(Math.max(effectiveQuoteUnitPrice - unitDiscountAmount, 0));
                  const netTotalPreview = quotationMoneyValue(netPricePreview);
                  const proposedImageFields = [
                    "proposed_image_url_1",
                    "proposed_image_url_2",
                    "proposed_image_url_3",
                    "proposed_image_url_4",
                    "proposed_image_url_5",
                    "proposed_image_url_6",
                    "proposed_image_url_7",
                    "proposed_image_url_8",
                    "proposed_image_url_9",
                    "proposed_image_url_10",
                    "proposed_image_url_11",
                    "proposed_image_url_12",
                    "proposed_image_url_13",
                    "proposed_image_url_14",
                    "proposed_image_url_15",
                    "proposed_image_url_16",
                    "proposed_image_url_17",
                    "proposed_image_url_18",
                    "proposed_image_url_19",
                    "proposed_image_url_20",
                  ] as const;
                  const availableProposedImages = proposedImageFields
                    .map((field) => ({
                      field,
                      label: `Image ${field.replace("proposed_image_url_", "")}`,
                      path:
                        field === "proposed_image_url_1"
                          ? template.proposed_image_url_1 ?? template.default_image_url
                          : template[field],
                    }))
                    .filter((image): image is { field: (typeof proposedImageFields)[number]; label: string; path: string } =>
                      Boolean(image.path),
                    );
                  const proposedImages = availableProposedImages.map((image) => image.path);
                  const selectedImage =
                    selectedImages[template.id] &&
                    proposedImages.includes(selectedImages[template.id])
                      ? selectedImages[template.id]
                      : proposedImages[0] ?? "";
                  const selectedImageField =
                    availableProposedImages.find((image) => image.path === selectedImage)?.field ??
                    null;
                  const selectedImageSettings = selectedImageField
                    ? template.image_settings?.[selectedImageField] ??
                      (selectedImageField === "proposed_image_url_1"
                        ? template.image_settings?.default_image_url
                        : undefined)
                    : undefined;
                  const localSelectedImagePath = normalizeProductImageSnapshotPath(selectedImage);
                  const templateMaterialLinks = templateMaterialGroups.filter((link) => link.product_template_id === template.id);
                  const templateMaterialLinkIds = new Set(templateMaterialLinks.map((link) => link.id));
                  const templateMaterialItems = templateMaterialGroupItems.filter((item) =>
                    templateMaterialLinkIds.has(item.product_template_material_group_id),
                  );
                  const selectedFinishes = selectedFinishesByTemplate[template.id] ?? [];

                  for (const component of templateComponents) {
                    const groupKey = `${component.option_type}:${component.component_group}`;
                    const groupOptions = groupedOptions.get(groupKey) ?? [];
                    groupOptions.push(component);
                    groupedOptions.set(groupKey, groupOptions);
                  }
                  const effectiveSelectedIds = Array.from(groupedOptions.entries()).flatMap(
                    ([groupKey, groupOptions]) => {
                      const [optionType] = groupKey.split(":");
                      const selectedValue = templateSelections[groupKey];
                      const selectableOptions = groupOptions.filter(
                        (option) => deskingRole(option) !== "accessory",
                      );
                      const accessoryIds = groupOptions
                        .filter(
                          (option) =>
                            deskingRole(option) === "accessory" ||
                            (isDesking && option.option_type === "linked_addon"),
                        )
                        .filter((option) => numberValue(templateAccessoryQuantities[option.id]) > 0)
                        .map((option) => option.id);

                      if (accessoryIds.length) {
                        const selectedId =
                          typeof selectedValue === "string"
                            ? selectedValue
                            : selectableOptions.find((option) => option.is_default_selected)?.id ??
                              (isDesking &&
                              selectableOptions.some((option) =>
                                ["base_size", "cluster_type"].includes(deskingRole(option)),
                              )
                                ? selectableOptions[0]?.id ?? ""
                                : "");

                        return selectedId ? [selectedId, ...accessoryIds] : accessoryIds;
                      }

                      if (optionType === "linked_addon") {
                        if (Array.isArray(selectedValue)) return selectedValue;

                        return selectableOptions
                          .filter((option) => option.is_default_selected)
                          .map((option) => option.id);
                      }

                      if (typeof selectedValue === "string") {
                        return selectedValue ? [selectedValue] : [];
                      }

                      const defaultOption =
                        selectableOptions.find((option) => option.is_default_selected) ??
                        (isDesking &&
                        selectableOptions.some((option) =>
                          ["base_size", "cluster_type"].includes(deskingRole(option)),
                        )
                          ? selectableOptions[0]
                          : undefined);

                      return defaultOption ? [defaultOption.id] : [];
                    },
                  );
                  const effectiveSelectedNames = effectiveSelectedIds
                    .map((id) => templateComponents.find((component) => component.id === id)?.component_name)
                    .filter(Boolean);
                  const selectedOptionSnapshots = effectiveSelectedIds
                    .map((id) => templateComponents.find((component) => component.id === id))
                    .filter((component): component is ProductLibraryComponent => Boolean(component))
                    .map((component) => ({
                      item_type: component.option_type ?? "component_option",
                      id: component.id,
                      group: component.component_group,
                      label: component.component_name,
                      specification: component.description ?? "",
                      component_code: component.component_code,
                      qty: numberValue(component.qty, 1),
                      unit_label: component.unit_label ?? "Pc",
                      price: numberValue(component.unit_price),
                      currency: normalizeCurrency(component.currency ?? template.currency),
                    }));
                  const hasMixedOptionCurrencies = effectiveSelectedIds
                    .map((id) => templateComponents.find((component) => component.id === id))
                    .filter(Boolean)
                    .some(
                      (option) =>
                        normalizeCurrency(option?.currency) !== normalizeCurrency(template.currency),
                    );
                  const accessorySnapshots = selectedPricingAccessories.map((line) => ({
                    item_type: "add_on",
                    group_name: line.groupName,
                    item_name: line.accessory.item_name,
                    qty: line.qty,
                    price: numberValue(line.accessory.price),
                    currency: normalizeCurrency(line.accessory.currency ?? rowCurrency),
                    supplier_price_list_code: line.accessory.supplier_price_list_code ?? null,
                    specification: line.accessory.specification ?? "",
                  }));
                  const linkedProductSnapshots = selectedLinkedProducts.map((line) => ({
                    item_type: "linked_product",
                    label: line.link.label,
                    template_name: line.childTemplate.template_name,
                    template_code: line.childTemplate.template_code,
                    selected_variant: line.childVariantRow?.variant_name ?? null,
                    selected_category: line.childCategoryRow ? line.childCategory : null,
                    dimension: line.childCategoryRow?.dimension ?? line.childVariantRow?.dimension ?? null,
                    supplier_price_list_code:
                      line.childCategoryRow?.supplier_price_list_code ??
                      line.childVariantRow?.supplier_price_list_code ??
                      null,
                    specification: line.childCategoryRow?.specification ?? line.childVariantRow?.specification ?? null,
                    qty: line.qty,
                    unit_price: line.unitPrice,
                    currency: normalizeCurrency(line.currency),
                    add_to_parent_price: line.link.add_to_parent_price,
                    append_to_specification: line.link.append_to_specification,
                    accessories: line.selectedAccessories.map((accessoryLine) => ({
                      group_name: accessoryLine.groupName,
                      item_name: accessoryLine.accessory.item_name,
                      qty: accessoryLine.qty,
                      price: numberValue(accessoryLine.accessory.price),
                      currency: normalizeCurrency(accessoryLine.accessory.currency ?? line.currency),
                      supplier_price_list_code: accessoryLine.accessory.supplier_price_list_code ?? null,
                    })),
                  }));
                  const sourceCurrencyTotals = Object.fromEntries(
                    Array.from(originalCurrencyTotals.entries()).map(([currency, amount]) => [
                      normalizeCurrency(currency),
                      quotationMoneyValue(amount),
                    ]),
                  );
                  const sourcePriceReference = {
                    original_source_price: originalCurrencyTotals.size === 1
                      ? Array.from(originalCurrencyTotals.values())[0]
                      : null,
                    original_source_currency: originalCurrencyTotals.size === 1
                      ? Array.from(originalCurrencyTotals.keys())[0]
                      : null,
                    original_source_totals: sourceCurrencyTotals,
                    source_price_type: derivedDesking
                      ? "desking_size_pricing"
                      : usesModularPricing
                        ? "modular_item_pricing"
                      : selectedCategoryRow
                        ? "category_pricing"
                        : selectedVariantRow
                          ? "variant_pricing"
                          : selectedOptionSnapshots.length
                            ? "component_options"
                            : "template_default",
                    source_price_label: derivedDesking?.sizeLabel ||
                      (usesModularPricing
                        ? `${selectedModularItems.length} modular items / ${selectedFabricCategory}`
                        : null) ||
                      pricingDisplayName(selectedCategoryRow) ||
                      pricingDisplayName(selectedVariantRow) ||
                      effectiveSelectedNames.join(", ") ||
                      template.template_name,
                    converted_quotation_price: effectiveQuoteUnitPrice,
                    quotation_currency: previewCurrency,
                  };
                  const originSnapshot = resolveProductOriginSnapshot(
                    template.origin,
                    brandOriginById.get(template.brand_id) ?? null,
                  );
                  const supplierNameSnapshot = template.supplier_name ?? null;
                  const companyStyleSpecification = buildCompanyStyleProductSpecification({
                    accessorySnapshots,
                    linkedProductSnapshots,
                    primarySpecification:
                      (usesWorkstationFlow ? configuredSpecification : null) ??
                      (usesModularPricing ? modularDefaults.defaultSpecification : null) ??
                      selectedCategoryRow?.specification ??
                      selectedVariantRow?.specification ??
                      null,
                    selectedOptionSnapshots,
                    selectedWorkstationVariant: selectedWorkstationVariantRow,
                    template: usesModularPricing
                      ? {
                          ...template,
                          default_specification:
                            modularDefaults.defaultSpecification ?? template.default_specification,
                        }
                      : template,
                  });
                  const localSpecification = resolveProductSpecificationSnapshot({
                    companyStyleSpecification,
                    selectedCategorySpecification:
                      (usesWorkstationFlow ? configuredSpecification : null) ??
                      (usesModularPricing ? modularDefaults.defaultSpecification : null) ??
                      selectedCategoryRow?.specification ??
                      null,
                    selectedVariantSpecification: selectedVariantRow?.specification ?? null,
                    selectedWorkstationVariantSpecification: selectedWorkstationVariantRow?.specification,
                    template: usesModularPricing
                      ? {
                          ...template,
                          default_specification:
                            modularDefaults.defaultSpecification ?? template.default_specification,
                        }
                      : template,
                  });
                  const localDimension = resolveProductDimensionSnapshot({
                    derivedDeskingDimension:
                      usesModularPricing || usesWorkstationFlow
                        ? configuredDimension
                        : derivedDesking?.dimension,
                    selectedSizeLabel: selectedSizeRow?.label,
                    selectedCategoryDimension: selectedCategoryRow?.dimension,
                    selectedVariantDimension: selectedVariantRow?.dimension,
                    selectedWorkstationVariantDimension: selectedWorkstationVariantRow?.dimension ?? null,
                  });
                  const selectedSupplierPriceListCode =
                    (usesModularPricing
                      ? selectedModularItems
                          .map((line) => line.row.supplier_price_list_code?.trim() || "")
                          .filter(Boolean)
                          .join(", ")
                      : null) ||
                    (usesWorkstationFlow && selectedSizeRow
                      ? [
                          selectedSizeRow.base_supplier_price_list_code?.trim() || selectedSizeRow.supplier_price_list_code?.trim() || "",
                          selectedSizeRow.additional_supplier_price_list_code?.trim() || "",
                        ].filter(Boolean).join(", ")
                      : null) ||
                    selectedCategoryRow?.supplier_price_list_code?.trim() ||
                    selectedVariantRow?.supplier_price_list_code?.trim() ||
                    selectedSizeRow?.supplier_price_list_code?.trim() ||
                    selectedWorkstationVariantRow?.supplier_price_list_code?.trim() ||
                    null;
                  const modularItemSnapshots = selectedModularItems.map((line) => ({
                    item_type: "modular_item",
                    label: pricingDisplayName(line.row) || line.row.variant_name || "Modular item",
                    item_name: pricingDisplayName(line.row) || line.row.variant_name || "Modular item",
                    selected_category: selectedFabricCategory,
                    supplier_price_list_code: line.row.supplier_price_list_code ?? null,
                    specification: line.row.specification ?? "",
                    dimension: line.row.dimension ?? null,
                    qty: line.qty,
                    unit_price: quotationMoneyValue(line.unitPrice),
                    total: quotationMoneyValue(line.total),
                    currency: normalizeCurrency(line.row.currency ?? rowCurrency),
                  }));
                  const localProductItem: LocalQuotationItem = {
                    id: createLocalId("item"),
                    quotation_id: quotationId,
                    section_id: sectionId,
                    item_type: "product",
                    source_template_id: template.id,
                    source_component_data: {
                      template_code: template.template_code,
                      template_name: template.template_name,
                      brand_name: brandNameById.get(template.brand_id) ?? null,
                      brand: brandNameById.get(template.brand_id) ?? null,
                      brand_id: template.brand_id,
                      origin: originSnapshot,
                      origin_country: originSnapshot,
                      country_of_origin: originSnapshot,
                      supplier_name: supplierNameSnapshot,
                      supplier: supplierNameSnapshot,
                      supplier_price_list_code: selectedSupplierPriceListCode,
                      specification: localSpecification,
                      description: template.description ?? null,
                      default_specification:
                        (usesWorkstationFlow ? configuredSpecification : null) ??
                        (usesModularPricing ? modularDefaults.defaultSpecification : null) ??
                        template.default_specification ??
                        null,
                      dimension: localDimension,
                      dimensions: localDimension,
                      size_label: localDimension,
                      default_image_url: template.default_image_url,
                      reference_image_url: template.reference_image_url,
                      proposed_image_url_1: template.proposed_image_url_1,
                      proposed_image_url_2: template.proposed_image_url_2,
                      proposed_image_url_3: template.proposed_image_url_3,
                      proposed_image_url_4: template.proposed_image_url_4,
                      proposed_image_url_5: template.proposed_image_url_5,
                      proposed_image_url_6: template.proposed_image_url_6,
                      proposed_image_url_7: template.proposed_image_url_7,
                      proposed_image_url_8: template.proposed_image_url_8,
                      proposed_image_url_9: template.proposed_image_url_9,
                      proposed_image_url_10: template.proposed_image_url_10,
                      proposed_image_url_11: template.proposed_image_url_11,
                      proposed_image_url_12: template.proposed_image_url_12,
                      proposed_image_url_13: template.proposed_image_url_13,
                      proposed_image_url_14: template.proposed_image_url_14,
                      proposed_image_url_15: template.proposed_image_url_15,
                      proposed_image_url_16: template.proposed_image_url_16,
                      proposed_image_url_17: template.proposed_image_url_17,
                      proposed_image_url_18: template.proposed_image_url_18,
                      proposed_image_url_19: template.proposed_image_url_19,
                      proposed_image_url_20: template.proposed_image_url_20,
                      selected_proposed_image_url: selectedImage || null,
                      selected_option_ids: effectiveSelectedIds,
                      selected_options: effectiveSelectedNames,
                      selected_options_snapshot: usesModularPricing
                        ? modularItemSnapshots
                        : selectedOptionSnapshots,
                      source_price_reference: sourcePriceReference,
                      ...(derivedDesking
                        ? {
                            desking: {
                              size_label: derivedDesking.sizeLabel,
                              cluster_label: derivedDesking.clusterLabel,
                              dimension: derivedDesking.dimension,
                              configured_dimension: configuredDimension || null,
                              default_dimension: selectedSizeRow?.default_dimension ?? null,
                              default_specification: selectedSizeRow?.specification ?? null,
                              layout_type: selectedWorkstationLayout || null,
                              total_modules: derivedDesking.totalModules,
                              total_seats: derivedDesking.totalSeats,
                              default_price: derivedDesking.basePrice,
                              additional_price: derivedDesking.additionalPrice,
                              base_supplier_price_list_code:
                                derivedDesking.baseSupplierPriceListCode,
                              additional_supplier_price_list_code:
                                derivedDesking.additionalSupplierPriceListCode,
                              additional_qty: derivedDesking.additionalClusterQty,
                              accessory_price: derivedDesking.accessoryPrice,
                              final_price: derivedDesking.unitPrice,
                              formula: derivedDesking.formula,
                            },
                          }
                        : {}),
                      ...(selectedVariantRow ? { variant_pricing: selectedVariantRow } : {}),
                      ...(selectedCategoryRow
                        ? {
                            category_pricing: {
                              selected_row: selectedCategoryRow,
                              selected_category: selectedFabricCategory,
                              selected_price: selectedCategoryPrice,
                            },
                          }
                        : {}),
                      ...(usesModularPricing
                        ? {
                            modular_pricing: {
                              configured_dimension: configuredDimension || null,
                              default_dimension: modularDefaults.defaultDimension,
                              default_specification: modularDefaults.defaultSpecification,
                              selected_category: selectedFabricCategory,
                              items: modularItemSnapshots,
                            },
                          }
                        : {}),
                      ...(accessorySnapshots.length
                        ? {
                            add_ons: {
                              groups: accessoryGroups
                                .map((group) => ({
                                  group_name: group.group_name,
                                  items: accessorySnapshots.filter((snapshot) => snapshot.group_name === group.group_name),
                                }))
                                .filter((group) => group.items.length > 0),
                              matching_currency_total: matchingAccessoryTotal,
                              mixed_currency_warning: hasMixedAccessoryCurrencies,
                            },
                          }
                        : {}),
                      ...(linkedProductSnapshots.length
                        ? {
                            linked_products: {
                              items: linkedProductSnapshots,
                              matching_currency_total: matchingLinkedProductTotal,
                              mixed_currency_warning: hasMixedLinkedProductCurrencies,
                            },
                          }
                        : {}),
                      ...(nonAedCurrencies.length
                        ? {
                            currency_conversion: {
                              exchange_rates: templateExchangeRates,
                              source_totals: sourceCurrencyTotals,
                              converted_total_aed: effectiveQuoteUnitPrice,
                            },
                          }
                        : {}),
                    },
                    manual_serial: null,
                    item_code_snapshot: template.item_code ?? template.template_code,
                    item_name_snapshot: template.template_name,
                    brand_name_snapshot: brandNameById.get(template.brand_id) ?? null,
                    category_name_snapshot: [mainCategory, subCategory].filter(Boolean).join(" / ") || null,
                    specified_image_url_snapshot: null,
                    proposed_image_url_snapshot: localSelectedImagePath || null,
                    specification_snapshot: localSpecification,
                    finish_selections_snapshot: selectedFinishes,
                    selected_options_snapshot: [
                      ...(usesModularPricing ? modularItemSnapshots : selectedOptionSnapshots),
                      ...accessorySnapshots,
                      ...linkedProductSnapshots,
                    ],
                    internal_components_snapshot: linkedProductSnapshots,
                    room_name_snapshot: null,
                    model_snapshot:
                      usesModularPricing
                        ? (selectedModularItems.length ? `${selectedModularItems.length} modular items` : null)
                        : selectedCategoryRow?.variant_name || selectedVariantRow?.variant_name || null,
                    finish_snapshot: finishSnapshotValue(selectedFinishes),
                    size_snapshot: localDimension,
                    origin_snapshot: originSnapshot,
                    warranty_snapshot: null,
                    supplier_name_snapshot: supplierNameSnapshot,
                    supplier_notes_snapshot: null,
                    allow_material_continuation_page: false,
                    qty: 1,
                    unit_label: template.unit_label ?? "Pc",
                    unit_price: effectiveQuoteUnitPrice,
                    discount_type: selectedDiscountType === "percent" ? "percent" : "amount",
                    discount_value: selectedDiscountType === "none" ? 0 : selectedDiscountValue,
                    net_price: netPricePreview,
                    net_total: netTotalPreview,
                    currency: previewCurrency,
                    sort_order: 0,
                    is_optional: false,
                    internal_cost: 0,
                    margin_type: "amount",
                    margin_value: 0,
                    is_rate_only: false,
                    line_style: "normal",
                    row_height: null,
                    cell_layout: selectedImageSettings
                      ? { images: { proposed_image_url_snapshot: selectedImageSettings } }
                      : {},
                    is_active: true,
                    notes: null,
                    created_at: localNow(),
                    updated_at: localNow(),
                    source_item_id: null,
                  };
                  const mainItemCurrency = normalizeCurrency(
                    usesWorkstationFlow
                      ? selectedSizeRow?.currency ?? rowCurrency
                      : rowCurrency,
                  );
                  const mainItemUnitPrice = quotationMoneyValue(
                    usesWorkstationFlow
                      ? numberValue(selectedSizeRow?.default_price)
                      : baseProductPrice,
                  );
                  const mainItemLabel = usesWorkstationFlow
                    ? selectedSizeRow?.label ?? selectedSizeRow?.id ?? template.template_name
                    : usesModularPricing
                      ? template.template_name
                    : selectedCategoryRow
                      ? `${pricingDisplayName(selectedCategoryRow)} / ${selectedFabricCategory}`
                      : pricingDisplayName(selectedVariantRow) || template.template_name;
                  const mainItemDimension = usesWorkstationFlow
                    ? selectedSizeRow?.label ?? derivedDesking?.dimension ?? null
                    : usesModularPricing
                      ? localDimension
                    : selectedCategoryRow?.dimension ?? selectedVariantRow?.dimension ?? localDimension;
                  const additionalClusterLine =
                    usesWorkstationFlow && selectedSizeRow && additionalClusterQty > 0
                      ? {
                          currency: normalizeCurrency(selectedSizeRow.currency ?? rowCurrency),
                          label: `Additional ${derivedDesking?.clusterName ?? "CL2"}`,
                          qty: additionalClusterQty,
                          total: quotationMoneyValue(numberValue(selectedSizeRow.additional_price) * additionalClusterQty),
                          unitPrice: quotationMoneyValue(numberValue(selectedSizeRow.additional_price)),
                        }
                      : null;
                  const workstationOptionalLine = selectedWorkstationVariantRow
                    ? {
                        currency: normalizeCurrency(selectedWorkstationVariantRow.currency ?? rowCurrency),
                        detail: selectedWorkstationVariantRow.dimension ?? selectedWorkstationVariantRow.specification ?? null,
                        label: pricingDisplayName(selectedWorkstationVariantRow) || selectedWorkstationVariantRow.variant_name || "Optional item",
                        supplierCode: selectedWorkstationVariantRow.supplier_price_list_code ?? null,
                        qty: 1,
                        total: quotationMoneyValue(selectedWorkstationVariantPrice),
                        unitPrice: quotationMoneyValue(selectedWorkstationVariantPrice),
                      }
                    : null;
                  const pricingAccessorySummary = selectedPricingAccessories.map((line) => ({
                    currency: normalizeCurrency(line.accessory.currency ?? rowCurrency),
                    detail: line.accessory.specification ?? line.groupName,
                    label: line.accessory.item_name || "Accessory",
                    supplierCode: line.accessory.supplier_price_list_code ?? null,
                    qty: line.qty,
                    total: quotationMoneyValue(line.qty * numberValue(line.accessory.price)),
                    unitPrice: quotationMoneyValue(numberValue(line.accessory.price)),
                  }));
                  const modularSummary = selectedModularItems.map((line) => ({
                    currency: normalizeCurrency(line.row.currency ?? rowCurrency),
                    detail: [line.row.supplier_price_list_code, line.row.dimension].filter(Boolean).join(" / ") || null,
                    label: pricingDisplayName(line.row) || line.row.variant_name || "Modular item",
                    supplierCode: line.row.supplier_price_list_code ?? null,
                    qty: line.qty,
                    total: quotationMoneyValue(line.total),
                    unitPrice: quotationMoneyValue(line.unitPrice),
                  }));
                  const linkedProductSummary = selectedLinkedProducts
                    .filter((line) => line.qty > 0)
                    .map((line) => ({
                      currency: normalizeCurrency(line.currency),
                      detail: [
                        pricingDisplayName(line.childVariantRow) ||
                          (line.childCategoryRow ? `${pricingDisplayName(line.childCategoryRow)} / ${line.childCategory}` : null),
                        line.childCategoryRow?.dimension ?? line.childVariantRow?.dimension ?? null,
                      ]
                        .filter(Boolean)
                        .join(" - "),
                      label: line.childTemplate.template_name,
                      supplierCode:
                        line.childCategoryRow?.supplier_price_list_code ??
                        line.childVariantRow?.supplier_price_list_code ??
                        null,
                      qty: line.qty,
                      total: quotationMoneyValue(line.baseLineTotal),
                      unitPrice: quotationMoneyValue(line.unitPrice),
                    }));
                  const linkedAccessorySummary = selectedLinkedProducts.flatMap((line) =>
                    line.qty > 0
                      ? line.selectedAccessories.map((accessoryLine) => ({
                          currency: normalizeCurrency(accessoryLine.accessory.currency ?? line.currency),
                          detail: line.childTemplate.template_name,
                          label: accessoryLine.accessory.item_name || "Accessory",
                          supplierCode: accessoryLine.accessory.supplier_price_list_code ?? null,
                          qty: accessoryLine.qty,
                          total: quotationMoneyValue(accessoryLine.qty * numberValue(accessoryLine.accessory.price)),
                          unitPrice: quotationMoneyValue(numberValue(accessoryLine.accessory.price)),
                        }))
                      : [],
                  );
                  const selectedFinishSummary = selectedFinishes
                    .filter((finish) => Boolean(
                      finish.finish_code ||
                      finish.finish_name ||
                      finish.finish_description,
                    ))
                    .map((finish) => finishSelectionLabel(finish));
                  const sourceTotalsList = Array.from(originalCurrencyTotals.entries())
                    .filter(([, amount]) => amount > 0)
                    .map(([currency, amount]) => ({
                      amount: quotationMoneyValue(amount),
                      currency: normalizeCurrency(currency),
                    }));
                  const specificationPreviewLines = [
                    localSpecification || null,
                    localDimension ? `Dimension: ${localDimension}` : null,
                  ].filter(Boolean);

                  return (
                    <article
                      key={template.id}
                      className="min-h-full bg-zinc-50"
                    >
                      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-4 shadow-sm lg:px-6">
                        <button
                          type="button"
                          onClick={() => setSelectedTemplateId("")}
                          className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
                        >
                          {"< Back to products"}
                        </button>
                        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                          Product Library / {brandNameById.get(template.brand_id) ?? "Unknown brand"}
                          {mainCategory ? ` / ${mainCategory}` : ""}
                          {subCategory ? ` / ${subCategory}` : ""}
                          {` / ${templateSelectionName(template)}`}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold text-zinc-950">
                            {templateSelectionName(template)}
                          </h3>
                          {template.internal_selection_name ? (
                            <p className="text-sm font-medium text-zinc-500">
                              Quote name: {template.template_name}
                            </p>
                          ) : null}
                          <PriceCheckBadge template={template} />
                        </div>
                      </div>
                      <form
                        action={addProductTemplateToQuotation}
                        className="grid gap-4 p-4 lg:p-6 xl:grid-cols-[minmax(0,1fr)_320px]"
                      >
                        <div className="min-w-0 space-y-4">
                          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                            <div className="grid gap-4 sm:grid-cols-[80px_minmax(0,1fr)]">
                              <div className="flex justify-center sm:justify-start">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const selectedIndex = availableProposedImages.findIndex((image) => image.path === selectedImage);
                                    if (selectedIndex >= 0) {
                                      setImagePreview({ templateId: template.id, imageIndex: selectedIndex });
                                    }
                                  }}
                                  className="rounded-md text-left transition hover:opacity-90"
                                  disabled={!selectedImage}
                                >
                                  <ProductThumbnail path={selectedImage || null} selected />
                                </button>
                              </div>
                              <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-zinc-950">
                            {templateSelectionName(template)}
                          </h3>
                          {template.internal_selection_name ? (
                            <span className="text-xs font-medium text-zinc-500">
                              Quote name: {template.template_name}
                            </span>
                          ) : null}
                          {template.item_code ? (
                            <span className="border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                              {template.item_code}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {brandNameById.get(template.brand_id) ?? "Unknown brand"}
                          {mainCategory ? ` / ${mainCategory}` : ""}
                          {subCategory ? ` / ${subCategory}` : ""}
                        </p>
                        {canManageProductLibrary ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => {
                                setTemplateActionMessageById((current) => ({
                                  ...current,
                                  [template.id]: "",
                                }));
                                setTemplateEditor({
                                  currentPreviewUnitPrice: effectiveQuoteUnitPrice,
                                  mode: "edit",
                                  templateId: template.id,
                                });
                              }}
                              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900"
                            >
                              Edit Template
                            </button>
                          </div>
                        ) : null}
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                          {template.default_specification ??
                            template.description ??
                            "No specification yet."}
                        </p>
                                {proposedImages.length ? (
                                  <div className="mt-3">
                                    <p className="text-[10px] font-bold uppercase text-zinc-500">
                                      Proposed Item Reference Images
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                              {proposedImages.map((imagePath, imageIndex) => (
                                <div key={`${imagePath}-${imageIndex}`} className="text-left">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedImages((current) => ({
                                        ...current,
                                        [template.id]: imagePath,
                                      }))
                                    }
                                    className="block"
                                  >
                                    <ProductThumbnail
                                      label={`Image ${imageIndex + 1}`}
                                      path={imagePath}
                                      selected={selectedImage === imagePath}
                                    />
                                  </button>
                                  <span className="mt-1 block text-center text-[10px] font-semibold text-zinc-500">
                                    Image {imageIndex + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setImagePreview({ templateId: template.id, imageIndex })}
                                    className="mt-1 block w-full text-center text-[10px] font-semibold text-emerald-900 transition hover:text-emerald-700"
                                  >
                                    View larger
                                  </button>
                                </div>
                              ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </section>
                          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                                  Configuration
                                </p>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  Configure size, pricing, accessories, linked items, and required selections.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-4">
                        {usesWorkstationFlow ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              1. Select workstation size / base price
                            </p>
                            <p className="text-xs leading-5 text-zinc-500">
                              This is the main workstation base price.
                            </p>
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">
                                Workstation Size / Base Price
                              </span>
                              <select
                                value={selectedSizeRow?.id ?? ""}
                                onChange={(event) =>
                                  setSelectedDeskingSizes((current) => ({
                                    ...current,
                                    [template.id]: event.target.value,
                                  }))
                                }
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              >
                                {sizePricingRows.map((row, index) => (
                                  <option key={row.id ?? index} value={row.id ?? `size-${index}`}>
                                    {row.label ?? `${row.length} x ${row.depth} x ${row.height}`} - {formatMoney(row.currency ?? template.currency, numberValue(row.default_price))}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {selectedSizeRow ? (
                              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-700">
                                <p>Layout type: {selectedWorkstationLayout || selectedSizeRow.layout_type || "Linear"}</p>
                                <p>
                                  Base price: {formatMoney(selectedSizeRow.currency ?? template.currency, numberValue(selectedSizeRow.default_price))}
                                </p>
                                {selectedSizeRow.base_supplier_price_list_code || selectedSizeRow.supplier_price_list_code ? (
                                  <p>Base supplier code: {selectedSizeRow.base_supplier_price_list_code || selectedSizeRow.supplier_price_list_code}</p>
                                ) : null}
                                <p>
                                  Additional CL2 price: {formatMoney(selectedSizeRow.currency ?? template.currency, numberValue(selectedSizeRow.additional_price))}
                                </p>
                                {selectedSizeRow.additional_supplier_price_list_code ? (
                                  <p>Additional supplier code: {selectedSizeRow.additional_supplier_price_list_code}</p>
                                ) : null}
                                {selectedSizeRow.specification ? <p>{selectedSizeRow.specification}</p> : null}
                                {selectedSizeRow.default_dimension ? <p>Default dimension: {selectedSizeRow.default_dimension}</p> : null}
                              </div>
                            ) : null}
                            {hasMixedWorkstationCurrencies ? (
                              <p className="text-xs leading-5 text-amber-700">
                                Mixed currencies detected. Review conversion before adding.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {usesWorkstationFlow && selectedSizeRow ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {selectedSizeRow.layout_type === "Both" ? (
                              <label className="block">
                                <span className="text-[10px] font-bold uppercase text-zinc-500">Layout Type</span>
                                <select
                                  value={selectedWorkstationLayout}
                                  onChange={(event) => setSelectedWorkstationLayouts((current) => ({ ...current, [template.id]: event.target.value }))}
                                  className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                >
                                  <option value="Linear">Linear</option>
                                  <option value="Cluster">Cluster</option>
                                </select>
                              </label>
                            ) : (
                              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                                <p className="font-semibold text-zinc-900">Layout Type</p>
                                <p>{selectedWorkstationLayout}</p>
                              </div>
                            )}
                            <label className="block md:col-span-2">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">Workstation Specification</span>
                              <textarea
                                value={configuredSpecification}
                                onChange={(event) => setConfiguredSpecifications((current) => ({ ...current, [template.id]: event.target.value }))}
                                rows={4}
                                className="mt-1 w-full border border-zinc-300 bg-white px-2 py-2 text-xs outline-none focus:border-emerald-800"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">Configured Dimension</span>
                              <input
                                value={configuredDimension}
                                onChange={(event) => setConfiguredDimensions((current) => ({ ...current, [template.id]: event.target.value }))}
                                placeholder="e.g. 240x120x75 cmH"
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              />
                            </label>
                          </div>
                        ) : null}
                        {usesWorkstationFlow ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              2. Additional CL2 quantity
                            </p>
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">
                                Additional CL2 Quantity
                              </span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={additionalClusterQty}
                                onChange={(event) =>
                                  setAdditionalClusterQuantities((current) => ({
                                    ...current,
                                    [template.id]: Math.max(
                                      0,
                                      Math.trunc(Number(event.target.value) || 0),
                                    ),
                                  }))
                                }
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              />
                            </label>
                            {selectedSizeRow ? (
                              <p className="text-xs leading-5 text-zinc-500">
                                {formatMoney(selectedSizeRow.currency ?? template.currency, numberValue(selectedSizeRow.default_price))}
                                {" + ("}
                                {formatMoney(selectedSizeRow.currency ?? template.currency, numberValue(selectedSizeRow.additional_price))}
                                {" x "}
                                {additionalClusterQty}
                                {`) = ${formatMoney(selectedSizeRow.currency ?? template.currency, numberValue(selectedSizeRow.default_price) + numberValue(selectedSizeRow.additional_price) * additionalClusterQty)}`}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {usesCategoryPricing ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">Variant</span>
                              <select
                                value={selectedCategoryRow?.id ?? ""}
                                onChange={(event) => setSelectedCategoryRows((current) => ({ ...current, [template.id]: event.target.value }))}
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              >
                                {categoryRows.map((row, index) => (
                                  <option key={row.id ?? index} value={row.id ?? `category-${index}`}>
                                    {pricingOptionLabel({
                                      currency: row.currency ?? template.currency,
                                      dimension: row.dimension,
                                      displayName: pricingDisplayName(row),
                                    })}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">Fabric / Leather Category</span>
                              <select
                                value={selectedFabricCategory}
                                onChange={(event) => setSelectedFabricCategories((current) => ({ ...current, [template.id]: event.target.value }))}
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              >
                                {availableCategoryColumns.map((category) => (
                                  <option key={category} value={category}>
                                    {category} {selectedCategoryRow ? `- ${formatMoney(selectedCategoryRow.currency ?? template.currency, numberValue(selectedCategoryRow.prices?.[category]))}` : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {selectedCategoryRow ? (
                              <div className="md:col-span-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                                <p className="text-xs font-semibold text-zinc-900">
                                  {pricingDisplayName(selectedCategoryRow) || selectedCategoryRow.variant_name}
                                </p>
                                <InternalMetaLine label="Dimension" value={selectedCategoryRow.dimension} />
                                <InternalMetaLine
                                  label="Price"
                                  value={formatMoney(selectedCategoryRow.currency ?? template.currency, numberValue(selectedCategoryRow.prices?.[selectedFabricCategory]))}
                                />
                                <InternalMetaLine
                                  label="Variant Code"
                                  value={selectedCategoryRow.variant_name && pricingDisplayName(selectedCategoryRow) !== selectedCategoryRow.variant_name ? selectedCategoryRow.variant_name : null}
                                />
                                <InternalMetaLine label="Supplier Code" value={selectedCategoryRow.supplier_price_list_code} />
                                <InternalMetaLine label="Specification" value={selectedCategoryRow.specification} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {usesModularPricing ? (
                          <div className="mt-3 space-y-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              Modular Configurator
                            </p>
                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="block">
                                <span className="text-[10px] font-bold uppercase text-zinc-500">Fabric / Category</span>
                                <select
                                  value={selectedFabricCategory}
                                  onChange={(event) => setSelectedFabricCategories((current) => ({ ...current, [template.id]: event.target.value }))}
                                  className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                >
                                  {availableCategoryColumns.map((category) => (
                                    <option key={category} value={category}>{category}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-[10px] font-bold uppercase text-zinc-500">Configured Dimension</span>
                                <input
                                  value={configuredDimension}
                                  onChange={(event) => setConfiguredDimensions((current) => ({ ...current, [template.id]: event.target.value }))}
                                  placeholder="e.g. 540x70x78 cmH"
                                  className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                />
                              </label>
                            </div>
                            {modularDefaults.defaultSpecification ? (
                              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                                <p className="font-semibold text-zinc-950">Default modular specification</p>
                                <p className="mt-1 whitespace-pre-wrap">{modularDefaults.defaultSpecification}</p>
                              </div>
                            ) : null}
                            <div className="space-y-2">
                              {modularRows.map((row) => {
                                const modularRowId = row.id ?? row.variant_name ?? row.display_name ?? "";
                                const modularQty = templateModularQuantities[modularRowId] ?? 0;
                                const modularUnitPrice = numberValue(row.prices?.[selectedFabricCategory]);
                                return (
                                  <div key={modularRowId} className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-[minmax(0,1fr)_100px]">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-zinc-950">
                                        {pricingDisplayName(row) || row.variant_name || "Modular item"}
                                      </p>
                                      <div className="mt-1 space-y-1 text-xs leading-5 text-zinc-600">
                                        {row.variant_name && pricingDisplayName(row) !== row.variant_name ? (
                                          <p>Module code: {row.variant_name}</p>
                                        ) : null}
                                        {row.supplier_price_list_code ? <p>Supplier code: {row.supplier_price_list_code}</p> : null}
                                        {row.dimension ? <p>Dimension: {row.dimension}</p> : null}
                                        <p>Price: {formatMoney(row.currency ?? template.currency, modularUnitPrice)}</p>
                                        {row.specification ? <p>{row.specification}</p> : null}
                                      </div>
                                    </div>
                                    <label className="block">
                                      <span className="text-[10px] font-bold uppercase text-zinc-500">Qty</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={modularQty}
                                        onChange={(event) =>
                                          setSelectedModularQuantities((current) => ({
                                            ...current,
                                            [template.id]: {
                                              ...(current[template.id] ?? {}),
                                              [modularRowId]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                                            },
                                          }))
                                        }
                                        className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-right text-xs outline-none focus:border-emerald-800"
                                      />
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {usesVariantPricing ? (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              Base Size / Main Price
                            </p>
                            <label className="block">
                              <span className="text-[10px] font-bold uppercase text-zinc-500">Select size / model</span>
                              <select
                                value={selectedVariantRow?.id ?? ""}
                                onChange={(event) => setSelectedVariantRows((current) => ({ ...current, [template.id]: event.target.value }))}
                                className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              >
                                  {variantRows.map((row, index) => (
                                    <option key={row.id ?? index} value={row.id ?? `variant-${index}`}>
                                      {pricingOptionLabel({
                                        currency: row.currency ?? template.currency,
                                        dimension: row.dimension,
                                        displayName: pricingDisplayName(row),
                                        price: numberValue(row.price),
                                      })}
                                    </option>
                                  ))}
                                </select>
                              {selectedVariantRow ? (
                                <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                                  <p className="text-xs font-semibold text-zinc-900">
                                    {pricingDisplayName(selectedVariantRow) || selectedVariantRow.variant_name}
                                  </p>
                                  <InternalMetaLine label="Dimension" value={selectedVariantRow.dimension} />
                                  <InternalMetaLine
                                    label="Price"
                                    value={formatMoney(selectedVariantRow.currency ?? template.currency, numberValue(selectedVariantRow.price))}
                                  />
                                  <InternalMetaLine
                                    label="Variant Code"
                                    value={selectedVariantRow.variant_name && pricingDisplayName(selectedVariantRow) !== selectedVariantRow.variant_name ? selectedVariantRow.variant_name : null}
                                  />
                                  <InternalMetaLine label="Supplier Code" value={selectedVariantRow.supplier_price_list_code} />
                                  <InternalMetaLine label="Specification" value={selectedVariantRow.specification} />
                                </div>
                              ) : null}
                            </label>
                          </div>
                        ) : null}
                        {usesWorkstationFlow && (variantRows.length || accessoryGroups.length) ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              3. Accessories / Optional Items
                            </p>
                            {variantRows.length ? (
                              <label className="block">
                                <span className="text-[10px] font-bold uppercase text-zinc-500">
                                  Optional Item / Variant Pricing
                                </span>
                                <select
                                  value={selectedWorkstationVariantRow?.id ?? ""}
                                  onChange={(event) =>
                                    setSelectedVariantRows((current) => ({
                                      ...current,
                                      [template.id]: event.target.value,
                                    }))
                                  }
                                  className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                >
                                  <option value="">No optional item</option>
                                  {variantRows.map((row, index) => (
                                    <option key={row.id ?? index} value={row.id ?? `workstation-variant-${index}`}>
                                      {pricingOptionLabel({
                                        currency: row.currency ?? template.currency,
                                        dimension: row.dimension,
                                        displayName: pricingDisplayName(row),
                                        price: numberValue(row.price),
                                      })}
                                    </option>
                                  ))}
                                </select>
                                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                  Optional workstation add-ons stay separate from the base workstation size.
                                </span>
                                {selectedWorkstationVariantRow ? (
                                  <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                                    <p className="text-xs font-semibold text-zinc-900">
                                      {pricingDisplayName(selectedWorkstationVariantRow) || selectedWorkstationVariantRow.variant_name}
                                    </p>
                                    <InternalMetaLine label="Dimension" value={selectedWorkstationVariantRow.dimension} />
                                    <InternalMetaLine
                                      label="Price"
                                      value={formatMoney(selectedWorkstationVariantRow.currency ?? template.currency, numberValue(selectedWorkstationVariantRow.price))}
                                    />
                                    <InternalMetaLine
                                      label="Variant Code"
                                      value={selectedWorkstationVariantRow.variant_name && pricingDisplayName(selectedWorkstationVariantRow) !== selectedWorkstationVariantRow.variant_name ? selectedWorkstationVariantRow.variant_name : null}
                                    />
                                    <InternalMetaLine label="Supplier Code" value={selectedWorkstationVariantRow.supplier_price_list_code} />
                                    <InternalMetaLine label="Specification" value={selectedWorkstationVariantRow.specification} />
                                  </div>
                                ) : null}
                              </label>
                            ) : null}
                            {accessoryGroups.length ? (
                              <div className="space-y-2">
                                {accessoryGroups.map((group) => (
                                  <fieldset key={group.id} className="border border-zinc-200 bg-zinc-50 p-2">
                                    <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                      {group.group_name}
                                    </legend>
                                    <div className="mt-1 space-y-2">
                                      {group.items.map((accessory) => {
                                        const id = accessory.id ?? accessory.item_name ?? "";
                                        const qty = templatePricingAccessoryQuantities[id] ?? 0;

                                        return (
                                          <label key={id} className="grid gap-2 text-xs text-zinc-700 sm:grid-cols-[1fr_auto_80px] sm:items-center">
                                            <span className="min-w-0">
                                              <input
                                                type="checkbox"
                                                checked={qty > 0}
                                                onChange={(event) =>
                                                  setPricingAccessoryQuantities((current) => ({
                                                    ...current,
                                                    [template.id]: {
                                                      ...(current[template.id] ?? {}),
                                                      [id]: event.target.checked ? Math.max(1, qty || 1) : 0,
                                                    },
                                                  }))
                                                }
                                                className="mr-2 h-4 w-4 rounded border-zinc-300 align-middle"
                                              />
                                              <span className="font-medium text-zinc-900">{accessory.item_name}</span>
                                              {accessory.supplier_price_list_code ? (
                                                <span className="mt-1 block text-[11px] text-zinc-500">
                                                  <span className="font-semibold text-zinc-700">Supplier Code:</span> {accessory.supplier_price_list_code}
                                                </span>
                                              ) : null}
                                            </span>
                                            <span className="font-semibold">
                                              {formatMoney(accessory.currency ?? rowCurrency, numberValue(accessory.price))}
                                            </span>
                                            <input
                                              type="number"
                                              min={1}
                                              step={1}
                                              value={qty || 1}
                                              disabled={qty <= 0}
                                              onChange={(event) =>
                                                setPricingAccessoryQuantities((current) => ({
                                                  ...current,
                                                  [template.id]: {
                                                    ...(current[template.id] ?? {}),
                                                    [id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                                                  },
                                                }))
                                              }
                                              className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 disabled:bg-zinc-100"
                                            />
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </fieldset>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {!usesWorkstationFlow && accessoryGroups.length ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              Accessories / Optional Items
                            </p>
                            {accessoryGroups.map((group) => (
                              <fieldset key={group.id} className="border border-zinc-200 bg-zinc-50 p-2">
                                <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                  {group.group_name}
                                </legend>
                                <div className="mt-1 space-y-2">
                                  {group.items.map((accessory) => {
                                    const id = accessory.id ?? accessory.item_name ?? "";
                                    const qty = templatePricingAccessoryQuantities[id] ?? 0;

                                    return (
                                      <label key={id} className="grid gap-2 text-xs text-zinc-700 sm:grid-cols-[1fr_auto_80px] sm:items-center">
                                        <span className="min-w-0">
                                          <input
                                            type="checkbox"
                                            checked={qty > 0}
                                            onChange={(event) =>
                                              setPricingAccessoryQuantities((current) => ({
                                                ...current,
                                                [template.id]: {
                                                  ...(current[template.id] ?? {}),
                                                  [id]: event.target.checked ? Math.max(1, qty || 1) : 0,
                                                },
                                              }))
                                            }
                                            className="mr-2 h-4 w-4 rounded border-zinc-300 align-middle"
                                          />
                                          <span className="font-medium text-zinc-900">{accessory.item_name}</span>
                                          {accessory.supplier_price_list_code ? (
                                            <span className="mt-1 block text-[11px] text-zinc-500">
                                              <span className="font-semibold text-zinc-700">Supplier Code:</span> {accessory.supplier_price_list_code}
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="font-semibold">
                                          {formatMoney(accessory.currency ?? rowCurrency, numberValue(accessory.price))}
                                        </span>
                                        <input
                                          type="number"
                                          min={1}
                                          step={1}
                                          value={qty || 1}
                                          disabled={qty <= 0}
                                          onChange={(event) =>
                                            setPricingAccessoryQuantities((current) => ({
                                              ...current,
                                              [template.id]: {
                                                ...(current[template.id] ?? {}),
                                                [id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                                              },
                                            }))
                                          }
                                          className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 disabled:bg-zinc-100"
                                        />
                                      </label>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            ))}
                          </div>
                        ) : null}
                        {selectedLinkedProducts.length ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              {usesWorkstationFlow ? "4. Linked Product Families / Screens & Add-ons" : "Linked Product Families / Screens & Add-ons"}
                            </p>
                            {selectedLinkedProducts.map((line) => (
                              <fieldset key={line.link.id} className="border border-zinc-200 bg-zinc-50 p-2">
                                <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                  {line.link.label || line.childTemplate.template_name}
                                  {line.link.is_required ? " (Required)" : ""}
                                </legend>
                                <p className="text-xs font-semibold text-zinc-900">
                                  {line.childTemplate.template_name}
                                </p>
                                {line.childCategoryRow ? (
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <label className="block">
                                      <span className="text-[10px] font-bold uppercase text-zinc-500">Variant</span>
                                      <select
                                        value={line.childCategoryRow.id ?? ""}
                                        onChange={(event) => setSelectedLinkedCategories((current) => ({ ...current, [line.link.id]: event.target.value }))}
                                        className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                      >
                                        {activeCategoryRows(line.childTemplate.category_pricing).map((row, index) => (
                                          <option key={row.id ?? index} value={row.id ?? `linked-category-${index}`}>
                                            {pricingOptionLabel({
                                              currency: row.currency ?? line.childTemplate.currency,
                                              dimension: row.dimension,
                                              displayName: pricingDisplayName(row),
                                            })}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-[10px] font-bold uppercase text-zinc-500">Category</span>
                                      <select
                                        value={line.childCategory}
                                        onChange={(event) => setSelectedLinkedFabricCategories((current) => ({ ...current, [line.link.id]: event.target.value }))}
                                        className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                      >
                                        {categoryPriceColumns(line.childTemplate.category_pricing).map((category) => (
                                          <option key={category} value={category}>
                                            {category} - {formatMoney(line.childCategoryRow?.currency ?? line.childTemplate.currency, numberValue(line.childCategoryRow?.prices?.[category]))}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                ) : activeVariantRows(line.childTemplate.variant_pricing).length ? (
                                  <label className="mt-2 block">
                                    <span className="text-[10px] font-bold uppercase text-zinc-500">Variant</span>
                                    <select
                                      value={line.childVariantRow?.id ?? ""}
                                      onChange={(event) => setSelectedLinkedVariants((current) => ({ ...current, [line.link.id]: event.target.value }))}
                                      className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                    >
                                      {activeVariantRows(line.childTemplate.variant_pricing).map((row, index) => (
                                        <option key={row.id ?? index} value={row.id ?? `linked-variant-${index}`}>
                                          {pricingOptionLabel({
                                            currency: row.currency ?? line.childTemplate.currency,
                                            dimension: row.dimension,
                                            displayName: pricingDisplayName(row),
                                            price: numberValue(row.price),
                                          })}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px] sm:items-end">
                                  <p className="text-xs text-zinc-600">
                                    Price: {formatMoney(line.currency, line.unitPrice)}
                                  </p>
                                  <label className="block">
                                    <span className="text-[10px] font-bold uppercase text-zinc-500">Qty</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={line.qty}
                                      onChange={(event) => setLinkedProductQuantities((current) => ({ ...current, [line.link.id]: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }))}
                                      className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                    />
                                  </label>
                                </div>
                                {line.childAccessoryGroups.length ? (
                                  <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3">
                                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                                      {line.childTemplate.template_name} Accessories / Optional Items
                                    </p>
                                    {line.childAccessoryGroups.map((group) => (
                                      <fieldset key={`${line.link.id}-${group.id}`} className="border border-zinc-200 bg-white p-2">
                                        <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                          {group.group_name}
                                        </legend>
                                        <div className="mt-1 space-y-2">
                                          {group.items.map((accessory) => {
                                            const id = accessory.id ?? accessory.item_name ?? "";
                                            const qty = linkedAccessoryQuantities[line.link.id]?.[id] ?? 0;

                                            return (
                                              <label key={`${line.link.id}-${id}`} className="grid gap-2 text-xs text-zinc-700 sm:grid-cols-[1fr_auto_80px] sm:items-center">
                                                <span>
                                                  <input
                                                    type="checkbox"
                                                    checked={qty > 0}
                                                    onChange={(event) =>
                                                      setLinkedAccessoryQuantities((current) => ({
                                                        ...current,
                                                        [line.link.id]: {
                                                          ...(current[line.link.id] ?? {}),
                                                          [id]: event.target.checked ? Math.max(1, qty || 1) : 0,
                                                        },
                                                      }))
                                                    }
                                                    className="mr-2 h-4 w-4 rounded border-zinc-300 align-middle"
                                                  />
                                                  {accessory.item_name}
                                                  {accessory.specification ? ` - ${accessory.specification}` : ""}
                                                </span>
                                                <span className="font-semibold">
                                                  {formatMoney(accessory.currency ?? line.currency, numberValue(accessory.price))}
                                                </span>
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={qty || 1}
                                                  disabled={qty <= 0}
                                                  onChange={(event) =>
                                                    setLinkedAccessoryQuantities((current) => ({
                                                      ...current,
                                                      [line.link.id]: {
                                                        ...(current[line.link.id] ?? {}),
                                                        [id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                                                      },
                                                    }))
                                                  }
                                                  className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 disabled:bg-zinc-100"
                                                />
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </fieldset>
                                    ))}
                                    {line.qty > 0 ? (
                                      <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs leading-5 text-zinc-600">
                                        <p>Linked screen total: {formatMoney(line.currency, line.baseLineTotal)}</p>
                                        <p>Accessories: {formatMoney(line.currency, line.matchingAccessoryTotal)}</p>
                                        <p className="font-semibold text-zinc-900">
                                          Total: {formatMoney(line.currency, line.baseLineTotal + line.matchingAccessoryTotal)}
                                        </p>
                                        {line.hasMixedAccessoryCurrencies ? (
                                          <p className="text-amber-700">
                                            Mixed currencies detected in linked accessories. Review conversion before adding.
                                          </p>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </fieldset>
                            ))}
                          </div>
                        ) : null}
                        {groupedOptions.size ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {Array.from(groupedOptions.entries())
                              .sort(([leftKey], [rightKey]) => {
                                const [leftType] = leftKey.split(":");
                                const [rightType] = rightKey.split(":");

                                return (
                                  optionTypeOrder.indexOf(leftType) -
                                  optionTypeOrder.indexOf(rightType)
                                );
                              })
                              .map(([groupKey, groupOptions]) => {
                                const [optionType, componentGroup] = groupKey.split(":");
                                const selectedValue = templateSelections[groupKey];
                                const accessoryOptions = groupOptions.filter(
                                  (option) =>
                                    deskingRole(option) === "accessory" ||
                                    (isDesking && option.option_type === "linked_addon"),
                                );
                                const selectableOptions = groupOptions.filter(
                                  (option) =>
                                    deskingRole(option) !== "accessory" &&
                                    !(isDesking && option.option_type === "linked_addon"),
                                );

                                if (isDesking && accessoryOptions.length) {
                                  return (
                                    <fieldset
                                      key={groupKey}
                                      className="border border-zinc-200 bg-zinc-50 p-2"
                                    >
                                      <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                        Accessories: {componentGroup}
                                      </legend>
                                      {selectableOptions.length ? (
                                        <label className="mt-1 block">
                                          <span className="text-[10px] font-bold uppercase text-zinc-500">
                                            Base selection
                                          </span>
                                          <select
                                            value={
                                              typeof selectedValue === "string"
                                                ? selectedValue
                                                : selectableOptions.find((option) => option.is_default_selected)?.id ??
                                                  selectableOptions[0]?.id ??
                                                  ""
                                            }
                                            onChange={(event) =>
                                              setSelectedOptions((current) => ({
                                                ...current,
                                                [template.id]: {
                                                  ...(current[template.id] ?? {}),
                                                  [groupKey]: event.target.value,
                                                },
                                              }))
                                            }
                                            className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                          >
                                            <option value="">No selection</option>
                                            {selectableOptions.map((option) => (
                                              <option key={option.id} value={option.id}>
                                                {option.component_name}
                                                {option.unit_price > 0
                                                  ? ` (+${formatMoney(option.currency, option.unit_price)})`
                                                  : ""}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                      ) : null}
                                      <div className="mt-2 space-y-2">
                                        {accessoryOptions.map((option) => (
                                          <label
                                            key={option.id}
                                            className="block text-xs text-zinc-700"
                                          >
                                            <span className="font-medium">
                                              {option.component_name}
                                              {option.unit_price > 0
                                                ? ` (+${formatMoney(option.currency, option.unit_price)} each)`
                                                : ""}
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              step={1}
                                              value={templateAccessoryQuantities[option.id] ?? 0}
                                              onChange={(event) =>
                                                setAccessoryQuantities((current) => ({
                                                  ...current,
                                                  [template.id]: {
                                                    ...(current[template.id] ?? {}),
                                                    [option.id]: Math.max(
                                                      0,
                                                      Math.trunc(Number(event.target.value) || 0),
                                                    ),
                                                  },
                                                }))
                                              }
                                              className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                            />
                                          </label>
                                        ))}
                                      </div>
                                    </fieldset>
                                  );
                                }

                                if (optionType === "linked_addon") {
                                  const checkedIds = Array.isArray(selectedValue)
                                    ? selectedValue
                                    : groupOptions
                                        .filter((option) => option.is_default_selected)
                                        .map((option) => option.id);

                                  return (
                                    <fieldset
                                      key={groupKey}
                                      className="border border-zinc-200 bg-zinc-50 p-2"
                                    >
                                      <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                        {optionTypeLabels.get(optionType) ?? "Option"}: {componentGroup}
                                      </legend>
                                      <div className="mt-1 space-y-1">
                                        {groupOptions.map((option) => (
                                          <label
                                            key={option.id}
                                            className="flex items-start gap-2 text-xs text-zinc-700"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checkedIds.includes(option.id)}
                                              onChange={(event) => {
                                                const nextIds = event.target.checked
                                                  ? [...checkedIds, option.id]
                                                  : checkedIds.filter((id) => id !== option.id);

                                                setSelectedOptions((current) => ({
                                                  ...current,
                                                  [template.id]: {
                                                    ...(current[template.id] ?? {}),
                                                    [groupKey]: nextIds,
                                                  },
                                                }));
                                              }}
                                              className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                                            />
                                            <span>
                                              {option.component_name}
                                              {option.unit_price > 0
                                                ? ` (+${formatMoney(option.currency, option.unit_price)})`
                                                : ""}
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    </fieldset>
                                  );
                                }

                                return (
                                  <label key={groupKey} className="block">
                                    <span className="text-[10px] font-bold uppercase text-zinc-500">
                                      {groupOptions.some((option) => deskingRole(option) === "base_size")
                                        ? "Size"
                                        : groupOptions.some((option) => deskingRole(option) === "cluster_type")
                                          ? "Workstation Type"
                                          : `${optionTypeLabels.get(optionType) ?? "Option"}: ${componentGroup}`}
                                    </span>
                                    <select
                                      value={
                                        typeof selectedValue === "string"
                                          ? selectedValue
                                          : groupOptions.find((option) => option.is_default_selected)?.id ??
                                            (isDesking &&
                                            groupOptions.some((option) =>
                                              ["base_size", "cluster_type"].includes(deskingRole(option)),
                                            )
                                              ? groupOptions[0]?.id ?? ""
                                              : "")
                                      }
                                      onChange={(event) =>
                                        setSelectedOptions((current) => ({
                                          ...current,
                                          [template.id]: {
                                            ...(current[template.id] ?? {}),
                                            [groupKey]: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                    >
                                      <option value="">No selection</option>
                                      {groupOptions.map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.component_name}
                                          {option.unit_price > 0
                                            ? ` (+${formatMoney(option.currency, option.unit_price)})`
                                            : ""}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                );
                              })}
                          </div>
                        ) : null}
                            </div>
                          </section>
                        </div>
                        <aside className="xl:sticky xl:top-24 xl:self-start">
                          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                            <div className="grid gap-1">
                              <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                                Quotation Preview / Summary
                              </p>
                              <p className="text-xs leading-5 text-zinc-500">
                                Review the exact selected items, source totals, conversion, discount, and specification before adding.
                              </p>
                            </div>
                            <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                                Selected items
                              </p>
                              <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-zinc-950">{templateSelectionName(template)}</p>
                                    {template.internal_selection_name ? (
                                      <p className="text-zinc-500">Quote name: {template.template_name}</p>
                                    ) : null}
                                    <p>{mainItemLabel}</p>
                                    {mainItemDimension ? (
                                      <p className="text-zinc-500">Dimension: {mainItemDimension}</p>
                                    ) : null}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p>{formatMoney(mainItemCurrency, mainItemUnitPrice)} x 1</p>
                                    <p className="font-semibold text-zinc-950">
                                      {formatMoney(mainItemCurrency, mainItemUnitPrice)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              {additionalClusterLine ? (
                                <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="font-semibold text-zinc-950">{additionalClusterLine.label}</p>
                                      <p>Qty: {additionalClusterLine.qty}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <p>{formatMoney(additionalClusterLine.currency, additionalClusterLine.unitPrice)} each</p>
                                      <p className="font-semibold text-zinc-950">
                                        {formatMoney(additionalClusterLine.currency, additionalClusterLine.total)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              {workstationOptionalLine ? (
                                <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-zinc-950">Optional item</p>
                                      <p>{workstationOptionalLine.label}</p>
                                      {workstationOptionalLine.supplierCode ? (
                                        <p className="text-zinc-500">
                                          <span className="font-semibold text-zinc-700">Supplier Code:</span> {workstationOptionalLine.supplierCode}
                                        </p>
                                      ) : null}
                                      {workstationOptionalLine.detail ? (
                                        <p className="text-zinc-500">{workstationOptionalLine.detail}</p>
                                      ) : null}
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <p>{formatMoney(workstationOptionalLine.currency, workstationOptionalLine.unitPrice)} x 1</p>
                                      <p className="font-semibold text-zinc-950">
                                        {formatMoney(workstationOptionalLine.currency, workstationOptionalLine.total)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              {pricingAccessorySummary.length ? (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                    Accessories / Optional Items
                                  </p>
                                  {pricingAccessorySummary.map((line) => (
                                    <div
                                      key={`${line.label}-${line.detail}-${line.qty}`}
                                      className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-zinc-950">{line.label}</p>
                                          {line.supplierCode ? (
                                            <p className="text-zinc-500">
                                              <span className="font-semibold text-zinc-700">Supplier Code:</span> {line.supplierCode}
                                            </p>
                                          ) : null}
                                          {line.detail ? <p className="text-zinc-500">{line.detail}</p> : null}
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <p>{formatMoney(line.currency, line.unitPrice)} x {line.qty}</p>
                                          <p className="font-semibold text-zinc-950">
                                            {formatMoney(line.currency, line.total)}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {linkedProductSummary.length ? (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                    Linked Products / Screens
                                  </p>
                                  {linkedProductSummary.map((line) => (
                                    <div
                                      key={`${line.label}-${line.detail}-${line.qty}`}
                                      className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-zinc-950">{line.label}</p>
                                          {line.supplierCode ? (
                                            <p className="text-zinc-500">
                                              <span className="font-semibold text-zinc-700">Supplier Code:</span> {line.supplierCode}
                                            </p>
                                          ) : null}
                                          {line.detail ? <p className="text-zinc-500">{line.detail}</p> : null}
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <p>{formatMoney(line.currency, line.unitPrice)} x {line.qty}</p>
                                          <p className="font-semibold text-zinc-950">
                                            {formatMoney(line.currency, line.total)}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {linkedAccessorySummary.length ? (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                    Linked Product Accessories
                                  </p>
                                  {linkedAccessorySummary.map((line) => (
                                    <div
                                      key={`${line.detail}-${line.label}-${line.qty}`}
                                      className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-zinc-950">{line.label}</p>
                                          {line.supplierCode ? (
                                            <p className="text-zinc-500">
                                              <span className="font-semibold text-zinc-700">Supplier Code:</span> {line.supplierCode}
                                            </p>
                                          ) : null}
                                          {line.detail ? <p className="text-zinc-500">{line.detail}</p> : null}
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <p>{formatMoney(line.currency, line.unitPrice)} x {line.qty}</p>
                                          <p className="font-semibold text-zinc-950">
                                            {formatMoney(line.currency, line.total)}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {selectedFinishSummary.length ? (
                                <div className="space-y-2">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                                    Materials / Finishes
                                  </p>
                                  <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-700">
                                    {selectedFinishSummary.map((line) => (
                                      <p key={line}>{line}</p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div className="grid gap-1">
                              <p className="text-sm font-semibold text-zinc-950">
                                {formatQuotationMoney(previewCurrency, effectiveQuoteUnitPrice)}
                              </p>
                              <PriceCheckBadge template={template} />
                              {priceCheckState(template).tone === "warning" ? (
                                <>
                                  <p className="max-w-52 text-[11px] leading-4 text-amber-700">
                                    Please verify source price before finalizing quotation.
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTemplateActionMessageById((current) => ({
                                          ...current,
                                          [template.id]: "",
                                        }));
                                        setTemplateEditor({
                                          currentPreviewUnitPrice: effectiveQuoteUnitPrice,
                                          mode: "price_check",
                                          templateId: template.id,
                                        });
                                      }}
                                      className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-900 transition hover:border-amber-500"
                                    >
                                      Check / Update Price
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        startTemplateActionTransition(async () => {
                                          const formData = new FormData();
                                          formData.set("id", template.id);
                                          formData.set("price_check_note", "");
                                          const result = await markTemplatePriceCheckedForQuotationModal(formData);

                                          if (!result.ok || !result.template) {
                                            setTemplateActionMessageById((current) => ({
                                              ...current,
                                              [template.id]: result.message,
                                            }));
                                            return;
                                          }

                                          updateTemplateRecord(result.template as ProductLibraryTemplate);
                                        });
                                      }}
                                      disabled={isTemplateActionPending}
                                      className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-900 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isTemplateActionPending ? "Saving..." : "Mark as Checked"}
                                    </button>
                                  </div>
                                  {templateActionMessageById[template.id] ? (
                                    <p className="max-w-64 text-[11px] leading-4 text-red-700">
                                      {templateActionMessageById[template.id]}
                                    </p>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                            {derivedDesking ? (
                              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                            {derivedDesking.clusterLabel ? (
                              <p>Selected size: {derivedDesking.sizeLabel}</p>
                            ) : null}
                            {derivedDesking.clusterLabel ? (
                              <p className="font-semibold text-zinc-950">
                                Cluster: {derivedDesking.clusterLabel}
                              </p>
                            ) : null}
                            {derivedDesking.layoutType ? (
                              <p>Layout: {derivedDesking.layoutType}</p>
                            ) : null}
                            {derivedDesking.dimension ? (
                              <p>Dimension: {derivedDesking.dimension}</p>
                            ) : null}
                            {configuredSpecification ? (
                              <p className="whitespace-pre-wrap">Specification: {configuredSpecification}</p>
                            ) : null}
                            <p>Price: {formatMoney(derivedDesking.mainCurrency, derivedDesking.unitPrice)}</p>
                            <p>Formula: {derivedDesking.formula}</p>
                            {derivedDesking.baseSupplierPriceListCode ? (
                              <p>Base supplier code: {derivedDesking.baseSupplierPriceListCode}</p>
                            ) : null}
                            {derivedDesking.additionalSupplierPriceListCode ? (
                              <p>Additional supplier code: {derivedDesking.additionalSupplierPriceListCode}</p>
                            ) : null}
                            {derivedDesking.finishNames.length ? (
                              <p>Finish: {derivedDesking.finishNames.join(", ")}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {usesVariantPricing && selectedVariantRow ? (
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                            <p className="font-semibold text-zinc-950">
                              Model: {pricingDisplayName(selectedVariantRow) || selectedVariantRow.variant_name}
                            </p>
                            {selectedVariantRow.variant_name && pricingDisplayName(selectedVariantRow) !== selectedVariantRow.variant_name ? (
                              <p>Variant Code: {selectedVariantRow.variant_name}</p>
                            ) : null}
                            {selectedVariantRow.supplier_price_list_code ? (
                              <p>Supplier Code: {selectedVariantRow.supplier_price_list_code}</p>
                            ) : null}
                            {selectedVariantRow.dimension ? (
                              <p>Dimension: {selectedVariantRow.dimension}</p>
                            ) : null}
                            <p>
                              Price: {formatMoney(selectedVariantRow.currency ?? template.currency, numberValue(selectedVariantRow.price))}
                            </p>
                            {selectedVariantRow.specification ? (
                              <p className="line-clamp-3">{selectedVariantRow.specification}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {usesModularPricing ? (
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                            <p className="font-semibold text-zinc-950">Modular configuration</p>
                            <p>Fabric / Category: {selectedFabricCategory}</p>
                            {localDimension ? <p>Configured Dimension: {localDimension}</p> : null}
                            {modularSummary.length ? (
                              <div className="mt-2 space-y-1">
                                {modularSummary.map((line) => (
                                  <p key={`${line.label}-${line.qty}-${line.supplierCode ?? ""}`}>
                                    {line.label} x{line.qty} - {formatMoney(line.currency, line.total)}
                                    {line.supplierCode ? ` (${line.supplierCode})` : ""}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-1 text-zinc-500">Select one or more modular items.</p>
                            )}
                          </div>
                        ) : null}
                        {usesWorkstationFlow && selectedWorkstationVariantRow ? (
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
                            <p className="font-semibold text-zinc-950">
                              Optional item: {pricingDisplayName(selectedWorkstationVariantRow) || selectedWorkstationVariantRow.variant_name}
                            </p>
                            {selectedWorkstationVariantRow.variant_name && pricingDisplayName(selectedWorkstationVariantRow) !== selectedWorkstationVariantRow.variant_name ? (
                              <p>Variant Code: {selectedWorkstationVariantRow.variant_name}</p>
                            ) : null}
                            {selectedWorkstationVariantRow.supplier_price_list_code ? (
                              <p>Supplier Code: {selectedWorkstationVariantRow.supplier_price_list_code}</p>
                            ) : null}
                            {selectedWorkstationVariantRow.dimension ? (
                              <p>Dimension: {selectedWorkstationVariantRow.dimension}</p>
                            ) : null}
                            <p>
                              Price: {formatMoney(selectedWorkstationVariantRow.currency ?? template.currency, numberValue(selectedWorkstationVariantRow.price))}
                            </p>
                            {selectedWorkstationVariantRow.specification ? (
                              <p className="line-clamp-3">{selectedWorkstationVariantRow.specification}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {isDesking && !usesWorkstationFlow ? (
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase text-zinc-500">
                              Additional {derivedDesking?.clusterName ?? "CL2"} Quantity
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={additionalClusterQty}
                              onChange={(event) =>
                                setAdditionalClusterQuantities((current) => ({
                                  ...current,
                                  [template.id]: Math.max(
                                    0,
                                    Math.trunc(Number(event.target.value) || 0),
                                  ),
                                }))
                              }
                              className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-right text-xs outline-none focus:border-emerald-800"
                            />
                          </label>
                        ) : null}
                        {effectiveSelectedNames.length ? (
                          <p className="text-xs leading-5 text-zinc-500">
                            Selected: {effectiveSelectedNames.join(", ")}
                          </p>
                        ) : null}
                        {missingRequiredModularSelection ? (
                          <p className="text-xs leading-5 text-amber-700">
                            Select at least one modular item to add this product.
                          </p>
                        ) : null}
                        {hasMixedOptionCurrencies ? (
                          <p className="text-xs leading-5 text-amber-700">
                            Mixed-currency advanced options should be reviewed manually.
                          </p>
                        ) : null}
                        {hasMixedAccessoryCurrencies ? (
                          <p className="text-xs leading-5 text-amber-700">
                            Mixed-currency add-ons use the conversion rates below.
                          </p>
                        ) : null}
                            {hasMixedLinkedProductCurrencies ? (
                              <p className="text-xs leading-5 text-amber-700">
                                Mixed-currency linked products use the conversion rates below.
                              </p>
                            ) : null}
                            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left text-xs leading-5 text-zinc-700">
                              <p className="font-bold uppercase text-zinc-500">Source Currency Total</p>
                              {sourceTotalsList.map((line) => (
                                <p key={line.currency}>
                                  {line.currency} subtotal: {formatMoney(line.currency, line.amount)}
                                </p>
                              ))}
                            </div>
                            {nonAedCurrencies.length ? (
                              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs leading-5 text-amber-900">
                                <p className="font-bold uppercase">
                                  {usesWorkstationFlow ? "5. Currency conversion" : "Currency Conversion"}
                                </p>
                            {Array.from(originalCurrencyTotals.entries()).map(([currency, amount]) => (
                              <p key={currency}>
                                {currency} total: {formatMoney(currency, amount)}
                              </p>
                            ))}
                            {nonAedCurrencies.map((currency) => (
                              <label key={currency} className="block">
                                <span className="text-[10px] font-bold uppercase">
                                  {currency} to AED rate
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.0001"
                                  placeholder={currency === "USD" ? "3.67" : currency === "EUR" ? "4.10" : ""}
                                  value={templateExchangeRates[currency] ?? ""}
                                  onChange={(event) =>
                                    setExchangeRates((current) => ({
                                      ...current,
                                      [template.id]: {
                                        ...(current[template.id] ?? {}),
                                        [currency]: event.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 h-8 w-full border border-amber-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                />
                              </label>
                            ))}
                            {missingExchangeRate ? (
                              <p>Enter exchange rate to add this item in AED.</p>
                            ) : (
                              <p className="font-semibold">
                                Converted final: {formatQuotationMoney("AED", convertedPreviewTotal)}
                              </p>
                            )}
                          </div>
                        ) : null}
                        <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left text-xs leading-5 text-zinc-700">
                          <p className="font-bold uppercase text-zinc-500">
                            {usesWorkstationFlow ? "6. Pricing / Discount" : "Pricing / Discount"}
                          </p>
                          <p>U.Price: {formatQuotationMoney(previewCurrency, effectiveQuoteUnitPrice)}</p>
                          {needsUpdatedPriceDecision ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                              <p className="font-semibold">
                                Price updated. Apply updated price to this selected quotation item?
                              </p>
                              <p className="mt-1">
                                Current quote price: {formatQuotationMoney(previewCurrency, previousQuotedPrice ?? effectiveQuoteUnitPrice)}
                              </p>
                              <p>
                                Updated source price: {formatQuotationMoney(previewCurrency, pendingUpdatedPrice)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTemplatePriceOverrides((current) => ({
                                      ...current,
                                      [template.id]: undefined,
                                    }));
                                    setPendingPriceUpdateChoice(null);
                                  }}
                                  className="rounded-md border border-emerald-700 bg-emerald-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-800"
                                >
                                  Apply Updated Price
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTemplatePriceOverrides((current) => ({
                                      ...current,
                                      [template.id]: previousQuotedPrice ?? effectiveQuoteUnitPrice,
                                    }));
                                    setPendingPriceUpdateChoice(null);
                                  }}
                                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400"
                                >
                                  Keep Current Quote Price
                                </button>
                              </div>
                            </div>
                          ) : null}
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase text-zinc-500">Discount Type</span>
                            <select
                              value={selectedDiscountType}
                              onChange={(event) =>
                                setDiscountTypes((current) => ({
                                  ...current,
                                  [template.id]: event.target.value,
                                }))
                              }
                              className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                            >
                              <option value="none">None</option>
                              <option value="amount">Amount</option>
                              <option value="percent">Percent</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-bold uppercase text-zinc-500">Discount</span>
                            <input
                              type="number"
                              min={0}
                              max={selectedDiscountType === "percent" ? 100 : undefined}
                              step="0.01"
                              disabled={selectedDiscountType === "none"}
                              value={selectedDiscountType === "none" ? "" : discountValues[template.id] ?? ""}
                              onChange={(event) =>
                                setDiscountValues((current) => ({
                                  ...current,
                                  [template.id]: event.target.value,
                                }))
                              }
                              className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 disabled:bg-zinc-100"
                            />
                          </label>
                          <p>
                            Discount: {selectedDiscountType === "percent" ? `${selectedDiscountValue}% / ` : ""}
                            {formatQuotationMoney(previewCurrency, unitDiscountAmount)}
                          </p>
                          <p>Net Price: {formatQuotationMoney(previewCurrency, netPricePreview)}</p>
                          <p>Net Total: {formatQuotationMoney(previewCurrency, netTotalPreview)}</p>
                        </div>
                              <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left text-xs leading-5 text-zinc-700">
                                <p className="font-bold uppercase text-zinc-500">Final Specification</p>
                                <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3">
                                <p className="font-semibold text-zinc-950">{templateSelectionName(template)}</p>
                                {template.internal_selection_name ? (
                                  <p className="text-zinc-500">Quote name: {template.template_name}</p>
                                ) : null}
                                {specificationPreviewLines.length ? (
                                  specificationPreviewLines.map((line) => (
                                    <p key={line}>{line}</p>
                                  ))
                                ) : (
                                  <p className="text-zinc-500">No specification details yet.</p>
                                )}
                              </div>
                            </div>
                            <div className="sticky bottom-0 -mx-4 -mb-4 mt-1 border-t border-zinc-200 bg-white px-4 py-4">
                              {isLocalMode ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                  onAddLocalItem?.(localProductItem);
                                  setIsOpen(false);
                                }}
                                  disabled={missingExchangeRate || missingRequiredWorkstationSelection || missingRequiredModularSelection || needsUpdatedPriceDecision}
                                  className="h-10 w-full bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                                >
                                  Add to Local Workspace
                                </button>
                              ) : (
                                <button
                                  type="submit"
                                  disabled={missingExchangeRate || missingRequiredWorkstationSelection || missingRequiredModularSelection || needsUpdatedPriceDecision}
                                  className="h-10 w-full bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                                >
                                  Add
                                </button>
                              )}
                            </div>
                          </div>
                        </aside>
                        <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                                Materials & Finishes
                              </p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">
                                {selectedFinishes.length
                                  ? "Review linked finishes, recommendations, and custom finish selections."
                                  : "No finishes selected yet. Use the compact selector below to add recommendations, browse materials, or set a custom finish."}
                              </p>
                            </div>
                          </div>
                          <input type="hidden" name="quotation_id" value={quotationId} />
                          <input type="hidden" name="section_id" value={sectionId} />
                          <input type="hidden" name="template_id" value={template.id} />
                          <input
                            type="hidden"
                            name="selected_template_image_path"
                            value={selectedImage}
                          />
                          <input type="hidden" name="return_to" value={returnTo} />
                          {effectiveSelectedIds.map((id) => (
                            <input
                              key={id}
                              type="hidden"
                              name="selected_component_id"
                              value={id}
                            />
                          ))}
                          {isDesking ? (
                            <input
                              type="hidden"
                              name="desking_additional_cluster_qty"
                              value={additionalClusterQty}
                            />
                          ) : null}
                          {derivedDesking && selectedSizeRow ? (
                            <input
                              type="hidden"
                              name="desking_size_id"
                              value={selectedSizeRow.id ?? ""}
                            />
                          ) : null}
                          {usesWorkstationFlow && selectedSizeRow ? (
                            <>
                              <input type="hidden" name="configured_dimension" value={configuredDimension} />
                              <input type="hidden" name="configured_specification" value={configuredSpecification} />
                              <input type="hidden" name="workstation_layout_type" value={selectedWorkstationLayout} />
                            </>
                          ) : null}
                          {usesCategoryPricing && selectedCategoryRow ? (
                            <>
                              <input type="hidden" name="category_pricing_row_id" value={selectedCategoryRow.id ?? ""} />
                              <input type="hidden" name="category_pricing_category" value={selectedFabricCategory} />
                            </>
                          ) : null}
                          {usesModularPricing ? (
                            <>
                              <input type="hidden" name="modular_pricing_category" value={selectedFabricCategory} />
                              <input type="hidden" name="configured_dimension" value={configuredDimension} />
                              {selectedModularItems.map((line) => (
                                <input
                                  key={line.id}
                                  type="hidden"
                                  name="modular_item_selection"
                                  value={`${line.id}:${line.qty}`}
                                />
                              ))}
                            </>
                          ) : null}
                          {usesVariantPricing && selectedVariantRow ? (
                            <input type="hidden" name="variant_pricing_row_id" value={selectedVariantRow.id ?? ""} />
                          ) : null}
                          {usesWorkstationFlow && selectedWorkstationVariantRow ? (
                            <input
                              type="hidden"
                              name="workstation_variant_pricing_row_id"
                              value={selectedWorkstationVariantRow.id ?? ""}
                            />
                          ) : null}
                          {selectedPricingAccessories.map((line) => (
                            <input
                              key={line.accessory.id ?? line.accessory.item_name}
                              type="hidden"
                              name="accessory_pricing_qty"
                              value={`${line.accessory.id ?? line.accessory.item_name ?? ""}:${line.qty}`}
                            />
                          ))}
                          {selectedLinkedProducts.map((line) => (
                            line.qty > 0 ? (
                              <span key={line.link.id} className="contents">
                                <input
                                  type="hidden"
                                  name="linked_product_selection"
                                  value={[
                                    line.link.id,
                                    line.qty,
                                    line.childCategoryRow?.id ?? "",
                                    line.childCategoryRow ? line.childCategory : "",
                                    line.childVariantRow?.id ?? "",
                                  ].join(":")}
                                />
                                {line.selectedAccessories.map((accessoryLine) => (
                                  <input
                                    key={`${line.link.id}-${accessoryLine.id}`}
                                    type="hidden"
                                    name="linked_product_accessory_qty"
                                    value={[line.link.id, accessoryLine.id, accessoryLine.qty].join(":")}
                                  />
                                ))}
                              </span>
                            ) : null
                          ))}
                          {nonAedCurrencies.map((currency) => (
                            <input
                              key={currency}
                              type="hidden"
                              name="currency_exchange_rate"
                              value={`${currency}:${templateExchangeRates[currency] ?? ""}`}
                            />
                          ))}
                          <input
                            type="hidden"
                            name="product_library_discount_type"
                            value={selectedDiscountType}
                          />
                          <input
                            type="hidden"
                            name="product_library_discount_value"
                            value={selectedDiscountValue}
                          />
                          {Object.entries(templateAccessoryQuantities).map(([id, qty]) =>
                            qty > 0 ? (
                              <input
                                key={id}
                                type="hidden"
                                name="accessory_qty"
                                value={`${id}:${qty}`}
                              />
                            ) : null,
                          )}
                          <div className="max-h-[32rem] overflow-y-auto pr-1 text-left">
                            <FinishSelectionsEditor
                              brands={finishBrands}
                              initialBrandId={template.brand_id}
                              initialFinishes={selectedFinishes}
                              materialGroups={materialGroups}
                              materials={materials}
                              onChange={(nextFinishes) =>
                                setSelectedFinishesByTemplate((current) => ({
                                  ...current,
                                  [template.id]: nextFinishes,
                                }))
                              }
                              quotationId={quotationId}
                              templateMaterialGroupItems={templateMaterialItems}
                              templateMaterialGroups={templateMaterialLinks}
                            />
                          </div>
                        </div>
                      </form>
                      {imagePreview?.templateId === template.id ? (
                        <ProductImagePreviewDialog
                          currentIndex={imagePreview.imageIndex}
                          images={availableProposedImages.map((image) => ({ label: image.label, path: image.path }))}
                          onClose={() => setImagePreview(null)}
                          onNavigate={(nextIndex) => {
                            if (nextIndex < 0 || nextIndex >= availableProposedImages.length) return;
                            setImagePreview({ templateId: template.id, imageIndex: nextIndex });
                          }}
                          onSelect={(path) => {
                            setSelectedImages((current) => ({
                              ...current,
                              [template.id]: path,
                            }));
                            setImagePreview(null);
                          }}
                          templateName={templateSelectionName(template)}
                        />
                      ) : null}
                    </article>
                  );
                }) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}
      {templateEditor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 px-4 py-6">
          <div className="flex h-[92vh] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-zinc-50 shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Product Library</p>
                <h3 className="text-sm font-semibold text-zinc-950">
                  {templateEditor.mode === "price_check" ? "Check / Update Price" : "Edit Template"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeTemplateEditor}
                className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-950"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {templateById.get(templateEditor.templateId) ? (
                <ProductTemplateForm
                  brands={brands}
                  categories={categories}
                  compactAccordionMode={templateEditor.mode === "edit"}
                  extraHiddenFields={templateEditor.mode === "price_check"
                    ? (
                        <>
                          <input type="hidden" name="price_check_mode" value="review_on_save" />
                          <input type="hidden" name="price_check_note" value="" />
                        </>
                      )
                    : undefined}
                  focusSection={templateEditor.mode === "price_check" ? "pricing" : "details"}
                  initialMessage={templateActionMessageById[templateEditor.templateId]}
                  mode="update"
                  onCancel={closeTemplateEditor}
                  onSubmitAction={async (formData) => {
                    const result = await updateProductTemplateForQuotationModal(formData);

                    if (!result.ok || !result.template) {
                      setTemplateActionMessageById((current) => ({
                        ...current,
                        [templateEditor.templateId]: result.message,
                      }));
                      return;
                    }

                    updateTemplateRecord(result.template as ProductLibraryTemplate);
                    if (templateEditor.mode === "price_check") {
                      setPendingPriceUpdateChoice({
                        previousUnitPrice: templateEditor.currentPreviewUnitPrice,
                        templateId: templateEditor.templateId,
                      });
                    }
                    closeTemplateEditor();
                  }}
                  returnTo={returnTo}
                  template={templateById.get(templateEditor.templateId) as ProductLibraryTemplate}
                />
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  Product template could not be loaded in the quotation popup.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
