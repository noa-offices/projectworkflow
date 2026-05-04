"use client";

import { useEffect, useRef, useState } from "react";

type ToolbarState = {
  formId: string;
  cellKey: string;
  top: number;
  left: number;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: string;
  wrapText: string;
  mergeMode: string;
};

const fontSizes = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"];

function fieldName(cellKey: string, field: string) {
  return `cell_style_${cellKey}_${field}`;
}

function associatedInput(formId: string, name: string) {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[form="${CSS.escape(formId)}"][name="${CSS.escape(name)}"]`,
  );
}

function associatedValue(formId: string, name: string, fallback: string) {
  return associatedInput(formId, name)?.value || fallback;
}

function setAssociatedValue(formId: string, name: string, value: string) {
  const input = associatedInput(formId, name);
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function applyElementStyle(element: HTMLElement, state: ToolbarState) {
  element.style.fontSize = `${state.fontSize}px`;
  element.style.fontWeight = state.fontWeight;
  element.style.fontStyle = state.fontStyle;
  element.style.textDecoration = state.textDecoration;
  element.style.textAlign = state.textAlign;
  element.style.whiteSpace = state.wrapText === "true" ? "pre-wrap" : "nowrap";
  element.style.overflow = state.wrapText === "true" ? "" : "hidden";
  element.style.textOverflow = state.wrapText === "true" ? "" : "ellipsis";
}

export function CellFormattingToolbar() {
  const [state, setState] = useState<ToolbarState | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function showToolbar(event: FocusEvent | MouseEvent) {
      const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-format-cell]");
      const formId = element?.dataset.formId;
      const cellKey = element?.dataset.formatCell;

      if (!element || !formId || !cellKey) return;

      const rect = element.getBoundingClientRect();
      activeElementRef.current = element;
      setState({
        formId,
        cellKey,
        top: Math.max(window.scrollY + rect.top - 38, 8),
        left: Math.max(window.scrollX + rect.left, 8),
        fontSize: associatedValue(formId, fieldName(cellKey, "font_size"), "12"),
        fontWeight: associatedValue(formId, fieldName(cellKey, "font_weight"), "400"),
        fontStyle: associatedValue(formId, fieldName(cellKey, "font_style"), "normal"),
        textDecoration: associatedValue(formId, fieldName(cellKey, "text_decoration"), "none"),
        textAlign: associatedValue(formId, fieldName(cellKey, "text_align"), "left"),
        wrapText: associatedValue(formId, fieldName(cellKey, "wrap_text"), "true"),
        mergeMode: associatedValue(formId, "merge_mode", "none"),
      });
    }

    function maybeHideToolbar(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-cell-formatting-toolbar]") || target?.closest("[data-format-cell]")) {
        return;
      }
      activeElementRef.current = null;
      setState(null);
    }

    function syncActiveElement() {
      if (activeElementRef.current && state) applyElementStyle(activeElementRef.current, state);
    }

    document.addEventListener("focusin", showToolbar);
    document.addEventListener("mousedown", showToolbar);
    document.addEventListener("mousedown", maybeHideToolbar);
    syncActiveElement();

    return () => {
      document.removeEventListener("focusin", showToolbar);
      document.removeEventListener("mousedown", showToolbar);
      document.removeEventListener("mousedown", maybeHideToolbar);
    };
  }, [state]);

  if (!state) return null;

  function update(next: Partial<ToolbarState>) {
    setState((current) => {
      if (!current) return current;

      const merged = { ...current, ...next };
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "font_size"), merged.fontSize);
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "font_weight"), merged.fontWeight);
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "font_style"), merged.fontStyle);
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "text_decoration"), merged.textDecoration);
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "text_align"), merged.textAlign);
      setAssociatedValue(merged.formId, fieldName(merged.cellKey, "wrap_text"), merged.wrapText);
      setAssociatedValue(merged.formId, "merge_mode", merged.mergeMode);

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>("[data-format-cell]") ?? activeElementRef.current
          : activeElementRef.current;
      if (activeElement) applyElementStyle(activeElement, merged);

      return merged;
    });
  }

  const buttonClass = "h-7 min-w-7 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-700 hover:bg-emerald-50";
  const activeClass = "border-emerald-900 bg-emerald-50 text-emerald-950";

  return (
    <div
      data-cell-formatting-toolbar
      className="fixed z-50 flex items-center gap-1 border border-zinc-300 bg-white p-1 shadow-lg"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <select
        aria-label="Font size"
        value={state.fontSize}
        onChange={(event) => update({ fontSize: event.target.value })}
        className="h-7 border border-zinc-300 bg-white px-1 text-xs text-zinc-800"
      >
        {fontSizes.map((size) => (
          <option key={size} value={size}>{size}</option>
        ))}
      </select>
      <button type="button" className={`${buttonClass} ${state.fontWeight === "700" ? activeClass : ""}`} onClick={() => update({ fontWeight: state.fontWeight === "700" ? "400" : "700" })}>B</button>
      <button type="button" className={`${buttonClass} italic ${state.fontStyle === "italic" ? activeClass : ""}`} onClick={() => update({ fontStyle: state.fontStyle === "italic" ? "normal" : "italic" })}>I</button>
      <button type="button" className={`${buttonClass} underline ${state.textDecoration === "underline" ? activeClass : ""}`} onClick={() => update({ textDecoration: state.textDecoration === "underline" ? "none" : "underline" })}>U</button>
      <button type="button" className={`${buttonClass} ${state.textAlign === "left" ? activeClass : ""}`} onClick={() => update({ textAlign: "left" })}>L</button>
      <button type="button" className={`${buttonClass} ${state.textAlign === "center" ? activeClass : ""}`} onClick={() => update({ textAlign: "center" })}>C</button>
      <button type="button" className={`${buttonClass} ${state.textAlign === "right" ? activeClass : ""}`} onClick={() => update({ textAlign: "right" })}>R</button>
      <button type="button" className={`${buttonClass} ${state.wrapText === "true" ? activeClass : ""}`} onClick={() => update({ wrapText: state.wrapText === "true" ? "false" : "true" })}>Wrap</button>
      <select
        aria-label="Merge cells"
        value={state.mergeMode}
        onChange={(event) => update({ mergeMode: event.target.value })}
        className="h-7 border border-zinc-300 bg-white px-1 text-xs text-zinc-800"
      >
        <option value="none">No merge</option>
        <option value="merge_specification">Merge spec</option>
        <option value="merge_full_row">Merge row</option>
      </select>
    </div>
  );
}
