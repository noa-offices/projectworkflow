"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  updateQuotationColumnWidth,
  updateQuotationItemRowHeight,
  updateQuotationSectionRowHeight,
} from "@/app/quotations/actions";

type SheetColumn = {
  key: string;
  width: number;
};

type ResizeState = {
  key: string;
  startX: number;
  startWidth: number;
};

type RowResizeState = {
  id: string;
  type: "item" | "section";
  row: HTMLTableRowElement;
  startY: number;
  startHeight: number;
};

const minColumnWidth = 40;
const maxColumnWidth = 800;
const minRowHeight = 40;
const maxRowHeight = 600;

function clampWidth(width: number) {
  return Math.min(Math.max(Math.round(width), minColumnWidth), maxColumnWidth);
}

function clampHeight(height: number) {
  return Math.min(Math.max(Math.round(height), minRowHeight), maxRowHeight);
}

export function QuotationSheetTable({
  quotationId,
  columns,
  children,
}: {
  quotationId: string;
  columns: SheetColumn[];
  children: ReactNode;
}) {
  const [widths, setWidths] = useState(() =>
    Object.fromEntries(columns.map((column) => [column.key, clampWidth(column.width)])),
  );
  const widthsRef = useRef(widths);
  const [, startTransition] = useTransition();

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const tableMinWidth = useMemo(
    () => columns.reduce((total, column) => total + (widths[column.key] ?? column.width), 0),
    [columns, widths],
  );

  function saveColumnWidth(key: string, width: number) {
    const formData = new FormData();
    formData.set("quotation_id", quotationId);
    formData.set("column_key", key);
    formData.set("width", String(clampWidth(width)));

    startTransition(() => {
      void updateQuotationColumnWidth(formData);
    });
  }

  function saveRowHeight(type: RowResizeState["type"], id: string, height: number) {
    const formData = new FormData();
    formData.set("quotation_id", quotationId);
    formData.set("id", id);
    formData.set("row_height", String(clampHeight(height)));

    startTransition(() => {
      if (type === "section") {
        void updateQuotationSectionRowHeight(formData);
        return;
      }

      void updateQuotationItemRowHeight(formData);
    });
  }

  function startColumnResize(event: ReactMouseEvent<HTMLTableElement>) {
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-column]");
    const key = handle?.dataset.resizeColumn;

    if (!key) return;

    event.preventDefault();
    event.stopPropagation();

    const resizeState: ResizeState = {
      key,
      startX: event.clientX,
      startWidth: widthsRef.current[key] ?? minColumnWidth,
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(moveEvent: MouseEvent) {
      const nextWidth = clampWidth(resizeState.startWidth + moveEvent.clientX - resizeState.startX);
      setWidths((current) => ({ ...current, [resizeState.key]: nextWidth }));
    }

    function onMouseUp(upEvent: MouseEvent) {
      const nextWidth = clampWidth(resizeState.startWidth + upEvent.clientX - resizeState.startX);
      setWidths((current) => ({ ...current, [resizeState.key]: nextWidth }));
      saveColumnWidth(resizeState.key, nextWidth);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function startRowResize(event: ReactMouseEvent<HTMLTableElement>) {
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-row-id]");
    const id = handle?.dataset.resizeRowId;
    const type = handle?.dataset.resizeRowType === "section" ? "section" : "item";
    const handleRow = handle?.closest("tr");
    const row =
      handle?.dataset.resizeRowTarget === "previous"
        ? handleRow?.previousElementSibling
        : handleRow;

    if (!id || !(row instanceof HTMLTableRowElement)) return;

    event.preventDefault();
    event.stopPropagation();

    const resizeState: RowResizeState = {
      id,
      type,
      row,
      startY: event.clientY,
      startHeight: clampHeight(row.getBoundingClientRect().height),
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(moveEvent: MouseEvent) {
      const nextHeight = clampHeight(resizeState.startHeight + moveEvent.clientY - resizeState.startY);
      resizeState.row.style.height = `${nextHeight}px`;
    }

    function onMouseUp(upEvent: MouseEvent) {
      const nextHeight = clampHeight(resizeState.startHeight + upEvent.clientY - resizeState.startY);
      resizeState.row.style.height = `${nextHeight}px`;
      saveRowHeight(resizeState.type, resizeState.id, nextHeight);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function startResize(event: ReactMouseEvent<HTMLTableElement>) {
    if ((event.target as HTMLElement).closest("[data-resize-row-id]")) {
      startRowResize(event);
      return;
    }

    startColumnResize(event);
  }

  return (
    <table
      className="w-full table-fixed border-collapse text-left text-xs"
      style={{ minWidth: tableMinWidth }}
      onMouseDown={startResize}
    >
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={{ width: `${widths[column.key] ?? column.width}px` }} />
        ))}
      </colgroup>
      {children}
    </table>
  );
}
