"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createBrandMainCategoryFromQuoteForm,
  createBrandSubcategoryFromQuoteForm,
  saveQuotationItemToProductLibrary,
} from "@/app/quotations/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type {
  ProductLibraryBrand,
  ProductLibraryCategory,
  ProductLibraryTemplate,
} from "@/components/quotations/product-library-selector";

type ManualQuoteRowLibraryItem = {
  id: string;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  model_snapshot: string | null;
  origin_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  size_snapshot: string | null;
  specification_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  supplier_name_snapshot: string | null;
  unit_label: string;
};

function queryValue(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value?.trim() || "";
}

function Field({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      />
    </label>
  );
}

function TextArea({
  className = "",
  defaultValue,
  label,
  name,
}: {
  className?: string;
  defaultValue?: string | null;
  label: string;
  name: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={3}
        className="w-full resize-none border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      />
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <PendingSubmitButton
      className="h-8 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </PendingSubmitButton>
  );
}

function CurrencySelect({
  defaultValue,
  name,
}: {
  defaultValue: string;
  name: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Currency</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      >
        <option value="AED">AED</option>
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
      </select>
    </label>
  );
}

function templateCategoryLabel(
  template: ProductLibraryTemplate,
  categories: ProductLibraryCategory[],
) {
  const mainCategory = categories.find((category) => category.id === template.main_category_id);
  const subCategory = categories.find((category) => category.id === template.sub_category_id);
  return [mainCategory?.name, subCategory?.name].filter(Boolean).join(" / ");
}

export function SaveRowToProductLibraryPanel({
  canManageProductLibrary,
  defaultBrandId,
  defaultCurrency,
  defaultPrice,
  descriptionDefault,
  item,
  productBrands,
  productCategories,
  productTemplates,
  quotationId,
  returnTo,
  variantSpecificationDefault,
}: {
  canManageProductLibrary: boolean;
  defaultBrandId: string;
  defaultCurrency: string;
  defaultPrice: number;
  descriptionDefault: string;
  item: ManualQuoteRowLibraryItem;
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productTemplates: ProductLibraryTemplate[];
  quotationId: string;
  returnTo: string;
  variantSpecificationDefault: string;
}) {
  const searchParams = useSearchParams();
  const queryItemId = queryValue(searchParams, "quote_library_item_id");
  const queryBrandId = queryValue(searchParams, "quote_library_brand_id");
  const queryMainCategoryId = queryValue(searchParams, "quote_library_main_category_id");
  const querySavedMode = queryValue(searchParams, "quote_library_saved_mode");
  const querySavedTemplateId = queryValue(searchParams, "saved_template_id");
  const queryImageNotice = queryValue(searchParams, "quote_library_image_notice");
  const querySubCategoryId = queryValue(searchParams, "quote_library_sub_category_id");
  const queryMessage = queryValue(searchParams, "message");
  const queryMatchesItem = queryItemId === item.id;
  const saveSucceededForItem = queryMatchesItem && Boolean(querySavedTemplateId);
  const successMessage =
    querySavedMode === "existing_family_variant"
      ? "Item added under existing product family."
      : saveSucceededForItem
        ? "Product saved to Product Library."
        : queryMessage || "Product saved to Product Library.";
  const initialBrandId = queryMatchesItem && queryBrandId ? queryBrandId : defaultBrandId;
  const initialMainCategoryId = queryMatchesItem ? queryMainCategoryId : "";
  const initialSubCategoryId = queryMatchesItem ? querySubCategoryId : "";
  const formStateKey = [
    item.id,
    initialBrandId,
    initialMainCategoryId,
    initialSubCategoryId,
  ].join(":");

  return (
    <SaveRowToProductLibraryPanelInner
      key={formStateKey}
      canManageProductLibrary={canManageProductLibrary}
      defaultCurrency={defaultCurrency}
      defaultPrice={defaultPrice}
      descriptionDefault={descriptionDefault}
      initialBrandId={initialBrandId}
      initialMainCategoryId={initialMainCategoryId}
      initialSubCategoryId={initialSubCategoryId}
      item={item}
      productBrands={productBrands}
      productCategories={productCategories}
      productTemplates={productTemplates}
      quotationId={quotationId}
      returnTo={returnTo}
      saveSucceededForItem={saveSucceededForItem}
      successMessage={successMessage}
      savedTemplateId={querySavedTemplateId}
      imageNotice={queryImageNotice}
      variantSpecificationDefault={variantSpecificationDefault}
    />
  );
}

