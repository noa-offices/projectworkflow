"use client";

import { useReplacementCommitSignal } from "@/components/products/use-replacement-commit";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { resolveDefaultPricingCurrency } from "@/components/products/pricing-default-currency";
import { parseNullablePricingNumber } from "@/lib/products/nullable-pricing";
import { hasMeaningfulWorkstationPricing } from "@/lib/products/workstation-pricing-state";
import { reviewImportantRequirements } from "@/lib/products/smart-product-review";
import { PricingGroupReferenceImages } from "@/components/products/finish-category-group-reference-images";
import { PricingRowReferenceImage } from "@/components/products/pricing-row-reference-image";
import {
  persistedWorkstationPricingGroupIds,
  workstationPricingGroupReferenceAvailability,
} from "@/lib/products/finish-category-reference-ui";
import {
  LEGACY_WORKSTATION_GROUP_ID,
  flattenWorkstationPricingRows,
  serializeWorkstationPricingGroups,
  workstationPricingGroups,
  type WorkstationPricingGroup,
} from "@/lib/products/workstation-pricing-groups";
import {
  addWorkstationPricingRow,
  createWorkstationPricingGroup,
  removeWorkstationPricingGroup,
  removeWorkstationPricingRow,
  replaceWholeTemplateWorkstationRows,
  shouldApplyWorkstationReplacement,
  updateWorkstationPricingGroup,
  updateWorkstationPricingRow,
} from "@/lib/products/workstation-pricing-ui-state";
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
  default_price?: number | null;
  additional_price?: number | null;
  additional_supplier_price_list_code?: string;
  currency?: string;
  specification?: string;
  importantRequirements?: string[];
  default_dimension?: string;
  sort_order?: number;
  is_active?: boolean;
};

