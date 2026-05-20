"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type BrowseOption = {
  id: string;
  label: string;
  count?: number;
};

type ProductLibraryBrowseControlsProps = {
  brandOptions: BrowseOption[];
  categoryOptions: BrowseOption[];
  subCategoryOptions: BrowseOption[];
  selectedBrandId: string;
  selectedCategoryId: string;
  selectedSubCategoryId: string;
  searchQuery: string;
  resultCount: number;
};

export function ProductLibraryBrowseControls({
  brandOptions,
  categoryOptions,
  subCategoryOptions,
  selectedBrandId,
  selectedCategoryId,
  selectedSubCategoryId,
  searchQuery,
  resultCount,
}: ProductLibraryBrowseControlsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draftSearch, setDraftSearch] = useState(searchQuery);

  const replaceParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }

    next.delete("template");
    next.delete("editTemplate");
    next.delete("addTemplate");
    next.delete("manage");
    next.delete("priceStatus");

    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draftSearch === searchQuery) return;
      replaceParams({ q: draftSearch.trim() || null });
    }, 300);

    return () => window.clearTimeout(handle);
  }, [draftSearch, replaceParams, searchQuery]);

  const hasFilters = Boolean(searchQuery || selectedBrandId || selectedCategoryId || selectedSubCategoryId);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Product Library</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Browse reusable product templates by brand, category, or search.
            </p>
          </div>
          <a
            href="/products/management"
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Open Product Management
          </a>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px]">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Search</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Search product name, item code, model, or template code"
              className="h-11 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Main Category</span>
            <select
              value={selectedCategoryId}
              onChange={(event) => replaceParams({ main: event.target.value || null, sub: null })}
              className="h-11 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sub Category</span>
            <select
              value={selectedSubCategoryId}
              onChange={(event) => replaceParams({ sub: event.target.value || null })}
              className="h-11 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All sub categories</option>
              {subCategoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => replaceParams({ brand: null, main: null, sub: null })}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              !selectedBrandId
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            All Brands
          </button>
          {brandOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => replaceParams({ brand: option.id, main: null, sub: null })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                selectedBrandId === option.id
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              {option.label}
              {typeof option.count === "number" ? ` ${option.count}` : ""}
            </button>
          ))}
        </div>

        {selectedBrandId && categoryOptions.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => replaceParams({ main: null, sub: null })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                !selectedCategoryId
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              All
            </button>
            {categoryOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => replaceParams({ main: option.id, sub: null })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  selectedCategoryId === option.id
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
              >
                {option.label}
                {typeof option.count === "number" ? ` ${option.count}` : ""}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-sm">
          <p className="text-zinc-600">
            {isPending ? "Updating results..." : `${resultCount} products found`}
          </p>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setDraftSearch("");
                replaceParams({ q: null, brand: null, main: null, sub: null });
              }}
              className="font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
