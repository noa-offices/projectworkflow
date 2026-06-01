"use client";

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import {
  groupedStandardCategoryPricingRows,
  normalizeCategoryPriceLabel,
  standardCategoryPriceColumns,
} from "@/lib/products/category-pricing-groups";
import {
  MODULAR_ITEM_PRICING_TYPE,
  modularItemPricingRows,
  modularPricingDefaultsFromRows,
} from "@/lib/products/modular-pricing";
import { resolveDefaultPricingCurrency } from "@/components/products/pricing-default-currency";
import {
  TEMPLATE_IMPORT_APPLY_EVENT,
  TEMPLATE_IMPORT_RESET_EVENT,
  TEMPLATE_IMPORT_STATUS_EVENT,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";

export type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type CategoryPricingRow = {
  id?: string;
  group_id?: string;
  group_name?: string;
  items?: CategoryPricingRow[];
  price_categories?: string[];
  pricing_type?: string | null;
  pricing_category_id?: string | null;
  pricing_category_name?: string | null;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number>;
  specification?: string;
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  items?: AccessoryPricingItem[];
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

export type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

const defaultPriceCategories = ["Cat A", "Cat B", "Cat C", "Cat D"];

function idFor(prefix: string, sortOrder: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${sortOrder}`;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizedPriceMap(prices?: Record<string, unknown> | null) {
  const normalized = new Map<string, number>();

  defaultPriceCategories.forEach((category) => {
    normalized.set(category, 0);
  });

  Object.entries(prices ?? {}).forEach(([key, value]) => {
    const label = normalizeCategoryPriceLabel(key);
    if (!label) {
      return;
    }

    normalized.set(label, numberValue(value));
  });

  return Object.fromEntries(normalized.entries());
}

function formCurrencyFromTrigger(trigger?: HTMLElement | null) {
  if (!trigger) {
    return null;
  }

  const form = trigger.closest("form");
  if (!form) {
    return null;
  }

  const currencyField = form.querySelector<HTMLSelectElement | HTMLInputElement>(
    'select[name="currency"], input[name="currency"]',
  );
  if (!currencyField) {
    return null;
  }

  const value = currencyField.value.trim();
  return value ? normalizeCurrency(value) : null;
}

function existingRowsCurrency(rows: Array<{ currency?: string | null }>) {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const currency = row.currency?.trim();
    if (!currency) {
      return;
    }

    const normalized = normalizeCurrency(currency);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function resolveDefaultModularPricingCurrency({
  brandDefaultCurrency,
  existingRows = [],
  savedTemplateCurrency,
  trigger,
}: {
  brandDefaultCurrency?: string | null;
  existingRows?: Array<{ currency?: string | null }>;
  savedTemplateCurrency?: string | null;
  trigger?: HTMLElement | null;
}) {
  return (
    (brandDefaultCurrency?.trim() ? normalizeCurrency(brandDefaultCurrency) : null) ||
    (savedTemplateCurrency?.trim() ? normalizeCurrency(savedTemplateCurrency) : null) ||
    formCurrencyFromTrigger(trigger) ||
    existingRowsCurrency(existingRows) ||
    defaultCurrency
  );
}

function normalizeVariant(row: VariantPricingRow, index: number): VariantPricingRow {
  return {
    id: row.id || `variant-${index}`,
    variant_name: row.variant_name?.trim() ?? "",
    display_name: row.display_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
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
    pricing_type: typeof row.pricing_type === "string" && row.pricing_type.trim()
      ? row.pricing_type.trim()
      : null,
    pricing_category_id:
      typeof row.pricing_category_id === "string" && row.pricing_category_id.trim()
        ? row.pricing_category_id.trim()
        : null,
    pricing_category_name:
      typeof row.pricing_category_name === "string" && row.pricing_category_name.trim()
        ? row.pricing_category_name.trim()
        : null,
    variant_name: row.variant_name?.trim() ?? "",
    display_name: row.display_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    prices: normalizedPriceMap(row.prices),
    specification: row.specification?.trim() ?? "",
    modular_default_dimension:
      typeof row.modular_default_dimension === "string" && row.modular_default_dimension.trim()
        ? row.modular_default_dimension.trim()
        : null,
    modular_default_specification:
      typeof row.modular_default_specification === "string" && row.modular_default_specification.trim()
        ? row.modular_default_specification.trim()
        : null,
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryItem(row: AccessoryPricingItem, index: number): AccessoryPricingItem {
  return {
    id: row.id || `add-on-${index}`,
    item_name: row.item_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    price: numberValue(row.price),
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() ?? "",
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryGroup(row: AccessoryPricingRow, index: number): AccessoryPricingRow {
  const flatItem = row.item_name || row.supplier_price_list_code || row.price || row.specification
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

function AutoGrowTextarea({
  minHeightClass = "min-h-[56px]",
  onChange,
  placeholder,
  rows = 2,
  value,
  widthClass = "min-w-[320px]",
}: {
  minHeightClass?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
  widthClass?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${minHeightClass} ${widthClass} resize-y overflow-hidden rounded-sm border border-zinc-200 px-3 py-2 leading-5 outline-none focus:border-emerald-800`}
    />
  );
}

