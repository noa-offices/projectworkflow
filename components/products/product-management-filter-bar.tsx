"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FilterOption = {
  id: string;
  name: string;
};

type ProductManagementFilterBarProps = {
  addBrandHref: string;
  addTemplateHref: string;
  brandOptions: FilterOption[];
  mainCategoryOptions: FilterOption[];
  priceStatus: string;
  searchQuery: string;
  selectedBrandId: string;
  selectedMainCategoryId: string;
  selectedSubCategoryId: string;
  subCategoryOptions: FilterOption[];
};

const searchDebounceMs = 300;

export function ProductManagementFilterBar({
  addBrandHref,
  addTemplateHref,
  brandOptions,
  mainCategoryOptions,
  priceStatus,
  searchQuery,
  selectedBrandId,
  selectedMainCategoryId,
  selectedSubCategoryId,
  subCategoryOptions,
}: ProductManagementFilterBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draftSearch, setDraftSearch] = useState(searchQuery);
  const [draftBrand, setDraftBrand] = useState(selectedBrandId);
  const [draftMainCategory, setDraftMainCategory] = useState(selectedMainCategoryId);
  const [draftSubCategory, setDraftSubCategory] = useState(selectedSubCategoryId);
  const [draftPriceStatus, setDraftPriceStatus] = useState(priceStatus);

  const replaceWithFilters = useCallback((nextValues: {
    brand?: string;
    main?: string;
    priceStatus?: string;
    q?: string;
    sub?: string;
  }) => {
    const next = new URLSearchParams(searchParams.toString());
    const values = {
      brand: nextValues.brand ?? draftBrand,
      main: nextValues.main ?? draftMainCategory,
      priceStatus: nextValues.priceStatus ?? draftPriceStatus,
      q: nextValues.q ?? draftSearch,
      sub: nextValues.sub ?? draftSubCategory,
    };

    next.set("manage", "1");

    if (values.q.trim()) next.set("q", values.q.trim());
    else next.delete("q");

    if (values.brand) next.set("brand", values.brand);
    else next.delete("brand");

    if (values.main) next.set("main", values.main);
    else next.delete("main");

    if (values.sub) next.set("sub", values.sub);
    else next.delete("sub");

    if (values.priceStatus) next.set("priceStatus", values.priceStatus);
    else next.delete("priceStatus");

    next.delete("template");
    next.delete("editTemplate");
    next.delete("addTemplate");
    next.delete("message");
    next.delete("returnTo");
    next.delete("quoteImportMode");
    next.delete("quoteImportDraft");
    next.delete("quoteImportAction");

    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }, [
    draftBrand,
    draftMainCategory,
    draftPriceStatus,
    draftSearch,
    draftSubCategory,
    pathname,
    router,
    searchParams,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (draftSearch !== searchQuery) {
        replaceWithFilters({ q: draftSearch });
      }
    }, searchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [draftSearch, replaceWithFilters, searchQuery]);

  function resetFilters() {
    setDraftSearch("");
    setDraftBrand("");
    setDraftMainCategory("");
    setDraftSubCategory("");
    setDraftPriceStatus("");

    startTransition(() => {
      router.replace(`${pathname}?manage=1`, { scroll: false });
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(180px,1fr)_170px_180px_180px_190px_auto]">
      <input
        aria-label="Search products"
        name="q"
        value={draftSearch}
        onChange={(event) => setDraftSearch(event.target.value)}
        placeholder="Search all products, codes, brands, categories..."
        className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
      <select
        aria-label="Brand"
        name="brand"
        value={draftBrand}
        onChange={(event) => {
          const value = event.target.value;
          setDraftBrand(value);
          setDraftMainCategory("");
          setDraftSubCategory("");
          replaceWithFilters({ brand: value, main: "", sub: "" });
        }}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">All brands</option>
        {brandOptions.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Main category"
        name="main"
        value={draftMainCategory}
        onChange={(event) => {
          const value = event.target.value;
          setDraftMainCategory(value);
          setDraftSubCategory("");
          replaceWithFilters({ main: value, sub: "" });
        }}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">All main categories</option>
        {mainCategoryOptions.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Sub category"
        name="sub"
        value={draftSubCategory}
        onChange={(event) => {
          const value = event.target.value;
          setDraftSubCategory(value);
          replaceWithFilters({ sub: value });
        }}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">All sub categories</option>
        {subCategoryOptions.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Price status"
        name="priceStatus"
        value={draftPriceStatus}
        onChange={(event) => {
          const value = event.target.value;
          setDraftPriceStatus(value);
          replaceWithFilters({ priceStatus: value });
        }}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">All price statuses</option>
        <option value="not_checked">Price not checked yet</option>
        <option value="due">Price check due</option>
        <option value="scheduled">New price list scheduled</option>
        <option value="checked">Price checked</option>
      </select>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          {isPending ? "Filtering..." : "Reset filters"}
        </button>
        <Link
          href={addBrandHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          + Add Brand
        </Link>
        <Link
          href={addTemplateHref}
          className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          + Add Product Template
        </Link>
      </div>
    </div>
  );
}
