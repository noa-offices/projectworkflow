"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { updateSpecificationSettings } from "@/app/quotations/actions";
import type { SpecificationLayoutSettings } from "@/lib/quotations/document-setup";
import { uploadQuotationSpecificationImage } from "@/lib/quotation-image-upload";

const MIN_SCALE = 0.2;
const MAX_SCALE = 1.5;
const SCALE_STEP = 0.1;

type PreviewMetrics = {
  availableWidth: number;
  contentHeight: number;
  contentWidth: number;
  isMobile: boolean;
};

export type SpecificationSettings = SpecificationLayoutSettings & {
  itemImageOverrides: Record<string, SpecificationItemImageOverride>;
  showBrand: boolean;
  showCategory: boolean;
  showClientReferenceHeader: boolean;
  showCode: boolean;
  showDescriptionSpecification: boolean;
  showDimensions: boolean;
  showFrontPage: boolean;
  showFrontPageAttentionContact: boolean;
  showFrontPageClient: boolean;
  showFrontPageCompanyFooter: boolean;
  showFrontPageLocation: boolean;
  showFrontPagePageNumber: boolean;
  showFrontPagePoBox: boolean;
  showFrontPageProjectAddress: boolean;
  showFrontPageProjectReference: boolean;
  showFrontPageProjectTitle: boolean;
  showFrontPageTelephone: boolean;
  showItemImages: boolean;
  showMaterialDetails: boolean;
  showModel: boolean;
  showOriginSupplier: boolean;
};

export type SpecificationItemImageOverride = {
  fit: "contain" | "cover";
  positionX: number;
  positionY: number;
  replacementImageUrl?: string;
  replacementPreviewUrl?: string;
  size: SpecificationLayoutSettings["productImageSize"];
  zoom: number;
};

export type SpecificationImageItem = {
  brand: string | null;
  id: string;
  itemNumber: number;
  name: string;
  thumbnailUrl: string | null;
};

