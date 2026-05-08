"use client";

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { autosaveQuotationItemInline } from "@/app/quotations/actions";
import { quotationMoneyCell, quotationMoneyValue } from "@/lib/quotation-pricing";

type SaveStatus = "saved" | "unsaved" | "saving" | "failed";

type SaveResult = Awaited<ReturnType<typeof autosaveQuotationItemInline>>;
type SavedRowPayload = {
  discount_value: number;
  net_price: number;
  net_total: number;
  qty: number;
  unit_price: number;
};

type RowSnapshot = {
  discountType: string;
  discountValue: number;
  qty: number;
  rowId: string;
  unitPrice: number;
};

type RowEditorContextValue = {
  discountPercentageText: string;
  formatComputedValue: (field: "discount_amount" | "net_price" | "net_total") => string;
  getInputValue: (field: string, fallback: string) => string;
  isRefreshingTotal: boolean;
  markUnsaved: () => void;
  onInputChange: (field: string, nextValue: string) => void;
  retrySave: () => void;
  saveNow: () => void;
  scheduleAutosave: (field?: string) => void;
  status: SaveStatus;
};

const RowEditorContext = createContext<RowEditorContextValue | null>(null);

const statusLabels: Record<SaveStatus, string> = {
  failed: "Save failed",
  saved: "Saved",
  saving: "Saving...",
  unsaved: "Unsaved",
};

function parseNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundedLinePricing(unitPriceValue: number, discountType: string, discountValueInput: number, qty = 1) {
  const unitPrice = quotationMoneyValue(unitPriceValue);
  const discountValue = discountType === "percent"
    ? discountValueInput
    : quotationMoneyValue(discountValueInput);
  const discountAmount = quotationMoneyValue(
    discountType === "percent"
      ? (unitPrice * discountValue) / 100
      : discountValue,
  );
  const netPrice = quotationMoneyValue(Math.max(unitPrice - discountAmount, 0));

  return {
    discountAmount,
    discountValue,
    netPrice,
    netTotal: quotationMoneyValue(qty * netPrice),
    unitPrice,
  };
}

function valueFromResult(
  result: SaveResult,
  fallback: number,
  field: keyof SavedRowPayload,
) {
  if (!result.ok || !result.row) return fallback;
  const row = result.row as SavedRowPayload;
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function QuotationRowEditorProvider({
  children,
  formId,
  row,
}: {
  children: ReactNode;
  formId: string;
  row: RowSnapshot;
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [isRefreshingTotal, setIsRefreshingTotal] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({
    discount_value: String(row.discountValue),
    qty: String(row.qty),
    unit_price: String(row.unitPrice),
  });
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const pendingFieldsRef = useRef(new Set<string>());
  const saveVersionRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleBackgroundRefresh = useCallback(() => {
    clearRefreshTimer();
    setIsRefreshingTotal(true);
    refreshTimerRef.current = window.setTimeout(() => {
      startTransition(() => {
        router.refresh();
      });
      refreshTimerRef.current = window.setTimeout(() => {
        setIsRefreshingTotal(false);
        refreshTimerRef.current = null;
      }, 1200);
    }, 250);
  }, [clearRefreshTimer, router, startTransition]);

  const syncFromResult = useCallback((result: SaveResult) => {
    if (!result.ok || !result.row) return;

    setFieldValues((current) => ({
      ...current,
      discount_value: String(valueFromResult(result, row.discountValue, "discount_value")),
      qty: String(valueFromResult(result, row.qty, "qty")),
      unit_price: String(valueFromResult(result, row.unitPrice, "unit_price")),
    }));
  }, [row.discountValue, row.qty, row.unitPrice]);

  const saveNow = useCallback(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    clearTimer();
    const version = ++saveVersionRef.current;
    setStatus("saving");

    startTransition(() => {
      void autosaveQuotationItemInline(new FormData(form))
        .then((result) => {
          if (version !== saveVersionRef.current) return;
          if (result.ok) {
            syncFromResult(result);
            setStatus("saved");
            const shouldRefreshTotals = ["discount_value", "discount_type", "qty", "unit_price"].some((field) =>
              pendingFieldsRef.current.has(field),
            );
            pendingFieldsRef.current.clear();
            if (shouldRefreshTotals) {
              scheduleBackgroundRefresh();
            } else {
              setIsRefreshingTotal(false);
            }
            return;
          }
          setStatus("failed");
        })
        .catch(() => {
          if (version !== saveVersionRef.current) return;
          setStatus("failed");
        });
    });
  }, [clearTimer, formId, scheduleBackgroundRefresh, startTransition, syncFromResult]);

  const scheduleAutosave = useCallback((field?: string) => {
    if (field) {
      pendingFieldsRef.current.add(field);
    }
    setStatus("unsaved");
    clearTimer();
    timerRef.current = window.setTimeout(saveNow, 700);
  }, [clearTimer, saveNow]);

  const markUnsaved = useCallback(() => {
    setStatus((current) => (current === "saving" ? current : "unsaved"));
  }, []);

  const computed = useMemo(() => {
    const qty = parseNumber(fieldValues.qty ?? "", row.qty);
    const unitPrice = parseNumber(fieldValues.unit_price ?? "", row.unitPrice);
    const discountValue = parseNumber(fieldValues.discount_value ?? "", row.discountValue);
    return roundedLinePricing(unitPrice, row.discountType, discountValue, qty);
  }, [fieldValues.discount_value, fieldValues.qty, fieldValues.unit_price, row.discountType, row.discountValue, row.qty, row.unitPrice]);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return undefined;

    function handleSubmit(event: Event) {
      event.preventDefault();
      saveNow();
    }

    form.addEventListener("submit", handleSubmit);

    return () => {
      clearTimer();
      clearRefreshTimer();
      form.removeEventListener("submit", handleSubmit);
    };
  }, [clearRefreshTimer, clearTimer, formId, saveNow]);

  const contextValue = useMemo<RowEditorContextValue>(() => ({
    discountPercentageText: row.discountType === "percent" ? `${fieldValues.discount_value ?? row.discountValue}%` : "-",
    formatComputedValue(field) {
      if (field === "discount_amount") return quotationMoneyCell(computed.discountAmount);
      if (field === "net_price") return quotationMoneyCell(computed.netPrice);
      return quotationMoneyCell(computed.netTotal);
    },
    getInputValue(field, fallback) {
      return fieldValues[field] ?? fallback;
    },
    isRefreshingTotal,
    markUnsaved,
    onInputChange(field, nextValue) {
      setFieldValues((current) => ({ ...current, [field]: nextValue }));
      scheduleAutosave(field);
    },
    retrySave: saveNow,
    saveNow,
    scheduleAutosave,
    status,
  }), [computed.discountAmount, computed.netPrice, computed.netTotal, fieldValues, isRefreshingTotal, markUnsaved, row.discountType, row.discountValue, saveNow, scheduleAutosave, status]);

  return (
    <RowEditorContext.Provider value={contextValue}>
      {children}
    </RowEditorContext.Provider>
  );
}