function SaveRowToProductLibraryPanelInner({
  canManageProductLibrary,
  defaultCurrency,
  defaultPrice,
  descriptionDefault,
  initialBrandId,
  initialMainCategoryId,
  initialSubCategoryId,
  item,
  productBrands,
  productCategories,
  productTemplates,
  quotationId,
  returnTo,
  saveSucceededForItem,
  successMessage,
  savedTemplateId,
  imageNotice,
  variantSpecificationDefault,
}: {
  canManageProductLibrary: boolean;
  defaultCurrency: string;
  defaultPrice: number;
  descriptionDefault: string;
  initialBrandId: string;
  initialMainCategoryId: string;
  initialSubCategoryId: string;
  item: ManualQuoteRowLibraryItem;
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productTemplates: ProductLibraryTemplate[];
  quotationId: string;
  returnTo: string;
  saveSucceededForItem: boolean;
  successMessage: string;
  savedTemplateId: string;
  imageNotice: string;
  variantSpecificationDefault: string;
}) {
  const [selectedBrandId, setSelectedBrandId] = useState(initialBrandId);
  const [selectedMainCategoryId, setSelectedMainCategoryId] = useState(initialMainCategoryId);
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState(initialSubCategoryId);
  const [selectedExistingTemplateId, setSelectedExistingTemplateId] = useState("");
  const [showAddMainCategory, setShowAddMainCategory] = useState(false);
  const [showAddSubCategory, setShowAddSubCategory] = useState(false);

  const mainCategories = useMemo(
    () => productCategories.filter((category) => !category.parent_id && category.brand_id === selectedBrandId),
    [productCategories, selectedBrandId],
  );
  const subCategories = useMemo(
    () => productCategories.filter(
      (category) =>
        Boolean(category.parent_id) &&
        category.brand_id === selectedBrandId &&
        category.parent_id === selectedMainCategoryId,
    ),
    [productCategories, selectedBrandId, selectedMainCategoryId],
  );
  const filteredTemplateGroups = useMemo(() => {
    const brandsToShow = selectedBrandId
      ? productBrands.filter((brand) => brand.id === selectedBrandId)
      : productBrands;

    return brandsToShow
      .map((brand) => ({
        brand,
        templates: productTemplates.filter((template) => template.brand_id === brand.id),
      }))
      .filter((group) => group.templates.length > 0);
  }, [productBrands, productTemplates, selectedBrandId]);

  const handleBrandChange = (nextBrandId: string) => {
    setSelectedBrandId(nextBrandId);
    setSelectedMainCategoryId("");
    setSelectedSubCategoryId("");
    setSelectedExistingTemplateId("");
    setShowAddSubCategory(false);
  };

  const handleMainCategoryChange = (nextMainCategoryId: string) => {
    setSelectedMainCategoryId(nextMainCategoryId);
    setSelectedSubCategoryId("");
    setShowAddSubCategory(false);
  };

  return (
    <fieldset className="border border-zinc-300 bg-white p-3">
      <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">
        Product Library
      </legend>
      <p className="text-xs text-zinc-500">
        This item is currently a manual quotation row.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Save this item to Product Library?
      </p>
      {saveSucceededForItem ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-950">{successMessage}</p>
          <div className="mt-2">
            <Link
              href={`/products/templates?template=${savedTemplateId}`}
              className="text-sm font-semibold text-emerald-900 underline underline-offset-2 transition hover:text-emerald-700"
            >
              Open product template
            </Link>
          </div>
          {imageNotice ? (
            <p className="mt-2 text-xs text-amber-800">{imageNotice}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-zinc-600">
            This quotation row stays unchanged.
          </p>
        </div>
      ) : null}
      {!canManageProductLibrary ? (
        <p className="mt-2 text-xs text-zinc-500">
          Product Library saving is available to settings managers.
        </p>
      ) : saveSucceededForItem ? null : !productBrands.length ? (
        <p className="mt-2 text-xs text-zinc-500">
          Create a brand first in the Product Library before saving this row.
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          <details data-state-key={`quotation-item-save-library-new-family-${item.id}`}>
            <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-900">
              Save as new product family
            </summary>
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <form action={saveQuotationItemToProductLibrary} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="quotation_item_id" value={item.id} />
                <input type="hidden" name="quotation_id" value={quotationId} />
                <input type="hidden" name="return_to" value={returnTo} />
                <input type="hidden" name="save_mode" value="new_family" />
                <Field
                  name="template_name"
                  label="Template name"
                  defaultValue={item.item_name_snapshot ?? item.model_snapshot}
                  required
                />
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Brand</span>
                  <select
                    name="brand_id"
                    value={selectedBrandId}
                    onChange={(event) => handleBrandChange(event.target.value)}
                    required
                    className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
                  >
                    <option value="">Select brand</option>
                    {productBrands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field name="template_code" label="Template code" defaultValue={item.item_code_snapshot} />
                <Field name="item_code" label="Item code" defaultValue={item.item_code_snapshot} />
                <div className="space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Main category</span>
                    <select
                      name="main_category_id"
                      value={selectedMainCategoryId}
                      onChange={(event) => handleMainCategoryChange(event.target.value)}
                      className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
                    >
                      <option value="">No main category</option>
                      {mainCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!selectedBrandId ? (
                    <p className="text-[11px] text-zinc-500">Select a brand first.</p>
                  ) : !mainCategories.length ? (
                    <div className="space-y-1">
                      <p className="text-[11px] text-zinc-500">No categories yet for this brand.</p>
                      <p className="text-[11px] text-zinc-500">Add a main category to organize this product.</p>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Subcategory</span>
                    <select
                      name="sub_category_id"
                      value={selectedSubCategoryId}
                      onChange={(event) => setSelectedSubCategoryId(event.target.value)}
                      className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
                    >
                      <option value="">No subcategory</option>
                      {subCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedMainCategoryId && !subCategories.length ? (
                    <p className="text-[11px] text-zinc-500">No subcategories yet.</p>
                  ) : null}
                  {!selectedMainCategoryId ? (
                    <p className="text-[11px] text-zinc-500">Select a main category first.</p>
                  ) : null}
                </div>
                <TextArea
                  name="description"
                  label="Description"
                  defaultValue={descriptionDefault}
                  className="md:col-span-2"
                />
                <TextArea
                  name="default_specification"
                  label="Specification"
                  defaultValue={item.specification_snapshot}
                  className="md:col-span-2"
                />
                <Field name="origin" label="Origin" defaultValue={item.origin_snapshot} />
                <Field name="supplier_name" label="Supplier" defaultValue={item.supplier_name_snapshot} />
                <Field name="unit_label" label="Unit" defaultValue={item.unit_label ?? "Pc"} />
                <Field name="default_unit_price" label="Default unit price" type="number" defaultValue={defaultPrice} />
                <CurrencySelect name="currency" defaultValue={defaultCurrency} />
                <Field
                  name="template_image_url"
                  label="Template image URL"
                  defaultValue={item.proposed_image_url_snapshot ?? item.specified_image_url_snapshot}
                />
                <div className="md:col-span-2">
                  <Field
                    name="reference_image_url"
                    label="Reference image URL"
                    defaultValue={item.specified_image_url_snapshot}
                  />
                </div>
                <p className="text-[11px] text-zinc-500 md:col-span-2">
                  Detailed finish selections stay on the quotation row only. Basic finish and dimension notes can be edited above.
                </p>
                <div className="flex justify-end md:col-span-2">
                  <SubmitButton label="Save as new product family" />
                </div>
              </form>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowAddMainCategory((current) => !current)}
                    disabled={!selectedBrandId}
                    className="text-xs font-semibold text-emerald-900 disabled:text-zinc-400"
                  >
                    + Add main category
                  </button>
                  {showAddMainCategory ? (
                    <form action={createBrandMainCategoryFromQuoteForm} className="grid gap-2 rounded-md border border-zinc-200 bg-white p-3">
                      <input type="hidden" name="brand_id" value={selectedBrandId} />
                      <input type="hidden" name="quotation_item_id" value={item.id} />
                      <input type="hidden" name="quotation_id" value={quotationId} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <Field name="name" label="Main category name" required />
                      <Field name="sort_order" label="Sort order" type="number" />
                      <div className="flex gap-2">
                        <SubmitButton label="Save" />
                        <button
                          type="button"
                          onClick={() => setShowAddMainCategory(false)}
                          className="h-8 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowAddSubCategory((current) => !current)}
                    disabled={!selectedBrandId || !selectedMainCategoryId}
                    className="text-xs font-semibold text-emerald-900 disabled:text-zinc-400"
                  >
                    + Add subcategory
                  </button>
                  {showAddSubCategory ? (
                    <form action={createBrandSubcategoryFromQuoteForm} className="grid gap-2 rounded-md border border-zinc-200 bg-white p-3">
                      <input type="hidden" name="brand_id" value={selectedBrandId} />
                      <input type="hidden" name="parent_id" value={selectedMainCategoryId} />
                      <input type="hidden" name="quotation_item_id" value={item.id} />
                      <input type="hidden" name="quotation_id" value={quotationId} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <Field name="name" label="Subcategory name" required />
                      <Field name="sort_order" label="Sort order" type="number" />
                      <div className="flex gap-2">
                        <SubmitButton label="Save" />
                        <button
                          type="button"
                          onClick={() => setShowAddSubCategory(false)}
                          className="h-8 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              </div>
            </div>
          </details>

          <details data-state-key={`quotation-item-save-library-existing-family-${item.id}`}>
            <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-900">
              Add to existing product family
            </summary>
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              {!filteredTemplateGroups.length ? (
                <p className="text-xs text-zinc-500">
                  {selectedBrandId
                    ? "No product families found for the selected brand."
                    : "Create a product family first, then add this row as a new variant."}
                </p>
              ) : (
                <form action={saveQuotationItemToProductLibrary} className="grid gap-3 md:grid-cols-2">
                  <input type="hidden" name="quotation_item_id" value={item.id} />
                  <input type="hidden" name="quotation_id" value={quotationId} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <input type="hidden" name="save_mode" value="existing_family_variant" />
                  <div className="md:col-span-2">
                    <p className="text-xs text-zinc-500">
                      Add this row under an existing family as a new size or model variant.
                    </p>
                  </div>
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Brand filter</span>
                    <select
                      value={selectedBrandId}
                      onChange={(event) => handleBrandChange(event.target.value)}
                      className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
                    >
                      <option value="">All brands</option>
                      {productBrands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Product family</span>
                    <select
                      name="existing_template_id"
                      value={selectedExistingTemplateId}
                      onChange={(event) => setSelectedExistingTemplateId(event.target.value)}
                      required
                      className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
                    >
                      <option value="">Select product family</option>
                      {filteredTemplateGroups.map(({ brand, templates }) => (
                        <optgroup key={brand.id} label={brand.name}>
                          {templates.map((template) => {
                            const categoryLabel = templateCategoryLabel(template, productCategories);
                            const codeLabel = template.template_code || template.item_code;

                            return (
                              <option key={template.id} value={template.id}>
                                {[
                                  template.template_name,
                                  codeLabel ? `(${codeLabel})` : null,
                                  categoryLabel ? `- ${categoryLabel}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <Field
                    name="variant_name"
                    label="Variant / model label"
                    defaultValue={item.item_name_snapshot ?? item.model_snapshot}
                    required
                  />
                  <Field name="dimension" label="Dimension / size" defaultValue={item.size_snapshot} />
                  <Field name="variant_item_code" label="Item code" defaultValue={item.item_code_snapshot} />
                  <Field name="variant_price" label="Variant price" type="number" defaultValue={defaultPrice} />
                  <CurrencySelect name="variant_currency" defaultValue={defaultCurrency} />
                  <TextArea
                    name="variant_specification"
                    label="Variant specification"
                    defaultValue={variantSpecificationDefault}
                    className="md:col-span-2"
                  />
                  <p className="text-[11px] text-zinc-500 md:col-span-2">
                    Variant images and detailed finish selections stay on the quotation row only. This saves a reusable pricing/specification variant under the selected family.
                  </p>
                  <div className="flex justify-end md:col-span-2">
                    <SubmitButton label="Add under existing product family" />
                  </div>
                </form>
              )}
            </div>
          </details>
        </div>
      )}
    </fieldset>
  );
}
