"use client";

import { useState } from "react";
import type { ClipboardEvent, ChangeEvent } from "react";
import { FinishImagePreview } from "@/components/quotations/finish-image-uploader";
import { uploadQuotationFinishImage } from "@/lib/quotation-image-upload";

export type FinishSelectionEditorRow = {
  id?: string;
  source_type?: string;
  source_scope?: string;
  brand_material_id?: string;
  material_group_id?: string;
  product_template_material_group_id?: string;
  brand_name?: string;
  group_label?: string;
  material_category?: string;
  finish_code?: string;
  finish_name?: string;
  finish_description?: string;
  finish_image_url?: string;
  show_in_quotation?: boolean;
  show_in_specification?: boolean;
  sort_order?: number;
};

export type FinishMaterialBrand = {
  id: string;
  name: string;
};

export type FinishMaterialGroup = {
  id: string;
  brand_id: string;
  group_name: string;
  sort_order: number;
};

export type FinishMaterial = {
  id: string;
  brand_id: string;
  material_group_id: string;
  material_category: string | null;
  material_code: string | null;
  material_name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export type ProductTemplateMaterialGroupLink = {
  id: string;
  product_template_id: string;
  material_group_id: string;
  label_override: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  show_in_specification: boolean;
  show_in_quotation: boolean;
  sort_order: number;
};

const finishGroupSuggestions = [
  "Wood Finish",
  "Top Finish",
  "Body Finish",
  "Base / Leg Finish",
  "Fabric",
  "Leather",
  "Screen Fabric",
  "Metal Finish",
  "Handle Finish",
  "Laminate",
  "Veneer",
  "Other",
];

const tabLabels = [
  ["linked", "Recommended / Linked Materials"],
  ["library", "Browse Material Library"],
  ["custom", "Add Custom Finish"],
] as const;

type EditorTab = (typeof tabLabels)[number][0];

type DraftFinish = Required<
  Pick<
    FinishSelectionEditorRow,
    | "id"
    | "group_label"
    | "finish_code"
    | "finish_name"
    | "finish_description"
    | "finish_image_url"
    | "show_in_quotation"
    | "show_in_specification"
  >
> &
  Omit<FinishSelectionEditorRow, "id" | "group_label" | "finish_code" | "finish_name" | "finish_description" | "finish_image_url" | "show_in_quotation" | "show_in_specification">;

type UploadStatus = "idle" | "uploading" | "failed";

function normalizeFinish(row: FinishSelectionEditorRow, index: number): DraftFinish {
  return {
    id: row.id || `finish-${Date.now()}-${index}`,
    source_type: row.source_type ?? "custom",
    source_scope: row.source_scope ?? "custom",
    brand_material_id: row.brand_material_id ?? "",
    material_group_id: row.material_group_id ?? "",
    product_template_material_group_id: row.product_template_material_group_id ?? "",
    brand_name: row.brand_name ?? "",
    group_label: row.group_label ?? "",
    material_category: row.material_category ?? "",
    finish_code: row.finish_code ?? "",
    finish_name: row.finish_name ?? "",
    finish_description: row.finish_description ?? "",
    finish_image_url: row.finish_image_url ?? "",
    show_in_quotation: row.show_in_quotation === true,
    show_in_specification: row.show_in_specification !== false,
  };
}

function emptyDraft(): DraftFinish {
  return {
    id: `finish-${Date.now()}`,
    source_type: "custom",
    source_scope: "custom",
    brand_material_id: "",
    material_group_id: "",
    product_template_material_group_id: "",
    brand_name: "",
    group_label: "",
    material_category: "",
    finish_code: "",
    finish_name: "",
    finish_description: "",
    finish_image_url: "",
    show_in_quotation: false,
    show_in_specification: true,
  };
}

function cleanCategoryLabel(value?: string | null) {
  const category = value?.trim();
  if (!category) return "";

  return /^(cat|category)\b/i.test(category) ? category : `Category ${category}`;
}

function sortMaterials(left: FinishMaterial, right: FinishMaterial) {
  return (
    left.sort_order - right.sort_order ||
    (left.material_code ?? "").localeCompare(right.material_code ?? "") ||
    left.material_name.localeCompare(right.material_name)
  );
}

function sourceLabel(finish: DraftFinish) {
  if (finish.source_scope === "linked") return "Recommended";
  if (finish.source_scope === "library") return "Library";
  return "Custom";
}

function finishHasContent(finish: DraftFinish) {
  return Boolean(
    finish.group_label.trim() ||
    finish.finish_code.trim() ||
    finish.finish_name.trim() ||
    finish.finish_description.trim() ||
    finish.finish_image_url.trim(),
  );
}

function filenameForClipboardImage(type: string) {
  const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return `pasted-finish-${Date.now()}.${extensionByType[type] ?? "png"}`;
}

function clipboardImageFile(event: ClipboardEvent<HTMLDivElement>) {
  const items = Array.from(event.clipboardData.items);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file =
    imageItem?.getAsFile() ??
    Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));

  if (!file) return null;
  if (file.name) return file;

  return new File([file], filenameForClipboardImage(file.type), {
    lastModified: file.lastModified,
    type: file.type,
  });
}

