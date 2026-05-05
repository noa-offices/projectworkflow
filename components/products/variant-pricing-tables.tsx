"use client";

import { useMemo, useState } from "react";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";

export type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type CategoryPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number>;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type AccessoryPricingRow = {
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

export type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

const categories = ["Cat A", "Cat B", "Cat C", "Cat D"];

function idFor(prefix: string, sortOrder: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${sortOrder}`;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeVariant(row: VariantPricingRow, index: number): VariantPricingRow {
  return {
    id: row.id || `variant-${index}`,
    variant_name: row.variant_name?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    price: numberValue(row.price),
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() ?? "",
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeCategory(row: CategoryPricingRow, index: number): CategoryPricingRow {
  return {
    id: row.id || `category-${index}`,
    variant_name: row.variant_name?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    prices: Object.fromEntries(categories.map((category) => [category, numberValue(row.prices?.[category])])),
    specification: row.specification?.trim() ?? "",
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryItem(row: AccessoryPricingItem, index: number): AccessoryPricingItem {
  return {
    id: row.id || `add-on-${index}`,
    item_name: row.item_name?.trim() ?? "",
    price: numberValue(row.price),
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() ?? "",
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryGroup(row: AccessoryPricingRow, index: number): AccessoryPricingRow {
  const flatItem = row.item_name || row.price || row.specification
    ? [normalizeAccessoryItem(row, 0)]
    : [];

  return {
    id: row.id || `add-on-group-${index}`,
    group_name: row.group_name?.trim() || "Accessories",
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    items: (row.items?.length ? row.items : flatItem).map(normalizeAccessoryItem),
  };
}

function normalizeAccessoryGroups(rows?: AccessoryPricingRow[] | null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const groupedRows = sourceRows.filter((row) => row.group_name || row.items);
  const flatRows = sourceRows.filter((row) => !row.group_name && !row.items);
  const normalizedGroups = groupedRows.map(normalizeAccessoryGroup);

  if (flatRows.length) {
    normalizedGroups.push({
      id: "accessories",
      group_name: "Accessories",
      is_active: true,
      sort_order: normalizedGroups.length,
      items: flatRows.map(normalizeAccessoryItem),
    });
  }

  return normalizedGroups.length ? normalizedGroups : [];
}

function CurrencySelect({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value?: string;
}) {
  return (
    <select
      value={normalizeCurrency(value ?? defaultCurrency)}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-24 border border-zinc-200 bg-white px-2 outline-none focus:border-emerald-800"
    >
      {supportedCurrencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code}
        </option>
      ))}
    </select>
  );
}

export function VariantPricingTable({ rows }: { rows?: VariantPricingRow[] | null }) {
  const [tableRows, setTableRows] = useState<VariantPricingRow[]>(() =>
    rows?.length ? rows.map(normalizeVariant) : [],
  );
  const serialized = useMemo(() => JSON.stringify(tableRows.map(normalizeVariant)), [tableRows]);

  function update(index: number, patch: Partial<VariantPricingRow>) {
    setTableRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="variant_pricing" value={serialized} />
      <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
        <table className="min-w-[980px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="px-2 py-2">Product / Variant</th>
              <th className="px-2 py-2">Dimension</th>
              <th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2">Specification</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, index) => (
              <tr key={row.id ?? index} className="border-t border-zinc-100">
                <td className="px-2 py-2"><input value={row.variant_name ?? ""} onChange={(e) => update(index, { variant_name: e.target.value })} className="h-8 w-32 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><input value={row.dimension ?? ""} onChange={(e) => update(index, { dimension: e.target.value })} className="h-8 w-28 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><input type="number" value={row.price ?? ""} onChange={(e) => update(index, { price: Number(e.target.value) })} className="h-8 w-24 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><CurrencySelect value={row.currency} onChange={(currency) => update(index, { currency })} /></td>
                <td className="px-2 py-2"><textarea value={row.specification ?? ""} onChange={(e) => update(index, { specification: e.target.value })} rows={1} className="w-56 rounded-sm border border-zinc-200 px-2 py-1 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><input type="checkbox" checked={row.is_active !== false} onChange={(e) => update(index, { is_active: e.target.checked })} /></td>
                <td className="px-2 py-2"><button type="button" onClick={() => setTableRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></td>
              </tr>
            ))}
            {!tableRows.length ? <tr><td colSpan={7} className="px-3 py-5 text-center text-zinc-500">No size/model variants yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setTableRows((current) => [...current, { id: idFor("variant", current.length), currency: defaultCurrency, is_active: true, sort_order: current.length }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Variant</button>
    </div>
  );
}

export function CategoryPricingTable({ rows }: { rows?: CategoryPricingRow[] | null }) {
  const [tableRows, setTableRows] = useState<CategoryPricingRow[]>(() =>
    rows?.length ? rows.map(normalizeCategory) : [],
  );
  const serialized = useMemo(() => JSON.stringify(tableRows.map(normalizeCategory)), [tableRows]);

  function update(index: number, patch: Partial<CategoryPricingRow>) {
    setTableRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="category_pricing" value={serialized} />
      <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
        <table className="min-w-[1120px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="px-2 py-2">Product / Variant</th>
              <th className="px-2 py-2">Dimension</th>
              {categories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2">Specification</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, index) => (
              <tr key={row.id ?? index} className="border-t border-zinc-100">
                <td className="px-2 py-2"><input value={row.variant_name ?? ""} onChange={(e) => update(index, { variant_name: e.target.value })} className="h-8 w-32 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><input value={row.dimension ?? ""} onChange={(e) => update(index, { dimension: e.target.value })} className="h-8 w-28 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                {categories.map((category) => <td key={category} className="px-2 py-2"><input type="number" value={row.prices?.[category] ?? ""} onChange={(e) => update(index, { prices: { ...(row.prices ?? {}), [category]: Number(e.target.value) } })} className="h-8 w-20 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>)}
                <td className="px-2 py-2"><CurrencySelect value={row.currency} onChange={(currency) => update(index, { currency })} /></td>
                <td className="px-2 py-2"><textarea value={row.specification ?? ""} onChange={(e) => update(index, { specification: e.target.value })} rows={1} className="w-52 rounded-sm border border-zinc-200 px-2 py-1 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2"><input type="checkbox" checked={row.is_active !== false} onChange={(e) => update(index, { is_active: e.target.checked })} /></td>
                <td className="px-2 py-2"><button type="button" onClick={() => setTableRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></td>
              </tr>
            ))}
            {!tableRows.length ? <tr><td colSpan={10} className="px-3 py-5 text-center text-zinc-500">No fabric/leather category variants yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setTableRows((current) => [...current, { id: idFor("category", current.length), currency: defaultCurrency, prices: {}, is_active: true, sort_order: current.length }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Fabric/Leather Row</button>
    </div>
  );
}

export function AccessoryPricingTable({ rows }: { rows?: AccessoryPricingRow[] | null }) {
  const [groups, setGroups] = useState<AccessoryPricingRow[]>(() =>
    normalizeAccessoryGroups(rows),
  );
  const serialized = useMemo(() => JSON.stringify(groups.map(normalizeAccessoryGroup)), [groups]);

  function updateGroup(index: number, patch: Partial<AccessoryPricingRow>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<AccessoryPricingItem>) {
    setGroups((current) =>
      current.map((group, currentGroupIndex) => {
        if (currentGroupIndex !== groupIndex) return group;

        return {
          ...group,
          items: (group.items ?? []).map((item, currentItemIndex) =>
            currentItemIndex === itemIndex ? { ...item, ...patch } : item,
          ),
        };
      }),
    );
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="accessory_pricing" value={serialized} />
      <div className="space-y-4">
        {groups.map((group, groupIndex) => (
          <div key={group.id ?? groupIndex} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={group.group_name ?? ""} onChange={(e) => updateGroup(groupIndex, { group_name: e.target.value })} placeholder="Accessories" className="h-8 w-56 border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800" />
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input type="checkbox" checked={group.is_active !== false} onChange={(e) => updateGroup(groupIndex, { is_active: e.target.checked })} />
                Active
              </label>
              <button type="button" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} className="ml-auto text-xs font-semibold text-red-700">Remove group</button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-xs">
                <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                  <tr>
                    <th className="px-2 py-2">Item</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Currency</th>
                    <th className="px-2 py-2">Specification</th>
                    <th className="px-2 py-2">Active</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(group.items ?? []).map((item, itemIndex) => (
                    <tr key={item.id ?? itemIndex} className="border-t border-zinc-100">
                      <td className="px-2 py-2"><input value={item.item_name ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { item_name: e.target.value })} className="h-8 w-36 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2"><input type="number" value={item.price ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { price: Number(e.target.value) })} className="h-8 w-24 border border-zinc-200 px-2 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2"><CurrencySelect value={item.currency} onChange={(currency) => updateItem(groupIndex, itemIndex, { currency })} /></td>
                      <td className="px-2 py-2"><textarea value={item.specification ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { specification: e.target.value })} rows={1} className="w-64 rounded-sm border border-zinc-200 px-2 py-1 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2"><input type="checkbox" checked={item.is_active !== false} onChange={(e) => updateItem(groupIndex, itemIndex, { is_active: e.target.checked })} /></td>
                      <td className="px-2 py-2"><button type="button" onClick={() => updateGroup(groupIndex, { items: (group.items ?? []).filter((_, index) => index !== itemIndex) })} className="text-xs font-semibold text-red-700">Remove item</button></td>
                    </tr>
                  ))}
                  {!(group.items ?? []).length ? <tr><td colSpan={6} className="px-3 py-5 text-center text-zinc-500">No items in this group yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => updateGroup(groupIndex, { items: [...(group.items ?? []), { id: idFor("add-on", group.items?.length ?? 0), currency: defaultCurrency, is_active: true, sort_order: group.items?.length ?? 0 }] })} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add more</button>
          </div>
        ))}
        {!groups.length ? <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">No option/add-on groups yet.</p> : null}
      </div>
      <button type="button" onClick={() => setGroups((current) => [...current, { id: idFor("add-on-group", current.length), group_name: "Accessories", is_active: true, sort_order: current.length, items: [] }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Option Group</button>
    </div>
  );
}
