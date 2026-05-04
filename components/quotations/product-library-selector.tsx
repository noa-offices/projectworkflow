"use client";

import { useEffect, useMemo, useState } from "react";
import { addProductTemplateToQuotation } from "@/app/quotations/actions";
import { formatMoney, normalizeCurrency } from "@/lib/currencies";
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
  currency: string;
  default_unit_price: number;
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

function activeSizePricingRows(rows?: DeskingSizePricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => numberValue(row.length) > 0 && numberValue(row.depth) > 0 && numberValue(row.height) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
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
    /workstation|desk|desking/.test(mainCategory?.toLowerCase() ?? "") ||
    /workstation|desk|desking/.test(subCategory?.toLowerCase() ?? "") ||
    false ||
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
    void supabase.storage
      .from("product-images")
      .createSignedUrl(path, 60 * 60)
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
  quotationId,
  returnTo,
  sectionId,
  templates,
}: {
  brands: ProductLibraryBrand[];
  categories: ProductLibraryCategory[];
  components: ProductLibraryComponent[];
  quotationId: string;
  returnTo: string;
  sectionId: string;
  templates: ProductLibraryTemplate[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Record<string, string | string[]>>>({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [additionalClusterQuantities, setAdditionalClusterQuantities] = useState<Record<string, number>>({});
  const [accessoryQuantities, setAccessoryQuantities] = useState<Record<string, Record<string, number>>>({});
  const [selectedDeskingSizes, setSelectedDeskingSizes] = useState<Record<string, string>>({});

  const brandNameById = useMemo(
    () => new Map(brands.map((brand) => [brand.id, brand.name])),
    [brands],
  );
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
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col border border-zinc-300 bg-white shadow-xl">
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

            <div className="grid gap-2 border-b border-zinc-200 bg-zinc-50 p-3 md:grid-cols-4">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products"
                className="h-9 border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-800 md:col-span-4"
              />
              <select
                value={brandId}
                onChange={(event) => setBrandId(event.target.value)}
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
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
              >
                <option value="">All categories</option>
                {mainCategories.map((category) => (
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
                {subcategories.map((category) => (
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
                }}
                className="h-9 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400"
              >
                Reset
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {filteredTemplates.map((template) => {
                  const mainCategory = template.main_category_id
                    ? categoryNameById.get(template.main_category_id)
                    : null;
                  const subCategory = template.sub_category_id
                    ? categoryNameById.get(template.sub_category_id)
                    : null;
                  const templateComponents = componentsByTemplate.get(template.id) ?? [];
                  const sizePricingRows = activeSizePricingRows(template.desking_size_pricing);
                  const groupedOptions = new Map<string, ProductLibraryComponent[]>();
                  const templateSelections = selectedOptions[template.id] ?? {};
                  const additionalClusterQty = Math.max(
                    0,
                    Math.trunc(numberValue(additionalClusterQuantities[template.id], 0)),
                  );
                  const templateAccessoryQuantities = accessoryQuantities[template.id] ?? {};
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
                  const isDesking = isDeskingTemplate({
                    mainCategory,
                    subCategory,
                    templateComponents,
                  }) || sizePricingRows.length > 0;
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
                      className="flex gap-3 border border-zinc-200 bg-white p-3"
                    >
                      <ProductThumbnail path={selectedImage || null} />
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
                        {isDesking && sizePricingRows.length ? (
                          <label className="mt-3 block">
                            <span className="text-[10px] font-bold uppercase text-zinc-500">
                              Size
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
                      <div className="flex shrink-0 flex-col items-end justify-between gap-3 text-right">
                        <p className="text-sm font-semibold text-zinc-950">
                          {formatMoney(
                            derivedDesking?.mainCurrency ?? template.currency,
                            derivedDesking?.unitPrice ?? template.default_unit_price,
                          )}
                        </p>
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
                            Currency conversion is not enabled yet. Mixed-currency totals should be reviewed manually.
                          </p>
                        ) : null}
                        <form action={addProductTemplateToQuotation}>
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
                          <button
                            type="submit"
                            className="h-8 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                          >
                            Add
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })}

                {!filteredTemplates.length ? (
                  <p className="border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
                    No product templates match your search.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