export function QuotationRowFieldInput({
  align = "left",
  cellStyle,
  defaultValue,
  formatCellKey,
  formId,
  name,
  step,
  type = "text",
}: {
  align?: "left" | "right" | "center";
  cellStyle?: CSSProperties;
  defaultValue?: string | number | null;
  formId: string;
  formatCellKey?: string;
  name: string;
  step?: string;
  type?: string;
}) {
  const context = useContext(RowEditorContext);
  const isTrackedField = context && (name === "qty" || name === "unit_price" || name === "discount_value");
  const fallback = defaultValue == null ? "" : String(defaultValue);
  const value = isTrackedField ? context.getInputValue(name, fallback) : undefined;

  return (
    <input
      form={formId}
      name={name}
      type={type}
      step={type === "number" ? step : undefined}
      data-form-id={formatCellKey ? formId : undefined}
      data-format-cell={formatCellKey}
      defaultValue={isTrackedField ? undefined : fallback}
      value={isTrackedField ? value : undefined}
      onChange={isTrackedField ? (event) => context.onInputChange(name, event.target.value) : undefined}
      onInput={!isTrackedField && context ? () => {
        context.markUnsaved();
        context.scheduleAutosave(name);
      } : undefined}
      onBlur={context ? () => context.saveNow() : undefined}
      className={`w-full border-0 bg-transparent px-1 py-0.5 text-xs text-zinc-800 outline-none focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-800 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : ""
      }`}
      style={cellStyle}
    />
  );
}

export function QuotationRowComputedValue({
  fallback,
  field,
}: {
  fallback: string;
  field: "discount_amount" | "discount_percentage" | "net_price" | "net_total";
}) {
  const context = useContext(RowEditorContext);

  if (!context) return <>{fallback}</>;
  if (field === "discount_percentage") {
    return <>{context.discountPercentageText}</>;
  }

  return <>{context.formatComputedValue(field)}</>;
}

export function QuotationRowSaveControls() {
  const context = useContext(RowEditorContext);
  const status = context?.status ?? "saved";
  const isSaving = status === "saving";

  return (
    <>
      {status === "failed" ? (
        <button
          type="button"
          onClick={() => context?.retrySave()}
          className="h-6 border border-red-700 bg-red-700 px-2 text-[11px] font-semibold text-white transition hover:bg-red-600"
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          onClick={() => context?.saveNow()}
          disabled={isSaving}
          className="h-6 border border-emerald-900 bg-emerald-900 px-2 text-[11px] font-semibold text-white transition hover:bg-emerald-800"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      )}
      <span
        className={`text-[10px] font-semibold ${
          status === "failed"
            ? "text-red-700"
            : status === "saving"
              ? "text-amber-700"
              : status === "unsaved"
                ? "text-zinc-500"
                : "text-emerald-800"
        }`}
      >
        {statusLabels[status]}
      </span>
      {context?.isRefreshingTotal ? (
        <span className="text-[10px] font-semibold text-zinc-500">Updating total...</span>
      ) : null}
    </>
  );
}