function categoryPricingRowWithColumns(
  row: CategoryPricingRow,
  priceCategories: string[],
): CategoryPricingRow {
  const normalized = normalizedPriceMap(row.prices);

  return {
    ...row,
    prices: Object.fromEntries(
      priceCategories.map((category) => [category, numberValue(normalized[category])]),
    ),
  };
}

function newCategoryPricingRow(
  sortOrder: number,
  priceCategories: string[],
  currency: string,
): CategoryPricingRow {
  return {
    id: idFor("category", sortOrder),
    currency: normalizeCurrency(currency),
    prices: Object.fromEntries(priceCategories.map((category) => [category, 0])),
    is_active: true,
    sort_order: sortOrder,
  };
}

function rowHasMeaningfulValues(row: CategoryPricingRow) {
  if (
    row.variant_name?.trim() ||
    row.display_name?.trim() ||
    row.supplier_price_list_code?.trim() ||
    row.dimension?.trim() ||
    row.specification?.trim()
  ) {
    return true;
  }

  return Object.values(row.prices ?? {}).some((value) => numberValue(value) !== 0);
}

function normalizeCategoryGroup(
  row: CategoryPricingRow,
  index: number,
): CategoryPricingRow {
  const items = Array.isArray(row.items)
    ? row.items.map((item, itemIndex) => normalizeCategory(item, itemIndex))
    : [];
  const priceCategories = Array.from(new Set([
    ...defaultPriceCategories,
    ...((row.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
    ...items.flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean)),
  ]));

  return {
    id: row.id || `category-group-${index}`,
    group_name: row.group_name?.trim() || "Finish Category Pricing",
    price_categories: priceCategories,
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    items,
  };
}

function variantRowHasMeaningfulValues(row: VariantPricingRow) {
  return Boolean(
    row.variant_name?.trim() ||
    row.display_name?.trim() ||
    row.supplier_price_list_code?.trim() ||
    row.dimension?.trim() ||
    row.specification?.trim() ||
    numberValue(row.price) !== 0,
  );
}

function accessoryItemHasMeaningfulValues(row: AccessoryPricingItem) {
  return Boolean(
    row.item_name?.trim() ||
    row.supplier_price_list_code?.trim() ||
    row.specification?.trim() ||
    numberValue(row.price) !== 0,
  );
}

