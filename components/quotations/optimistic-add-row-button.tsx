"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { createBlankQuotationItemOptimistic } from "@/app/quotations/actions";
import { formatMoney } from "@/lib/currencies";

type OptimisticColumn = {
  className?: string;
  key: string;
};

type OptimisticRowStatus = "creating" | "failed" | "syncing";

type OptimisticRow = {
  errorMessage?: string;
  id: string;
  realItemId?: string;
  sectionId: string;
  status: OptimisticRowStatus;
};

type OptimisticBuilderContextValue = {
  createRow: (args: {
    quotationId: string;
    returnTo: string;
    sectionId: string;
  }) => void;
  dismissRow: (rowId: string) => void;
  optimisticRows: OptimisticRow[];
  retryRow: (rowId: string, args: {
    quotationId: string;
    returnTo: string;
    sectionId: string;
  }) => void;
};

const OptimisticBuilderContext = createContext<OptimisticBuilderContextValue | null>(null);

function optimisticRowId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `temp-${crypto.randomUUID()}`;
  }

  return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function useOptimisticBuilder() {
  const context = useContext(OptimisticBuilderContext);
  if (!context) {
    throw new Error("Optimistic quotation builder context is not available.");
  }

  return context;
}

export function OptimisticQuotationBuilderProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [optimisticRows, setOptimisticRows] = useState<OptimisticRow[]>([]);
  const [, startTransition] = useTransition();

  function createTempRow(sectionId: string) {
    const row: OptimisticRow = {
      id: optimisticRowId(),
      sectionId,
      status: "creating",
    };

    setOptimisticRows((current) => [...current, row]);
    return row.id;
  }

  const runCreate = useCallback(({
    quotationId,
    returnTo,
    rowId,
    sectionId,
  }: {
    quotationId: string;
    returnTo: string;
    rowId: string;
    sectionId: string;
  }) => {
    const formData = new FormData();
    formData.set("quotation_id", quotationId);
    formData.set("section_id", sectionId);
    formData.set("currency", "AED");
    formData.set("return_to", returnTo);

    startTransition(() => {
      void createBlankQuotationItemOptimistic(formData)
        .then((result) => {
          if (!result.ok) {
            setOptimisticRows((current) =>
              current.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      errorMessage: result.message,
                      status: "failed",
                    }
                  : row,
              ),
            );
            return;
          }

          setOptimisticRows((current) =>
            current.map((row) =>
              row.id === rowId
                ? {
                    ...row,
                    realItemId: result.itemId,
                    status: "syncing",
                  }
                : row,
            ),
          );
          router.refresh();
        })
        .catch((error: unknown) => {
          setOptimisticRows((current) =>
            current.map((row) =>
              row.id === rowId
                ? {
                    ...row,
                    errorMessage:
                      error instanceof Error ? error.message : "Blank row could not be created.",
                    status: "failed",
                  }
                : row,
            ),
          );
        });
    });
  }, [router, startTransition]);

  const contextValue = useMemo<OptimisticBuilderContextValue>(() => ({
    createRow({ quotationId, returnTo, sectionId }) {
      const rowId = createTempRow(sectionId);
      runCreate({ quotationId, returnTo, rowId, sectionId });
    },
    dismissRow(rowId) {
      setOptimisticRows((current) => current.filter((row) => row.id !== rowId));
    },
    optimisticRows,
    retryRow(rowId, { quotationId, returnTo, sectionId }) {
      setOptimisticRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                errorMessage: undefined,
                status: "creating",
              }
            : row,
        ),
      );
      runCreate({ quotationId, returnTo, rowId, sectionId });
    },
  }), [optimisticRows, runCreate]);

  return (
    <OptimisticBuilderContext.Provider value={contextValue}>
      {children}
    </OptimisticBuilderContext.Provider>
  );
}

export function OptimisticAddRowButton({
  quotationId,
  returnTo,
  sectionId,
}: {
  quotationId: string;
  returnTo: string;
  sectionId: string;
}) {
  const { createRow } = useOptimisticBuilder();

  return (
    <button
      type="button"
      onClick={() => createRow({ quotationId, returnTo, sectionId })}
      className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50"
    >
      + Item Row
    </button>
  );
}

function optimisticCellValue(columnKey: string, status: OptimisticRowStatus) {
  if (columnKey === "s_no") return "…";
  if (columnKey === "qty") return "1";
  if (columnKey === "discount_percentage") return "0%";
  if (columnKey === "unit_price" || columnKey === "discount" || columnKey === "discount_amount" || columnKey === "net_price" || columnKey === "net_total") {
    return formatMoney("AED", 0);
  }
  if (columnKey === "specification" || columnKey === "description") {
    return status === "failed" ? "Failed to create row." : "Creating…";
  }

  return "";
}

export function OptimisticSectionRows({
  columns,
  quotationId,
  realItemIds,
  returnTo,
  sectionId,
  showEditColumn,
}: {
  columns: OptimisticColumn[];
  quotationId: string;
  realItemIds: string[];
  returnTo: string;
  sectionId: string;
  showEditColumn: boolean;
}) {
  const { dismissRow, optimisticRows, retryRow } = useOptimisticBuilder();
  const rows = optimisticRows.filter((row) => row.sectionId === sectionId);

  useEffect(() => {
    const resolvedIds = new Set(realItemIds);
    const matchedRows = rows.filter((row) => row.realItemId && resolvedIds.has(row.realItemId));
    if (!matchedRows.length) return;

    for (const row of matchedRows) {
      dismissRow(row.id);
    }
  }, [dismissRow, realItemIds, rows]);

  if (!rows.length) {
    return null;
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.id} className="align-middle" data-temporary-row="true">
          {columns.map((column) => (
            <td
              key={`${row.id}-${column.key}`}
              className={`break-words whitespace-pre-wrap border border-zinc-300 px-2 py-2 align-middle text-zinc-700 ${column.className ?? ""}`}
            >
              {optimisticCellValue(column.key, row.status)}
            </td>
          ))}
          {showEditColumn ? (
            <td className="border border-zinc-300 bg-white px-2 py-2 align-middle">
              <div className="flex flex-col gap-1 text-[10px]">
                <span
                  className={`font-semibold ${
                    row.status === "failed" ? "text-red-700" : "text-amber-700"
                  }`}
                >
                  {row.status === "failed" ? "Failed to create row" : "Creating…"}
                </span>
                {row.status === "failed" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => retryRow(row.id, { quotationId, returnTo, sectionId })}
                      className="font-semibold text-red-700 underline underline-offset-2"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissRow(row.id)}
                      className="font-semibold text-zinc-500 underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="text-zinc-500">Row actions unlock after sync.</span>
                )}
              </div>
            </td>
          ) : null}
        </tr>
      ))}
    </>
  );
}

export function OptimisticSectionEmptyState({
  isServerEmpty,
  sectionId,
  totalColumns,
}: {
  isServerEmpty: boolean;
  sectionId: string;
  totalColumns: number;
}) {
  const { optimisticRows } = useOptimisticBuilder();
  const hasOptimisticRows = optimisticRows.some((row) => row.sectionId === sectionId);

  if (!isServerEmpty || hasOptimisticRows) {
    return null;
  }

  return (
    <tr>
      <td
        colSpan={totalColumns}
        className="border border-zinc-300 bg-white px-3 py-5 text-center text-sm text-zinc-500"
      >
        Add your first item row.
      </td>
    </tr>
  );
}
