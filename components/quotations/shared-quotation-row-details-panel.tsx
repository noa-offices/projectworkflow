"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { FinishImagePreview } from "@/components/quotations/finish-image-uploader";

type SharedMode = "server" | "local";

const lineStyleOptions = [
  { value: "normal", label: "Normal" },
  { value: "heading", label: "Heading" },
  { value: "note", label: "Note" },
  { value: "blank", label: "Blank" },
  { value: "no_quote", label: "No Quote" },
] as const;

type SharedQuotationRowDetailsItem = {
  allow_material_continuation_page?: boolean;
  currency?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  finish_snapshot?: string | null;
  internal_cost?: number | null;
  item_code_snapshot?: string | null;
  item_name_snapshot?: string | null;
  line_style?: string | null;
  manual_serial?: string | null;
  margin_type?: string | null;
  margin_value?: number | null;
  model_snapshot?: string | null;
  notes?: string | null;
  origin_snapshot?: string | null;
  proposed_image_url_snapshot?: string | null;
  qty?: number | null;
  room_name_snapshot?: string | null;
  row_height?: number | null;
  size_snapshot?: string | null;
  sort_order?: number | null;
  specification_snapshot?: string | null;
  specified_image_url_snapshot?: string | null;
  supplier_name_snapshot?: string | null;
  supplier_notes_snapshot?: string | null;
  unit_label?: string | null;
  unit_price?: number | null;
  warranty_snapshot?: string | null;
  is_rate_only?: boolean;
};

function stringValue(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function checkboxValue(value: boolean | null | undefined) {
  return value === true;
}

function integerFieldValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
}

function ClickAwayWrapper({
  children,
  className,
  buttonClassName,
  buttonLabel,
  defaultOpen = false,
  dataStateKey,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  className?: string;
  buttonClassName: string;
  buttonLabel: ReactNode;
  defaultOpen?: boolean;
  dataStateKey?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    if (!isOpen) return;

    function handleOutsideClick(event: PointerEvent | MouseEvent) {
      const wrapper = wrapperRef.current;
      const target = event.target;

      if (!wrapper || !(target instanceof Node) || wrapper.contains(target)) return;

      setOpen(false);
    }

    document.addEventListener("pointerdown", handleOutsideClick, true);
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick, true);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [isOpen, setOpen]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      data-state-key={dataStateKey}
    >
      <button type="button" className={buttonClassName} onClick={() => setOpen(!isOpen)}>
        {buttonLabel}
      </button>
      {isOpen ? children : null}
    </div>
  );
}

