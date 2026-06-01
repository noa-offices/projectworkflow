"use client";

import { useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  createMainCategoryFromTemplates,
  createSubCategoryFromTemplates,
} from "@/app/products/templates/actions";

type BrandOption = {
  id: string;
  name: string;
};

type CategoryOption = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
};

function InlineQuickCategoryFields({
  brandId,
  parentId,
  returnMode = "library",
}: {
  brandId: string;
  parentId?: string | null;
  returnMode?: "add-template" | "library";
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="quick_brand_id" value={brandId} />
      <input type="hidden" name="quick_parent_id" value={parentId ?? ""} />
      <input type="hidden" name="quick_return_mode" value={returnMode} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Name</span>
        <input
          name="quick_name"
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Code</span>
        <input
          name="quick_code"
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <label className="block md:col-span-2">
        <span className="text-xs font-semibold uppercase text-zinc-500">Description</span>
        <textarea
          name="quick_description"
          rows={4}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            name="quick_is_active"
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
          />
          Active
        </label>
        <PendingSubmitButton
          formAction={
            parentId ? createSubCategoryFromTemplates : createMainCategoryFromTemplates
          }
          formNoValidate
          className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          pendingLabel={parentId ? "Saving subcategory..." : "Saving category..."}
        >
          Save
        </PendingSubmitButton>
      </div>
    </div>
  );
}

function CategorySelect({
  categories,
  helper,
  label,
  name,
  onChange,
  value,
}: {
  categories: CategoryOption[];
  helper?: string;
  label: string;
  name: string;
  onChange?: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <select
        name={name}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">None</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {helper ? (
        <span className="mt-1 block text-xs text-zinc-500">{helper}</span>
      ) : null}
    </label>
  );
}

export function QuickCategoryForm({
  brandId,
  parentId,
  returnMode = "library",
}: {
  brandId: string;
  parentId?: string | null;
  returnMode?: "add-template" | "library";
}) {
  return (
    <form
      action={
        parentId ? createSubCategoryFromTemplates : createMainCategoryFromTemplates
      }
      className="grid gap-3 md:grid-cols-2"
    >
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="parent_id" value={parentId ?? ""} />
      <input type="hidden" name="return_mode" value={returnMode} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Name</span>
        <input
          name="name"
          required
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Code</span>
        <input
          name="code"
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <label className="block md:col-span-2">
        <span className="text-xs font-semibold uppercase text-zinc-500">Description</span>
        <textarea
          name="description"
          rows={4}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            name="is_active"
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
          />
          Active
        </label>
        <PendingSubmitButton
          className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          pendingLabel={parentId ? "Saving subcategory..." : "Saving category..."}
        >
          Save
        </PendingSubmitButton>
      </div>
    </form>
  );
}

export function TemplateCategoryFields({
  allowQuickCreate,
  brands,
  categories,
  defaultBrandId,
  defaultMainCategoryId,
  defaultSubCategoryId,
  onBrandChange,
}: {
  allowQuickCreate: boolean;
  brands: BrandOption[];
  categories: CategoryOption[];
  defaultBrandId?: string;
  defaultMainCategoryId?: string;
  defaultSubCategoryId?: string;
  onBrandChange?: (brandId: string) => void;
}) {
  const [selectedBrandId, setSelectedBrandId] = useState(defaultBrandId ?? "");
  const [selectedMainCategoryId, setSelectedMainCategoryId] = useState(defaultMainCategoryId ?? "");
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState(defaultSubCategoryId ?? "");

  const mainCategoryOptions = categories.filter(
    (category) => !category.parent_id && category.brand_id === selectedBrandId,
  );
  const subCategoryOptions = categories.filter(
    (category) =>
      category.parent_id &&
      category.brand_id === selectedBrandId &&
      category.parent_id === selectedMainCategoryId,
  );

  const noCategoriesHelper = selectedBrandId && !mainCategoryOptions.length
    ? "No categories yet for this brand. Add categories from Brands or Product Library."
    : undefined;

  return (
    <>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          Brand
        </span>
        <select
          name="brand_id"
          value={selectedBrandId}
          onChange={(event) => {
            setSelectedBrandId(event.target.value);
            setSelectedMainCategoryId("");
            setSelectedSubCategoryId("");
            onBrandChange?.(event.target.value);
          }}
          required
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">Select brand</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
        {!brands.length ? (
          <span className="mt-1 block text-xs text-zinc-500">
            Create a brand first.
          </span>
        ) : null}
      </label>

      <div className="space-y-2">
        <CategorySelect
          name="main_category_id"
          label="Main Category"
          categories={mainCategoryOptions}
          helper={noCategoriesHelper}
          value={selectedMainCategoryId}
          onChange={(value) => {
            setSelectedMainCategoryId(value);
            setSelectedSubCategoryId("");
          }}
        />
        {allowQuickCreate && selectedBrandId ? (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
              + New Main Category
            </summary>
            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <InlineQuickCategoryFields
                brandId={selectedBrandId}
                returnMode="add-template"
              />
            </div>
          </details>
        ) : allowQuickCreate ? (
          <p className="text-xs text-zinc-500">
            Select a brand in the form to quick-create a main category.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <CategorySelect
          name="sub_category_id"
          label="Sub Category"
          categories={subCategoryOptions}
          value={selectedSubCategoryId}
          onChange={setSelectedSubCategoryId}
        />
        {allowQuickCreate && selectedBrandId && selectedMainCategoryId ? (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
              + New Sub Category
            </summary>
            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <InlineQuickCategoryFields
                brandId={selectedBrandId}
                parentId={selectedMainCategoryId}
                returnMode="add-template"
              />
            </div>
          </details>
        ) : allowQuickCreate ? (
          <p className="text-xs text-zinc-500">
            Select a main category in the form to quick-create a subcategory.
          </p>
        ) : null}
      </div>
    </>
  );
}