export function VariantPricingTable({
  brandDefaultCurrency,
  rows,
  templateId,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  rows?: VariantPricingRow[] | null;
  templateId: string;
  templateCurrency?: string | null;
}) {
  const initialRows = useMemo(() => rows?.length ? rows.map(normalizeVariant) : [], [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [tableRows, setTableRows] = useState<VariantPricingRow[]>(() => initialRows);
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialRows,
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(() => JSON.stringify(tableRows.map(normalizeVariant)), [tableRows]);

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "variant") {
        return;
      }

      const row = normalizeVariant({
        id: idFor("variant", tableRows.length),
        variant_name: detail.draft.model_snapshot || detail.draft.item_name_snapshot || "Imported row",
        display_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported row",
        dimension: detail.draft.size_snapshot || "",
        price: Number(detail.draft.unit_price) || 0,
        currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
        specification: detail.draft.specification_snapshot || "",
        is_active: true,
        sort_order: tableRows.length,
      }, tableRows.length);

      importedIdsRef.current.add(row.id ?? "");
      setTableRows((current) => [...current, row]);
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "variant",
          status: "Base/model row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setTableRows((current) => current.filter((row) => !importedIdsRef.current.has(row.id ?? "")));
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "variant",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, tableRows.length, templateCurrency, templateId]);

  useEffect(() => {
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: tableRows,
      savedTemplateCurrency: templateCurrency,
    });

    setTableRows((current) => {
      let didChange = false;
      const nextRows = current.map((row, index) => {
        const key = row.id ?? `variant-${index}`;
        if (userEditedCurrencyRowIds.current.has(key) || variantRowHasMeaningfulValues(row)) {
          return row;
        }

        const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
        const previousDefaultCurrency = previousDefaultCurrencyRef.current;
        if (
          currentCurrency &&
          currentCurrency !== previousDefaultCurrency &&
          currentCurrency !== defaultCurrency
        ) {
          return row;
        }

        if (currentCurrency === nextDefaultCurrency) {
          return row;
        }

        didChange = true;
        return {
          ...row,
          currency: nextDefaultCurrency,
        };
      });

      return didChange ? nextRows : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, tableRows, templateCurrency]);

  function update(index: number, patch: Partial<VariantPricingRow>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyRowIds.current.add(tableRows[index]?.id ?? `variant-${index}`);
    }

    setTableRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="variant_pricing" value={serialized} />
      <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
        <table className="min-w-[1760px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="px-2 py-2">Variant Code / Short Name</th>
              <th className="px-2 py-2">Display Name</th>
              <th className="px-2 py-2">Supplier / Price List Code</th>
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
              <tr key={row.id ?? index} className="border-t border-zinc-100 align-top">
                <td className="px-2 py-2 align-top"><input value={row.variant_name ?? ""} onChange={(e) => update(index, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><AutoGrowTextarea value={row.display_name ?? ""} onChange={(value) => update(index, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                <td className="px-2 py-2 align-top"><input value={row.supplier_price_list_code ?? ""} onChange={(e) => update(index, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><input value={row.dimension ?? ""} onChange={(e) => update(index, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><input type="number" value={row.price ?? ""} onChange={(e) => update(index, { price: Number(e.target.value) })} className="h-10 min-w-[120px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={row.currency} onChange={(currency) => update(index, { currency })} /></div></td>
                <td className="px-2 py-2 align-top"><AutoGrowTextarea value={row.specification ?? ""} onChange={(value) => update(index, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-[360px]" /></td>
                <td className="px-2 py-2 align-top"><input type="checkbox" checked={row.is_active !== false} onChange={(e) => update(index, { is_active: e.target.checked })} /></td>
                <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => setTableRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></div></td>
              </tr>
            ))}
            {!tableRows.length ? <tr><td colSpan={9} className="px-3 py-5 text-center text-zinc-500">No size/model variants yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={(event) => setTableRows((current) => [...current, { id: idFor("variant", current.length), currency: resolveDefaultPricingCurrency({ brandDefaultCurrency, existingRows: current, savedTemplateCurrency: templateCurrency, trigger: event.currentTarget }), is_active: true, sort_order: current.length }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Variant</button>
    </div>
  );
}

export function CategoryPricingTable({
  brandDefaultCurrency,
  rows,
  templateId,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  rows?: CategoryPricingRow[] | null;
  templateId: string;
  templateCurrency?: string | null;
}) {
  const initialGroups = useMemo(
    () => groupedStandardCategoryPricingRows(rows).map((group, index) => normalizeCategoryGroup(group, index)),
    [rows],
  );
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<CategoryPricingRow[]>(() => initialGroups);
  const [newCategoryNames, setNewCategoryNames] = useState<Record<string, string>>({});
  const [showCategoryCreators, setShowCategoryCreators] = useState<Record<string, boolean>>({});
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialGroups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(
    () =>
      JSON.stringify(
        groups.map((group, groupIndex) => {
          const normalizedGroup = normalizeCategoryGroup(group, groupIndex);
          return {
            ...normalizedGroup,
            items: (normalizedGroup.items ?? []).map((item, itemIndex) =>
              normalizeCategory(
                categoryPricingRowWithColumns(item, normalizedGroup.price_categories ?? defaultPriceCategories),
                itemIndex,
              ),
            ),
          };
        }),
      ),
    [groups],
  );

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "finish") {
        return;
      }

      const price = Number(detail.draft.unit_price) || 0;
      const row = normalizeCategory({
        id: idFor("category", groups.length),
        variant_name: detail.draft.model_snapshot || detail.draft.item_name_snapshot || "Imported finish row",
        display_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported finish row",
        dimension: detail.draft.size_snapshot || "",
        currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
        prices: {
          "Cat A": price,
          "Cat B": price,
          "Cat C": price,
          "Cat D": price,
        },
        specification: detail.draft.specification_snapshot || "",
        is_active: true,
        sort_order: 0,
      }, 0);

      importedIdsRef.current.add(row.id ?? "");
      setGroups((current) => {
        if (!current.length) {
          return [normalizeCategoryGroup({
            id: "finish-category-pricing",
            group_name: "Finish Category Pricing",
            is_active: true,
            sort_order: 0,
            price_categories: defaultPriceCategories,
            items: [row],
          }, 0)];
        }

        return current.map((group, index) => index === 0
          ? {
              ...group,
              items: [...(group.items ?? []), { ...row, sort_order: group.items?.length ?? 0 }],
            }
          : group);
      });
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "finish",
          status: "Finish pricing row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setGroups((current) =>
          current.map((group) => ({
            ...group,
            items: (group.items ?? []).filter((row) => !importedIdsRef.current.has(row.id ?? "")),
          })).filter((group) => (group.items ?? []).length > 0 || group.group_name),
        );
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "finish",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, groups.length, templateCurrency, templateId]);

  function updateGroup(index: number, patch: Partial<CategoryPricingRow>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<CategoryPricingRow>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyRowIds.current.add(groups[groupIndex]?.items?.[itemIndex]?.id ?? `category-${groupIndex}-${itemIndex}`);
    }

    setGroups((current) =>
      current.map((group, currentGroupIndex) => {
        if (currentGroupIndex !== groupIndex) return group;

        return {
          ...group,
          items: (group.items ?? []).map((row, rowIndex) => rowIndex === itemIndex ? { ...row, ...patch } : row),
        };
      }),
    );
  }

  useEffect(() => {
    const allRows = groups.flatMap((group) => group.items ?? []);
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: allRows,
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group, groupIndex) => {
        const nextItems = (group.items ?? []).map((row, index) => {
          const key = row.id ?? `category-${groupIndex}-${index}`;
          if (userEditedCurrencyRowIds.current.has(key) || rowHasMeaningfulValues(row)) {
            return row;
          }

          const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
          const previousDefaultCurrency = previousDefaultCurrencyRef.current;
          if (
            currentCurrency &&
            currentCurrency !== previousDefaultCurrency &&
            currentCurrency !== defaultCurrency
          ) {
            return row;
          }

          if (currentCurrency === nextDefaultCurrency) {
            return row;
          }

          didChange = true;
          return {
            ...row,
            currency: nextDefaultCurrency,
          };
        });

        return nextItems.some((item, index) => item !== (group.items ?? [])[index])
          ? { ...group, items: nextItems }
          : group;
      });

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  function addPriceCategoryColumn(groupIndex: number) {
    const group = groups[groupIndex];
    const groupId = group?.id ?? `category-group-${groupIndex}`;
    const trimmedName = (newCategoryNames[groupId] ?? "").trim();
    if (!trimmedName) {
      return;
    }
    const normalizedCategory = normalizePriceCategoryLabel(trimmedName);
    const groupPriceCategories = group?.price_categories ?? defaultPriceCategories;
    if (!normalizedCategory || groupPriceCategories.includes(normalizedCategory)) {
      setNewCategoryNames((current) => ({ ...current, [groupId]: "" }));
      setShowCategoryCreators((current) => ({ ...current, [groupId]: false }));
      return;
    }

    updateGroup(groupIndex, {
      price_categories: [...groupPriceCategories, normalizedCategory],
      items: (group.items ?? []).map((row) => ({
        ...row,
        prices: {
          ...normalizedPriceMap(row.prices),
          [normalizedCategory]: numberValue(row.prices?.[normalizedCategory]),
        },
      })),
    });
    setNewCategoryNames((current) => ({ ...current, [groupId]: "" }));
    setShowCategoryCreators((current) => ({ ...current, [groupId]: false }));
  }

  function addRow(groupIndex: number, event: MouseEvent<HTMLButtonElement>) {
    const currency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: groups[groupIndex]?.items ?? groups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
      trigger: event.currentTarget,
    });
    updateGroup(groupIndex, {
      items: [
        ...(groups[groupIndex]?.items ?? []),
        newCategoryPricingRow(
          groups[groupIndex]?.items?.length ?? 0,
          groups[groupIndex]?.price_categories ?? defaultPriceCategories,
          currency,
        ),
      ],
    });
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="category_pricing" value={serialized} />
      <div className="space-y-4">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Finish category pricing</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Create separate finish pricing groups such as melamine, fabric, leather, glass, or acoustic panel pricing.
          </p>
          <button
            type="button"
            onClick={() => setGroups((current) => [...current, normalizeCategoryGroup({
              id: idFor("category-group", current.length),
              group_name: "Finish Category Pricing",
              is_active: true,
              sort_order: current.length,
              price_categories: defaultPriceCategories,
              items: [],
            }, current.length)])}
            className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
          >
            + Add finish pricing group
          </button>
        </div>

        {groups.length ? groups.map((group, groupIndex) => {
          const groupId = group.id ?? `category-group-${groupIndex}`;
          const groupPriceCategories = group.price_categories ?? standardCategoryPriceColumns(group.items);

          return (
            <div key={groupId} className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={group.group_name ?? ""}
                  onChange={(event) => updateGroup(groupIndex, { group_name: event.target.value })}
                  placeholder="Finish pricing group"
                  className="h-8 w-64 border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800"
                />
                <label className="flex items-center gap-2 text-xs text-zinc-600">
                  <input type="checkbox" checked={group.is_active !== false} onChange={(event) => updateGroup(groupIndex, { is_active: event.target.checked })} />
                  Active
                </label>
                <button type="button" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} className="ml-auto text-xs font-semibold text-red-700">Remove group</button>
              </div>

              {showCategoryCreators[groupId] ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={newCategoryNames[groupId] ?? ""}
                    onChange={(event) => setNewCategoryNames((current) => ({ ...current, [groupId]: event.target.value }))}
                    placeholder="Cat E"
                    className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
                  />
                  <button type="button" onClick={() => addPriceCategoryColumn(groupIndex)} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                    Add column
                  </button>
                  <button type="button" onClick={() => { setNewCategoryNames((current) => ({ ...current, [groupId]: "" })); setShowCategoryCreators((current) => ({ ...current, [groupId]: false })); }} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300">
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCategoryCreators((current) => ({ ...current, [groupId]: true }))} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                  + Add price category column
                </button>
              )}

              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[1960px] w-full text-left text-xs">
                  <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                    <tr>
                      <th className="px-2 py-2">Variant Code / Short Name</th>
                      <th className="px-2 py-2">Display Name</th>
                      <th className="px-2 py-2">Supplier / Price List Code</th>
                      <th className="px-2 py-2">Dimension</th>
                      {groupPriceCategories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}
                      <th className="px-2 py-2">Currency</th>
                      <th className="px-2 py-2">Specification</th>
                      <th className="px-2 py-2">Active</th>
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(group.items ?? []).map((row, itemIndex) => {
                      const normalizedRow = categoryPricingRowWithColumns(row, groupPriceCategories);
                      return (
                        <tr key={row.id ?? itemIndex} className="border-t border-zinc-100 align-top">
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.variant_name ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                          <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.display_name ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.supplier_price_list_code ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.dimension ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                          {groupPriceCategories.map((category) => <td key={category} className="px-2 py-2 align-top"><input type="number" value={normalizedRow.prices?.[category] ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { prices: { ...normalizedRow.prices, [category]: Number(e.target.value) } })} className="h-10 min-w-[116px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>)}
                          <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={normalizedRow.currency} onChange={(currency) => updateItem(groupIndex, itemIndex, { currency })} /></div></td>
                          <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.specification ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-[360px]" /></td>
                          <td className="px-2 py-2 align-top"><input type="checkbox" checked={normalizedRow.is_active !== false} onChange={(e) => updateItem(groupIndex, itemIndex, { is_active: e.target.checked })} /></td>
                          <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => updateGroup(groupIndex, { items: (group.items ?? []).filter((_, index) => index !== itemIndex) })} className="text-xs font-semibold text-red-700">Remove row</button></div></td>
                        </tr>
                      );
                    })}
                    {!(group.items ?? []).length ? <tr><td colSpan={groupPriceCategories.length + 5} className="px-3 py-5 text-center text-zinc-500">No finish pricing rows in this group yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={(event) => addRow(groupIndex, event)} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                + Add row
              </button>
            </div>
          );
        }) : (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            <p>No finish pricing groups yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModularItemPricingTable({
  brandDefaultCurrency,
  rows,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  rows?: CategoryPricingRow[] | null;
  templateCurrency?: string | null;
}) {
  const initialRows = useMemo(
    () => modularItemPricingRows(rows).map(normalizeCategory),
    [rows],
  );
  const modularDefaults = useMemo(() => modularPricingDefaultsFromRows(rows), [rows]);
  const [tableRows, setTableRows] = useState<CategoryPricingRow[]>(() => initialRows);
  const [priceCategories, setPriceCategories] = useState<string[]>(() => derivedPriceCategories(initialRows));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [defaultSpecification, setDefaultSpecification] = useState(modularDefaults.defaultSpecification ?? "");
  const [defaultDimension, setDefaultDimension] = useState(modularDefaults.defaultDimension ?? "");
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialRows,
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(
    () =>
      JSON.stringify(
        tableRows.map((row, index) =>
          normalizeCategory({
            ...categoryPricingRowWithColumns(row, priceCategories),
            pricing_type: MODULAR_ITEM_PRICING_TYPE,
          }, index),
        ),
      ),
    [priceCategories, tableRows],
  );
  const serializedDefaults = useMemo(
    () =>
      JSON.stringify({
        modular_default_dimension: defaultDimension.trim() || null,
        modular_default_specification: defaultSpecification.trim() || null,
      }),
    [defaultDimension, defaultSpecification],
  );

  function update(index: number, patch: Partial<CategoryPricingRow>) {
    setTableRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  useEffect(() => {
    const nextDefaultCurrency = resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: tableRows,
      savedTemplateCurrency: templateCurrency,
    });

    setTableRows((current) => {
      let didChange = false;
      const nextRows = current.map((row) => {
        if (userEditedCurrencyRowIds.current.has(row.id ?? "")) {
          return row;
        }

        if (rowHasMeaningfulValues(row)) {
          return row;
        }

        const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
        const previousDefaultCurrency = previousDefaultCurrencyRef.current;
        if (
          currentCurrency &&
          currentCurrency !== previousDefaultCurrency &&
          currentCurrency !== defaultCurrency
        ) {
          return row;
        }

        if (currentCurrency === nextDefaultCurrency) {
          return row;
        }

        didChange = true;
        return {
          ...row,
          currency: nextDefaultCurrency,
        };
      });

      return didChange ? nextRows : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, tableRows, templateCurrency]);

  function addPriceCategoryColumn() {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) return;

    const normalizedCategory = normalizePriceCategoryLabel(trimmedName);
    if (!normalizedCategory || priceCategories.includes(normalizedCategory)) {
      setNewCategoryName("");
      setShowCategoryCreator(false);
      return;
    }

    setPriceCategories((current) => [...current, normalizedCategory]);
    setTableRows((current) =>
      current.map((row) => ({
        ...row,
        prices: {
          ...normalizedPriceMap(row.prices),
          [normalizedCategory]: numberValue(row.prices?.[normalizedCategory]),
        },
      })),
    );
    setNewCategoryName("");
    setShowCategoryCreator(false);
  }

  function addRow(event: MouseEvent<HTMLButtonElement>) {
    const currency = resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: tableRows,
      savedTemplateCurrency: templateCurrency,
      trigger: event.currentTarget,
    });
    setTableRows((current) => [
      ...current,
      {
        ...newCategoryPricingRow(current.length, priceCategories, currency),
        pricing_type: MODULAR_ITEM_PRICING_TYPE,
      },
    ]);
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="modular_item_pricing" value={serialized} />
      <input type="hidden" name="modular_item_pricing_defaults" value={serializedDefaults} />
      <div className="space-y-4">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Modular item defaults</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Set the default modular specification and dimension used when this template opens in the quotation popup.
          </p>
          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Default modular specification</span>
              <AutoGrowTextarea
                value={defaultSpecification}
                onChange={setDefaultSpecification}
                minHeightClass="min-h-[72px]"
                rows={3}
                widthClass="min-w-0 w-full"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Default dimension</span>
              <input
                value={defaultDimension}
                onChange={(event) => setDefaultDimension(event.target.value)}
                placeholder="540x70x78 cmH"
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
              />
            </label>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Modular item pricing</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Add configurable modular units and their fabric/category prices for sofas, lounges, and sectional compositions.
          </p>
          {showCategoryCreator ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Cat E"
                className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
              />
              <button type="button" onClick={addPriceCategoryColumn} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                Add column
              </button>
              <button type="button" onClick={() => { setNewCategoryName(""); setShowCategoryCreator(false); }} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowCategoryCreator(true)} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
              + Add price category column
            </button>
          )}
        </div>

        {tableRows.length ? (
          <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
            <table className="min-w-[1960px] w-full text-left text-xs">
              <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                <tr>
                  <th className="px-2 py-2">Module name</th>
                  <th className="px-2 py-2">Display name</th>
                  <th className="px-2 py-2">Supplier / Price List Code</th>
                  <th className="px-2 py-2">Dimension</th>
                  {priceCategories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}
                  <th className="px-2 py-2">Currency</th>
                  <th className="px-2 py-2">Specification note</th>
                  <th className="px-2 py-2">Active</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, index) => {
                  const normalizedRow = categoryPricingRowWithColumns(row, priceCategories);
                  return (
                    <tr key={row.id ?? index} className="border-t border-zinc-100 align-top">
                      <td className="px-2 py-2 align-top"><input value={normalizedRow.variant_name ?? ""} onChange={(e) => update(index, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.display_name ?? ""} onChange={(value) => update(index, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                      <td className="px-2 py-2 align-top"><input value={normalizedRow.supplier_price_list_code ?? ""} onChange={(e) => update(index, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top"><input value={normalizedRow.dimension ?? ""} onChange={(e) => update(index, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      {priceCategories.map((category) => <td key={category} className="px-2 py-2 align-top"><input type="number" value={normalizedRow.prices?.[category] ?? ""} onChange={(e) => update(index, { prices: { ...normalizedRow.prices, [category]: Number(e.target.value) } })} className="h-10 min-w-[116px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>)}
                      <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={normalizedRow.currency} onChange={(currency) => {
                        userEditedCurrencyRowIds.current.add(normalizedRow.id ?? `${index}`);
                        update(index, { currency });
                      }} /></div></td>
                      <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.specification ?? ""} onChange={(value) => update(index, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-[360px]" /></td>
                      <td className="px-2 py-2 align-top"><input type="checkbox" checked={normalizedRow.is_active !== false} onChange={(e) => update(index, { is_active: e.target.checked })} /></td>
                      <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => setTableRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            <p>No modular item pricing rows yet.</p>
          </div>
        )}
        <button type="button" onClick={addRow} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
          + Add modular item
        </button>
      </div>
    </div>
  );
}

export function AccessoryPricingTable({
  brandDefaultCurrency,
  rows,
  templateId,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  rows?: AccessoryPricingRow[] | null;
  templateId: string;
  templateCurrency?: string | null;
}) {
  const initialGroups = useMemo(() => normalizeAccessoryGroups(rows), [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<AccessoryPricingRow[]>(() => initialGroups);
  const userEditedCurrencyItemIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialGroups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(() => JSON.stringify(groups.map(normalizeAccessoryGroup)), [groups]);

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "accessory") {
        return;
      }

      const group = normalizeAccessoryGroup({
        id: idFor("add-on-group", groups.length),
        group_name: "Imported accessories",
        is_active: true,
        sort_order: groups.length,
        items: [
          {
            id: idFor("add-on", 0),
            item_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported accessory",
            price: Number(detail.draft.unit_price) || 0,
            currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
            specification: detail.draft.specification_snapshot || "",
            is_active: true,
            sort_order: 0,
          },
        ],
      }, groups.length);

      importedIdsRef.current.add(group.id ?? "");
      setGroups((current) => [...current, group]);
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "accessory",
          status: "Accessory row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setGroups((current) => current.filter((group) => !importedIdsRef.current.has(group.id ?? "")));
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "accessory",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, groups.length, templateCurrency, templateId]);

  function updateGroup(index: number, patch: Partial<AccessoryPricingRow>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<AccessoryPricingItem>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyItemIds.current.add(groups[groupIndex]?.items?.[itemIndex]?.id ?? `add-on-${groupIndex}-${itemIndex}`);
    }

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

  useEffect(() => {
    const allItems = groups.flatMap((group) => group.items ?? []);
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: allItems,
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group, groupIndex) => {
        const nextItems = (group.items ?? []).map((item, itemIndex) => {
          const key = item.id ?? `add-on-${groupIndex}-${itemIndex}`;
          if (userEditedCurrencyItemIds.current.has(key) || accessoryItemHasMeaningfulValues(item)) {
            return item;
          }

          const currentCurrency = item.currency?.trim() ? normalizeCurrency(item.currency) : null;
          const previousDefaultCurrency = previousDefaultCurrencyRef.current;
          if (
            currentCurrency &&
            currentCurrency !== previousDefaultCurrency &&
            currentCurrency !== defaultCurrency
          ) {
            return item;
          }

          if (currentCurrency === nextDefaultCurrency) {
            return item;
          }

          didChange = true;
          return {
            ...item,
            currency: nextDefaultCurrency,
          };
        });

        const groupChanged = nextItems.some((item, itemIndex) => item !== (group.items ?? [])[itemIndex]);
        if (!groupChanged) {
          return group;
        }

        return {
          ...group,
          items: nextItems,
        };
      });

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="accessory_pricing" value={serialized} />
      <div className="space-y-4">
        {groups.map((group, groupIndex) => (
          <div key={group.id ?? groupIndex} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={group.group_name ?? ""} onChange={(e) => updateGroup(groupIndex, { group_name: e.target.value })} placeholder="Accessories / Optional Items" className="h-8 w-56 border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800" />
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input type="checkbox" checked={group.is_active !== false} onChange={(e) => updateGroup(groupIndex, { is_active: e.target.checked })} />
                Active
              </label>
              <button type="button" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} className="ml-auto text-xs font-semibold text-red-700">Remove group</button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1460px] w-full text-left text-xs">
                <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                  <tr>
                    <th className="px-2 py-2">Accessory name</th>
                    <th className="px-2 py-2">Supplier / Price List Code</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Currency</th>
                    <th className="px-2 py-2">Specification / Notes</th>
                    <th className="px-2 py-2">Active</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(group.items ?? []).map((item, itemIndex) => (
                    <tr key={item.id ?? itemIndex} className="border-t border-zinc-100 align-top">
                      <td className="px-2 py-2 align-top"><AutoGrowTextarea value={item.item_name ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { item_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[260px]" /></td>
                      <td className="px-2 py-2 align-top"><input value={item.supplier_price_list_code ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top"><input type="number" value={item.price ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { price: Number(e.target.value) })} className="h-10 min-w-[120px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={item.currency} onChange={(currency) => updateItem(groupIndex, itemIndex, { currency })} /></div></td>
                      <td className="px-2 py-2 align-top"><AutoGrowTextarea value={item.specification ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-[360px]" /></td>
                      <td className="px-2 py-2 align-top"><input type="checkbox" checked={item.is_active !== false} onChange={(e) => updateItem(groupIndex, itemIndex, { is_active: e.target.checked })} /></td>
                      <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => updateGroup(groupIndex, { items: (group.items ?? []).filter((_, index) => index !== itemIndex) })} className="text-xs font-semibold text-red-700">Remove item</button></div></td>
                    </tr>
                  ))}
                  {!(group.items ?? []).length ? <tr><td colSpan={7} className="px-3 py-5 text-center text-zinc-500">No items in this group yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={(event) => updateGroup(groupIndex, { items: [...(group.items ?? []), { id: idFor("add-on", group.items?.length ?? 0), currency: resolveDefaultPricingCurrency({ brandDefaultCurrency, existingRows: group.items ?? groups.flatMap((entry) => entry.items ?? []), savedTemplateCurrency: templateCurrency, trigger: event.currentTarget }), is_active: true, sort_order: group.items?.length ?? 0 }] })} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Accessory</button>
          </div>
        ))}
        {!groups.length ? <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">No accessories / optional items yet.</p> : null}
      </div>
      <button type="button" onClick={() => setGroups((current) => [...current, { id: idFor("add-on-group", current.length), group_name: "Accessories", is_active: true, sort_order: current.length, items: [] }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Accessory Group</button>
    </div>
  );
}