function SharedField({
  className,
  label,
  mode,
  name,
  onValueChange,
  step,
  type = "text",
  value,
}: {
  className?: string;
  label: string;
  mode: SharedMode;
  name?: string;
  onValueChange?: (value: string) => void;
  step?: string;
  type?: "text" | "number";
  value: string | number | null | undefined;
}) {
  return (
    <label className={className ?? "block"}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <input
        name={mode === "server" ? name : undefined}
        type={type}
        step={type === "number" ? step ?? "0.01" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        defaultValue={mode === "server" ? stringValue(value) : undefined}
        value={mode === "local" ? stringValue(value) : undefined}
        onChange={mode === "local" ? (event) => onValueChange?.(event.target.value) : undefined}
        onWheel={type === "number" ? (event) => event.currentTarget.blur() : undefined}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800"
      />
    </label>
  );
}

function SharedTextArea({
  className,
  label,
  mode,
  name,
  onValueChange,
  rows = 3,
  value,
}: {
  className?: string;
  label: string;
  mode: SharedMode;
  name?: string;
  onValueChange?: (value: string) => void;
  rows?: number;
  value: string | null | undefined;
}) {
  return (
    <label className={className ?? "block"}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={mode === "server" ? name : undefined}
        rows={rows}
        defaultValue={mode === "server" ? stringValue(value) : undefined}
        value={mode === "local" ? stringValue(value) : undefined}
        onChange={mode === "local" ? (event) => onValueChange?.(event.target.value) : undefined}
        className="w-full resize-none border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-emerald-800"
      />
    </label>
  );
}

function SharedSelect({
  className,
  label,
  mode,
  name,
  onValueChange,
  options,
  value,
}: {
  className?: string;
  label: string;
  mode: SharedMode;
  name?: string;
  onValueChange?: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string | null | undefined;
}) {
  return (
    <label className={className ?? "block"}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <select
        name={mode === "server" ? name : undefined}
        defaultValue={mode === "server" ? value ?? "" : undefined}
        value={mode === "local" ? value ?? "" : undefined}
        onChange={mode === "local" ? (event) => onValueChange?.(event.target.value) : undefined}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SharedCheckbox({
  label,
  mode,
  name,
  onValueChange,
  value,
}: {
  label: string;
  mode: SharedMode;
  name?: string;
  onValueChange?: (value: boolean) => void;
  value: boolean | null | undefined;
}) {
  return (
    <label className="flex items-end gap-2 text-xs font-semibold text-zinc-600">
      <input
        name={mode === "server" ? name : undefined}
        type="checkbox"
        defaultChecked={mode === "server" ? checkboxValue(value) : undefined}
        checked={mode === "local" ? checkboxValue(value) : undefined}
        onChange={mode === "local" ? (event) => onValueChange?.(event.target.checked) : undefined}
        className="mb-2 h-4 w-4 rounded border-zinc-300"
      />
      <span className="pb-2">{label}</span>
    </label>
  );
}

export function SharedQuotationMoreMenu({
  actionButtons,
  detailsContent,
  detailsDefaultOpen = false,
  detailsPanelClassName = "absolute right-0 top-full z-40 mt-2 w-[1080px] max-w-[calc(100vw-3rem)] border border-zinc-300 bg-zinc-50 p-3 shadow-lg",
  itemId,
  mergeControl,
  menuClassName = "absolute right-0 z-30 mt-1 w-56 border border-zinc-300 bg-white p-2 text-left shadow-lg",
}: {
  actionButtons: ReactNode;
  detailsContent?: ReactNode;
  detailsDefaultOpen?: boolean;
  detailsPanelClassName?: string;
  itemId: string;
  mergeControl: ReactNode;
  menuClassName?: string;
}) {
  return (
    <ClickAwayWrapper
      className="relative"
      buttonClassName="h-6 cursor-pointer border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
      buttonLabel="More"
      dataStateKey={`quotation-item-more-${itemId}`}
    >
      <div className={menuClassName}>
        {mergeControl}
        <div className="mt-2 grid gap-2">
          {actionButtons}
          {detailsContent ? (
            <ClickAwayWrapper
              className="relative"
              buttonClassName="h-7 cursor-pointer border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-900"
              buttonLabel="Details"
              dataStateKey={`quotation-item-details-${itemId}`}
              defaultOpen={detailsDefaultOpen}
            >
              <div className={detailsPanelClassName}>{detailsContent}</div>
            </ClickAwayWrapper>
          ) : null}
        </div>
      </div>
    </ClickAwayWrapper>
  );
}

export function SharedQuotationRowDetailsPanel({
  basicHint,
  currencyFieldName,
  currencyOptions,
  discountTypeOptions = [
    { label: "Amount", value: "amount" },
    { label: "Percent", value: "percent" },
  ],
  extraSectionsAfterImages,
  extraSectionsBeforeSpecification,
  imageActions,
  imageNote,
  item,
  mode,
  onFieldChange,
  showImagePreview = false,
  showInternal,
  showSupplierNotes = true,
  unitPriceLabel = "U.Price",
}: {
  basicHint?: ReactNode;
  currencyFieldName?: string | null;
  currencyOptions: ReadonlyArray<{ code: string; label: string }>;
  discountTypeOptions?: ReadonlyArray<{ label: string; value: string }>;
  extraSectionsAfterImages?: ReactNode;
  extraSectionsBeforeSpecification?: ReactNode;
  imageActions?: ReactNode;
  imageNote?: ReactNode;
  item: SharedQuotationRowDetailsItem;
  mode: SharedMode;
  onFieldChange?: (patch: Partial<SharedQuotationRowDetailsItem>) => void;
  showImagePreview?: boolean;
  showInternal: boolean;
  showSupplierNotes?: boolean;
  unitPriceLabel?: string;
}) {
  const previewValue = item.proposed_image_url_snapshot || item.specified_image_url_snapshot;

  return (
    <div className="grid gap-3">
      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Basic</legend>
        <div className="grid gap-2 md:grid-cols-6">
          <SharedField
            label="Manual S.No."
            mode={mode}
            name="manual_serial"
            onValueChange={(value) => onFieldChange?.({ manual_serial: value || null })}
            value={item.manual_serial}
          />
          <SharedField
            label="Code"
            mode={mode}
            name="item_code_snapshot"
            onValueChange={(value) => onFieldChange?.({ item_code_snapshot: value || null })}
            value={item.item_code_snapshot}
          />
          <SharedField
            className="md:col-span-2"
            label="Item / Model Name"
            mode={mode}
            name="item_name_snapshot"
            onValueChange={(value) => onFieldChange?.({ item_name_snapshot: value || null })}
            value={item.item_name_snapshot}
          />
          <SharedField
            label="Qty"
            mode={mode}
            name="qty"
            onValueChange={(value) => onFieldChange?.({ qty: integerFieldValue(value) })}
            step="1"
            type="number"
            value={item.qty ?? 0}
          />
          <SharedField
            label="Unit"
            mode={mode}
            name="unit_label"
            onValueChange={(value) => onFieldChange?.({ unit_label: value || "Pc" })}
            value={item.unit_label ?? "Pc"}
          />
          <SharedField
            label={unitPriceLabel}
            mode={mode}
            name="unit_price"
            onValueChange={(value) => onFieldChange?.({ unit_price: Number(value) || 0 })}
            step="any"
            type="number"
            value={item.unit_price ?? 0}
          />
          <SharedSelect
            label="Currency"
            mode={mode}
            name={currencyFieldName ?? undefined}
            onValueChange={(value) => onFieldChange?.({ currency: value })}
            options={currencyOptions.map((option) => ({ label: option.label, value: option.code }))}
            value={item.currency ?? currencyOptions[0]?.code ?? "AED"}
          />
          <SharedSelect
            label="Discount type"
            mode={mode}
            name="discount_type"
            onValueChange={(value) => onFieldChange?.({ discount_type: value, discount_value: value === "none" ? 0 : (item.discount_value ?? 0) })}
            options={discountTypeOptions}
            value={item.discount_type ?? discountTypeOptions[0]?.value ?? "amount"}
          />
          <SharedField
            label="Discount"
            mode={mode}
            name="discount_value"
            onValueChange={(value) => onFieldChange?.({ discount_value: Number(value) || 0 })}
            type="number"
            value={item.discount_value ?? 0}
          />
          <SharedSelect
            label="Line style"
            mode={mode}
            name="line_style"
            onValueChange={(value) => onFieldChange?.({ line_style: value })}
            options={lineStyleOptions}
            value={item.line_style ?? "normal"}
          />
          <SharedField
            label="Sort"
            mode={mode}
            name="sort_order"
            onValueChange={(value) => onFieldChange?.({ sort_order: Number(value) || 0 })}
            step="1"
            type="number"
            value={item.sort_order ?? 0}
          />
          <SharedField
            label="Row height"
            mode={mode}
            name="row_height"
            onValueChange={(value) => onFieldChange?.({ row_height: value ? Number(value) : null })}
            type="number"
            value={item.row_height}
          />
          {basicHint ? <div className="self-end pb-2 text-[11px] text-zinc-500 md:col-span-3">{basicHint}</div> : null}
          <SharedCheckbox
            label="Rate only"
            mode={mode}
            name="is_rate_only"
            onValueChange={(value) => onFieldChange?.({ is_rate_only: value })}
            value={item.is_rate_only}
          />
          <SharedCheckbox
            label="Allow material continuation page"
            mode={mode}
            name="allow_material_continuation_page"
            onValueChange={(value) => onFieldChange?.({ allow_material_continuation_page: value })}
            value={item.allow_material_continuation_page}
          />
        </div>
      </fieldset>

      {extraSectionsBeforeSpecification}

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Specification</legend>
        <div className="grid gap-2 md:grid-cols-6">
          <SharedTextArea
            className="md:col-span-6"
            label="Specification"
            mode={mode}
            name="specification_snapshot"
            onValueChange={(value) => onFieldChange?.({ specification_snapshot: value || null })}
            rows={5}
            value={item.specification_snapshot}
          />
          <p className="text-[11px] text-zinc-500 md:col-span-6">
            Description appears below the main title and keeps text wrapping in the row.
          </p>
        </div>
      </fieldset>

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Product details</legend>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <SharedField
            label="Room"
            mode={mode}
            name="room_name_snapshot"
            onValueChange={(value) => onFieldChange?.({ room_name_snapshot: value || null })}
            value={item.room_name_snapshot}
          />
          <SharedField
            label="Model code / alternate model"
            mode={mode}
            name="model_snapshot"
            onValueChange={(value) => onFieldChange?.({ model_snapshot: value || null })}
            value={item.model_snapshot}
          />
          <SharedField
            label="Dimension"
            mode={mode}
            name="size_snapshot"
            onValueChange={(value) => onFieldChange?.({ size_snapshot: value || null })}
            value={item.size_snapshot}
          />
          <SharedField
            label="Finish"
            mode={mode}
            name="finish_snapshot"
            onValueChange={(value) => onFieldChange?.({ finish_snapshot: value || null })}
            value={item.finish_snapshot}
          />
          <SharedField
            label="Origin"
            mode={mode}
            name="origin_snapshot"
            onValueChange={(value) => onFieldChange?.({ origin_snapshot: value || null })}
            value={item.origin_snapshot}
          />
          <SharedField
            label="Warranty"
            mode={mode}
            name="warranty_snapshot"
            onValueChange={(value) => onFieldChange?.({ warranty_snapshot: value || null })}
            value={item.warranty_snapshot}
          />
          <SharedField
            label="Supplier"
            mode={mode}
            name="supplier_name_snapshot"
            onValueChange={(value) => onFieldChange?.({ supplier_name_snapshot: value || null })}
            value={item.supplier_name_snapshot}
          />
        </div>
      </fieldset>

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Images</legend>
        <div className={`grid gap-2 ${showImagePreview ? "md:grid-cols-[220px_1fr]" : "md:grid-cols-2"}`}>
          {showImagePreview ? (
            <div className="grid gap-2">
              <FinishImagePreview
                alt={item.item_name_snapshot ?? "Item image"}
                className="h-32 w-full"
                value={previewValue}
              />
              {imageActions}
              {imageNote}
            </div>
          ) : null}
          <div className="grid gap-2">
            <SharedField
              label="Specified Image URL"
              mode={mode}
              name="specified_image_url_snapshot"
              onValueChange={(value) => onFieldChange?.({ specified_image_url_snapshot: value || null })}
              value={item.specified_image_url_snapshot}
            />
            <SharedField
              label="Proposed / Reference Image URL"
              mode={mode}
              name="proposed_image_url_snapshot"
              onValueChange={(value) => onFieldChange?.({ proposed_image_url_snapshot: value || null })}
              value={item.proposed_image_url_snapshot}
            />
          </div>
        </div>
      </fieldset>

      {extraSectionsAfterImages}

      {showInternal ? (
        <fieldset className="border border-zinc-300 bg-white p-3">
          <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Internal</legend>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <SharedField
              label="Internal Cost"
              mode={mode}
              name="internal_cost"
              onValueChange={(value) => onFieldChange?.({ internal_cost: Number(value) || 0 })}
              type="number"
              value={item.internal_cost ?? 0}
            />
            <SharedSelect
              label="Margin type"
              mode={mode}
              name="margin_type"
              onValueChange={(value) => onFieldChange?.({ margin_type: value })}
              options={[
                { label: "Amount", value: "amount" },
                { label: "Percent", value: "percent" },
              ]}
              value={item.margin_type ?? "amount"}
            />
            <SharedField
              label="Margin"
              mode={mode}
              name="margin_value"
              onValueChange={(value) => onFieldChange?.({ margin_value: Number(value) || 0 })}
              type="number"
              value={item.margin_value ?? 0}
            />
            {showSupplierNotes ? (
              <SharedTextArea
                className="md:col-span-2"
                label="Supplier Notes"
                mode={mode}
                name="supplier_notes_snapshot"
                onValueChange={(value) => onFieldChange?.({ supplier_notes_snapshot: value || null })}
                value={item.supplier_notes_snapshot}
              />
            ) : null}
            <SharedTextArea
              className={showSupplierNotes ? "md:col-span-2" : "md:col-span-2 xl:col-span-4"}
              label="Internal Notes"
              mode={mode}
              name="notes"
              onValueChange={(value) => onFieldChange?.({ notes: value || null })}
              value={item.notes}
            />
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
