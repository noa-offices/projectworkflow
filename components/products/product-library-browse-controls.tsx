"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { toolbarControl as control, toolbarFocusRing as focusRing, toolbarActions, toolbarContainer, toolbarRow, toolbarSearch, toolbarSecondaryButton, toolbarSelectWidth } from "./product-toolbar-styles";

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

const chipClass = (active: boolean) => `inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition ${focusRing} ${
  active ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
}`;

/**
 * Product Library toolbar: live search, Main category, Sub category, the brand chips, the result count and the link to Product
 * Management in one wrapping block. The product list is read on the server, so every change updates the address (soft navigation, no reload).
 */
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
    }, 250);

    return () => window.clearTimeout(handle);
  }, [draftSearch, replaceParams, searchQuery]);

  const hasFilters = Boolean(searchQuery || selectedBrandId || selectedCategoryId || selectedSubCategoryId);

  return (
    <section className={`${toolbarContainer} ${toolbarRow}`} aria-label="Find products">
      <div className={toolbarSearch}>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          aria-label="Search products"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
          placeholder="Search product name, item code, model, or template code"
          className={`${control} w-full pl-9 pr-3`}
        />
      </div>
      <select
        aria-label="Main category"
        value={selectedCategoryId}
        onChange={(event) => replaceParams({ main: event.target.value || null, sub: null })}
        className={`${control} ${toolbarSelectWidth}`}
      >
        <option value="">All main categories</option>
        {categoryOptions.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      <select
        aria-label="Sub category"
        value={selectedSubCategoryId}
        onChange={(event) => replaceParams({ sub: event.target.value || null })}
        className={`${control} ${toolbarSelectWidth}`}
      >
        <option value="">All sub categories</option>
        {subCategoryOptions.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      <a
        href="/products/manage"
        className={`${toolbarSecondaryButton} @xl:ml-auto`}
      >
        Open Product Management
      </a>

      <div className="flex w-full flex-wrap items-center gap-2" role="group" aria-label="Brand">
        <button type="button" aria-pressed={!selectedBrandId} onClick={() => replaceParams({ brand: null, main: null, sub: null })} className={chipClass(!selectedBrandId)}>
          All Brands
        </button>
        {brandOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={selectedBrandId === option.id}
            onClick={() => replaceParams({ brand: option.id, main: null, sub: null })}
            className={chipClass(selectedBrandId === option.id)}
          >
            {option.label}
            {typeof option.count === "number" ? ` ${option.count}` : ""}
          </button>
        ))}
        <p className="ml-auto text-sm text-zinc-600" role="status" aria-live="polite">
          {isPending ? "Updating results..." : `${resultCount} ${resultCount === 1 ? "product" : "products"} found`}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setDraftSearch("");
              replaceParams({ q: null, brand: null, main: null, sub: null });
            }}
            className={`text-sm font-semibold text-emerald-900 transition hover:text-emerald-800 ${focusRing}`}
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}
