"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

const MIN_ROW_HEIGHT = 40;
const MAX_ROW_HEIGHT = 600;

function clampHeight(value: number) {
  return Math.min(Math.max(Math.round(value), MIN_ROW_HEIGHT), MAX_ROW_HEIGHT);
}

export function RowHeightTextarea({
  formId,
  name,
  defaultValue,
  rowHeight,
  cellStyle,
  formatCellKey,
}: {
  formId: string;
  name: string;
  defaultValue?: string | null;
  rowHeight?: number | null;
  cellStyle?: CSSProperties;
  formatCellKey?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const heightInputRef = useRef<HTMLInputElement>(null);
  const initialHeightRef = useRef<number | null>(null);

  const resizeToContent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const manualMinHeight = rowHeight
      ? Math.max(rowHeight - 18, MIN_ROW_HEIGHT)
      : MIN_ROW_HEIGHT;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, manualMinHeight)}px`;
  }, [rowHeight]);

  const syncHeight = useCallback((force = false) => {
    const textarea = textareaRef.current;
    const heightInput = heightInputRef.current;
    if (!textarea || !heightInput) return;

    resizeToContent();

    const measuredHeight = clampHeight(textarea.getBoundingClientRect().height);
    if (initialHeightRef.current === null) {
      initialHeightRef.current = measuredHeight;
    }

    const resized = Math.abs(measuredHeight - initialHeightRef.current) > 2;
    if (rowHeight || resized || force) {
      heightInput.value = String(measuredHeight);
    }
  }, [resizeToContent, rowHeight]);

  useEffect(() => {
    const form = document.getElementById(formId);
    const textarea = textareaRef.current;
    if (!form || !textarea) return;

    const animationFrame = window.requestAnimationFrame(() => {
      resizeToContent();
      initialHeightRef.current = clampHeight(textarea.getBoundingClientRect().height);
    });
    const handleSubmit = () => syncHeight(false);

    form.addEventListener("submit", handleSubmit);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      form.removeEventListener("submit", handleSubmit);
    };
  }, [formId, resizeToContent, syncHeight]);

  return (
    <>
      <input
        ref={heightInputRef}
        form={formId}
        type="hidden"
        name="row_height"
        defaultValue={rowHeight ?? ""}
      />
      <textarea
        ref={textareaRef}
        form={formId}
        name={name}
        data-form-id={formatCellKey ? formId : undefined}
        data-format-cell={formatCellKey}
        defaultValue={defaultValue ?? ""}
        rows={2}
        onInput={() => syncHeight(true)}
        onBlur={() => syncHeight(false)}
        onMouseUp={() => syncHeight(false)}
        className="min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-0.5 text-xs text-zinc-700 outline-none focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-800"
        style={{
          ...(rowHeight ? { minHeight: `${Math.max(rowHeight - 18, MIN_ROW_HEIGHT)}px` } : {}),
          ...cellStyle,
        }}
      />
    </>
  );
}
