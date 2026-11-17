"use client";

import { useId, useMemo, useState } from "react";
import {
  cleanBrandName,
  isNewBrandInput,
  resolveBrandInput,
  suggestBrands,
  type BrandCount,
} from "@/lib/products/saved-setups/custom-brands";
import { CUSTOM_ITEM_BRAND_MAX } from "@/lib/products/saved-setups/custom-item";

// Brand field for custom items: a text input with a list of the owner's existing brands (with item counts).
// Typing filters; a name that matches an existing brand (ignoring case and extra spaces) uses the EXISTING spelling;
// a name that matches nothing shows a "+ New brand: <name>" row. Arrows, Enter and Escape work.
export function BrandCombobox({
  brands,
  error,
  onChange,
  value,
}: {
  brands: BrandCount[];
  error?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(() => suggestBrands(brands, value), [brands, value]);
  const showNew = cleanBrandName(value) !== "" && isNewBrandInput(brands, value);
  const rowCount = suggestions.length + (showNew ? 1 : 0);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
    setActive(-1);
  }

  // Leaving the field (or pressing Enter) snaps a matching name to the existing spelling.
  function snap() {
    const resolved = resolveBrandInput(value, brands);
    if (resolved.ok && resolved.name !== value) onChange(resolved.name);
  }

  function pickActive() {
    if (active < 0) return false;
    if (active < suggestions.length) choose(suggestions[active].brandName);
    else choose(cleanBrandName(value));
    return true;
  }

  return (
    <div className="relative min-w-0">
      <label htmlFor={`${listId}-input`} className="mb-1 block text-xs font-semibold text-zinc-600">
        Brand <span aria-hidden="true" className="text-red-700">*</span>
      </label>
      <input
        id={`${listId}-input`}
        value={value}
        maxLength={CUSTOM_ITEM_BRAND_MAX}
        role="combobox"
        aria-label="Brand"
        aria-required="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Pick a brand or type a new one"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          // Delay so a click on a suggestion lands before the list closes.
          window.setTimeout(() => setOpen(false), 120);
          snap();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (rowCount === 0 ? -1 : (current + 1) % rowCount));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (rowCount === 0 ? -1 : (current <= 0 ? rowCount - 1 : current - 1)));
          } else if (event.key === "Enter") {
            // Enter inside the list picks the highlighted row; it never submits the form from here.
            event.preventDefault();
            if (!open || !pickActive()) {
              snap();
              setOpen(false);
            }
          } else if (event.key === "Escape" && open) {
            // Closes the list only (not the surrounding popup).
            event.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
        className="h-9 w-full rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
      <p className="mt-1 text-[11px] text-zinc-500">Pick one or type a new brand</p>
      {error ? <span role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}
      {open && rowCount > 0 ? (
        <ul id={listId} role="listbox" aria-label="Brands" className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-zinc-300 bg-white py-1 text-sm shadow-lg">
          {suggestions.map((brand, index) => (
            <li key={brand.brandName} role="option" aria-selected={active === index}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(brand.brandName)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${active === index ? "bg-emerald-50 text-emerald-900" : "text-zinc-800 hover:bg-zinc-50"}`}
              >
                <span className="truncate">{brand.brandName}</span>
                <span className="shrink-0 text-xs text-zinc-500">{brand.count}</span>
              </button>
            </li>
          ))}
          {showNew ? (
            <li role="option" aria-selected={active === suggestions.length}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(cleanBrandName(value))}
                className={`w-full px-3 py-1.5 text-left font-semibold ${active === suggestions.length ? "bg-emerald-50 text-emerald-900" : "text-emerald-900 hover:bg-zinc-50"}`}
              >
                + New brand: {cleanBrandName(value)}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

// Left column of both custom-item screens: "All brands" and each brand with its item count.
// Stacks above the list on narrow screens (the parent lays it out).
export function BrandFilterList({
  brands,
  onSelect,
  selected,
  total,
}: {
  brands: BrandCount[];
  onSelect: (brandName: string | null) => void;
  selected: string | null;
  total: number;
}) {
  const row = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition ${active ? "bg-emerald-900 font-semibold text-white" : "text-zinc-800 hover:bg-zinc-100"}`;
  return (
    <nav aria-label="Brands" className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 md:max-h-[60vh]">
      <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)} className={row(selected === null)}>
        <span>All brands</span>
        <span className="text-xs opacity-80">{total}</span>
      </button>
      {brands.map((brand) => (
        <button key={brand.brandName} type="button" aria-pressed={selected === brand.brandName} onClick={() => onSelect(brand.brandName)} className={row(selected === brand.brandName)}>
          <span className="truncate">{brand.brandName}</span>
          <span className="shrink-0 text-xs opacity-80">{brand.count}</span>
        </button>
      ))}
    </nav>
  );
}
