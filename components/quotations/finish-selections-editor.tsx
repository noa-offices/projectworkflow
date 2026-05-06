"use client";

import { useState } from "react";
import type { ClipboardEvent, ChangeEvent } from "react";
import { FinishImagePreview } from "@/components/quotations/finish-image-uploader";
import { uploadQuotationFinishImage } from "@/lib/quotation-image-upload";

export type FinishSelectionEditorRow = {
  id?: string;
  group_label?: string;
  finish_code?: string;
  finish_name?: string;
  finish_description?: string;
  finish_image_url?: string;
  show_in_quotation?: boolean;
  show_in_specification?: boolean;
  sort_order?: number;
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

type DraftFinish = Required<Omit<FinishSelectionEditorRow, "sort_order">>;

type UploadStatus = "idle" | "uploading" | "failed";

function normalizeFinish(row: FinishSelectionEditorRow, index: number): DraftFinish {
  return {
    id: row.id || `finish-${Date.now()}-${index}`,
    group_label: row.group_label ?? "",
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
    group_label: "",
    finish_code: "",
    finish_name: "",
    finish_description: "",
    finish_image_url: "",
    show_in_quotation: false,
    show_in_specification: true,
  };
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
      <input type="hidden" name="finish_group_label[]" value={finish.group_label} />
      <input type="hidden" name="finish_code[]" value={finish.finish_code} />
      <input type="hidden" name="finish_name[]" value={finish.finish_name} />
      <input type="hidden" name="finish_description[]" value={finish.finish_description} />
      <input type="hidden" name="finish_image_url[]" value={finish.finish_image_url} />
      {finish.show_in_specification ? <input type="hidden" name={`finish_show_in_specification_${index}`} value="on" /> : null}
      {finish.show_in_quotation ? <input type="hidden" name={`finish_show_in_quotation_${index}`} value="on" /> : null}
    </>
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
  initialFinishes,
  itemId,
  quotationId,
}: {
  initialFinishes: FinishSelectionEditorRow[];
  itemId?: string | null;
  quotationId: string;
}) {
  const [finishes, setFinishes] = useState(() => initialFinishes.map(normalizeFinish));
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftFinish>(() => emptyDraft());
  const isEditing = editingIndex !== null;

  function startAdd() {
    setDraft(emptyDraft());
    setEditingIndex("new");
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

  return (
    <fieldset className="border border-zinc-300 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-[11px] font-bold uppercase text-zinc-500">Materials & Finishes</legend>
        <button
          type="button"
          onClick={startAdd}
          className="border border-emerald-900 px-2.5 py-1 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
        >
          + Add finish
        </button>
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
            <button
              type="button"
              onClick={startAdd}
              className="mt-2 border border-emerald-900 px-2.5 py-1 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
            >
              + Add finish
            </button>
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
