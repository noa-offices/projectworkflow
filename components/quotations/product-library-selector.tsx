"use client";

import { useEffect, useMemo, useState } from "react";
import { addProductTemplateToQuotation } from "@/app/quotations/actions";
import {
  FinishSelectionsEditor,
  type FinishMaterial,
  type FinishMaterialBrand,
  type FinishMaterialGroup,
  type ProductTemplateMaterialGroupItemLink,
  type ProductTemplateMaterialGroupLink,
} from "@/components/quotations/finish-selections-editor";
import { formatMoney, normalizeCurrency } from "@/lib/currencies";
import { productTemplatePriceCheckState } from "@/lib/product-price-check";
import { formatQuotationMoney, quotationMoneyValue } from "@/lib/quotation-pricing";
import { createClient } from "@/lib/supabase/client";

export type ProductLibraryBrand = {
  id: string;
  name: string;
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
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  currency: string;
  default_unit_price: number;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
  price_check_note?: string | null;
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
  length?: number;
  depth?: number;
  height?: number;
  dimension_unit?: string;
  default_price?: number;
  additional_price?: number;
  currency?: string;
  sort_order?: number;
  is_active?: boolean;
};

type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type CategoryPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number>;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  items?: AccessoryPricingItem[];
  item_name?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
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

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPriceCheckDate(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function priceCheckState(template: ProductLibraryTemplate, brandName?: string | null) {
  return productTemplatePriceCheckState({
    brandName,
    formatDate: formatPriceCheckDate,
    latestBrandPriceListUpdate: template.latest_brand_price_list_update,
    template,
  });
}

function PriceCheckBadge({
  brandName,
  compact = false,
  template,
}: {
  brandName?: string | null;
  compact?: boolean;
  template: ProductLibraryTemplate;
}) {
  const status = priceCheckState(template, brandName);
  const badgeClass = status.tone === "ok"
    ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-900"
    : status.tone === "notice"
      ? "inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-900"
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
    .filter((row) => row.is_active !== false)
    .filter((row) => numberValue(row.length) > 0 && numberValue(row.depth) > 0 && numberValue(row.height) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeVariantRows(rows?: VariantPricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.dimension || numberValue(row.price) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeCategoryRows(rows?: CategoryPricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.dimension || Object.values(row.prices ?? {}).some((price) => numberValue(price) > 0))
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
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
        .filter((item) => item.item_name || numberValue(item.price) > 0)
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
  selectedSize,
  template,
  templateComponents,
}: {
  accessoryQuantities: Record<string, number>;
  additionalClusterQty: number;
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
  const dimension =
    moduleLength && depth && height && totalModules
      ? `${moduleLength * totalModules} x ${depth} x ${height} ${dimensionUnit}`
      : "";
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
    basePrice,
    clusterLabel,
    clusterName,
    dimension,
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

    if (isDirectImageUrl(path)) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl(path);
      });
      return;
    }

    const supabase = createClient();
    const storagePath = path.startsWith("product-images:")
      ? path.slice("product-images:".length)
      : path;

    void supabase.storage
      .from("product-images")
      .createSignedUrl(storagePath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setPreviewUrl(data?.signedUrl ?? "");
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
          className="block h-full w-full object-contain"
        />
      ) : (
        <span className="px-1">No image</span>
      )}
    </div>
  );
}