function newRow(sortOrder: number, currency: string): DeskingSizePricingRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${sortOrder}-${Math.random().toString(36).slice(2)}`;

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
    default_price: parseNullablePricingNumber(row.default_price),
    additional_price: parseNullablePricingNumber(row.additional_price),
    additional_supplier_price_list_code: row.additional_supplier_price_list_code?.trim() || "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() || "",
    importantRequirements: reviewImportantRequirements(Array.isArray(row.importantRequirements) ? row.importantRequirements.join("\n") : ""),
    default_dimension: row.default_dimension?.trim() || fallbackDimension,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    is_active: row.is_active !== false,
  };
}

export function DeskingSizePricingTable({
  brandDefaultCurrency,
  onHasDataChange,
  onGroupsChange,
  replacementPricing,
  replacementRows,
  replacementSubgroups,
  replacementVersion,
  onReplacementCommitted,
  templateCurrency,
  templateId,
  templateIsPersisted,
  rows,
}: {
  brandDefaultCurrency?: string | null;
  onHasDataChange?: (hasWorkstationData: boolean) => void;
  onGroupsChange?: (groups: WorkstationPricingGroup<DeskingSizePricingRow>[]) => void;
  replacementPricing?: unknown;
  replacementRows?: DeskingSizePricingRow[] | null;
  replacementSubgroups?: WorkstationPricingGroup["subgroups"];
  replacementVersion?: number;
  onReplacementCommitted?: (version: number) => void;
  templateCurrency?: string | null;
  templateId: string;
  templateIsPersisted: boolean;
  rows?: unknown;
}) {
  const initialGroups = useMemo(() => workstationPricingGroups<DeskingSizePricingRow>(Array.isArray(rows) ? rows : [])
    .map((group) => ({
      id: group.id,
      pricing_type: group.pricing_type,
      group_name: group.group_name,
      is_active: group.is_active,
      sort_order: group.sort_order,
      items: group.items.map((row, index) => normalizedRow({ ...row, id: row.id || `${group.id}-size-${index}` }, index)),
      ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
    })) as WorkstationPricingGroup<DeskingSizePricingRow>[], [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<WorkstationPricingGroup<DeskingSizePricingRow>[]>(() => initialGroups);
  const [draftRows, setDraftRows] = useState<Record<string, DeskingSizePricingRow>>({});
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupActionNotices, setGroupActionNotices] = useState<Record<string, string>>({});
  const [referenceTargetGroupId, setReferenceTargetGroupId] = useState<string | null>(null);
  const persistedGroupIds = useMemo(() => persistedWorkstationPricingGroupIds(rows ?? []), [rows]);
  const appliedReplacementVersion = useRef<number | undefined>(undefined);
  const markReplacementApplied = useReplacementCommitSignal(onReplacementCommitted);
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: flattenWorkstationPricingRows<DeskingSizePricingRow>(initialGroups),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const effectiveGroups = useMemo(() => groups.map((group) => ({
    ...group,
    items: group.items.map((row, index) => {
      const key = `${group.id}:${row.id ?? `size-${index}`}`;
      return normalizedRow({ ...row, ...(draftRows[key] ?? {}) }, index);
    }),
  })), [draftRows, groups]);
  const serializedRows = useMemo(
    () => JSON.stringify(serializeWorkstationPricingGroups(effectiveGroups)),
    [effectiveGroups],
  );

  function stableId(prefix: string) {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    if (!shouldApplyWorkstationReplacement(replacementVersion, appliedReplacementVersion.current)) return;
    appliedReplacementVersion.current = replacementVersion;
    markReplacementApplied(replacementVersion);
    const nextRows = (replacementRows ?? []).map(normalizedRow);
    setGroups((current) => Array.isArray(replacementPricing)
      ? workstationPricingGroups<DeskingSizePricingRow>(replacementPricing).map((group) => ({ ...group, items: group.items.map((row, index) => normalizedRow({ ...row, id: row.id || `${group.id}-size-${index}` }, index)), ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}) }))
      : replaceWholeTemplateWorkstationRows(current, nextRows, LEGACY_WORKSTATION_GROUP_ID).map((group) => ({ ...group, ...(replacementSubgroups ? { subgroups: replacementSubgroups } : {}) })));
    setDraftRows({});
    setEditingRows({});
  }, [replacementPricing, replacementRows, replacementSubgroups, replacementVersion, markReplacementApplied]);

  useEffect(() => {
    onHasDataChange?.(hasMeaningfulWorkstationPricing(flattenWorkstationPricingRows(effectiveGroups)));
  }, [effectiveGroups, onHasDataChange]);

  useEffect(() => {
    onGroupsChange?.(effectiveGroups);
  }, [effectiveGroups, onGroupsChange]);

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
        sort_order: flattenWorkstationPricingRows(groups).length,
      }, flattenWorkstationPricingRows(groups).length);

      importedIdsRef.current.add(row.id ?? "");
      setGroups((current) => {
        if (current.length) return addWorkstationPricingRow(current, current[0].id, row);
        const group = createWorkstationPricingGroup<DeskingSizePricingRow>(stableId("workstation-group"), 0);
        return [{ ...group, items: [row] }];
      });
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
        setGroups((current) => current.map((group) => ({
          ...group,
          items: group.items.filter((row) => !importedIdsRef.current.has(row.id ?? "")),
        })));
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
  }, [brandDefaultCurrency, groups, templateCurrency, templateId]);

  useEffect(() => {
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: flattenWorkstationPricingRows(groups),
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group) => ({ ...group, items: group.items.map((row, index) => {
        const key = `${group.id}:${row.id ?? `size-${index}`}`;
        if (userEditedCurrencyRowIds.current.has(key)) {
          return row;
        }

        const draft = draftRows[key] ?? row;
        if (hasMeaningfulWorkstationPricing([draft])) {
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
      }) }));

      return didChange ? nextGroups : current;
    });

    setDraftRows((current) => {
      let didChange = false;
      const nextDrafts = { ...current };

      Object.entries(current).forEach(([key, draft]) => {
        if (userEditedCurrencyRowIds.current.has(key) || hasMeaningfulWorkstationPricing([draft])) {
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
  }, [brandDefaultCurrency, draftRows, groups, templateCurrency]);

  function rowKey(groupId: string, row: DeskingSizePricingRow, index: number) {
    return `${groupId}:${row.id ?? `size-${index}`}`;
  }

  function startEdit(groupId: string, row: DeskingSizePricingRow, index: number) {
    const key = rowKey(groupId, row, index);
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

  function saveDraft(groupId: string, row: DeskingSizePricingRow, index: number) {
    const key = rowKey(groupId, row, index);
    const nextRow = normalizedRow({ ...row, ...(draftRows[key] ?? {}) }, index);

    setGroups((current) => updateWorkstationPricingRow(current, groupId, index, nextRow));
    setEditingRows((current) => ({ ...current, [key]: false }));
  }

  function cancelEdit(groupId: string, row: DeskingSizePricingRow, index: number) {
    const key = rowKey(groupId, row, index);
    setDraftRows((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setEditingRows((current) => ({ ...current, [key]: false }));
  }

  function removeRow(groupId: string, index: number) {
    setGroups((current) => removeWorkstationPricingRow(current, groupId, index));
  }

  function openReferenceImages(groupId: string) {
    const availability = workstationPricingGroupReferenceAvailability({
      groupId,
      persistedGroupIds,
      templateIsPersisted,
    });
    if (!availability.available) {
      setGroupActionNotices((current) => ({ ...current, [groupId]: availability.message ?? "Reference images are unavailable." }));
      return;
    }
    setGroupActionNotices((current) => ({ ...current, [groupId]: "" }));
    setReferenceTargetGroupId(groupId);
  }

  const referenceTargetGroup = groups.find((group) => group.id === referenceTargetGroupId) ?? null;

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="desking_size_pricing" value={serializedRows} />
      <div className="space-y-4">
      {groups.map((group) => (
      <section key={group.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-200 bg-zinc-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-expanded={!collapsedGroups[group.id]}
              aria-label={collapsedGroups[group.id] ? "Expand pricing group" : "Collapse pricing group"}
              onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
              className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700"
            >
              {collapsedGroups[group.id] ? ">" : "v"}
            </button>
            <input
              aria-label="Workstation group title"
              value={group.group_name}
              onChange={(event) => setGroups((current) => updateWorkstationPricingGroup(current, group.id, { group_name: event.target.value }))}
              className="h-8 min-w-64 flex-1 border border-zinc-200 bg-white px-2 text-sm font-semibold outline-none focus:border-emerald-800"
            />
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
              <input
                type="checkbox"
                checked={group.is_active}
                onChange={(event) => setGroups((current) => updateWorkstationPricingGroup(current, group.id, { is_active: event.target.checked }))}
              />
              Active
            </label>
            <button
              type="button"
              onClick={() => setGroups((current) => removeWorkstationPricingGroup(current, group.id))}
              className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Remove group
            </button>
          </div>
          <button
            type="button"
            onClick={(event) => {
              const nextRowSortOrder = Math.max(-1, ...group.items.map((item) => Number(item.sort_order) || 0)) + 1;
              const row = newRow(nextRowSortOrder, resolveDefaultPricingCurrency({
                brandDefaultCurrency,
                existingRows: flattenWorkstationPricingRows(groups),
                savedTemplateCurrency: templateCurrency,
                trigger: event.currentTarget,
              }));
              const key = rowKey(group.id, row, group.items.length);
              setGroups((current) => addWorkstationPricingRow(current, group.id, row));
              setEditingRows((current) => ({ ...current, [key]: true }));
              setDraftRows((current) => ({ ...current, [key]: row }));
            }}
            className="mt-3 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900"
          >
            + Add row
          </button>
          <button
            type="button"
            onClick={() => openReferenceImages(group.id)}
            className="ml-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900"
          >
            Reference images
          </button>
          {groupActionNotices[group.id] ? <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{groupActionNotices[group.id]}</p> : null}
        </header>
      <div hidden={collapsedGroups[group.id]} className="overflow-x-auto">
        <table className="min-w-[1560px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="w-20 px-2 py-2">Image</th>
              <th className="px-2 py-2">Size / Display Name</th>
              <th className="px-2 py-2">Layout Type</th>
              <th className="px-2 py-2">Default Price</th>
              <th className="px-2 py-2">Base Supplier / Price List Code</th>
              <th className="px-2 py-2">Additional Price</th>
              <th className="px-2 py-2">Additional Supplier / Price List Code</th>
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2">Default Workstation Specification</th>
              <th className="px-2 py-2">Important Requirements</th>
              <th className="px-2 py-2">Default Dimension</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((row, index) => {
              const key = rowKey(group.id, row, index);
              const isEditing = editingRows[key] ?? !row.label;
              const draft = draftRows[key] ?? row;

              return (
                <tr key={key} className="border-t border-zinc-100">
                  <td className="px-2 py-2 align-top">{row.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="workstation" groupId={group.id} rowId={row.id} /> : <span className="text-[10px] text-zinc-400">Save row first</span>}</td>
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
                        onChange={(event) => updateDraft(key, { default_price: parseNullablePricingNumber(event.target.value) })}
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
                        onChange={(event) => updateDraft(key, { additional_price: parseNullablePricingNumber(event.target.value) })}
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
                  <td className="px-2 py-2 align-top">
                    {isEditing ? (
                      <textarea
                        value={(draft.importantRequirements ?? []).join("\n")}
                        rows={3}
                        placeholder="One requirement per line"
                        onChange={(event) => updateDraft(key, { importantRequirements: event.target.value.split(/\r?\n/) })}
                        className="min-h-[64px] min-w-[240px] border border-zinc-200 px-2 py-1 outline-none focus:border-emerald-800"
                      />
                    ) : (
                      <span className="whitespace-pre-wrap">{row.importantRequirements?.join("\n") || "-"}</span>
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
                            onClick={() => saveDraft(group.id, row, index)}
                            className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-700"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(group.id, row, index)}
                            className="text-xs font-semibold text-zinc-600 transition hover:text-zinc-950"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(group.id, row, index)}
                          className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-700"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(group.id, index)}
                        className="text-xs font-semibold text-red-700 transition hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!group.items.length ? (
              <tr>
                <td colSpan={12} className="px-3 py-5 text-center text-zinc-500">
                  No workstation sizes yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      </section>
      ))}
      {!groups.length ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          No workstation groups yet.
        </div>
      ) : null}
      </div>
      <button
        type="button"
        onClick={() => setGroups((current) => {
          const nextSortOrder = Math.max(-1, ...current.map((group) => Number(group.sort_order) || 0)) + 1;
          return [
            ...current,
            createWorkstationPricingGroup<DeskingSizePricingRow>(stableId("workstation-group"), nextSortOrder, current.length ? "New Workstation Group" : "Workstation Pricing"),
          ];
        })}
        className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
      >
        + Add Workstation Group
      </button>
      <button
        type="submit"
        className="ml-2 mt-3 rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
      >
        Save Pricing
      </button>
      {referenceTargetGroup && referenceTargetGroupId ? (
        <PricingGroupReferenceImages
          templateId={templateId}
          pricingType="workstation"
          groupId={referenceTargetGroupId}
          groupLabel={referenceTargetGroup.group_name || "Workstation Pricing"}
          onClose={() => setReferenceTargetGroupId(null)}
        />
      ) : null}
    </div>
  );
}
