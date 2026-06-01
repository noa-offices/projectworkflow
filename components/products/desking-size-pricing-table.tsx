"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { resolveDefaultPricingCurrency } from "@/components/products/pricing-default-currency";
import {
  TEMPLATE_IMPORT_APPLY_EVENT,
  TEMPLATE_IMPORT_RESET_EVENT,
  TEMPLATE_IMPORT_STATUS_EVENT,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";

export type DeskingSizePricingRow = {
  id?: string;
  label?: string;
  supplier_price_list_code?: string;
  base_supplier_price_list_code?: string;
  length?: number;
  depth?: number;
  height?: number;
  dimension_unit?: string;
  layout_type?: string;
  default_price?: number;
  additional_price?: number;
  additional_supplier_price_list_code?: string;
  currency?: string;
  specification?: string;
  default_dimension?: string;
  sort_order?: number;
  is_active?: boolean;
};

function newRow(sortOrder: number, currency: string): DeskingSizePricingRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${sortOrder}`;

  return {
    id,
    dimension_unit: "cm",
    layout_type: "Linear",
    currency: normalizeCurrency(currency),
    sort_order: sortOrder,
    is_active: true,
  };
}

function numericValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseDimensionLabel(label?: string) {
  const parts = (label ?? "")
    .trim()
    .split(/\s*x\s*/i)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (parts.length !== 3) {
    return null;
  }

  return {
    length: parts[0],
    depth: parts[1],
    height: parts[2],
  };
}

function normalizedLayoutType(value: unknown) {
  return value === "Linear" || value === "Cluster" || value === "Both" ? value : "Linear";
}

function normalizedRow(row: DeskingSizePricingRow, index: number): DeskingSizePricingRow {
  const parsed = parseDimensionLabel(
    typeof row.default_dimension === "string" && row.default_dimension.trim()
      ? row.default_dimension
      : row.label,
  );
  const length = parsed?.length ?? numericValue(row.length);
  const depth = parsed?.depth ?? numericValue(row.depth);
  const height = parsed?.height ?? numericValue(row.height);
  const fallbackDimension = length && depth && height ? `${length} x ${depth} x ${height}` : "";
  const baseSupplierPriceListCode = row.base_supplier_price_list_code?.trim() || row.supplier_price_list_code?.trim() || "";

  return {
    id: row.id || `size-${index}`,
    label: row.label?.trim() || fallbackDimension,
    supplier_price_list_code: baseSupplierPriceListCode,
    base_supplier_price_list_code: baseSupplierPriceListCode,
    length,
    depth,
    height,
    dimension_unit: row.dimension_unit?.trim() || "cm",
    layout_type: normalizedLayoutType(row.layout_type),
    default_price: numericValue(row.default_price),
    additional_price: numericValue(row.additional_price),
    additional_supplier_price_list_code: row.additional_supplier_price_list_code?.trim() || "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() || "",
    default_dimension: row.default_dimension?.trim() || fallbackDimension,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
  };
}

function rowHasMeaningfulValues(row: DeskingSizePricingRow) {
  return Boolean(
    row.label?.trim() ||
    row.base_supplier_price_list_code?.trim() ||
    row.additional_supplier_price_list_code?.trim() ||
    numericValue(row.length) !== 0 ||
    numericValue(row.depth) !== 0 ||
    numericValue(row.height) !== 0 ||
    row.specification?.trim() ||
    row.default_dimension?.trim() ||
    numericValue(row.default_price) !== 0 ||
    numericValue(row.additional_price) !== 0,
  );
}

export function DeskingSizePricingTable({
  brandDefaultCurrency,
  templateCurrency,
  templateId,
  rows,
}: {
  brandDefaultCurrency?: string | null;
  templateCurrency?: string | null;
  templateId: string;
  rows?: DeskingSizePricingRow[] | null;
}) {
  const initialRows = useMemo(() => rows?.length ? rows.map(normalizedRow) : [], [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [tableRows, setTableRows] = useState<DeskingSizePricingRow[]>(() => initialRows);
  const [draftRows, setDraftRows] = useState<Record<string, DeskingSizePricingRow>>({});
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({});
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialRows,
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serializedRows = useMemo(
    () =>
      JSON.stringify(
        tableRows.map((row, index) => {
          const key = row.id ?? `size-${index}`;
          return normalizedRow({ ...row, ...(draftRows[key] ?? {}) }, index);
        }),
      ),
    [draftRows, tableRows],
  );

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "workstation") {
        return;
      }

      const row = normalizedRow({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `size-import-${Date.now()}`,
        label: detail.draft.size_snapshot || detail.draft.item_name_snapshot || "Imported size",
        supplier_price_list_code: "",
        base_supplier_price_list_code: "",
        default_price: Number(detail.draft.unit_price) || 0,
        additional_price: 0,
        additional_supplier_price_list_code: "",
        currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
        dimension_unit: "cm",
        layout_type: "Linear",
        specification: detail.draft.specification_snapshot || "",
        default_dimension: detail.draft.size_snapshot || "",
        is_active: true,
        sort_order: tableRows.length,
      }, tableRows.length);

      importedIdsRef.current.add(row.id ?? "");
      setTableRows((current) => [...current, row]);
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "workstation",
          status: "Workstation size row added.",
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
        setTableRows((current) =>
          current.filter((row) => !importedIdsRef.current.has(row.id ?? "")),
        );
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "workstation",
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
        const key = row.id ?? `size-${index}`;
        if (userEditedCurrencyRowIds.current.has(key)) {
          return row;
        }

        const draft = draftRows[key] ?? row;
        if (rowHasMeaningfulValues(draft)) {
          return row;
        }

        const currentCurrency = draft.currency?.trim() ? normalizeCurrency(draft.currency) : null;
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

    setDraftRows((current) => {
      let didChange = false;
      const nextDrafts = { ...current };

      Object.entries(current).forEach(([key, draft]) => {
        if (userEditedCurrencyRowIds.current.has(key) || rowHasMeaningfulValues(draft)) {
          return;
        }

        const currentCurrency = draft.currency?.trim() ? normalizeCurrency(draft.currency) : null;
        const previousDefaultCurrency = previousDefaultCurrencyRef.current;
        if (
          currentCurrency &&
          currentCurrency !== previousDefaultCurrency &&
          currentCurrency !== defaultCurrency
        ) {
          return;
        }

        if (currentCurrency === nextDefaultCurrency) {
          return;
        }

        didChange = true;
        nextDrafts[key] = { ...draft, currency: nextDefaultCurrency };
      });

      return didChange ? nextDrafts : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, draftRows, tableRows, templateCurrency]);

  function rowKey(row: DeskingSizePricingRow, index: number) {
    return row.id ?? `size-${index}`;
  }

  function startEdit(row: DeskingSizePricingRow, index: number) {
    const key = rowKey(row, index);
    setDraftRows((current) => ({ ...current, [key]: row }));
    setEditingRows((current) => ({ ...current, [key]: true }));
  }

  function updateDraft(key: string, patch: Partial<DeskingSizePricingRow>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyRowIds.current.add(key);
    }

    setDraftRows((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), ...patch },
    }));
  }

  function saveDraft(row: DeskingSizePricingRow, index: number) {
    const key = rowKey(row, index);
    const nextRow = normalizedRow({ ...row, ...(draftRows[key] ?? {}) }, index);

    setTableRows((current) =>
      current.map((currentRow, rowIndex) => (rowIndex === index ? nextRow : currentRow)),
    );
    setEditingRows((current) => ({ ...current, [key]: false }));
  }

  function cancelEdit(row: DeskingSizePricingRow, index: number) {
    const key = rowKey(row, index);
    setEditingRows((current) => ({ ...current, [key]: false }));
  }

  function removeRow(index: number) {
    setTableRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="desking_size_pricing" value={serializedRows} />
      <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
        <table className="min-w-[1560px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="px-2 py-2">Size / Display Name</th>
              <th className="px-2 py-2">Layout Type</th>
              <th className="px-2 py-2">Default Price</th>
              <th className="px-2 py-2">Base Supplier / Price List Code</th>
              <th className="px-2 py-2">Additional Price</th>
              <th className="px-2 py-2">Additional Supplier / Price List Code</th>
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2">Default Workstation Specification</th>
              <th className="px-2 py-2">Default Dimension</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, index) => {
              const key = rowKey(row, index);
              const isEditing = editingRows[key] ?? !row.label;
              const draft = draftRows[key] ?? row;

              return (
                <tr key={key} className="border-t border-zinc-100">
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        value={draft.label ?? ""}
                        placeholder="6-person bench"
                        onChange={(event) => updateDraft(key, { label: event.target.value })}
                        className="h-8 w-48 border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span className="font-medium text-zinc-900">{row.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <select
                        value={normalizedLayoutType(draft.layout_type)}
                        onChange={(event) => updateDraft(key, { layout_type: event.target.value })}
                        className="h-8 w-28 border border-zinc-200 bg-white px-2 outline-none focus:border-emerald-800"
                      >
                        <option value="Linear">Linear</option>
                        <option value="Cluster">Cluster</option>
                        <option value="Both">Both</option>
                      </select>
                    ) : (
                      <span>{row.layout_type || "Linear"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draft.default_price ?? ""}
                        onChange={(event) => updateDraft(key, { default_price: Number(event.target.value) })}
                        className="h-8 w-28 border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span>{row.default_price}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        value={draft.base_supplier_price_list_code ?? draft.supplier_price_list_code ?? ""}
                        onChange={(event) => updateDraft(key, {
                          base_supplier_price_list_code: event.target.value,
                          supplier_price_list_code: event.target.value,
                        })}
                        className="h-8 min-w-[180px] border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span>{row.base_supplier_price_list_code || row.supplier_price_list_code || "-"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draft.additional_price ?? ""}
                        onChange={(event) => updateDraft(key, { additional_price: Number(event.target.value) })}
                        className="h-8 w-28 border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span>{row.additional_price}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        value={draft.additional_supplier_price_list_code ?? ""}
                        onChange={(event) => updateDraft(key, { additional_supplier_price_list_code: event.target.value })}
                        className="h-8 min-w-[180px] border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span>{row.additional_supplier_price_list_code || "-"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <select
                        value={normalizeCurrency(draft.currency ?? defaultCurrency)}
                        onChange={(event) => updateDraft(key, { currency: event.target.value })}
                        className="h-8 w-24 border border-zinc-200 bg-white px-2 outline-none focus:border-emerald-800"
                      >
                        {supportedCurrencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{normalizeCurrency(row.currency ?? defaultCurrency)}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top">
                    {isEditing ? (
                      <textarea
                        value={draft.specification ?? ""}
                        rows={3}
                        onChange={(event) => updateDraft(key, { specification: event.target.value })}
                        className="min-h-[64px] min-w-[280px] border border-zinc-200 px-2 py-1 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span className="whitespace-pre-wrap">{row.specification || "-"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        value={draft.default_dimension ?? ""}
                        placeholder="240x120x75 cmH"
                        onChange={(event) => updateDraft(key, { default_dimension: event.target.value })}
                        className="h-8 min-w-[150px] border border-zinc-200 px-2 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span>{row.default_dimension || "-"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={draft.is_active !== false}
                        onChange={(event) => updateDraft(key, { is_active: event.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300"
                      />
                    ) : (
                      <span>{row.is_active !== false ? "Yes" : "No"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveDraft(row, index)}
                            className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-700"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(row, index)}
                            className="text-xs font-semibold text-zinc-600 transition hover:text-zinc-950"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row, index)}
                          className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-700"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="text-xs font-semibold text-red-700 transition hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!tableRows.length ? (
              <tr>
                <td colSpan={11} className="px-3 py-5 text-center text-zinc-500">
                  No workstation sizes yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={(event) => {
          const row = newRow(
            tableRows.length,
            resolveDefaultPricingCurrency({
              brandDefaultCurrency,
              existingRows: tableRows,
              savedTemplateCurrency: templateCurrency,
              trigger: event.currentTarget,
            }),
          );
          setTableRows((current) => [...current, row]);
          setEditingRows((current) => ({ ...current, [row.id ?? ""]: true }));
          setDraftRows((current) => ({ ...current, [row.id ?? ""]: row }));
        }}
        className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
      >
        + Add Size
      </button>
      <button
        type="submit"
        className="ml-2 mt-3 rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
      >
        Save Pricing
      </button>
    </div>
  );
}