function Field({
  label,
  list,
  onChange,
  value,
}: {
  label: string;
  list?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">{label}</span>
      <input
        list={list}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      />
    </label>
  );
}

function HiddenFinishFields({ finish, index }: { finish: DraftFinish; index: number }) {
  return (
    <>
      <input type="hidden" name="finish_id[]" value={finish.id} />
      <input type="hidden" name="finish_source_type[]" value={finish.source_type ?? ""} />
      <input type="hidden" name="finish_source_scope[]" value={finish.source_scope ?? ""} />
      <input type="hidden" name="finish_brand_material_id[]" value={finish.brand_material_id ?? ""} />
      <input type="hidden" name="finish_material_group_id[]" value={finish.material_group_id ?? ""} />
      <input type="hidden" name="finish_product_template_material_group_id[]" value={finish.product_template_material_group_id ?? ""} />
      <input type="hidden" name="finish_brand_name[]" value={finish.brand_name ?? ""} />
      <input type="hidden" name="finish_group_label[]" value={finish.group_label} />
      <input type="hidden" name="finish_material_category[]" value={finish.material_category ?? ""} />
      <input type="hidden" name="finish_code[]" value={finish.finish_code} />
      <input type="hidden" name="finish_name[]" value={finish.finish_name} />
      <input type="hidden" name="finish_description[]" value={finish.finish_description} />
      <input type="hidden" name="finish_image_url[]" value={finish.finish_image_url} />
      <input type="hidden" name="finish_sort_order[]" value={finish.sort_order ?? index} />
      {finish.show_in_specification ? <input type="hidden" name={`finish_show_in_specification_${index}`} value="on" /> : null}
      {finish.show_in_quotation ? <input type="hidden" name={`finish_show_in_quotation_${index}`} value="on" /> : null}
    </>
  );
}

function MaterialCard({
  actionLabel = "Select",
  brand,
  category,
  groupLabel,
  isSelected = false,
  material,
  onSelect,
}: {
  actionLabel?: string;
  brand?: FinishMaterialBrand;
  category?: string;
  groupLabel: string;
  isSelected?: boolean;
  material: FinishMaterial;
  onSelect: () => void;
}) {
  const codeName = [material.material_code, material.material_name].filter(Boolean).join(" | ");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        isSelected
          ? "grid min-h-28 gap-2 border border-emerald-900 bg-emerald-50 p-2 text-left ring-1 ring-emerald-900/20 transition hover:bg-emerald-100/70"
          : "grid min-h-28 gap-2 border border-zinc-200 bg-white p-2 text-left transition hover:border-emerald-900 hover:bg-emerald-50/40"
      }
    >
      <FinishImagePreview
        alt={material.material_name || material.material_code || groupLabel}
        className="h-14 w-full"
        value={material.image_url ?? ""}
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-zinc-900">{codeName || material.material_name}</p>
        <p className="truncate text-[10px] font-medium text-zinc-500">
          {[brand?.name, groupLabel, cleanCategoryLabel(category)].filter(Boolean).join(" / ")}
        </p>
      </div>
      <span className={isSelected ? "text-[10px] font-bold uppercase text-emerald-900" : "text-[10px] font-bold uppercase text-emerald-900"}>
        {actionLabel}
      </span>
    </button>
  );
}

