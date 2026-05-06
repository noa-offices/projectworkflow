"use client";

import { useState } from "react";
import {
  defaultImageDisplaySettings,
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";

export {
  defaultImageDisplaySettings,
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
};

function Slider({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold uppercase text-zinc-500">
        <span>{label}</span>
        <span>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-emerald-900"
      />
    </label>
  );
}

export function ImageAdjustmentDialog({
  imageUrl,
  initialSettings,
  onCancel,
  onSave,
  saving,
}: {
  imageUrl: string;
  initialSettings?: Partial<ImageDisplaySettings> | null;
  onCancel: () => void;
  onSave: (settings: ImageDisplaySettings) => void;
  saving?: boolean;
}) {
  const [settings, setSettings] = useState(() => normalizeImageDisplaySettings(initialSettings));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 px-4 py-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-950">Adjust image</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-950"
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 flex h-48 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Image adjustment preview"
            className="block h-full w-full transition"
            style={imageDisplayStyle(settings)}
          />
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <span className="text-xs font-semibold uppercase text-zinc-500">Fit</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["contain", "cover"] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => setSettings((current) => ({ ...current, fit }))}
                  className={`h-9 rounded-md border text-xs font-semibold capitalize transition ${
                    settings.fit === fit
                      ? "border-emerald-900 bg-emerald-50 text-emerald-950"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  {fit}
                </button>
              ))}
            </div>
          </div>

          <Slider
            label="Zoom"
            min={1}
            max={3}
            step={0.05}
            value={settings.zoom}
            onChange={(zoom) => setSettings((current) => ({ ...current, zoom }))}
          />
          <Slider
            label="Move X"
            min={0}
            max={100}
            value={settings.positionX}
            onChange={(positionX) => setSettings((current) => ({ ...current, positionX }))}
          />
          <Slider
            label="Move Y"
            min={0}
            max={100}
            value={settings.positionY}
            onChange={(positionY) => setSettings((current) => ({ ...current, positionY }))}
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSettings(defaultImageDisplaySettings)}
            className="text-xs font-semibold text-zinc-600 transition hover:text-zinc-950"
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 transition hover:border-zinc-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(settings)}
              disabled={saving}
              className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
