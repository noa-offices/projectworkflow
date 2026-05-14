"use client";

import { useMemo, useState } from "react";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";

type ProductTemplateImageField =
  | "proposed_image_url_1"
  | "proposed_image_url_2"
  | "proposed_image_url_3"
  | "proposed_image_url_4"
  | "proposed_image_url_5"
  | "proposed_image_url_6"
  | "proposed_image_url_7"
  | "proposed_image_url_8"
  | "proposed_image_url_9"
  | "proposed_image_url_10"
  | "proposed_image_url_11"
  | "proposed_image_url_12"
  | "proposed_image_url_13"
  | "proposed_image_url_14"
  | "proposed_image_url_15"
  | "proposed_image_url_16"
  | "proposed_image_url_17"
  | "proposed_image_url_18"
  | "proposed_image_url_19"
  | "proposed_image_url_20";

type Slot = {
  field: ProductTemplateImageField;
  label: string;
};

type ImageSettings = {
  fit?: "contain" | "cover";
  zoom?: number;
  positionX?: number;
  positionY?: number;
} | null | undefined;

type ImageSlotState = {
  field: ProductTemplateImageField;
  label: string;
  settings?: ImageSettings;
  value: string | null;
};

const allTemplateImageSlots: Array<{
  field: ProductTemplateImageField;
  label: string;
}> = [
  { field: "proposed_image_url_1", label: "Image 1" },
  { field: "proposed_image_url_2", label: "Image 2" },
  { field: "proposed_image_url_3", label: "Image 3" },
  { field: "proposed_image_url_4", label: "Image 4" },
  { field: "proposed_image_url_5", label: "Image 5" },
  { field: "proposed_image_url_6", label: "Image 6" },
  { field: "proposed_image_url_7", label: "Image 7" },
  { field: "proposed_image_url_8", label: "Image 8" },
  { field: "proposed_image_url_9", label: "Image 9" },
  { field: "proposed_image_url_10", label: "Image 10" },
  { field: "proposed_image_url_11", label: "Image 11" },
  { field: "proposed_image_url_12", label: "Image 12" },
  { field: "proposed_image_url_13", label: "Image 13" },
  { field: "proposed_image_url_14", label: "Image 14" },
  { field: "proposed_image_url_15", label: "Image 15" },
  { field: "proposed_image_url_16", label: "Image 16" },
  { field: "proposed_image_url_17", label: "Image 17" },
  { field: "proposed_image_url_18", label: "Image 18" },
  { field: "proposed_image_url_19", label: "Image 19" },
  { field: "proposed_image_url_20", label: "Image 20" },
];

const maxTemplateImages = allTemplateImageSlots.length;

function normalizeFormSlots(initialSlots: ImageSlotState[]) {
  const slotByField = new Map(initialSlots.map((slot) => [slot.field, slot]));

  return allTemplateImageSlots.map((slot) => {
    const existing = slotByField.get(slot.field);

    return {
      field: slot.field,
      label: slot.label,
      settings: existing?.settings,
      value: existing?.value ?? null,
    };
  });
}

function visibleFormSlots(slots: ImageSlotState[]) {
  const filledSlots = slots.filter((slot) => slot.value);
  const lastFilledIndex = slots.reduce(
    (highestIndex, slot, index) => (slot.value ? index : highestIndex),
    -1,
  );

  const nextAvailableSlot =
    slots.slice(lastFilledIndex + 1).find((slot) => !slot.value) ??
    slots.find((slot) => !slot.value) ??
    null;

  if (!filledSlots.length) {
    return slots[0] ? [slots[0]] : [];
  }

  return nextAvailableSlot && !nextAvailableSlot.value
    ? [...filledSlots, nextAvailableSlot]
    : filledSlots;
}

export function TemplateReferenceImageFieldManager({
  initialSlots,
  templateExists,
  templateId,
}: {
  initialSlots: ImageSlotState[];
  templateExists: boolean;
  templateId: string;
}) {
  const [slots, setSlots] = useState(() => normalizeFormSlots(initialSlots));
  const renderedSlots = useMemo(() => visibleFormSlots(slots), [slots]);
  const filledImageCount = slots.filter((slot) => slot.value).length;
  const hasReachedImageLimit = filledImageCount >= maxTemplateImages;

  function updateSlotValue(field: ProductTemplateImageField, value: string | null) {
    setSlots((current) =>
      current.map((slot) => (slot.field === field ? { ...slot, value } : slot)),
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {slots.map((slot) => (
        <input
          key={`hidden-${slot.field}`}
          type="hidden"
          name={slot.field}
          defaultValue={slot.value ?? ""}
        />
      ))}
      {slots.map((slot) => (
        <input
          key={`settings-${slot.field}`}
          type="hidden"
          name={`image_settings_${slot.field}`}
          defaultValue={slot.settings ? JSON.stringify(slot.settings) : ""}
        />
      ))}
      {renderedSlots.map((slot, index) => {
        const isEmptyAddSlot = !slot.value;
        const label = isEmptyAddSlot ? "Add image" : `Image ${index + 1}`;

        return (
          <div key={slot.field}>
            <span className="text-xs font-semibold uppercase text-zinc-500">
              {label}
            </span>
            <div className="mt-2">
              <ProductTemplateImageUploader
                canEdit
                field={slot.field}
                formOnly={!templateExists}
                imageSettings={slot.settings}
                label={isEmptyAddSlot ? "Add product reference image" : `${label} product reference image`}
                onValueChange={(value) => updateSlotValue(slot.field, value)}
                templateId={templateId}
                value={slot.value}
              />
            </div>
          </div>
        );
      })}
      {hasReachedImageLimit ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 md:col-span-2 xl:col-span-4">
          This template currently supports up to 20 stored images.
        </div>
      ) : null}
    </div>
  );
}

export function TemplateDetailImageGallery({
  templateId,
  visibleSlots,
}: {
  templateId: string;
  visibleSlots: Array<Slot & { settings?: ImageSettings; value: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const initiallyVisibleSlots = visibleSlots.slice(0, 6);
  const hiddenSlots = visibleSlots.slice(6);
  const renderedSlots = expanded ? visibleSlots : initiallyVisibleSlots;

  if (!visibleSlots.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-500">
        No product images uploaded yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {renderedSlots.map((slot, index) => (
          <div key={slot.field} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Image {index + 1}
            </p>
            <ProductTemplateImageUploader
              imageSettings={slot.settings}
              label={`Image ${index + 1}`}
              templateId={templateId}
              value={slot.value}
            />
          </div>
        ))}
      </div>
      {hiddenSlots.length ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
        >
          {expanded ? "Show less images" : `Show more images (${hiddenSlots.length})`}
        </button>
      ) : null}
    </div>
  );
}