function MaterialGrid({
  brandsById,
  groupLabel,
  getActionLabel,
  isMaterialSelected,
  materials,
  onSelect,
  showCategoryHeadings = true,
}: {
  brandsById: Map<string, FinishMaterialBrand>;
  groupLabel: string;
  getActionLabel?: (material: FinishMaterial) => string;
  isMaterialSelected?: (material: FinishMaterial) => boolean;
  materials: FinishMaterial[];
  onSelect: (material: FinishMaterial) => void;
  showCategoryHeadings?: boolean;
}) {
  const sorted = [...materials].sort(sortMaterials);
  const categorized = new Map<string, FinishMaterial[]>();
  const uncategorized: FinishMaterial[] = [];

  for (const material of sorted) {
    const category = material.material_category?.trim();
    if (!category) {
      uncategorized.push(material);
      continue;
    }
    categorized.set(category, [...(categorized.get(category) ?? []), material]);
  }

  const sections = [
    ...Array.from(categorized.entries()).sort(([left], [right]) => left.localeCompare(right)),
    ...(uncategorized.length ? [[categorized.size ? "Uncategorized" : "", uncategorized] as [string, FinishMaterial[]]] : []),
  ];

  return (
    <div className="grid gap-3">
      {sections.map(([category, categoryMaterials]) => (
        <section key={category || "uncategorized"} className="grid gap-2">
          {showCategoryHeadings && category ? (
            <div className="flex items-center gap-2 border-b border-zinc-200 pb-1">
              <h5 className="text-[11px] font-bold uppercase text-zinc-600">{cleanCategoryLabel(category)}</h5>
              <span className="border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">
                {categoryMaterials.length}
              </span>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {categoryMaterials.map((material) => (
              <MaterialCard
                key={material.id}
                actionLabel={getActionLabel?.(material) ?? "Select"}
                brand={brandsById.get(material.brand_id)}
                category={category && category !== "Uncategorized" ? category : material.material_category ?? ""}
                groupLabel={groupLabel}
                isSelected={isMaterialSelected?.(material) ?? false}
                material={material}
                onSelect={() => onSelect(material)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SwatchEditor({
  draft,
  itemId,
  onChange,
  quotationId,
}: {
  draft: DraftFinish;
  itemId?: string | null;
  onChange: (patch: Partial<DraftFinish>) => void;
  quotationId: string;
}) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function uploadFile(file: File) {
    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadQuotationFinishImage({ file, itemId, quotationId });
      onChange({ finish_image_url: `quote-images:${upload.path}` });
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Swatch upload failed.");
      setStatus("failed");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await uploadFile(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = clipboardImageFile(event);
    if (!file) return;

    event.preventDefault();
    await uploadFile(file);
  }

  return (
    <div className="grid gap-2 md:grid-cols-[88px_minmax(0,1fr)]">
      <div
        tabIndex={0}
        onPaste={handlePaste}
        className="flex h-20 w-20 items-center justify-center overflow-hidden border border-dashed border-zinc-300 bg-white outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        aria-label="Finish swatch paste area"
      >
        {draft.finish_image_url ? (
          <FinishImagePreview
            alt={draft.finish_name || draft.group_label || "Finish swatch"}
            className="h-20 w-20"
            value={draft.finish_image_url}
          />
        ) : (
          <span className="px-2 text-center text-[10px] leading-4 text-zinc-400">Paste or upload</span>
        )}
      </div>
      <div className="grid content-start gap-2">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          disabled={status === "uploading"}
          className="block w-full text-[11px] text-zinc-600 file:mr-2 file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-zinc-700"
        />
        <input
          value={draft.finish_image_url}
          onChange={(event) => onChange({ finish_image_url: event.target.value })}
          placeholder="Image URL or quote-images path"
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">{status === "uploading" ? "Uploading..." : "Click swatch area, then Ctrl+V to paste image."}</span>
          {draft.finish_image_url ? (
            <button
              type="button"
              onClick={() => onChange({ finish_image_url: "" })}
              className="text-[10px] font-semibold text-zinc-500 hover:text-red-700"
            >
              Remove image
            </button>
          ) : null}
        </div>
        {status === "failed" && errorMessage ? <p className="text-[10px] text-red-700">{errorMessage}</p> : null}
      </div>
    </div>
  );
}

export function FinishSelectionsEditor({
  brands,
  initialBrandId,
  initialFinishes,
  itemId,
  materialGroups,
  materials,
  templateMaterialGroups,
  quotationId,
}: {
  brands?: FinishMaterialBrand[];
  initialBrandId?: string | null;
  initialFinishes: FinishSelectionEditorRow[];
  itemId?: string | null;
  materialGroups?: FinishMaterialGroup[];
  materials?: FinishMaterial[];
  templateMaterialGroups?: ProductTemplateMaterialGroupLink[];
  quotationId: string;
}) {
  const [finishes, setFinishes] = useState(() => initialFinishes.map(normalizeFinish));
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftFinish>(() => emptyDraft());
  const [activeTab, setActiveTab] = useState<EditorTab>("linked");
  const [libraryBrandId, setLibraryBrandId] = useState(initialBrandId ?? "");
  const [libraryGroupId, setLibraryGroupId] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const isEditing = editingIndex !== null;
  const brandsById = new Map((brands ?? []).map((brand) => [brand.id, brand]));
  const groupsById = new Map((materialGroups ?? []).map((group) => [group.id, group]));
  const linkedGroups = [...(templateMaterialGroups ?? [])].sort((left, right) => left.sort_order - right.sort_order);
  const availableMaterials = materials ?? [];
  const visibleMaterials = availableMaterials.filter((material) => !activeOnly || material.is_active !== false);
  const categoryOptions = Array.from(
    new Set(
      visibleMaterials
        .filter((material) => !libraryBrandId || material.brand_id === libraryBrandId)
        .filter((material) => !libraryGroupId || material.material_group_id === libraryGroupId)
        .map((material) => material.material_category?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const filteredLibraryMaterials = visibleMaterials
    .filter((material) => !libraryBrandId || material.brand_id === libraryBrandId)
    .filter((material) => !libraryGroupId || material.material_group_id === libraryGroupId)
    .filter((material) => !libraryCategory || material.material_category?.trim() === libraryCategory)
    .filter((material) => {
      const search = librarySearch.trim().toLowerCase();
      if (!search) return true;

      return [material.material_code, material.material_name].some((value) => value?.toLowerCase().includes(search));
    });

  function startAdd() {
    setDraft(emptyDraft());
    setEditingIndex("new");
    setActiveTab("custom");
  }

  function startEdit(index: number) {
    setDraft({ ...finishes[index] });
    setEditingIndex(index);
  }

  function saveDraft() {
    if (!finishHasContent(draft)) {
      setEditingIndex(null);
      return;
    }

    if (editingIndex === "new") {
      setFinishes((current) => [...current, { ...draft }]);
    } else if (typeof editingIndex === "number") {
      setFinishes((current) => current.map((finish, index) => (index === editingIndex ? { ...draft } : finish)));
    }

    setEditingIndex(null);
  }

  function removeFinish(index: number) {
    setFinishes((current) => current.filter((_, finishIndex) => finishIndex !== index));
    if (editingIndex === index) setEditingIndex(null);
  }

  function updateDraft(patch: Partial<DraftFinish>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function materialDraft({
    link,
    material,
    rowIndex,
    sourceScope,
  }: {
    link?: ProductTemplateMaterialGroupLink;
    material: FinishMaterial;
    rowIndex: number;
    sourceScope: "linked" | "library";
  }): DraftFinish {
    const group = groupsById.get(material.material_group_id);
    const brand = brandsById.get(material.brand_id);
    const groupLabel = link?.label_override?.trim() || group?.group_name || "Finish";

    return {
      id: `selected-${sourceScope}-${material.id}-${rowIndex}`,
      source_type: "brand_material",
      source_scope: sourceScope,
      brand_material_id: material.id,
      material_group_id: material.material_group_id,
      product_template_material_group_id: link?.id ?? "",
      brand_name: brand?.name ?? "",
      group_label: groupLabel,
      material_category: material.material_category ?? "",
      finish_code: material.material_code ?? "",
      finish_name: material.material_name,
      finish_description: material.description ?? "",
      finish_image_url: material.image_url ?? "",
      show_in_specification: link ? link.show_in_specification : true,
      show_in_quotation: link ? link.show_in_quotation : false,
      sort_order: rowIndex,
    };
  }

  function selectLinkedMaterial(link: ProductTemplateMaterialGroupLink, material: FinishMaterial) {
    setFinishes((current) => {
      const existingIndex = current.findIndex(
        (finish) =>
          finish.source_scope === "linked" &&
          finish.product_template_material_group_id === link.id &&
          finish.brand_material_id === material.id,
      );

      if (existingIndex >= 0) {
        if (link.allow_multiple) {
          return current.filter((_, index) => index !== existingIndex);
        }

        return current;
      }

      const next = materialDraft({ link, material, rowIndex: current.length, sourceScope: "linked" });
      if (link.allow_multiple) return [...current, next];

      return [
        ...current.filter(
          (finish) =>
            finish.product_template_material_group_id !== link.id &&
            !(finish.source_scope === "linked" && finish.material_group_id === link.material_group_id),
        ),
        next,
      ];
    });
  }

  function selectLibraryMaterial(material: FinishMaterial) {
    setFinishes((current) => {
      if (current.some((finish) => finish.brand_material_id === material.id)) return current;

      return [
        ...current,
        materialDraft({ material, rowIndex: current.length, sourceScope: "library" }),
      ];
    });
  }

  return (
    <fieldset className="border border-zinc-300 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-[11px] font-bold uppercase text-zinc-500">Materials & Finishes</legend>
        <span className="text-[11px] font-semibold text-zinc-500">{finishes.length} selected</span>
      </div>

      <datalist id="finish-group-suggestions">
        {finishGroupSuggestions.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      {finishes.map((finish, index) => (
        <HiddenFinishFields key={`hidden-${finish.id}-${index}`} finish={finish} index={index} />
      ))}

      <div className="mt-3 grid gap-2">
        {!finishes.length ? (
          <div className="border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center">
            <p className="text-sm font-medium text-zinc-600">No finishes added yet.</p>
            <p className="mt-1 text-xs text-zinc-500">Choose a recommended material, browse the library, or add a custom finish.</p>
          </div>
        ) : null}

        {finishes.map((finish, index) => {
          const codeName = [finish.finish_code, finish.finish_name].filter(Boolean).join(" - ");

          return (
            <div key={`${finish.id}-${index}`} className="grid gap-3 border border-zinc-200 bg-zinc-50 p-2 md:grid-cols-[48px_minmax(0,1fr)_auto]">
              <FinishImagePreview
                alt={finish.finish_name || finish.group_label || "Finish swatch"}
                className="h-12 w-12"
                value={finish.finish_image_url}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{finish.group_label || "Finish"}</p>
                {codeName ? <p className="text-xs font-medium text-zinc-700">{codeName}</p> : null}
                {finish.finish_description ? <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{finish.finish_description}</p> : null}
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase">
                  <span className="border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-500">{sourceLabel(finish)}</span>
                  <span className={finish.show_in_specification ? "border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800" : "border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-400"}>
                    Spec: {finish.show_in_specification ? "Yes" : "No"}
                  </span>
                  <span className={finish.show_in_quotation ? "border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800" : "border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-400"}>
                    Quote: {finish.show_in_quotation ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2 md:justify-end">
                <button type="button" onClick={() => startEdit(index)} className="text-xs font-semibold text-emerald-900 hover:text-emerald-700">
                  Edit
                </button>
                <button type="button" onClick={() => removeFinish(index)} className="text-xs font-semibold text-red-700 hover:text-red-600">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-b border-zinc-200">
        {tabLabels.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setActiveTab(value);
              if (value === "custom") startAdd();
            }}
            className={
              activeTab === value
                ? "border border-b-white border-emerald-900 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-900"
                : "border border-transparent px-2.5 py-1.5 text-xs font-semibold text-zinc-500 transition hover:text-emerald-900"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "linked" ? (
        <div className="mt-3 grid gap-3">
          <p className="text-xs font-semibold text-zinc-600">Recommended finishes for this product</p>
          {!linkedGroups.length ? (
            <div className="border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">
              No recommended material groups linked to this product. Use Browse Material Library or Add Custom Finish.
            </div>
          ) : null}
          {linkedGroups.map((link) => {
            const group = groupsById.get(link.material_group_id);
            const groupMaterials = visibleMaterials.filter((material) => material.material_group_id === link.material_group_id);
            const label = link.label_override?.trim() || group?.group_name || "Material group";
            const selectedMaterialIds = new Set(
              finishes
                .filter(
                  (finish) =>
                    finish.source_scope === "linked" &&
                    (finish.product_template_material_group_id === link.id ||
                      (!finish.product_template_material_group_id && finish.material_group_id === link.material_group_id)),
                )
                .map((finish) => finish.brand_material_id)
                .filter((value): value is string => Boolean(value)),
            );
            const hasSelection = selectedMaterialIds.size > 0;

            return (
              <section key={link.id} className="border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">{label}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                      <span className="border border-zinc-200 bg-white px-1.5 py-0.5 font-bold uppercase text-zinc-600">
                        {link.allow_multiple ? "Multiple selection" : "Single selection"}
                      </span>
                      <span>{link.is_required ? "Required" : "Optional"}</span>
                      <span>Spec {link.show_in_specification ? "Yes" : "No"}</span>
                      <span>Quote {link.show_in_quotation ? "Yes" : "No"}</span>
                    </div>
                  </div>
                  <span className="border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-bold text-zinc-500">{groupMaterials.length}</span>
                </div>
                {groupMaterials.length ? (
                  <MaterialGrid
                    brandsById={brandsById}
                    getActionLabel={(material) => {
                      if (selectedMaterialIds.has(material.id)) return link.allow_multiple ? "Remove" : "Selected";
                      return link.allow_multiple || !hasSelection ? "Select" : "Replace";
                    }}
                    groupLabel={label}
                    isMaterialSelected={(material) => selectedMaterialIds.has(material.id)}
                    materials={groupMaterials}
                    onSelect={(material) => selectLinkedMaterial(link, material)}
                  />
                ) : (
                  <p className="border border-dashed border-zinc-300 bg-white px-3 py-3 text-xs text-zinc-500">No active swatches in this linked group yet.</p>
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      {activeTab === "library" ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-2 border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-5">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Brand</span>
              <select value={libraryBrandId} onChange={(event) => setLibraryBrandId(event.target.value)} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800">
                <option value="">All brands</option>
                {(brands ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Group</span>
              <select value={libraryGroupId} onChange={(event) => setLibraryGroupId(event.target.value)} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800">
                <option value="">All groups</option>
                {(materialGroups ?? [])
                  .filter((group) => !libraryBrandId || group.brand_id === libraryBrandId)
                  .map((group) => (
                    <option key={group.id} value={group.id}>{group.group_name}</option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Category</span>
              <select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800">
                <option value="">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{cleanCategoryLabel(category)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Search</span>
              <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Code or name" className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800" />
            </label>
            <label className="flex items-end gap-2 pb-1 text-xs font-semibold text-zinc-600">
              <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} className="mb-1 h-4 w-4 rounded border-zinc-300" />
              <span>Active only</span>
            </label>
          </div>

          {Array.from(new Set(filteredLibraryMaterials.map((material) => material.material_group_id))).map((groupId) => {
            const group = groupsById.get(groupId);
            const groupMaterials = filteredLibraryMaterials.filter((material) => material.material_group_id === groupId);

            return (
              <section key={groupId} className="border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-zinc-900">{group?.group_name ?? "Material group"}</h4>
                  <span className="border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-bold text-zinc-500">{groupMaterials.length}</span>
                </div>
                <MaterialGrid brandsById={brandsById} groupLabel={group?.group_name ?? "Material group"} materials={groupMaterials} onSelect={selectLibraryMaterial} />
              </section>
            );
          })}

          {!filteredLibraryMaterials.length ? (
            <div className="border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">No library materials match these filters.</div>
          ) : null}
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-3 border border-emerald-900/30 bg-emerald-50/40 p-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Field label="Finish group / label" list="finish-group-suggestions" value={draft.group_label} onChange={(value) => updateDraft({ group_label: value })} />
            <Field label="Code" value={draft.finish_code} onChange={(value) => updateDraft({ finish_code: value })} />
            <Field label="Name" value={draft.finish_name} onChange={(value) => updateDraft({ finish_name: value })} />
          </div>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Description</span>
            <textarea
              value={draft.finish_description}
              onChange={(event) => updateDraft({ finish_description: event.target.value })}
              rows={2}
              className="w-full resize-none border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
            />
          </label>
          <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <SwatchEditor draft={draft} itemId={itemId} onChange={updateDraft} quotationId={quotationId} />
            <div className="grid content-start gap-2">
              <label className="flex items-center gap-2 border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold text-zinc-700">
                <input
                  type="checkbox"
                  checked={draft.show_in_specification}
                  onChange={(event) => updateDraft({ show_in_specification: event.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>Show in Specification</span>
              </label>
              <label className="flex items-center gap-2 border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold text-zinc-700">
                <input
                  type="checkbox"
                  checked={draft.show_in_quotation}
                  onChange={(event) => updateDraft({ show_in_quotation: event.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>Show in Quotation</span>
              </label>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={saveDraft} className="bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800">
              Save finish
            </button>
            <button type="button" onClick={() => setEditingIndex(null)} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
