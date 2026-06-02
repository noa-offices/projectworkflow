"use client";

import { useState, type ReactNode } from "react";
import {
  createMaterial,
  createMaterialsBatch,
  updateMaterial,
} from "@/app/products/materials/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { BrandMaterialSwatchInput } from "@/components/products/brand-material-swatch-input";

type MaterialGroupOption = {
  id: string;
  group_name: string;
};

type MaterialRecord = {
  id: string;
  material_group_id: string;
  material_category: string | null;
  material_collection: string | null;
  material_code: string | null;
  material_name: string;
  color_family: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

type MaterialPrefill = {
  collection?: string;
  grade?: string;
  groupId?: string;
};

const priceCategorySuggestions = ["CAT A", "CAT B", "CAT C", "CAT D", "CAT E", "CAT F", "CAT G", "CAT H", "A", "B", "C", "D"];

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  defaultValue,
  label,
  name,
  required,
  placeholder,
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </Field>
  );
}

function ActiveToggle({ defaultChecked = true }: { defaultChecked?: boolean }) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
      <input
        name="is_active"
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-zinc-300"
      />
      Active
    </label>
  );
}

function ModalFrame({
  children,
  isOpen,
  onClose,
  title,
  widthClassName = "max-w-3xl",
}: {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  widthClassName?: string;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4">
      <div className={`w-full ${widthClassName} max-h-[calc(100vh-2rem)] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function MaterialEditorForm({
  brandId,
  brandName,
  groups,
  material,
  prefill,
  returnTo,
}: {
  brandId: string;
  brandName: string;
  groups: MaterialGroupOption[];
  material?: MaterialRecord;
  prefill?: MaterialPrefill;
  returnTo: string;
}) {
  const initialGroupId = material?.material_group_id ?? prefill?.groupId ?? groups[0]?.id ?? "";
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);

  return (
    <form action={material ? updateMaterial : createMaterial} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="material_group_id" value={selectedGroupId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="description" value={material?.description ?? ""} />
      <input type="hidden" name="color_family" value={material?.color_family ?? ""} />
      <input type="hidden" name="sort_order" value={material?.sort_order ?? 0} />
      {material ? <input type="hidden" name="id" value={material.id} /> : null}

      <Field label="Brand">
        <span className="mt-1 flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700">
          {brandName}
        </span>
      </Field>

      <Field label="Material Group">
        <select
          value={selectedGroupId}
          onChange={(event) => setSelectedGroupId(event.target.value)}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.group_name}</option>
          ))}
        </select>
      </Field>

      <datalist id={`material-price-category-suggestions-${material?.id ?? "new"}`}>
        {priceCategorySuggestions.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      <Field label="Grade / Category">
        <div>
          <input
            name="material_price_category"
            list={`material-price-category-suggestions-${material?.id ?? "new"}`}
            defaultValue={material?.material_category ?? prefill?.grade ?? ""}
            placeholder="CAT B, B, CAT H"
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            Optional for wood and metal. If blank, Collection / Finish Type will still be used for grouping.
          </span>
        </div>
      </Field>

      <TextInput
        name="material_collection"
        label="Collection / Finish Type"
        defaultValue={material?.material_collection ?? prefill?.collection ?? ""}
        placeholder="Crepe, New, Melamine, Powder Coat"
      />
      <TextInput name="material_code" label="Code" defaultValue={material?.material_code} />
      <TextInput name="material_name" label="Name" defaultValue={material?.material_name} required />
      <BrandMaterialSwatchInput brandId={brandId} groupId={selectedGroupId} defaultValue={material?.image_url} />

      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <ActiveToggle defaultChecked={material?.is_active ?? true} />
        <div className="flex flex-wrap items-center gap-3">
          <PendingSubmitButton
            className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            pendingLabel={material ? "Saving material..." : "Creating material..."}
          >
            {material ? "Save" : "Save"}
          </PendingSubmitButton>
        </div>
      </div>
    </form>
  );
}

function BatchMaterialEditorForm({
  brandId,
  brandName,
  groups,
  prefill,
  returnTo,
}: {
  brandId: string;
  brandName: string;
  groups: MaterialGroupOption[];
  prefill?: MaterialPrefill;
  returnTo: string;
}) {
  const initialGroupId = prefill?.groupId ?? groups[0]?.id ?? "";
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);

  return (
    <form action={createMaterialsBatch} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="material_group_id" value={selectedGroupId} />
      <input type="hidden" name="return_to" value={returnTo} />

      <Field label="Brand">
        <span className="mt-1 flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700">
          {brandName}
        </span>
      </Field>

      <Field label="Material Group">
        <select
          value={selectedGroupId}
          onChange={(event) => setSelectedGroupId(event.target.value)}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.group_name}</option>
          ))}
        </select>
      </Field>

      <datalist id="batch-material-price-category-suggestions">
        {priceCategorySuggestions.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      <Field label="Grade / Category">
        <div>
          <input
            name="material_price_category"
            list="batch-material-price-category-suggestions"
            defaultValue={prefill?.grade ?? ""}
            placeholder="CAT B, B, CAT H"
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            Optional batch default. Leave blank for groups that should group by Collection / Finish Type instead.
          </span>
        </div>
      </Field>

      <TextInput
        name="material_collection"
        label="Collection / Finish Type"
        defaultValue={prefill?.collection ?? ""}
        placeholder="Crepe, New, Melamine, Powder Coat"
      />

      <label className="block md:col-span-2">
        <span className="text-xs font-semibold uppercase text-zinc-500">Rows</span>
        <textarea
          name="batch_material_rows"
          required
          rows={8}
          placeholder={"522 | Light grey\n523 | Dark grey\n524 | Black"}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
        <span className="mt-1 block text-xs text-zinc-500">Use one code and name per line. Separators: |, comma, or tab.</span>
      </label>

      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <ActiveToggle />
        <PendingSubmitButton
          className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          pendingLabel="Creating materials..."
        >
          Save batch
        </PendingSubmitButton>
      </div>
    </form>
  );
}

export function MaterialDialogButton({
  brandId,
  brandName,
  groups,
  material,
  prefill,
  returnTo,
  title,
  triggerClassName,
  triggerLabel,
}: {
  brandId: string;
  brandName: string;
  groups: MaterialGroupOption[];
  material?: MaterialRecord;
  prefill?: MaterialPrefill;
  returnTo: string;
  title: string;
  triggerClassName: string;
  triggerLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={triggerClassName}>
        {triggerLabel}
      </button>
      <ModalFrame isOpen={isOpen} onClose={() => setIsOpen(false)} title={title}>
        <MaterialEditorForm
          brandId={brandId}
          brandName={brandName}
          groups={groups}
          material={material}
          prefill={prefill}
          returnTo={returnTo}
        />
      </ModalFrame>
    </>
  );
}

export function BatchMaterialDialogButton({
  brandId,
  brandName,
  groups,
  prefill,
  returnTo,
  triggerClassName,
  triggerLabel,
}: {
  brandId: string;
  brandName: string;
  groups: MaterialGroupOption[];
  prefill?: MaterialPrefill;
  returnTo: string;
  triggerClassName: string;
  triggerLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={triggerClassName}>
        {triggerLabel}
      </button>
      <ModalFrame isOpen={isOpen} onClose={() => setIsOpen(false)} title="Batch Add Materials">
        <BatchMaterialEditorForm
          brandId={brandId}
          brandName={brandName}
          groups={groups}
          prefill={prefill}
          returnTo={returnTo}
        />
      </ModalFrame>
    </>
  );
}