export function ProductLibrarySelector({
  brands,
  categories,
  components,
  linkedFamilies,
  materialGroups,
  materials,
  quotationId,
  returnTo,
  sectionId,
  templateMaterialGroupItems,
  templateMaterialGroups,
  templates,
}: {
  brands: ProductLibraryBrand[];
  categories: ProductLibraryCategory[];
  components: ProductLibraryComponent[];
  linkedFamilies: ProductLibraryLinkedFamily[];
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  quotationId: string;
  returnTo: string;
  sectionId: string;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
  templates: ProductLibraryTemplate[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, string | string[]>>>({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [additionalClusterQuantities, setAdditionalClusterQuantities] = useState<Record<string, number>>({});
  const [accessoryQuantities, setAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [selectedDeskingSizes, setSelectedDeskingSizes] = useState<Record<string, string>>({});
  const [selectedVariantRows, setSelectedVariantRows] = useState<Record<string, string>>({});
  const [selectedCategoryRows, setSelectedCategoryRows] = useState<Record<string, string>>({});
  const [selectedFabricCategories, setSelectedFabricCategories] = useState<Record<string, string>>({});
  const [pricingAccessoryQuantities, setPricingAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [linkedProductQuantities, setLinkedProductQuantities] = useState<Record<string, number>>({});
  const [selectedLinkedVariants, setSelectedLinkedVariants] = useState<Record<string, string>>({});
  const [selectedLinkedCategories, setSelectedLinkedCategories] = useState<Record<string, string>>({});
  const [selectedLinkedFabricCategories, setSelectedLinkedFabricCategories] = useState<Record<string, string>>({});
  const [exchangeRates, setExchangeRates] = useState<Record<string, Record<string, string>>>({});
  const [discountTypes, setDiscountTypes] = useState<Record<string, string>>({});
  const [discountValues, setDiscountValues] = useState<Record<string, string>>({});

  const brandNameById = useMemo(
    () => new Map(brands.map((brand) => [brand.id, brand.name])),
    [brands],
  );
  const templateById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
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
  const visibleMainCategories = mainCategories.filter((category) => !brandId || category.brand_id === brandId);
  const subcategories = categories.filter((category) => category.parent_id);
  const visibleSubcategories = subcategories.filter((category) => {
    if (brandId && category.brand_id !== brandId) return false;
    if (categoryId && category.parent_id !== categoryId) return false;

    return true;
  });
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
  const filteredTemplates = templates.filter((template) => {
    if (brandId && template.brand_id !== brandId) return false;
    if (categoryId && template.main_category_id !== categoryId) return false;
    if (subcategoryId && template.sub_category_id !== subcategoryId) return false;

    if (!normalizedSearch) return true;

    return [
      template.template_name,
      template.item_code,
      template.template_code,
      template.description,
      template.default_specification,
      brandNameById.get(template.brand_id),
      template.main_category_id ? categoryNameById.get(template.main_category_id) : null,
      template.sub_category_id ? categoryNameById.get(template.sub_category_id) : null,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
  });
  const selectedTemplate = selectedTemplateId
    ? filteredTemplates.find((template) => template.id === selectedTemplateId) ?? null
    : null;
  const finishBrands: FinishMaterialBrand[] = brands;
  const productCountByBrand = useMemo(() => {
    const map = new Map<string, number>();

    for (const template of templates) {
      map.set(template.brand_id, (map.get(template.brand_id) ?? 0) + 1);
    }

    return map;
  }, [templates]);
  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();

    for (const template of templates) {
      if (template.main_category_id) {
        map.set(template.main_category_id, (map.get(template.main_category_id) ?? 0) + 1);
      }
      if (template.sub_category_id) {
        map.set(template.sub_category_id, (map.get(template.sub_category_id) ?? 0) + 1);
      }
    }

    return map;
  }, [templates]);

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
                className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
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
                className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
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
                className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
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

            <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[220px_minmax(320px,1fr)_420px]">
              <aside className="min-h-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50 p-3 lg:border-b-0 lg:border-r">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase text-zinc-500">Library</p>
                  <span className="text-[11px] font-semibold text-zinc-500">{templates.length} products</span>
                </div>
                <div className="space-y-2">
                  {brands.map((brand) => {
                    const brandCategories = mainCategories.filter((category) => category.brand_id === brand.id);
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
                            const categorySubcategories = subcategories.filter((child) => child.parent_id === category.id);
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

              <section className="min-h-0 overflow-y-auto border-b border-zinc-200 p-3 lg:border-b-0 lg:border-r">
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
                    const thumbnailPath = template.proposed_image_url_1 ?? template.default_image_url ?? template.reference_image_url;
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
                            {template.template_name}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500">
                            {brandNameById.get(template.brand_id) ?? "Unknown brand"}
                            {mainCategory ? ` / ${mainCategory}` : ""}
                            {subCategory ? ` / ${subCategory}` : ""}
                          </span>
                          <span className="mt-1 block text-[11px] font-semibold text-zinc-500">
                            {template.item_code ?? template.template_code ?? "No code"}
                          </span>
                          <PriceCheckBadge compact brandName={brandNameById.get(template.brand_id)} template={template} />
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

              <section className="min-h-0 overflow-y-auto bg-white">
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
                  const variantRows = activeVariantRows(template.variant_pricing);
                  const categoryRows = activeCategoryRows(template.category_pricing);
                  const accessoryGroups = activeAccessoryRows(template.accessory_pricing);
                  const templateLinkedFamilies = linkedFamiliesByParent.get(template.id) ?? [];
                  const usesWorkstationFlow = sizePricingRows.length > 0;
                  const usesVariantPricing = !usesWorkstationFlow && variantRows.length > 0;
                  const usesCategoryPricing = !usesVariantPricing && categoryRows.length > 0;
                  const templatePricingAccessoryQuantities = pricingAccessoryQuantities[template.id] ?? {};
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
                  const selectedFabricCategory = selectedFabricCategories[template.id] ?? "Cat A";
                  const selectedCategoryPrice = selectedCategoryRow
                    ? numberValue(selectedCategoryRow.prices?.[selectedFabricCategory])
                    : 0;
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
                  const derivedDesking = isDesking && selectedSizeRow
                    ? deskingSizePricingCalculation({
                        accessoryQuantities: templateAccessoryQuantities,
                        additionalClusterQty,
                        selectedSize: selectedSizeRow,
                        template,
                        templateComponents,
                      })
                    : null;
                  const rowCurrency = derivedDesking?.mainCurrency ??
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
                    (derivedDesking?.unitPrice ??
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
                      const childCategory = selectedLinkedFabricCategories[link.id] ?? "Cat A";
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

                      return {
                        childCategory,
                        childCategoryRow,
                        childTemplate,
                        childVariantRow,
                        currency,
                        link,
                        qty,
                        unitPrice,
                      };
                    })
                    .filter((line): line is NonNullable<typeof line> => Boolean(line));
                  const matchingLinkedProductTotal = selectedLinkedProducts
                    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
                    .filter((line) => normalizeCurrency(line.currency) === normalizeCurrency(rowCurrency))
                    .reduce((total, line) => total + line.qty * line.unitPrice, 0);
                  const hasMixedLinkedProductCurrencies = selectedLinkedProducts
                    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
                    .some((line) => normalizeCurrency(line.currency) !== normalizeCurrency(rowCurrency));
                  const totalPreviewUnitPrice = previewUnitPrice + matchingLinkedProductTotal;
                  const baseProductPrice =
                    derivedDesking?.unitPrice ??
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
                      addCurrencyTotal(line.currency, line.qty * line.unitPrice);
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
                  const selectedDiscountType = discountTypes[template.id] ?? "none";
                  const rawDiscountValue = Math.max(0, numberValue(discountValues[template.id], 0));
                  const selectedDiscountValue = selectedDiscountType === "percent"
                    ? Math.min(rawDiscountValue, 100)
                    : selectedDiscountType === "amount"
                      ? rawDiscountValue
                      : 0;
                  const unitDiscountAmount = quotationMoneyValue(
                    selectedDiscountType === "percent"
                      ? previewUnitPriceWithConversion * selectedDiscountValue / 100
                      : selectedDiscountType === "amount"
                        ? selectedDiscountValue
                        : 0,
                  );
                  const netPricePreview = quotationMoneyValue(Math.max(previewUnitPriceWithConversion - unitDiscountAmount, 0));
                  const netTotalPreview = quotationMoneyValue(netPricePreview);
                  const proposedImages = [
                    template.proposed_image_url_1 ?? template.default_image_url,
                    template.proposed_image_url_2,
                    template.proposed_image_url_3,
                  ].filter((value): value is string => Boolean(value));
                  const selectedImage =
                    selectedImages[template.id] &&
                    proposedImages.includes(selectedImages[template.id])
                      ? selectedImages[template.id]
                      : proposedImages[0] ?? "";
                  const templateMaterialLinks = templateMaterialGroups.filter((link) => link.product_template_id === template.id);
                  const templateMaterialLinkIds = new Set(templateMaterialLinks.map((link) => link.id));
                  const templateMaterialItems = templateMaterialGroupItems.filter((item) =>
                    templateMaterialLinkIds.has(item.product_template_material_group_id),
                  );

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
                  const hasMixedOptionCurrencies = effectiveSelectedIds
                    .map((id) => templateComponents.find((component) => component.id === id))
                    .filter(Boolean)
                    .some(
                      (option) =>
                        normalizeCurrency(option?.currency) !== normalizeCurrency(template.currency),
                    );

                  return (
                    <article
                      key={template.id}
                      className="flex min-h-full flex-col gap-3 bg-white p-3"
                    >
                      <ProductThumbnail path={selectedImage || null} selected />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-zinc-950">
                            {template.template_name}
                          </h3>
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
                                <button
                                  key={`${imagePath}-${imageIndex}`}
                                  type="button"
                                  onClick={() =>
                                    setSelectedImages((current) => ({
                                      ...current,
                                      [template.id]: imagePath,
                                    }))
                                  }
                                  className="text-left"
                                >
                                  <ProductThumbnail
                                    label={`Image ${imageIndex + 1}`}
                                    path={imagePath}
                                    selected={selectedImage === imagePath}
                                  />
                                  <span className="mt-1 block text-center text-[10px] font-semibold text-zinc-500">
                                    Image {imageIndex + 1}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {usesWorkstationFlow ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              1. Select workstation size
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
                                    {row.variant_name} {row.dimension ? `- ${row.dimension}` : ""}
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
                                {["Cat A", "Cat B", "Cat C", "Cat D"].map((category) => (
                                  <option key={category} value={category}>
                                    {category} {selectedCategoryRow ? `- ${formatMoney(selectedCategoryRow.currency ?? template.currency, numberValue(selectedCategoryRow.prices?.[category]))}` : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ) : null}
                        {usesVariantPricing ? (
                          <label className="mt-3 block">
                            <span className="text-[10px] font-bold uppercase text-zinc-500">Select Size / Model Variant</span>
                            <select
                              value={selectedVariantRow?.id ?? ""}
                              onChange={(event) => setSelectedVariantRows((current) => ({ ...current, [template.id]: event.target.value }))}
                              className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                            >
                                {variantRows.map((row, index) => (
                                  <option key={row.id ?? index} value={row.id ?? `variant-${index}`}>
                                    {row.variant_name} {row.dimension ? `- ${row.dimension}` : ""} - {formatMoney(row.currency ?? template.currency, numberValue(row.price))}
                                  </option>
                                ))}
                              </select>
                            {selectedVariantRow ? (
                              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                {selectedVariantRow.variant_name}
                                {selectedVariantRow.dimension ? ` - ${selectedVariantRow.dimension}` : ""}
                                {" - "}
                                {formatMoney(selectedVariantRow.currency ?? template.currency, numberValue(selectedVariantRow.price))}
                                {selectedVariantRow.specification ? ` - ${selectedVariantRow.specification}` : ""}
                              </span>
                            ) : null}
                          </label>
                        ) : null}
                        {usesWorkstationFlow && (variantRows.length || accessoryGroups.length) ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-zinc-700">
                              2. Optional items
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
                                      {row.variant_name} {row.dimension ? `- ${row.dimension}` : ""} - {formatMoney(row.currency ?? template.currency, numberValue(row.price))}
                                    </option>
                                  ))}
                                </select>
                                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                  Optional workstation add-ons stay separate from the base workstation size.
                                </span>
                                {selectedWorkstationVariantRow ? (
                                  <span className="mt-1 block text-xs leading-5 text-zinc-600">
                                    Selected add-on: {selectedWorkstationVariantRow.variant_name}
                                    {selectedWorkstationVariantRow.dimension ? ` - ${selectedWorkstationVariantRow.dimension}` : ""}
                                    {" - "}
                                    {formatMoney(selectedWorkstationVariantRow.currency ?? template.currency, numberValue(selectedWorkstationVariantRow.price))}
                                    {selectedWorkstationVariantRow.specification ? ` - ${selectedWorkstationVariantRow.specification}` : ""}
                                  </span>
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
                                            <span>
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
                                              {accessory.item_name}
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
                          <div className="mt-3 space-y-2">
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
                                        <span>
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
                                          {accessory.item_name}
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
                              {usesWorkstationFlow ? "3. Linked product families" : "Linked Product Families / Screens & Add-ons"}
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
                                            {row.variant_name} {row.dimension ? `- ${row.dimension}` : ""}
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
                                        {["Cat A", "Cat B", "Cat C", "Cat D"].map((category) => (
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
                                          {row.variant_name} {row.dimension ? `- ${row.dimension}` : ""} - {formatMoney(row.currency ?? line.childTemplate.currency, numberValue(row.price))}
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
                      <div className="flex shrink-0 flex-col gap-3 border-t border-zinc-200 pt-3 text-left">
                        <div className="grid gap-1">
                          <p className="text-sm font-semibold text-zinc-950">
                            {formatQuotationMoney(previewCurrency, previewUnitPriceWithConversion)}
                          </p>
                          <PriceCheckBadge brandName={brandNameById.get(template.brand_id)} template={template} />
                          {priceCheckState(template, brandNameById.get(template.brand_id)).tone === "warning" ? (
                            <p className="max-w-52 text-[11px] leading-4 text-amber-700">
                              Please verify source price before finalizing quotation.
                            </p>
                          ) : null}
                        </div>
                        {derivedDesking ? (
                          <div className="max-w-48 space-y-1 text-xs leading-5 text-zinc-600">
                            {derivedDesking.clusterLabel ? (
                              <p>Selected size: {derivedDesking.sizeLabel}</p>
                            ) : null}
                            {derivedDesking.clusterLabel ? (
                              <p className="font-semibold text-zinc-950">
                                Cluster: {derivedDesking.clusterLabel}
                              </p>
                            ) : null}
                            {derivedDesking.dimension ? (
                              <p>Dimension: {derivedDesking.dimension}</p>
                            ) : null}
                            <p>Price: {formatMoney(derivedDesking.mainCurrency, derivedDesking.unitPrice)}</p>
                            <p>Formula: {derivedDesking.formula}</p>
                            {derivedDesking.finishNames.length ? (
                              <p>Finish: {derivedDesking.finishNames.join(", ")}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {usesVariantPricing && selectedVariantRow ? (
                          <div className="max-w-48 space-y-1 text-xs leading-5 text-zinc-600">
                            <p className="font-semibold text-zinc-950">
                              Model: {selectedVariantRow.variant_name}
                            </p>
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
                        {usesWorkstationFlow && selectedWorkstationVariantRow ? (
                          <div className="max-w-48 space-y-1 text-xs leading-5 text-zinc-600">
                            <p className="font-semibold text-zinc-950">
                              Optional item: {selectedWorkstationVariantRow.variant_name}
                            </p>
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
                        {isDesking ? (
                          <label className="block max-w-48 text-right">
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
                          <p className="max-w-40 text-xs leading-5 text-zinc-500">
                            Selected: {effectiveSelectedNames.join(", ")}
                          </p>
                        ) : null}
                        {hasMixedOptionCurrencies ? (
                          <p className="max-w-44 text-xs leading-5 text-amber-700">
                            Mixed-currency advanced options should be reviewed manually.
                          </p>
                        ) : null}
                        {hasMixedAccessoryCurrencies ? (
                          <p className="max-w-44 text-xs leading-5 text-amber-700">
                            Mixed-currency add-ons use the conversion rates below.
                          </p>
                        ) : null}
                        {hasMixedLinkedProductCurrencies ? (
                          <p className="max-w-44 text-xs leading-5 text-amber-700">
                            Mixed-currency linked products use the conversion rates below.
                          </p>
                        ) : null}
                        {nonAedCurrencies.length ? (
                          <div className="max-w-56 space-y-2 border border-amber-200 bg-amber-50 p-2 text-left text-xs leading-5 text-amber-900">
                            <p className="font-bold uppercase">
                              {usesWorkstationFlow ? "4. Currency conversion" : "Currency Conversion"}
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
                        <div className="max-w-56 space-y-2 border border-zinc-200 bg-zinc-50 p-2 text-left text-xs leading-5 text-zinc-700">
                          <p className="font-bold uppercase text-zinc-500">
                            {usesWorkstationFlow ? "5. Final quotation price" : "Pricing / Discount"}
                          </p>
                          <p>U.Price: {formatQuotationMoney(previewCurrency, previewUnitPriceWithConversion)}</p>
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
                        <form action={addProductTemplateToQuotation} className="mt-3 -mx-3 border-t border-zinc-200 bg-white px-3 py-3">
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
                          {usesCategoryPricing && selectedCategoryRow ? (
                            <>
                              <input type="hidden" name="category_pricing_row_id" value={selectedCategoryRow.id ?? ""} />
                              <input type="hidden" name="category_pricing_category" value={selectedFabricCategory} />
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
                              <input
                                key={line.link.id}
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
                          <div className="text-left">
                            <FinishSelectionsEditor
                              brands={finishBrands}
                              initialBrandId={template.brand_id}
                              initialFinishes={[]}
                              materialGroups={materialGroups}
                              materials={materials}
                              quotationId={quotationId}
                              templateMaterialGroupItems={templateMaterialItems}
                              templateMaterialGroups={templateMaterialLinks}
                            />
                          </div>
                          <div className="sticky bottom-0 -mx-3 mt-3 border-t border-zinc-200 bg-white px-3 py-3 text-right">
                            <button
                              type="submit"
                              disabled={missingExchangeRate}
                              className="h-8 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                            >
                              Add
                            </button>
                          </div>
                        </form>
                      </div>
                    </article>
                  );
                }) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
