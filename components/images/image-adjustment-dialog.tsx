"use client";

import { useRef, useState } from "react";
import {
  defaultImageDisplaySettings,
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";

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
  previewFrameHeight,
  previewFrameWidth,
  saving,
}: {
  imageUrl: string;
  initialSettings?: Partial<ImageDisplaySettings> | null;
  onCancel: () => void;
  onSave: (settings: ImageDisplaySettings) => void;
  previewFrameHeight?: number;
  previewFrameWidth?: number;
  saving?: boolean;
}) {
  const [settings, setSettings] = useState(() => normalizeImageDisplaySettings(initialSettings));
  const previewRef = useRef<HTMLDivElement | null>(null);

  const frameWidth = Math.max(Math.round(previewFrameWidth ?? 180), 120);
  const frameHeight = Math.max(Math.round(previewFrameHeight ?? 112), 72);
  const zoomPercent = Math.round(settings.zoom * 100);

  function updateSettings(patch: Partial<ImageDisplaySettings>) {
    setSettings((current) => normalizeImageDisplaySettings({ ...current, ...patch }));
  }

  function adjustZoom(delta: number) {
    updateSettings({ zoom: Math.min(Math.max(settings.zoom + delta, 1), 3) });
  }

  function nudgePosition(deltaX: number, deltaY: number) {
    updateSettings({
      positionX: settings.positionX + deltaX,
      positionY: settings.positionY + deltaY,
    });
  }

  function centerImage() {
    updateSettings({ positionX: 50, positionY: 50 });
  }

  function resetAll() {
    setSettings(defaultImageDisplaySettings);
  }

  function startDrag(clientX: number, clientY: number) {
    const frame = previewRef.current;
    if (!frame) return;

    const { width, height } = frame.getBoundingClientRect();
    const startX = clientX;
    const startY = clientY;
    const initialX = settings.positionX;
    const initialY = settings.positionY;

    function updatePosition(nextClientX: number, nextClientY: number) {
      const deltaX = width > 0 ? ((nextClientX - startX) / width) * 100 : 0;
      const deltaY = height > 0 ? ((nextClientY - startY) / height) * 100 : 0;
      updateSettings({
        positionX: initialX + deltaX,
        positionY: initialY + deltaY,
      });
    }

    function stopDrag() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(event: MouseEvent) {
      event.preventDefault();
      updatePosition(event.clientX, event.clientY);
    }

    function handleMouseUp() {
      stopDrag();
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 px-4 py-6">
      <div className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-white p-4 shadow-xl">
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

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500">Preview</p>
                <p className="text-xs text-zinc-500">Preview matches quotation image cell.</p>
              </div>
              <div className="text-right text-[11px] text-zinc-500">
                {frameWidth} x {frameHeight}
              </div>
            </div>
            <div className="mt-4 flex min-h-[280px] items-center justify-center">
              <div
                ref={previewRef}
                className="relative overflow-hidden border border-dashed border-zinc-300 bg-white shadow-sm"
                style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  startDrag(event.clientX, event.clientY);
                }}
              >
                <QuotationImageFrame
                  alt="Image adjustment preview"
                  className="h-full w-full cursor-move overflow-hidden"
                  imageUrl={imageUrl}
                  settings={settings}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold uppercase text-zinc-500">Fit</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateSettings({ fit: "contain", zoom: 1, positionX: 50, positionY: 50 })}
                  className={`h-9 rounded-md border text-xs font-semibold transition ${
                    settings.fit === "contain" && settings.zoom === 1
                      ? "border-emerald-900 bg-emerald-50 text-emerald-950"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  Fit inside cell
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ fit: "cover", zoom: Math.max(settings.zoom, 1), positionX: 50, positionY: 50 })}
                  className={`h-9 rounded-md border text-xs font-semibold capitalize transition ${
                    settings.fit === "cover"
                      ? "border-emerald-900 bg-emerald-50 text-emerald-950"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  Fill cell
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ zoom: 1 })}
                  className="h-9 rounded-md border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 transition hover:border-zinc-300"
                >
                  Actual size
                </button>
                <button
                  type="button"
                  onClick={centerImage}
                  className="h-9 rounded-md border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 transition hover:border-zinc-300"
                >
                  Center
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-zinc-500">Zoom</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustZoom(-0.05)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={100}
                    max={300}
                    step={5}
                    value={zoomPercent}
                    onChange={(event) => updateSettings({ zoom: Number(event.target.value) / 100 })}
                    className="h-8 w-20 rounded-md border border-zinc-200 bg-white px-2 text-center text-xs font-semibold text-zinc-700 outline-none focus:border-emerald-800"
                  />
                  <button
                    type="button"
                    onClick={() => adjustZoom(0.05)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    +
                  </button>
                </div>
              </div>
              <Slider
                label="Zoom"
                min={1}
                max={3}
                step={0.05}
                value={settings.zoom}
                onChange={(zoom) => updateSettings({ zoom })}
              />
            </div>

            <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-zinc-500">Move</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => nudgePosition(-5, 0)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgePosition(0, -5)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgePosition(0, 5)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgePosition(5, 0)}
                    className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:border-zinc-300"
                  >
                    →
                  </button>
                </div>
              </div>
              <Slider
                label="Move X"
                min={0}
                max={100}
                value={settings.positionX}
                onChange={(positionX) => updateSettings({ positionX })}
              />
              <Slider
                label="Move Y"
                min={0}
                max={100}
                value={settings.positionY}
                onChange={(positionY) => updateSettings({ positionY })}
              />
              <button
                type="button"
                onClick={centerImage}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:border-zinc-300"
              >
                Reset position
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={resetAll}
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