const defaultSettings: SpecificationSettings = {
  itemImageOverrides: {},
  productImageFit: "contain",
  productImageSize: "current",
  showBrand: true,
  showCategory: true,
  showClientReferenceHeader: true,
  showCode: true,
  showDescriptionSpecification: true,
  showDimensions: true,
  showFrontPage: true,
  showFrontPageAttentionContact: true,
  showFrontPageClient: true,
  showFrontPageCompanyFooter: true,
  showFrontPageLocation: true,
  showFrontPagePageNumber: true,
  showFrontPagePoBox: true,
  showFrontPageProjectAddress: true,
  showFrontPageProjectReference: true,
  showFrontPageProjectTitle: true,
  showFrontPageTelephone: true,
  showItemImages: true,
  showMaterialDetails: true,
  showModel: true,
  showOriginSupplier: true,
  textDensity: "standard",
};

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function SpecificationPreview({
  backHref,
  canManage,
  children,
  downloadHref,
  initialSettings,
  imageItems,
  pageCount,
  quotationId,
  quotationNo,
}: {
  backHref: string;
  canManage: boolean;
  children: ReactNode;
  downloadHref: string;
  initialSettings: SpecificationSettings;
  imageItems: SpecificationImageItem[];
  pageCount: number;
  quotationId: string;
  quotationNo: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<PreviewMetrics | null>(null);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [selectedItemId, setSelectedItemId] = useState(imageItems[0]?.id ?? "");
  const [imageUploadError, setImageUploadError] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const replacementInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const updateMetrics = () => {
      setMetrics({
        availableWidth: viewport.clientWidth,
        contentHeight: content.scrollHeight,
        contentWidth: content.scrollWidth,
        isMobile: window.innerWidth < 1280,
      });
    };

    const frame = window.requestAnimationFrame(updateMetrics);
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(viewport);
    observer.observe(content);
    window.addEventListener("resize", updateMetrics);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const heights = { small: "260px", medium: "310px", current: "350px" } as const;
    content.querySelectorAll<HTMLElement>("[data-spec-item-id]").forEach((itemPage) => {
      const itemId = itemPage.dataset.specItemId;
      if (!itemId) return;

      const override = settings.itemImageOverrides[itemId];
      const frame = itemPage.querySelector<HTMLElement>("[data-spec-main-image]");
      let image = frame?.querySelector<HTMLImageElement>("img");
      if (!frame) return;

      frame.style.height = heights[override?.size ?? settings.productImageSize];
      const originalImageUrl = imageItems.find((item) => item.id === itemId)?.thumbnailUrl ?? null;
      const imageUrl = override?.replacementPreviewUrl ?? originalImageUrl;
      const imageContainer = frame.firstElementChild as HTMLElement | null;
      let emptyContent = frame.querySelector<HTMLElement>("[data-spec-image-empty]");
      if (imageUrl && !image && imageContainer) {
        image = document.createElement("img");
        image.alt = "Specification product image";
        image.className = "block h-full w-full";
        image.dataset.specDraftImage = "true";
        imageContainer.appendChild(image);
      }
      if (!imageUrl) {
        if (image?.dataset.specDraftImage === "true") {
          image.remove();
        } else if (image) {
          image.style.display = "none";
        }
        if (!emptyContent && imageContainer) {
          emptyContent = document.createElement("span");
          emptyContent.dataset.specImageEmpty = "true";
          emptyContent.className = "text-xs text-zinc-400";
          emptyContent.textContent = "No image";
          imageContainer.appendChild(emptyContent);
        }
        if (emptyContent) emptyContent.style.display = "";
        return;
      }
      if (!image) return;

      image.src = imageUrl;
      image.style.display = "block";
      if (emptyContent) emptyContent.style.display = "none";
      image.onerror = () => {
        image.style.display = "none";
        if (emptyContent) emptyContent.style.display = "";
      };

      const fit = override?.fit ?? settings.productImageFit;
      const zoom = override?.zoom ?? 1;
      const positionX = override?.positionX ?? 50;
      const positionY = override?.positionY ?? 50;
      image.style.objectFit = fit;
      image.style.objectPosition = `${positionX}% ${positionY}%`;
      image.style.transform = `scale(${zoom})`;
      image.style.transformOrigin = `${positionX}% ${positionY}%`;
    });
  }, [imageItems, settings]);

  const fitScale = metrics
    ? clampScale(metrics.availableWidth / metrics.contentWidth)
    : 1;
  const scale = metrics?.isMobile ? manualScale ?? fitScale : 1;
  const scaledWidth = metrics ? metrics.contentWidth * scale : undefined;
  const scaledHeight = metrics ? metrics.contentHeight * scale : undefined;
  const isDirty = JSON.stringify(settings) !== JSON.stringify(initialSettings);
  const selectedItem = imageItems.find((item) => item.id === selectedItemId) ?? imageItems[0];
  const selectedOverride = selectedItem ? settings.itemImageOverrides[selectedItem.id] : undefined;

  const changeScale = (direction: -1 | 1) => {
    const nextScale = Math.round((scale + direction * SCALE_STEP) * 100) / 100;
    setManualScale(clampScale(nextScale));
  };

  const updateSetting = <Key extends keyof SpecificationSettings>(key: Key, value: SpecificationSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const updateSelectedItem = (next: Partial<SpecificationItemImageOverride>) => {
    if (!selectedItem) return;

    setSettings((current) => {
      const existing = current.itemImageOverrides[selectedItem.id];
      const definedNext = Object.fromEntries(
        Object.entries(next).filter(([, value]) => value !== undefined),
      ) as Partial<SpecificationItemImageOverride>;
      const base: SpecificationItemImageOverride = existing ?? {
        fit: current.productImageFit,
        positionX: 50,
        positionY: 50,
        size: current.productImageSize,
        zoom: 1,
      };

      return {
        ...current,
        itemImageOverrides: {
          ...current.itemImageOverrides,
          [selectedItem.id]: {
            ...base,
            ...definedNext,
          },
        },
      };
    });
  };
  const resetSelectedItem = () => {
    if (!selectedItem) return;

    setSettings((current) => {
      const itemImageOverrides = { ...current.itemImageOverrides };
      delete itemImageOverrides[selectedItem.id];
      return { ...current, itemImageOverrides };
    });
  };
  const replaceSelectedImage = async (file: File | null) => {
    if (!file || !selectedItem) return;

    setImageUploadError("");
    setIsUploadingImage(true);
    try {
      const upload = await uploadQuotationSpecificationImage({
        file,
        itemId: selectedItem.id,
        quotationId,
      });
      updateSelectedItem({
        replacementImageUrl: `quote-images:${upload.path}`,
        replacementPreviewUrl: upload.previewUrl,
      });
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Image could not be uploaded.");
    } finally {
      setIsUploadingImage(false);
      if (replacementInputRef.current) replacementInputRef.current.value = "";
    }
  };
  const useOriginalImage = () => {
    if (!selectedItem) return;

    setSettings((current) => {
      const existing = current.itemImageOverrides[selectedItem.id];
      if (!existing) return current;
      const rest = { ...existing };
      delete rest.replacementImageUrl;
      delete rest.replacementPreviewUrl;
      return {
        ...current,
        itemImageOverrides: { ...current.itemImageOverrides, [selectedItem.id]: rest },
      };
    });
    setImageUploadError("");
  };
  const enabledProductDetailCount = [
    settings.showBrand,
    settings.showModel,
    settings.showCode,
    settings.showCategory,
    settings.showOriginSupplier,
    settings.showDimensions,
    settings.showDescriptionSpecification,
    settings.showMaterialDetails,
  ].filter(Boolean).length;

  const settingsPanel = (
    <form action={updateSpecificationSettings}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={`/quotations/${quotationId}/specification`} />
      <input type="hidden" name="item_image_overrides" value={JSON.stringify(settings.itemImageOverrides)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-900">
            Specification Settings
          </p>
          <p className="mt-2 truncate text-lg font-semibold text-zinc-950">{quotationNo}</p>
          <p className="mt-1 text-sm text-zinc-500">{pageCount} document pages</p>
          <p className="mt-1 text-xs text-zinc-500">
            {enabledProductDetailCount}/8 product details - Front page {settings.showFrontPage ? "included" : "hidden"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileSettingsOpen(false)}
          className="inline-flex min-h-10 items-center rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 xl:hidden"
        >
          Close
        </button>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Choose which supported details appear in the Specification Sheet. Save to update pagination and PDF output.
      </p>

      <div className="mt-5 grid gap-4">
        <SettingsGroup title="Document Content">
          <SettingToggle
            checked={settings.showClientReferenceHeader}
            disabled={!canManage}
            label="Client and reference header"
            name="show_client_reference_header"
            onChange={(checked) => updateSetting("showClientReferenceHeader", checked)}
          />
          <SettingToggle
            checked={settings.showItemImages}
            disabled={!canManage}
            label="Product images"
            name="show_item_images"
            onChange={(checked) => updateSetting("showItemImages", checked)}
          />
        </SettingsGroup>

        <SettingsGroup title="Product Page">
          <SettingChoice
            disabled={!canManage}
            label="Default image size"
            name="product_image_size"
            onChange={(value) => updateSetting("productImageSize", value as SpecificationSettings["productImageSize"])}
            options={[
              { label: "Small", value: "small" },
              { label: "Medium", value: "medium" },
              { label: "Current", value: "current" },
            ]}
            value={settings.productImageSize}
          />
          <SettingChoice
            disabled={!canManage}
            label="Default image fit"
            name="product_image_fit"
            onChange={(value) => updateSetting("productImageFit", value as SpecificationSettings["productImageFit"])}
            options={[
              { label: "Contain", value: "contain" },
              { label: "Cover", value: "cover" },
            ]}
            value={settings.productImageFit}
          />
          <SettingChoice
            disabled={!canManage}
            label="Text density"
            name="text_density"
            onChange={(value) => updateSetting("textDensity", value as SpecificationSettings["textDensity"])}
            options={[
              { label: "Standard", value: "standard" },
              { label: "Compact", value: "compact" },
            ]}
            value={settings.textDensity}
          />
          <p className="text-xs leading-5 text-zinc-500">
            Defaults apply only to items without their own image adjustment. Long descriptions may be shortened to protect the product-page layout.
          </p>
        </SettingsGroup>

        {selectedItem ? (
          <SettingsGroup title="Current Item Image">
            <label className="grid gap-1 text-xs font-semibold text-zinc-600">
              Adjust item
              <select
                disabled={!canManage}
                value={selectedItem.id}
                onChange={(event) => {
                  setSelectedItemId(event.target.value);
                  setImageUploadError("");
                }}
                className="min-h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800"
              >
                {imageItems.map((item) => (
                  <option key={item.id} value={item.id}>Item {item.itemNumber} — {item.name}</option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-2.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-50">
                {selectedOverride?.replacementPreviewUrl || selectedItem.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedOverride?.replacementPreviewUrl ?? selectedItem.thumbnailUrl ?? ""} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[9px] uppercase text-zinc-400">No image</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">Item {selectedItem.itemNumber} — {selectedItem.name}</p>
                {selectedItem.brand ? <p className="mt-0.5 truncate text-xs text-zinc-500">{selectedItem.brand}</p> : null}
                <p className={`mt-1 text-xs font-medium ${selectedOverride?.replacementImageUrl ? "text-emerald-800" : "text-zinc-500"}`}>
                  {selectedOverride?.replacementImageUrl ? "Using Specification replacement" : "Using original quotation image"}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{selectedOverride ? "Custom item adjustment" : "Using document default"}</p>
              </div>
            </div>
            <input
              ref={replacementInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!canManage || isUploadingImage}
              onChange={(event) => void replaceSelectedImage(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!canManage || isUploadingImage}
                onClick={() => replacementInputRef.current?.click()}
                className="min-h-10 rounded-lg border border-emerald-800 px-3 text-sm font-semibold text-emerald-900 disabled:opacity-40"
              >
                {isUploadingImage ? "Uploading…" : "Replace image"}
              </button>
              <button
                type="button"
                disabled={!canManage || !selectedOverride?.replacementImageUrl || isUploadingImage}
                onClick={useOriginalImage}
                className="min-h-10 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 disabled:opacity-40"
              >
                Use original image
              </button>
            </div>
            {imageUploadError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{imageUploadError}</p> : null}
            <p className="text-xs leading-5 text-zinc-500">
              Use original image keeps this item&apos;s presentation adjustments. Reset removes the replacement and all item adjustments.
            </p>
            <SettingChoice
              disabled={!canManage}
              label="Image frame size"
              name={`item_image_size_${selectedItem.id}`}
              onChange={(value) => updateSelectedItem({ size: value as SpecificationItemImageOverride["size"] })}
              options={[
                { label: "Small", value: "small" },
                { label: "Medium", value: "medium" },
                { label: "Current", value: "current" },
              ]}
              value={selectedOverride?.size ?? settings.productImageSize}
            />
            <SettingChoice
              disabled={!canManage}
              label="Fit"
              name={`item_image_fit_${selectedItem.id}`}
              onChange={(value) => updateSelectedItem({ fit: value as SpecificationItemImageOverride["fit"] })}
              options={[
                { label: "Contain", value: "contain" },
                { label: "Cover", value: "cover" },
              ]}
              value={selectedOverride?.fit ?? settings.productImageFit}
            />
            <ImageSlider
              disabled={!canManage}
              label="Image scale"
              max={3}
              min={0.5}
              onChange={(value) => updateSelectedItem({ zoom: value })}
              step={0.05}
              value={selectedOverride?.zoom ?? 1}
              valueLabel={`${(selectedOverride?.zoom ?? 1).toFixed(2)}×`}
            />
            <p className="text-xs leading-5 text-zinc-500">
              Frame size changes the available image area. Image scale makes the product smaller or larger inside that frame.
            </p>
            <ImageSlider
              disabled={!canManage}
              label="Horizontal position"
              max={100}
              min={0}
              onChange={(value) => updateSelectedItem({ positionX: value })}
              step={5}
              value={selectedOverride?.positionX ?? 50}
              valueLabel={`${selectedOverride?.positionX ?? 50}%`}
            />
            <ImageSlider
              disabled={!canManage}
              label="Vertical position"
              max={100}
              min={0}
              onChange={(value) => updateSelectedItem({ positionY: value })}
              step={5}
              value={selectedOverride?.positionY ?? 50}
              valueLabel={`${selectedOverride?.positionY ?? 50}%`}
            />
            <button
              type="button"
              disabled={!canManage || !selectedOverride}
              onClick={resetSelectedItem}
              className="min-h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 disabled:opacity-40"
            >
              Reset this item to document defaults
            </button>
          </SettingsGroup>
        ) : null}

        <SettingsGroup title="Product Details">
          <SettingToggle
            checked={settings.showBrand}
            disabled={!canManage}
            label="Brand"
            name="show_brand"
            onChange={(checked) => updateSetting("showBrand", checked)}
          />
          <SettingToggle
            checked={settings.showModel}
            disabled={!canManage}
            label="Model"
            name="show_model"
            onChange={(checked) => updateSetting("showModel", checked)}
          />
          <SettingToggle
            checked={settings.showCode}
            disabled={!canManage}
            label="Code"
            name="show_code"
            onChange={(checked) => updateSetting("showCode", checked)}
          />
          <SettingToggle
            checked={settings.showCategory}
            disabled={!canManage}
            label="Category"
            name="show_category"
            onChange={(checked) => updateSetting("showCategory", checked)}
          />
          <SettingToggle
            checked={settings.showOriginSupplier}
            disabled={!canManage}
            label="Origin / Supplier"
            name="show_origin_supplier"
            onChange={(checked) => updateSetting("showOriginSupplier", checked)}
          />
          <SettingToggle
            checked={settings.showDimensions}
            disabled={!canManage}
            label="Dimensions"
            name="show_dimensions"
            onChange={(checked) => updateSetting("showDimensions", checked)}
          />
          <SettingToggle
            checked={settings.showDescriptionSpecification}
            disabled={!canManage}
            label="Description / Specification"
            name="show_description_specification"
            onChange={(checked) => updateSetting("showDescriptionSpecification", checked)}
          />
          <SettingToggle
            checked={settings.showMaterialDetails}
            disabled={!canManage}
            label="Materials and finishes"
            name="show_material_details"
            onChange={(checked) => updateSetting("showMaterialDetails", checked)}
          />
        </SettingsGroup>

        <SettingsGroup title="Front Page">
          <SettingToggle
            checked={settings.showFrontPage}
            disabled={!canManage}
            label="Show front page"
            name="show_front_page"
            onChange={(checked) => updateSetting("showFrontPage", checked)}
          />
          <div className="grid gap-2">
            <SettingToggle
              checked={settings.showFrontPageProjectTitle}
              disabled={!canManage}
              label="Project title"
              name="show_front_page_project_title"
              onChange={(checked) => updateSetting("showFrontPageProjectTitle", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageClient}
              disabled={!canManage}
              label="Client"
              name="show_front_page_client"
              onChange={(checked) => updateSetting("showFrontPageClient", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageProjectReference}
              disabled={!canManage}
              label="Project / Reference"
              name="show_front_page_project_reference"
              onChange={(checked) => updateSetting("showFrontPageProjectReference", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageLocation}
              disabled={!canManage}
              label="Location"
              name="show_front_page_location"
              onChange={(checked) => updateSetting("showFrontPageLocation", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageTelephone}
              disabled={!canManage}
              label="Telephone"
              name="show_front_page_telephone"
              onChange={(checked) => updateSetting("showFrontPageTelephone", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageAttentionContact}
              disabled={!canManage}
              label="Attention / Contact"
              name="show_front_page_attention_contact"
              onChange={(checked) => updateSetting("showFrontPageAttentionContact", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPagePoBox}
              disabled={!canManage}
              label="PO Box"
              name="show_front_page_po_box"
              onChange={(checked) => updateSetting("showFrontPagePoBox", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageProjectAddress}
              disabled={!canManage}
              label="Project Address"
              name="show_front_page_project_address"
              onChange={(checked) => updateSetting("showFrontPageProjectAddress", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPageCompanyFooter}
              disabled={!canManage}
              label="Company footer"
              name="show_front_page_company_footer"
              onChange={(checked) => updateSetting("showFrontPageCompanyFooter", checked)}
            />
            <SettingToggle
              checked={settings.showFrontPagePageNumber}
              disabled={!canManage}
              label="Page number"
              name="show_front_page_page_number"
              onChange={(checked) => updateSetting("showFrontPagePageNumber", checked)}
            />
          </div>
          {!settings.showFrontPage ? (
            <p className="text-xs leading-5 text-zinc-500">
              Field choices are preserved and will apply when the front page is enabled.
            </p>
          ) : null}
        </SettingsGroup>
      </div>

      <p className={`mt-4 text-xs ${isDirty ? "text-amber-700" : "text-zinc-500"}`}>
        {isDirty ? "Unsaved settings changes." : "Preview matches saved settings."}
      </p>

      <div className="mt-5 grid gap-2">
        {canManage ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSettings((current) => ({ ...defaultSettings, itemImageOverrides: current.itemImageOverrides }))}
              className="min-h-10 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-700"
            >
              Reset document defaults
            </button>
            <button
              type="submit"
              disabled={!isDirty || isUploadingImage}
              className="min-h-10 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white disabled:bg-zinc-300"
            >
              Save
            </button>
          </div>
        ) : (
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-5 text-zinc-600">
            You have read-only access to these settings.
          </p>
        )}
        {isDirty ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium leading-5 text-amber-800">
            Save settings before downloading the updated PDF.
          </p>
        ) : (
          <a
            href={downloadHref}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-900 px-3 text-sm font-semibold text-emerald-900"
          >
            Download PDF
          </a>
        )}
      </div>
    </form>
  );

  return (
    <>
      <div className="no-print mb-3 min-w-0 xl:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-emerald-900"
          >
            Back
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-zinc-950">Specification Sheet</p>
            <p className="text-xs text-zinc-500">Preview</p>
          </div>
          {isDirty ? (
            <button
              type="button"
              disabled
              title="Save settings before downloading the updated PDF"
              className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-zinc-300 px-3 text-sm font-semibold text-white"
            >
              Download PDF
            </button>
          ) : (
            <a
              href={downloadHref}
              className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white"
            >
              Download PDF
            </a>
          )}
        </div>

        <div className="mt-2 flex min-w-0 items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={scale <= MIN_SCALE}
            onClick={() => changeScale(-1)}
            className="min-h-10 min-w-10 rounded-md px-3 text-lg font-semibold text-zinc-700 disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-14 text-center text-xs font-semibold text-zinc-600">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={scale >= MAX_SCALE}
            onClick={() => changeScale(1)}
            className="min-h-10 min-w-10 rounded-md px-3 text-lg font-semibold text-zinc-700 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setManualScale(null)}
            className="min-h-10 flex-1 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-emerald-900"
          >
            Fit width
          </button>
        </div>

        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Specification Settings
            </p>
            <p className="mt-1 text-xs text-zinc-600">{pageCount} pages</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSettingsOpen(true)}
            className="min-h-10 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-800"
          >
            Open settings
          </button>
        </div>
      </div>

      {isMobileSettingsOpen ? (
        <button
          type="button"
          aria-label="Close specification settings"
          onClick={() => setIsMobileSettingsOpen(false)}
          className="no-print fixed inset-0 z-40 bg-zinc-950/40 xl:hidden"
        />
      ) : null}

      <div className="spec-workspace min-w-0 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-6">
        <div
          ref={viewportRef}
          className="spec-preview-viewport min-w-0 max-w-full overflow-x-auto overflow-y-hidden xl:overflow-visible"
        >
          <div
            className="spec-preview-reservation relative xl:static"
            style={
              metrics?.isMobile
                ? {
                    width: scaledWidth,
                    height: scaledHeight,
                    marginInline: scaledWidth && scaledWidth < metrics.availableWidth ? "auto" : 0,
                  }
                : undefined
            }
          >
            <div
              ref={contentRef}
              className={[
                "spec-preview-scale absolute left-0 top-0 w-[210mm] origin-top-left xl:static xl:w-auto",
                settings.showClientReferenceHeader ? "" : "spec-hide-client-reference",
                settings.showItemImages ? "" : "spec-hide-item-images",
                settings.showDimensions ? "" : "spec-hide-dimensions",
                settings.showMaterialDetails ? "" : "spec-hide-material-details",
                settings.textDensity === "compact" ? "spec-draft-density-compact" : "spec-draft-density-standard",
              ].filter(Boolean).join(" ")}
              style={metrics?.isMobile ? { transform: `scale(${scale})` } : undefined}
            >
              {children}
            </div>
          </div>
        </div>

        <aside
          className={`${isMobileSettingsOpen ? "fixed inset-3 z-50 block" : "hidden"} no-print max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl xl:sticky xl:top-5 xl:block xl:max-h-[calc(100vh-2.5rem)] xl:self-start xl:overflow-y-auto xl:shadow-[0_18px_50px_rgba(15,23,42,0.08)]`}
        >
          {settingsPanel}
        </aside>
      </div>
    </>
  );
}

function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{title}</h3>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

function SettingToggle({
  checked,
  disabled,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  name: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
      <span className="min-w-0 font-medium">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 rounded border-zinc-300 text-emerald-900"
      />
    </label>
  );
}

function SettingChoice({
  disabled,
  label,
  name,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold text-zinc-600">{label}</legend>
      <div className={`grid gap-1 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {options.map((option) => (
          <label key={option.value} className={`flex min-h-10 items-center justify-center rounded-lg border px-2 text-center text-xs font-semibold ${value === option.value ? "border-emerald-800 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-white text-zinc-600"}`}>
            <input
              type="radio"
              checked={value === option.value}
              className="sr-only"
              name={name}
              onChange={() => onChange(option.value)}
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ImageSlider({
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel,
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
  valueLabel: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-zinc-600">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-zinc-500">{valueLabel}</span>
      </span>
      <input
        type="range"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        value={value}
        className="h-10 w-full accent-emerald-900"
      />
    </label>
  );
}
