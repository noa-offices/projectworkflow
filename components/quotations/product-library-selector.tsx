"use client";

import { useEffect, useMemo, useState } from "react";
import { addProductTemplateToQuotation } from "@/app/quotations/actions";
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
  default_image_url: string | null;
  reference_image_url: string | null;
  currency: string;
  default_unit_price: number;
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

function ProductThumbnail({ path }: { path: string | null }) {
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
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-dashed border-zinc-300 bg-white text-center text-[10px] text-zinc-400">
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
                  const groupedOptions = new Map<string, ProductLibraryComponent[]>();
                  const templateSelections = selectedOptions[template.id] ?? {};

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

                      if (optionType === "linked_addon") {
                        if (Array.isArray(selectedValue)) return selectedValue;

                        return groupOptions
                          .filter((option) => option.is_default_selected)
                          .map((option) => option.id);
                      }

                      if (typeof selectedValue === "string") {
                        return selectedValue ? [selectedValue] : [];
                      }

                      const defaultOption = groupOptions.find((option) => option.is_default_selected);

                      return defaultOption ? [defaultOption.id] : [];
                    },
                  );
                  const effectiveSelectedNames = effectiveSelectedIds
                    .map((id) => templateComponents.find((component) => component.id === id)?.component_name)
                    .filter(Boolean);

                  return (
                    <article
                      key={template.id}
                      className="flex gap-3 border border-zinc-200 bg-white p-3"
                    >
                      <ProductThumbnail
                        path={template.default_image_url ?? template.reference_image_url}
                      />
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
                                                ? ` (+${option.currency} ${option.unit_price.toFixed(2)})`
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
                                      {optionTypeLabels.get(optionType) ?? "Option"}: {componentGroup}
                                    </span>
                                    <select
                                      value={
                                        typeof selectedValue === "string"
                                          ? selectedValue
                                          : groupOptions.find((option) => option.is_default_selected)?.id ?? ""
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
                                            ? ` (+${option.currency} ${option.unit_price.toFixed(2)})`
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
                          {template.currency} {template.default_unit_price.toFixed(2)}
                        </p>
                        {effectiveSelectedNames.length ? (
                          <p className="max-w-40 text-xs leading-5 text-zinc-500">
                            Selected: {effectiveSelectedNames.join(", ")}
                          </p>
                        ) : null}
                        <form action={addProductTemplateToQuotation}>
                          <input type="hidden" name="quotation_id" value={quotationId} />
                          <input type="hidden" name="section_id" value={sectionId} />
                          <input type="hidden" name="template_id" value={template.id} />
                          <input type="hidden" name="return_to" value={returnTo} />
                          {effectiveSelectedIds.map((id) => (
                            <input
                              key={id}
                              type="hidden"
                              name="selected_component_id"
                              value={id}
                            />
                          ))}
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
