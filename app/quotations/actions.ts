"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  requireActiveUser,
  requireRecordsManager,
  requireSettingsManager,
} from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
import {
  quotationOptionLabel,
  quotationOptionNoFromQuotationNo,
  quotationRevisionBaseNo,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import { allowedQuotationStatuses, quotationStatusLabel } from "@/lib/quotation-status";
import { quotationMoneyValue } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const quotationStatuses = allowedQuotationStatuses;
const discountTypes = new Set(["amount", "percent"]);
const mergeModes = new Set(["none", "merge_specification", "merge_full_row"]);
const itemTypes = new Set(["product", "custom", "note", "blank", "subtotal"]);
const layoutModes = new Set([
  "simple_proposal",
  "standard_proposal",
  "comparison",
  "boq_schedule",
  "internal_costing",
]);
const sectionTypes = new Set(["option", "floor", "room", "category", "section"]);
const sectionKinds = new Set(["main", "sub"]);
const titleAlignments = new Set(["left", "center", "right"]);
const titleBackgrounds = new Set(["light_grey", "white", "dark_grey"]);
const titleSizes = new Set(["normal", "large"]);
const cellStyleKeys = new Set(["specification", "full_row"]);
const fontSizes = new Set(["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"]);
const fontWeights = new Set(["400", "700"]);
const fontStyles = new Set(["normal", "italic"]);
const textDecorations = new Set(["none", "underline"]);
const textAlignments = new Set(["left", "center", "right"]);
const manualConversionCurrencies = new Set(["AED", "EUR", "USD"]);
const lineStyles = new Set([
  "normal",
  "optional",
  "rate_only",
  "no_quote",
  "note",
  "heading",
]);
const excludedTotalLineStyles = new Set(["rate_only", "no_quote", "note", "heading"]);
const imageFields = new Set([
  "specified_image_url_snapshot",
  "proposed_image_url_snapshot",
]);
const imageFits = new Set(["contain", "cover"]);
const layoutColumnKeys = [
  "s_no",
  "code",
  "specified_image",
  "proposed_image",
  "reference_image",
  "specification",
  "description",
  "room",
  "model",
  "finish",
  "size",
  "origin",
  "warranty",
  "qty",
  "unit_price",
  "discount",
  "discount_value",
  "discount_percentage",
  "discount_amount",
  "net_price",
  "net_total",
  "edit",
  "internal_cost",
  "margin",
  "supplier_notes",
  "supplier_name",
  "manual_serial",
] as const;

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function numberValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseFloat(textValue(formData, name));
  return Number.isFinite(value) ? value : fallback;
}

function integerValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseInt(textValue(formData, name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function optionalIntegerInRange(formData: FormData, name: string, min: number, max: number) {
  const rawValue = textValue(formData, name);
  if (!rawValue) return null;

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value)) return null;

  return Math.min(Math.max(value, min), max);
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function roundedLinePricing(unitPriceValue: number, discountType: string, discountValueInput: number, qty = 1) {
  const unitPrice = quotationMoneyValue(unitPriceValue);
  const discountValue = discountType === "percent"
    ? discountValueInput
    : quotationMoneyValue(discountValueInput);
  const discountAmount = quotationMoneyValue(
    discountType === "percent"
      ? (unitPrice * discountValue) / 100
      : discountValue,
  );
  const netPrice = quotationMoneyValue(Math.max(unitPrice - discountAmount, 0));

  return {
    discountAmount,
    discountValue,
    netPrice,
    netTotal: quotationMoneyValue(qty * netPrice),
    unitPrice,
  };
}

function splitRelativePath(path: string) {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const pathWithoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = pathWithoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? pathWithoutHash.slice(0, queryIndex) : pathWithoutHash;
  const queryString = queryIndex >= 0 ? pathWithoutHash.slice(queryIndex + 1) : "";

  return { hash, pathname, queryString };
}

function redirectWithMessage(path: string, message: string): never {
  redirect(pathWithParams(path, { message }));
}

function pathWithParams(path: string, params: Record<string, string | null | undefined>) {
  const { hash, pathname, queryString } = splitRelativePath(path);
  const searchParams = new URLSearchParams(queryString);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
  }

  const nextQuery = searchParams.toString();
  const nextPath = nextQuery ? `${pathname}?${nextQuery}` : pathname;
  return `${nextPath}${hash}`;
}

function redirectWithMessageAndParams(
  path: string,
  message: string,
  params: Record<string, string | null | undefined>,
): never {
  redirectWithMessage(pathWithParams(path, params), message);
}

function returnPath(formData: FormData, fallback: string) {
  const value = textValue(formData, "return_to");

  return value.startsWith("/quotations/") || value.startsWith("/clients/projects/")
    ? value
    : fallback;
}

function allowedText(formData: FormData, name: string, allowed: Set<string>, fallback: string) {
  const value = textValue(formData, name);

  return allowed.has(value) ? value : fallback;
}

function quotationLabel(title: string | null | undefined, quotationNo?: string | null) {
  return quotationNo?.trim() || title?.trim() || "Quotation";
}

function quotationItemAuditLabel(itemName: string | null | undefined) {
  return itemName?.trim() || "Quotation row";
}

function quotationSectionAuditLabel(sectionTitle: string | null | undefined) {
  return sectionTitle?.trim() || "Quotation section";
}

type QuotationStatusState = {
  id: string;
  project_id: string;
  quotation_no: string | null;
  status: string;
  title: string;
};

type CellLayoutPayload = {
  mergeMode: string;
  cells?: Record<string, {
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    textDecoration: string;
    textAlign: string;
    wrapText: boolean;
  }>;
  images?: Record<string, ImageDisplaySettings>;
};

type ImageDisplaySettings = {
  fit: "contain" | "cover";
  zoom: number;
  positionX: number;
  positionY: number;
};

function isCellLayoutPayload(value: unknown): value is CellLayoutPayload {
  return typeof value === "object" && value !== null;
}

function isDirectImagePath(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

function isQuoteStoragePath(value: string) {
  return value.startsWith("quotation-items/") || value.startsWith("quotation-finishes/");
}

function isProductStoragePath(value: string) {
  return value.startsWith("product-templates/") || value.startsWith("brand-materials/");
}

function productImageSnapshotPath(value: string | null) {
  if (!value || isDirectImagePath(value) || value.startsWith("product-images:")) {
    return value;
  }

  return `product-images:${value}`;
}

type ProductLibraryImageReference =
  | { kind: "empty"; value: null }
  | { kind: "direct"; value: string }
  | { kind: "product"; path: string }
  | { kind: "quote"; path: string };

function parseProductLibraryImageReference(value: string | null): ProductLibraryImageReference {
  if (!value) {
    return { kind: "empty", value: null };
  }

  if (isDirectImagePath(value)) {
    return { kind: "direct", value };
  }

  if (value.startsWith("product-images:")) {
    return { kind: "product", path: value.slice("product-images:".length) };
  }

  if (value.startsWith("quote-images:")) {
    return { kind: "quote", path: value.slice("quote-images:".length) };
  }

  if (isQuoteStoragePath(value)) {
    return { kind: "quote", path: value };
  }

  if (isProductStoragePath(value)) {
    return { kind: "product", path: value };
  }

  return { kind: "product", path: value };
}

function safeStorageFilename(path: string) {
  const rawFilename = path.split("/").at(-1) ?? "image";
  const dotIndex = rawFilename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? rawFilename.slice(dotIndex + 1).toLowerCase() : "";
  const basename = (dotIndex >= 0 ? rawFilename.slice(0, dotIndex) : rawFilename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return extension ? `${basename || "image"}.${extension}` : basename || "image";
}

function contentTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";

  return undefined;
}

async function copyQuoteImageToProductImages({
  sourcePath,
  supabase,
  templateId,
}: {
  sourcePath: string;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
  templateId: string;
}) {
  const { data, error } = await supabase.storage.from("quote-images").download(sourcePath);

  if (error || !data) {
    throw new Error(error?.message || "Source image could not be downloaded.");
  }

  const targetPath = `product-templates/${templateId}/${Date.now()}-${safeStorageFilename(sourcePath)}`;
  const body = new Uint8Array(await data.arrayBuffer());
  const contentType = data.type || contentTypeFromPath(sourcePath);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(targetPath, body, {
      cacheControl: "3600",
      contentType,
      upsert: false,
    });

  if (uploadError || !uploadData?.path) {
    throw new Error(uploadError?.message || "Image could not be uploaded.");
  }

  return uploadData.path;
}

function calculationNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function preciseDecimalValue(value: unknown, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;

  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function deskingRole(option: ProductComponentSnapshotSource) {
  return option.calculation_data?.desking_role ?? "";
}

function accessoryQuantities(formData: FormData) {
  const quantities = new Map<string, number>();

  for (const value of formData.getAll("accessory_qty")) {
    if (typeof value !== "string") continue;

    const [id, rawQty] = value.split(":");
    const qty = Math.max(0, Math.trunc(Number(rawQty) || 0));

    if (id && qty > 0) {
      quantities.set(id, qty);
    }
  }

  return quantities;
}

function accessoryPricingQuantities(formData: FormData) {
  const quantities = new Map<string, number>();

  for (const value of formData.getAll("accessory_pricing_qty")) {
    if (typeof value !== "string") continue;

    const [id, rawQty] = value.split(":");
    const qty = Math.max(0, Math.trunc(Number(rawQty) || 0));

    if (id && qty > 0) {
      quantities.set(id, qty);
    }
  }

  return quantities;
}

type LinkedProductSelectionInput = {
  category: string;
  categoryRowId: string;
  linkId: string;
  qty: number;
  variantRowId: string;
};

function linkedProductSelections(formData: FormData) {
  return formData
    .getAll("linked_product_selection")
    .filter((value): value is string => typeof value === "string")
    .map((value): LinkedProductSelectionInput | null => {
      const [linkId, rawQty, categoryRowId = "", category = "", variantRowId = ""] = value.split(":");
      const qty = Math.max(0, Math.trunc(Number(rawQty) || 0));

      return linkId && qty > 0 ? { category, categoryRowId, linkId, qty, variantRowId } : null;
    })
    .filter((value): value is LinkedProductSelectionInput => Boolean(value));
}

function currencyExchangeRates(formData: FormData) {
  const rates = new Map<string, number>();

  for (const value of formData.getAll("currency_exchange_rate")) {
    if (typeof value !== "string") continue;

    const [currency, rawRate] = value.split(":");
    const normalizedCurrency = normalizeCurrency(currency || "");
    const rate = Number(rawRate);

    if (normalizedCurrency && Number.isFinite(rate) && rate > 0) {
      rates.set(normalizedCurrency, rate);
    }
  }

  return rates;
}

function deskingAdditionalClusterQty(formData: FormData) {
  return Math.max(0, Math.trunc(numberValue(formData, "desking_additional_cluster_qty", 0)));
}

function activeDeskingSizeRows(rows?: DeskingSizePricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter(
      (row) =>
        calculationNumber(row.length) > 0 &&
        calculationNumber(row.depth) > 0 &&
        calculationNumber(row.height) > 0,
    )
    .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order));
}

function selectedDeskingSize(formData: FormData, rows?: DeskingSizePricingRow[] | null) {
  const selectedId = textValue(formData, "desking_size_id");
  const activeRows = activeDeskingSizeRows(rows);

  return activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
}

function activeVariantRows(rows?: VariantPricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.dimension || calculationNumber(row.price) > 0)
    .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order));
}

function activeCategoryRows(rows?: CategoryPricingRow[] | null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.dimension || Object.values(row.prices ?? {}).some((price) => calculationNumber(price) > 0))
    .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order));
}

function activeAccessoryRows(rows?: AccessoryPricingRow[] | null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const groups = sourceRows
    .filter((row) => row.group_name || row.items)
    .map((group, groupIndex) => ({
      id: group.id ?? `add-on-group-${groupIndex}`,
      group_name: group.group_name?.trim() || "Accessories",
      is_active: group.is_active !== false,
      sort_order: calculationNumber(group.sort_order, groupIndex),
      items: (group.items ?? [])
        .filter((item) => item.is_active !== false)
        .filter((item) => item.item_name || calculationNumber(item.price) > 0)
        .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order)),
    }))
    .filter((group) => group.is_active && group.items.length)
    .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order));
  const flatRows = sourceRows
    .filter((row) => !row.group_name && !row.items)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.item_name || calculationNumber(row.price) > 0)
    .sort((left, right) => calculationNumber(left.sort_order) - calculationNumber(right.sort_order));

  return flatRows.length
    ? [
        ...groups,
        {
          id: "accessories",
          group_name: "Accessories",
          is_active: true,
          sort_order: groups.length,
          items: flatRows,
        },
      ]
    : groups;
}

function selectedVariantPricing(formData: FormData, rows?: VariantPricingRow[] | null) {
  const selectedId = textValue(formData, "variant_pricing_row_id");
  const activeRows = activeVariantRows(rows);

  return activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
}

function selectedCategoryPricing(formData: FormData, rows?: CategoryPricingRow[] | null) {
  const selectedId = textValue(formData, "category_pricing_row_id");
  const activeRows = activeCategoryRows(rows);

  return activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
}

function deskingSizePricingSnapshot({
  accessoryQtyById,
  additionalClusterQty,
  baseText,
  selectedSize,
  selectedOptions,
  template,
}: {
  accessoryQtyById: Map<string, number>;
  additionalClusterQty: number;
  baseText: string;
  selectedSize: DeskingSizePricingRow;
  selectedOptions: ProductComponentSnapshotSource[];
  template: ProductTemplateSnapshotSource;
}) {
  const accessoryLines = selectedOptions
    .filter((option) => option.option_type === "linked_addon" || deskingRole(option) === "accessory")
    .map((option) => ({ option, qty: accessoryQtyById.get(option.id) ?? 0 }))
    .filter((line) => line.qty > 0);
  const selectedCoreOptions = selectedOptions.filter(
    (option) => option.option_type !== "linked_addon" && deskingRole(option) !== "accessory",
  );
  const baseSeats = 2;
  const seatsPerCluster = 2;
  const modulesPerCluster = 1;
  const totalSeats = baseSeats + additionalClusterQty * seatsPerCluster;
  const totalModules = 1 + additionalClusterQty * modulesPerCluster;
  const moduleLength = calculationNumber(selectedSize.length);
  const depth = calculationNumber(selectedSize.depth);
  const height = calculationNumber(selectedSize.height);
  const dimensionUnit = selectedSize.dimension_unit ?? "cm";
  const dimensionValue =
    moduleLength && depth && height
      ? `${moduleLength * totalModules} x ${depth} x ${height}`
      : "";
  const dimension = dimensionValue ? `${dimensionValue} ${dimensionUnit}` : "";
  const clusterName = "CL2";
  const clusterLabel =
    additionalClusterQty > 0
      ? `${clusterName} + ${additionalClusterQty} additional / Cluster of ${totalSeats}`
      : `Cluster of ${totalSeats}`;
  const basePrice = calculationNumber(selectedSize.default_price, template.default_unit_price ?? 0);
  const additionalUnitPrice = calculationNumber(selectedSize.additional_price, basePrice);
  const additionalClusterPrice = money(additionalUnitPrice * additionalClusterQty);
  const accessoryPrice = money(
    accessoryLines.reduce(
      (total, line) => total + line.qty * calculationNumber(line.option.unit_price),
      0,
    ),
  );
  const unitPrice = money(basePrice + additionalClusterPrice + accessoryPrice);
  const selectedOptionNames = [
    ...selectedCoreOptions.map((option) => option.component_name),
    ...accessoryLines.map((line) => `${line.option.component_name} x${line.qty}`),
  ];
  const finishOptions = selectedCoreOptions
    .filter(
      (option) =>
        option.option_type === "material_finish" ||
        option.option_type === "fabric_category",
    )
    .map((option) => option.component_name);
  const specification = [baseText, `Cluster of ${totalSeats}`]
    .filter(Boolean)
    .join(", ");

  return {
    accessoryPrice,
    additionalClusterPrice,
    additionalClusterQty,
    additionalUnitPrice,
    baseClusterSeats: baseSeats,
    basePrice,
    clusterLabel,
    clusterName,
    dimension,
    dimensionValue,
    finishOptions,
    mainCurrency: selectedSize.currency || template.currency || defaultCurrency,
    selectedOptionNames,
    selectedOptions: [
      ...selectedCoreOptions,
      ...accessoryLines.map((line) => ({
        ...line.option,
        selected_quantity: line.qty,
      })),
    ],
    sizeLabel: selectedSize.label ?? `${moduleLength} x ${depth} x ${height}`,
    specification,
    totalModules,
    totalSeats,
    unitPrice,
  };
}

function numberInRange(formData: FormData, name: string, fallback: number, min: number, max: number) {
  const value = numberValue(formData, name, fallback);

  return Math.min(Math.max(value, min), max);
}

function imageDisplaySettingsValue(formData: FormData): ImageDisplaySettings {
  const fit = allowedText(formData, "image_fit", imageFits, "contain");

  return {
    fit: fit === "cover" ? "cover" : "contain",
    zoom: numberInRange(formData, "image_zoom", 1, 1, 3),
    positionX: numberInRange(formData, "image_position_x", 50, 0, 100),
    positionY: numberInRange(formData, "image_position_y", 50, 0, 100),
  };
}

function cellLayoutWithImageSettings(currentLayout: unknown, field: string, settings: ImageDisplaySettings) {
  const current: Partial<CellLayoutPayload> = isCellLayoutPayload(currentLayout)
    ? currentLayout
    : {};

  return {
    ...current,
    mergeMode: current.mergeMode && mergeModes.has(current.mergeMode) ? current.mergeMode : "none",
    images: {
      ...(current.images ?? {}),
      [field]: settings,
    },
  };
}

function cellLayoutValue(formData: FormData, currentLayout?: unknown): CellLayoutPayload {
  const current: Partial<CellLayoutPayload> = isCellLayoutPayload(currentLayout) ? currentLayout : {};
  const layout: CellLayoutPayload = {
    ...current,
    mergeMode: formData.has("merge_mode")
      ? allowedText(formData, "merge_mode", mergeModes, "none")
      : current.mergeMode && mergeModes.has(current.mergeMode)
        ? current.mergeMode
        : "none",
  };

  const submittedCells = formData
    .getAll("cell_style_key")
    .filter((value): value is string => typeof value === "string" && cellStyleKeys.has(value));
  const cells: CellLayoutPayload["cells"] = { ...(current.cells ?? {}) };

  for (const cellKey of Array.from(new Set(submittedCells))) {
    cells[cellKey] = {
      fontSize: Number(allowedText(formData, `cell_style_${cellKey}_font_size`, fontSizes, "12")),
      fontWeight: allowedText(formData, `cell_style_${cellKey}_font_weight`, fontWeights, "400"),
      fontStyle: allowedText(formData, `cell_style_${cellKey}_font_style`, fontStyles, "normal"),
      textDecoration: allowedText(formData, `cell_style_${cellKey}_text_decoration`, textDecorations, "none"),
      textAlign: allowedText(formData, `cell_style_${cellKey}_text_align`, textAlignments, "left"),
      wrapText: textValue(formData, `cell_style_${cellKey}_wrap_text`) !== "false",
    };
  }

  if (Object.keys(cells).length) {
    layout.cells = cells;
  }

  return layout;
}

export async function updateQuotationItemImageSettings(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const field = textValue(formData, "image_field");

  if (!id || !quotationId || !imageFields.has(field)) {
    return { ok: false, message: "Line item, quotation, and image field are required." };
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("cell_layout")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .single<{ cell_layout: CellLayoutPayload | null }>();

  if (readError || !currentItem) {
    console.error("QUOTATION IMAGE SETTINGS READ ERROR", readError?.message);
    return { ok: false, message: "Image settings could not be loaded." };
  }

  const cellLayout = cellLayoutWithImageSettings(
    currentItem.cell_layout,
    field,
    imageDisplaySettingsValue(formData),
  );

  const { error } = await supabase
    .from("quotation_items")
    .update({ cell_layout: cellLayout })
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION IMAGE SETTINGS UPDATE ERROR", error.message);
    return { ok: false, message: "Image settings could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  return { ok: true };
}

function quotationPayload(formData: FormData, userId?: string) {
  const payload = {
    client_id: textValue(formData, "client_id"),
    project_id: textValue(formData, "project_id"),
    quotation_no: optionalTextValue(formData, "quotation_no"),
    title: textValue(formData, "title"),
    quotation_date: textValue(formData, "quotation_date") || new Date().toISOString().slice(0, 10),
    status: textValue(formData, "status") || "draft",
    layout_mode: textValue(formData, "layout_mode") || "standard_proposal",
    currency: normalizeCurrency(textValue(formData, "currency") || defaultCurrency),
    vat_percent: numberValue(formData, "vat_percent", 5),
    overall_discount_type: allowedText(
      formData,
      "overall_discount_type",
      discountTypes,
      "amount",
    ),
    overall_discount_value: numberValue(formData, "overall_discount_value", 0),
    payment_terms: optionalTextValue(formData, "payment_terms"),
    validity: optionalTextValue(formData, "validity"),
    delivery_terms: optionalTextValue(formData, "delivery_terms"),
    warranty_terms: optionalTextValue(formData, "warranty_terms"),
    notes: optionalTextValue(formData, "notes"),
    is_active: boolValue(formData, "is_active"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

function createQuotationDraftParams(formData: FormData) {
  return {
    currency: textValue(formData, "currency") || null,
    delivery_terms: textValue(formData, "delivery_terms") || null,
    layout_mode: textValue(formData, "layout_mode") || null,
    newQuotation: "1",
    notes: textValue(formData, "notes") || null,
    payment_terms: textValue(formData, "payment_terms") || null,
    quotation_date: textValue(formData, "quotation_date") || null,
    quotation_no: textValue(formData, "quotation_no") || null,
    title: textValue(formData, "title") || null,
    validity: textValue(formData, "validity") || null,
    vat_percent: textValue(formData, "vat_percent") || null,
    warranty_terms: textValue(formData, "warranty_terms") || null,
  };
}

function redirectQuotationCreateError(formData: FormData, redirectPath: string, message: string): never {
  redirectWithMessageAndParams(redirectPath, message, createQuotationDraftParams(formData));
}

function safeProjectQuotationTitle(projectName: string | null | undefined) {
  return projectName?.trim() || "New quotation";
}

function safeProjectQuotationNo(projectCode: string | null | undefined) {
  const normalizedCode = projectCode?.trim() ?? "";
  return normalizedCode || null;
}

function safeQuotationCreateErrorMessage(error: {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
} | null | undefined) {
  if (!error) {
    return "Database error: quotation insert failed.";
  }

  if (error.code === "23505") {
    return "Could not create quotation because this quotation number already exists.";
  }

  if (error.code === "23503") {
    return "Project or client reference is no longer valid.";
  }

  if (error.code === "23502") {
    return "Quotation is missing a required value. Please check the title, client, and project.";
  }

  if (error.code === "23514") {
    return "Quotation settings are invalid. Please check the selected status and layout.";
  }

  if (error.code === "42501") {
    return "You do not have permission to create quotations.";
  }

  if (error.message && error.message.length <= 140) {
    return `Database error: ${error.message}`;
  }

  return "Database error: quotation insert failed.";
}

type QuotationCopyMode = "duplicate" | "revision" | "option";

type QuotationCopySource = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  option_no: number;
  revision_no: number;
  title: string;
  quotation_date: string;
  currency: string;
  vat_percent: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
  layout_mode: string;
  layout_settings: Record<string, unknown> | null;
  overall_discount_type: string;
  overall_discount_value: number;
};

type QuotationSectionCopySource = {
  id: string;
  section_title: string;
  section_notes: string | null;
  section_type: string;
  parent_section_id: string | null;
  section_kind: string;
  title_align: string;
  title_bold: boolean;
  title_bg: string;
  title_size: string;
  row_height: number | null;
  sort_order: number;
};

type QuotationItemCopySource = {
  id: string;
  quotation_id: string;
  section_id: string | null;
  item_type: string;
  source_template_id: string | null;
  source_component_data: unknown;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  selected_options_snapshot: unknown;
  internal_components_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  is_optional: boolean;
  internal_cost: number;
  margin_type: string;
  margin_value: number;
  is_rate_only: boolean;
  line_style: string;
  row_height: number | null;
  cell_layout: unknown;
  notes: string | null;
};

type ProductTemplateSnapshotSource = {
  id: string;
  brand_id: string;
  main_category_id: string | null;
  sub_category_id: string | null;
  template_code: string | null;
  template_name: string;
  item_code: string | null;
  description: string | null;
  default_specification: string | null;
  origin: string | null;
  supplier_name: string | null;
  default_image_url: string | null;
  reference_image_url: string | null;
  proposed_image_url_1: string | null;
  proposed_image_url_2: string | null;
  proposed_image_url_3: string | null;
  image_settings: Record<string, ImageDisplaySettings> | null;
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  unit_label: string;
  currency: string;
  default_unit_price: number;
};

type LinkedProductFamilySource = {
  id: string;
  parent_template_id: string;
  linked_template_id: string;
  label: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  add_to_parent_price: boolean;
  append_to_specification: boolean;
  default_qty: number;
  sort_order: number;
  is_active: boolean;
};

type DeskingSizePricingRow = {
  id?: string;
  label?: string;
  length?: number;
  depth?: number;
  height?: number;
  dimension_unit?: string;
  default_price?: number;
  additional_price?: number;
  currency?: string;
  sort_order?: number;
  is_active?: boolean;
};

type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type CategoryPricingRow = {
  id?: string;
  variant_name?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number>;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  items?: AccessoryPricingItem[];
  item_name?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
  price?: number;
  currency?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
};

type ProductComponentSnapshotSource = {
  id: string;
  template_id: string;
  option_type: string;
  component_group: string;
  component_code: string | null;
  component_name: string;
  description: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  currency: string;
  calculation_data: {
    desking_role?: string;
    base_cluster_seats?: number;
    module_length?: number;
    depth?: number;
    height?: number;
    dimension_unit?: string;
    price_role?: string;
    seats_per_cluster?: number;
    modules_per_cluster?: number;
    label?: string;
    allow_manual_quantity?: boolean;
  } | null;
};

type SourcePriceTemplate = {
  id: string;
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  currency: string;
  default_unit_price: number;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return Boolean(value);
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringRecordValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function findRecordById(rows: unknown, id: string | null) {
  if (!id) return null;

  return arrayValue(rows)
    .map(recordValue)
    .find((row) => row?.id === id) ?? null;
}

function currentAccessorySourceTotal({
  baseCurrency,
  selectedAddOns,
  template,
}: {
  baseCurrency: string;
  selectedAddOns: Record<string, unknown>;
  template: SourcePriceTemplate;
}) {
  let total = 0;

  for (const group of arrayValue(selectedAddOns.groups).map(recordValue).filter(isRecord)) {
    for (const item of arrayValue(group.items).map(recordValue).filter(isRecord)) {
      const selectedId = stringRecordValue(item.id);
      if (!selectedId) return null;

      const currentItem = arrayValue(template.accessory_pricing)
        .map(recordValue)
        .flatMap((accessoryGroup) => arrayValue(accessoryGroup?.items).map(recordValue))
        .find((candidate) => candidate?.id === selectedId);

      if (!currentItem) return null;

      const currency = normalizeCurrency(stringRecordValue(currentItem.currency) ?? baseCurrency);
      if (currency !== baseCurrency) return null;

      total += calculationNumber(item.qty, 1) * quotationMoneyValue(calculationNumber(currentItem.price));
    }
  }

  return quotationMoneyValue(total);
}

function currentComponentSourceTotal({
  baseCurrency,
  components,
  selectedOptions,
}: {
  baseCurrency: string;
  components: ProductComponentSnapshotSource[];
  selectedOptions: unknown;
}) {
  let total = 0;

  for (const option of arrayValue(selectedOptions).map(recordValue).filter(isRecord)) {
    const optionId = stringRecordValue(option.id);
    const isAccessorySnapshot = Boolean(option.group_name && option.item_name && option.price !== undefined);
    if (
      !optionId ||
      isAccessorySnapshot ||
      ["variant_pricing", "category_pricing", "desking_size"].includes(String(option.item_type))
    ) {
      continue;
    }

    const component = components.find((candidate) => candidate.id === optionId);
    if (!component) return null;

    const currency = normalizeCurrency(component.currency);
    if (currency !== baseCurrency) return null;

    total += quotationMoneyValue(component.unit_price);
  }

  return quotationMoneyValue(total);
}

function currentSourcePriceFromSnapshot({
  components,
  sourceData,
  template,
}: {
  components: ProductComponentSnapshotSource[];
  sourceData: unknown;
  template: SourcePriceTemplate;
}) {
  const data = recordValue(sourceData);
  if (data?.currency_conversion || data?.linked_products) return null;

  let sourcePrice = quotationMoneyValue(template.default_unit_price);
  let sourceCurrency = normalizeCurrency(template.currency);

  const variantData = recordValue(data?.variant_pricing);
  const variantId = stringRecordValue(variantData?.id);
  if (variantId) {
    const currentVariant = findRecordById(template.variant_pricing, variantId);
    if (!currentVariant) return null;

    sourcePrice = quotationMoneyValue(calculationNumber(currentVariant.price));
    sourceCurrency = normalizeCurrency(stringRecordValue(currentVariant.currency) ?? template.currency);
  }

  const categoryData = recordValue(data?.category_pricing);
  const categoryRow = recordValue(categoryData?.selected_row);
  const categoryId = stringRecordValue(categoryRow?.id);
  const selectedCategory = stringRecordValue(categoryData?.selected_category);
  if (categoryId && selectedCategory) {
    const currentCategory = findRecordById(template.category_pricing, categoryId);
    const prices = recordValue(currentCategory?.prices);
    if (!currentCategory || !prices) return null;

    sourcePrice = quotationMoneyValue(calculationNumber(prices[selectedCategory]));
    sourceCurrency = normalizeCurrency(stringRecordValue(currentCategory.currency) ?? template.currency);
  }

  const deskingData = recordValue(data?.desking);
  const deskingLabel = stringRecordValue(deskingData?.size_label);
  if (deskingLabel) {
    if (calculationNumber(deskingData?.accessory_price) > 0) return null;

    const matches = arrayValue(template.desking_size_pricing)
      .map(recordValue)
      .filter(isRecord)
      .filter((row) => row.label === deskingLabel);

    if (matches.length !== 1) return null;

    const currentSize = matches[0];
    sourceCurrency = normalizeCurrency(stringRecordValue(currentSize.currency) ?? template.currency);
    sourcePrice = quotationMoneyValue(
      calculationNumber(currentSize.default_price) +
      calculationNumber(currentSize.additional_price) * calculationNumber(deskingData?.additional_qty),
    );
  }

  const componentTotal = currentComponentSourceTotal({
    baseCurrency: sourceCurrency,
    components,
    selectedOptions: data?.selected_options,
  });
  if (componentTotal === null) return null;

  const accessoryTotal = data?.add_ons
    ? currentAccessorySourceTotal({
        baseCurrency: sourceCurrency,
        selectedAddOns: recordValue(data.add_ons) ?? {},
        template,
      })
    : 0;
  if (accessoryTotal === null) return null;

  return {
    currency: sourceCurrency,
    price: quotationMoneyValue(sourcePrice + componentTotal + accessoryTotal),
  };
}

type QuotationItemPriceState = {
  id: string;
  currency: string;
  discount_value: number;
  item_name_snapshot?: string | null;
  net_price: number;
  net_total: number;
  quotation_id: string;
  source_component_data?: unknown;
  source_template_id: string | null;
  unit_price: number;
};

function quotationItemPriceChanged(
  current: QuotationItemPriceState,
  next: Pick<QuotationItemPriceState, "currency" | "discount_value" | "net_price" | "net_total" | "unit_price">,
) {
  return (
    Math.abs(quotationMoneyValue(current.unit_price) - quotationMoneyValue(next.unit_price)) >= 0.01 ||
    normalizeCurrency(current.currency) !== normalizeCurrency(next.currency) ||
    Math.abs(quotationMoneyValue(current.discount_value) - quotationMoneyValue(next.discount_value)) >= 0.01 ||
    Math.abs(quotationMoneyValue(current.net_price) - quotationMoneyValue(next.net_price)) >= 0.01 ||
    Math.abs(quotationMoneyValue(current.net_total) - quotationMoneyValue(next.net_total)) >= 0.01
  );
}

function sourceReferenceMetadata(sourceData: unknown) {
  const reference = recordValue(recordValue(sourceData)?.source_price_reference);

  return {
    sourcePriceLabel: stringRecordValue(reference?.source_price_label),
    sourcePriceType: stringRecordValue(reference?.source_price_type),
  };
}

function manualSourcePricingFromSourceData(sourceData: unknown) {
  const data = recordValue(sourceData);
  const reference = recordValue(data?.source_price_reference);
  const manualSourcePrice =
    optionalNumericValue(data?.manual_source_price) ??
    optionalNumericValue(reference?.original_source_price);
  const manualSourceCurrency = normalizeCurrency(
    stringRecordValue(data?.manual_source_currency) ??
    stringRecordValue(reference?.original_source_currency) ??
    defaultCurrency,
  );

  if (manualSourcePrice === null) return null;

  return {
    currency: manualSourceCurrency,
    price: preciseDecimalValue(manualSourcePrice, 2),
  };
}

function manualConversionSourceComponentData({
  convertedPrice,
  conversionRate,
  currentSourceData,
  sourceCurrency,
  sourcePrice,
}: {
  convertedPrice: number;
  conversionRate: number;
  currentSourceData: unknown;
  sourceCurrency: string;
  sourcePrice: number;
}) {
  const currentData = recordValue(currentSourceData);
  const currentReference = recordValue(currentData?.source_price_reference);
  const normalizedSourceCurrency = normalizeCurrency(sourceCurrency);
  const normalizedSourcePrice = preciseDecimalValue(sourcePrice, 2);
  const normalizedRate = preciseDecimalValue(conversionRate, 4);
  const normalizedConvertedPrice = quotationMoneyValue(convertedPrice);

  return {
    ...(currentData ?? {}),
    manual_source_price: normalizedSourcePrice,
    manual_source_currency: normalizedSourceCurrency,
    manual_conversion_rate: normalizedRate,
    manual_converted_currency: "AED",
    manual_converted_price: normalizedConvertedPrice,
    source_price_reference: {
      ...(currentReference ?? {}),
      original_source_price: normalizedSourcePrice,
      original_source_currency: normalizedSourceCurrency,
      original_source_totals: {
        [normalizedSourceCurrency]: normalizedSourcePrice,
      },
      source_price_type: "manual_currency_conversion",
      source_price_label: "Manual currency conversion",
      source_price_key: "manual_currency_conversion",
      converted_quotation_price: normalizedConvertedPrice,
      quotation_currency: "AED",
    },
    currency_conversion: {
      target_currency: "AED",
      original_totals: {
        [normalizedSourceCurrency]: normalizedSourcePrice,
      },
      rates: normalizedSourceCurrency === "AED"
        ? {}
        : {
            [normalizedSourceCurrency]: normalizedRate,
          },
      converted_total: normalizedConvertedPrice,
      rounded_converted_total: normalizedConvertedPrice,
    },
  };
}

async function insertQuotationItemPriceHistory({
  changeType,
  changedBy,
  actorName,
  current,
  newValues,
  note,
  supabase,
}: {
  changeType: "manual" | "use_current_source_price" | "revision_adjustment" | "other";
  changedBy: string;
  actorName?: string | null;
  current: QuotationItemPriceState;
  newValues: Pick<QuotationItemPriceState, "currency" | "discount_value" | "net_price" | "net_total" | "unit_price">;
  note: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
}) {
  if (!quotationItemPriceChanged(current, newValues)) {
    return;
  }

  const { sourcePriceLabel, sourcePriceType } = sourceReferenceMetadata(current.source_component_data);
  const { error } = await supabase.from("quotation_item_price_history").insert({
    change_type: changeType,
    changed_by: changedBy,
    new_currency: normalizeCurrency(newValues.currency),
    new_discount_value: quotationMoneyValue(newValues.discount_value),
    new_net_price: quotationMoneyValue(newValues.net_price),
    new_net_total: quotationMoneyValue(newValues.net_total),
    new_unit_price: quotationMoneyValue(newValues.unit_price),
    note,
    old_currency: normalizeCurrency(current.currency),
    old_discount_value: quotationMoneyValue(current.discount_value),
    old_net_price: quotationMoneyValue(current.net_price),
    old_net_total: quotationMoneyValue(current.net_total),
    old_unit_price: quotationMoneyValue(current.unit_price),
    quotation_id: current.quotation_id,
    quotation_item_id: current.id,
    source_price_label: sourcePriceLabel,
    source_price_type: sourcePriceType,
    source_template_id: current.source_template_id,
  });

  if (error) {
    console.error("QUOTATION ITEM PRICE HISTORY INSERT ERROR", error.message);
    return;
  }

  const oldCurrency = normalizeCurrency(current.currency);
  const newCurrency = normalizeCurrency(newValues.currency);
  const action = changeType === "use_current_source_price"
    ? "row_price_updated"
    : changeType === "revision_adjustment"
      ? "revision_adjustment"
      : "row_price_updated";
  const title = changeType === "use_current_source_price"
    ? "Use current source price"
    : "Row price updated";

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: current.id,
    parentEntityType: "quotation",
    parentEntityId: current.quotation_id,
    action,
    title,
    description: `${quotationItemAuditLabel(current.item_name_snapshot)} - ${oldCurrency} ${quotationMoneyValue(current.unit_price)} -> ${newCurrency} ${quotationMoneyValue(newValues.unit_price)}`,
    metadata: {
      changeType,
      newCurrency,
      newDiscountValue: quotationMoneyValue(newValues.discount_value),
      newNetPrice: quotationMoneyValue(newValues.net_price),
      newNetTotal: quotationMoneyValue(newValues.net_total),
      newUnitPrice: quotationMoneyValue(newValues.unit_price),
      note,
      oldCurrency,
      oldDiscountValue: quotationMoneyValue(current.discount_value),
      oldNetPrice: quotationMoneyValue(current.net_price),
      oldNetTotal: quotationMoneyValue(current.net_total),
      oldUnitPrice: quotationMoneyValue(current.unit_price),
      sourcePriceLabel,
      sourcePriceType,
    },
    actorName,
    createdBy: changedBy,
  });
}

const quotationCopySelect =
  "id,client_id,project_id,quotation_no,option_no,revision_no,title,quotation_date,currency,vat_percent,payment_terms,validity,delivery_terms,warranty_terms,notes,layout_mode,layout_settings,overall_discount_type,overall_discount_value";

const sectionCopySelect =
  "id,section_title,section_notes,section_type,parent_section_id,section_kind,title_align,title_bold,title_bg,title_size,row_height,sort_order";

const itemCopySelect =
  "id,quotation_id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,notes";

function finishSelectionsValue(formData: FormData) {
  const labels = formData.getAll("finish_group_label[]");
  const sourceTypes = formData.getAll("finish_source_type[]");
  const sourceScopes = formData.getAll("finish_source_scope[]");
  const brandMaterialIds = formData.getAll("finish_brand_material_id[]");
  const materialGroupIds = formData.getAll("finish_material_group_id[]");
  const templateMaterialGroupIds = formData.getAll("finish_product_template_material_group_id[]");
  const brandNames = formData.getAll("finish_brand_name[]");
  const groupSortOrders = formData.getAll("finish_group_sort_order[]");
  const materialCategories = formData.getAll("finish_material_category[]");
  const codes = formData.getAll("finish_code[]");
  const names = formData.getAll("finish_name[]");
  const descriptions = formData.getAll("finish_description[]");
  const imageUrls = formData.getAll("finish_image_url[]");
  const sortOrders = formData.getAll("finish_sort_order[]");
  const ids = formData.getAll("finish_id[]");
  const removed = new Set(
    formData
      .getAll("finish_remove[]")
      .map((value) => String(value)),
  );
  const maxRows = Math.max(
    labels.length,
    sourceTypes.length,
    sourceScopes.length,
    brandMaterialIds.length,
    materialGroupIds.length,
    templateMaterialGroupIds.length,
    brandNames.length,
    groupSortOrders.length,
    materialCategories.length,
    codes.length,
    names.length,
    descriptions.length,
    imageUrls.length,
    sortOrders.length,
    ids.length,
  );

  return Array.from({ length: maxRows })
    .map((_, index) => {
      const groupLabel = String(labels[index] ?? "").trim();
      const sourceType = String(sourceTypes[index] ?? "").trim() || "custom";
      const sourceScope = String(sourceScopes[index] ?? "").trim() || sourceType;
      const brandMaterialId = String(brandMaterialIds[index] ?? "").trim();
      const materialGroupId = String(materialGroupIds[index] ?? "").trim();
      const templateMaterialGroupId = String(templateMaterialGroupIds[index] ?? "").trim();
      const brandName = String(brandNames[index] ?? "").trim();
      const groupSortOrder = Number.parseInt(String(groupSortOrders[index] ?? ""), 10);
      const materialCategory = String(materialCategories[index] ?? "").trim();
      const finishCode = String(codes[index] ?? "").trim();
      const finishName = String(names[index] ?? "").trim();
      const finishDescription = String(descriptions[index] ?? "").trim();
      const finishImageUrl = String(imageUrls[index] ?? "").trim();
      const id = String(ids[index] ?? "").trim() || `finish-${index + 1}`;
      const sortOrder = Number.parseInt(String(sortOrders[index] ?? ""), 10);

      return {
        id,
        source_type: sourceType,
        source_scope: sourceScope,
        brand_material_id: brandMaterialId,
        material_group_id: materialGroupId,
        product_template_material_group_id: templateMaterialGroupId,
        brand_name: brandName,
        group_label: groupLabel,
        group_sort_order: Number.isFinite(groupSortOrder) ? groupSortOrder : undefined,
        material_category: materialCategory,
        finish_code: finishCode,
        finish_name: finishName,
        finish_description: finishDescription,
        finish_image_url: finishImageUrl,
        show_in_quotation: formData.get(`finish_show_in_quotation_${index}`) === "on",
        show_in_specification: formData.get(`finish_show_in_specification_${index}`) === "on",
        sort_order: Number.isFinite(sortOrder) ? sortOrder : index,
      };
    })
    .filter((finish, index) => {
      if (removed.has(String(index))) return false;

      return Boolean(
        finish.group_label ||
        finish.finish_code ||
        finish.finish_name ||
        finish.finish_description ||
        finish.finish_image_url,
      );
    });
}

function itemPayload(formData: FormData, userId?: string) {
  const qty = numberValue(formData, "qty", 1);
  const rawUnitPrice = numberValue(formData, "unit_price", 0);
  const discountType = textValue(formData, "discount_type") || "amount";
  const rawDiscountValue = numberValue(formData, "discount_value", 0);
  const linePricing = roundedLinePricing(rawUnitPrice, discountType, rawDiscountValue, qty);
  const payload = {
    quotation_id: textValue(formData, "quotation_id"),
    section_id: optionalTextValue(formData, "section_id"),
    item_type: textValue(formData, "item_type") || "custom",
    manual_serial: optionalTextValue(formData, "manual_serial"),
    item_code_snapshot: optionalTextValue(formData, "item_code_snapshot"),
    item_name_snapshot: optionalTextValue(formData, "item_name_snapshot"),
    specified_image_url_snapshot: optionalTextValue(
      formData,
      "specified_image_url_snapshot",
    ),
    proposed_image_url_snapshot: optionalTextValue(
      formData,
      "proposed_image_url_snapshot",
    ),
    specification_snapshot: optionalTextValue(formData, "specification_snapshot"),
    finish_selections_snapshot: finishSelectionsValue(formData),
    room_name_snapshot: optionalTextValue(formData, "room_name_snapshot"),
    model_snapshot: optionalTextValue(formData, "model_snapshot"),
    finish_snapshot: optionalTextValue(formData, "finish_snapshot"),
    size_snapshot: optionalTextValue(formData, "size_snapshot"),
    origin_snapshot: optionalTextValue(formData, "origin_snapshot"),
    warranty_snapshot: optionalTextValue(formData, "warranty_snapshot"),
    supplier_name_snapshot: optionalTextValue(formData, "supplier_name_snapshot"),
    supplier_notes_snapshot: optionalTextValue(formData, "supplier_notes_snapshot"),
    allow_material_continuation_page: boolValue(formData, "allow_material_continuation_page"),
    qty,
    unit_label: textValue(formData, "unit_label") || "Pc",
    unit_price: linePricing.unitPrice,
    discount_type: discountType,
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    currency: normalizeCurrency(textValue(formData, "currency") || defaultCurrency),
    sort_order: integerValue(formData, "sort_order", 0),
    is_optional: boolValue(formData, "is_optional"),
    internal_cost: numberValue(formData, "internal_cost", 0),
    margin_type: textValue(formData, "margin_type") || "amount",
    margin_value: numberValue(formData, "margin_value", 0),
    is_rate_only: boolValue(formData, "is_rate_only"),
    line_style: textValue(formData, "line_style") || "normal",
    row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
    cell_layout: cellLayoutValue(formData),
    is_active: boolValue(formData, "is_active"),
    notes: optionalTextValue(formData, "notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

export async function recalculateQuotationTotals(quotationId: string) {
  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("vat_percent,overall_discount_type,overall_discount_value")
    .eq("id", quotationId)
    .single<{
      vat_percent: number;
      overall_discount_type: string;
      overall_discount_value: number;
    }>();

  if (quotationError) {
    console.error("QUOTATION TOTAL READ ERROR", quotationError.message);
    return;
  }

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select("qty,unit_price,net_total,line_style,is_rate_only,item_type")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .returns<
      Array<{
        qty: number;
        unit_price: number;
        net_total: number;
        line_style: string;
        is_rate_only: boolean;
        item_type: string;
      }>
    >();

  if (itemsError) {
    console.error("QUOTATION ITEMS TOTAL ERROR", itemsError.message);
    return;
  }

  const pricedItems = (items ?? []).filter(
    (item) =>
      !item.is_rate_only &&
      !excludedTotalLineStyles.has(item.line_style) &&
      !["note", "blank", "subtotal"].includes(item.item_type),
  );

  const subtotal = quotationMoneyValue(
    pricedItems.reduce((total, item) => total + quotationMoneyValue(item.qty * item.unit_price), 0),
  );
  const netTotal = quotationMoneyValue(
    pricedItems.reduce((total, item) => total + quotationMoneyValue(item.net_total), 0),
  );
  const discountTotal = quotationMoneyValue(Math.max(subtotal - netTotal, 0));
  const overallDiscountAmount = quotationMoneyValue(
    quotation.overall_discount_type === "percent"
      ? (netTotal * quotation.overall_discount_value) / 100
      : quotation.overall_discount_value,
  );
  const taxableTotal = quotationMoneyValue(Math.max(netTotal - overallDiscountAmount, 0));
  const vatAmount = quotationMoneyValue((taxableTotal * quotation.vat_percent) / 100);
  const grandTotal = quotationMoneyValue(taxableTotal + vatAmount);

  const { error } = await supabase
    .from("quotations")
    .update({
      subtotal,
      discount_total: discountTotal,
      vat_amount: vatAmount,
      grand_total: grandTotal,
    })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION TOTAL UPDATE ERROR", error.message);
  }
}

export async function createQuotation(formData: FormData) {
  const redirectPath = returnPath(formData, "/quotations");
  const { user, profile, displayName } = await requireActiveUser();
  const role = profile?.role;

  if (
    role !== "system_owner" &&
    role !== "admin_manager" &&
    role !== "sales_designer"
  ) {
    redirectQuotationCreateError(formData, redirectPath, "You do not have permission to create quotations.");
  }

  const payload = quotationPayload(formData, user.id);

  if (!payload.client_id) {
    redirectQuotationCreateError(formData, redirectPath, "Client is required.");
  }

  if (!payload.project_id) {
    redirectQuotationCreateError(formData, redirectPath, "Project is required.");
  }

  if (!quotationStatuses.has(payload.status) || !layoutModes.has(payload.layout_mode)) {
    redirectQuotationCreateError(formData, redirectPath, "Select valid quotation settings.");
  }

  try {
    const supabase = await createSupabaseClient();
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("id", payload.client_id)
      .maybeSingle<{ id: string }>();

    if (clientError) {
      console.error("QUOTATION CREATE CLIENT READ ERROR", {
        action: "createQuotation",
        client_id: payload.client_id,
        message: clientError.message,
      });
      redirectQuotationCreateError(formData, redirectPath, "Client could not be found.");
    }

    if (!client) {
      redirectQuotationCreateError(formData, redirectPath, "Client could not be found.");
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,client_id,project_name,project_code")
      .eq("id", payload.project_id)
      .maybeSingle<{
        id: string;
        client_id: string;
        project_code: string | null;
        project_name: string | null;
      }>();

    if (projectError) {
      console.error("QUOTATION CREATE PROJECT READ ERROR", {
        action: "createQuotation",
        client_id: payload.client_id,
        project_id: payload.project_id,
        message: projectError.message,
      });
      redirectQuotationCreateError(formData, redirectPath, "Project could not be found.");
    }

    if (!project) {
      redirectQuotationCreateError(formData, redirectPath, "Project could not be found.");
    }

    if (!project.client_id) {
      redirectQuotationCreateError(formData, redirectPath, "Project is missing client link.");
    }

    if (project.client_id !== payload.client_id) {
      redirectQuotationCreateError(formData, redirectPath, "Selected project does not belong to the selected client.");
    }

    payload.title = payload.title || safeProjectQuotationTitle(project.project_name);
    payload.quotation_no = payload.quotation_no || safeProjectQuotationNo(project.project_code);

    if (payload.quotation_no) {
      const { data: duplicateQuotation, error: duplicateQuotationError } = await supabase
        .from("quotations")
        .select("id,client_id,project_id")
        .ilike("quotation_no", payload.quotation_no)
        .limit(1)
        .maybeSingle<{ id: string; client_id: string; project_id: string }>();

      if (duplicateQuotationError) {
        console.error("QUOTATION CREATE DUPLICATE CHECK ERROR", {
          action: "createQuotation",
          client_id: payload.client_id,
          project_id: payload.project_id,
          quotation_no: payload.quotation_no,
          message: duplicateQuotationError.message,
        });
      }

      if (duplicateQuotation) {
        const duplicateMessage =
          duplicateQuotation.client_id === payload.client_id &&
          duplicateQuotation.project_id === payload.project_id
            ? "Quotation number already exists for this project."
            : "Could not create quotation because this quotation number already exists.";
        redirectQuotationCreateError(formData, redirectPath, duplicateMessage);
      }
    }

    const { data, error } = await supabase
      .from("quotations")
      .insert(payload)
      .select("id,title,quotation_no")
      .single<{ id: string; quotation_no: string | null; title: string }>();

    if (error || !data) {
      console.error("QUOTATION CREATE ERROR", {
        action: "createQuotation",
        client_id: payload.client_id,
        project_id: payload.project_id,
        quotation_no: payload.quotation_no,
        title: payload.title,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        message: error?.message,
      });
      redirectQuotationCreateError(formData, redirectPath, safeQuotationCreateErrorMessage(error));
    }

    await createAuditLog(supabase, {
      entityType: "quotation",
      entityId: data.id,
      action: "quotation_created",
      title: "Quotation created",
      description: quotationLabel(data.title, data.quotation_no),
      metadata: {
        clientId: payload.client_id,
        projectId: payload.project_id,
        quotationLabel: quotationLabel(data.title, data.quotation_no),
        status: payload.status,
      },
      actorName: displayName,
      createdBy: user.id,
    });

    revalidatePath("/quotations");
    revalidatePath(redirectPath);
    redirectWithMessage(`/quotations/${data.id}`, "Quotation created.");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    console.error("QUOTATION CREATE UNEXPECTED ERROR", {
      action: "createQuotation",
      client_id: payload.client_id,
      project_id: payload.project_id,
      quotation_no: payload.quotation_no,
      title: payload.title,
      error,
    });
    redirectQuotationCreateError(formData, redirectPath, "Database error: quotation insert failed.");
  }
}

export async function saveQuotationItemToProductLibrary(formData: FormData) {
  const { user, displayName } = await requireSettingsManager();
  const quotationItemId = textValue(formData, "quotation_item_id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(
    formData,
    `/quotations/${quotationId}/builder#item-${quotationItemId}`,
  );
  const saveMode =
    textValue(formData, "save_mode") === "existing_family_variant"
      ? "existing_family_variant"
      : "new_family";
  const templateName = textValue(formData, "template_name");
  const brandId = textValue(formData, "brand_id");
  const mainCategoryId = optionalTextValue(formData, "main_category_id");
  const subCategoryId = optionalTextValue(formData, "sub_category_id");

  if (!quotationItemId || !quotationId) {
    redirectWithMessage(redirectPath, "Quotation row could not be identified.");
  }

  if (saveMode === "new_family" && (!templateName || !brandId)) {
    redirectWithMessage(redirectPath, "Template name and brand are required.");
  }

  const supabase = await createSupabaseClient();
  if (saveMode === "new_family") {
    const { data: brand, error: brandError } = await supabase
      .from("brands")
      .select("id")
      .eq("id", brandId)
      .eq("is_active", true)
      .maybeSingle<{ id: string }>();

    if (brandError || !brand) {
      console.error("SAVE QUOTATION ITEM TO LIBRARY BRAND ERROR", brandError?.message);
      redirectWithMessage(redirectPath, "Select a valid brand.");
    }
  }

  const { data: quotationItem, error: quotationItemError } = await supabase
    .from("quotation_items")
    .select(
      "id,quotation_id,source_template_id,source_component_data,item_type,item_code_snapshot,item_name_snapshot,specification_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,supplier_name_snapshot,qty,unit_label,unit_price,currency,specified_image_url_snapshot,proposed_image_url_snapshot,notes,is_active",
    )
    .eq("id", quotationItemId)
    .eq("quotation_id", quotationId)
    .maybeSingle<{
      id: string;
      quotation_id: string;
      source_template_id: string | null;
      source_component_data: unknown;
      item_type: string;
      item_code_snapshot: string | null;
      item_name_snapshot: string | null;
      specification_snapshot: string | null;
      model_snapshot: string | null;
      finish_snapshot: string | null;
      size_snapshot: string | null;
      origin_snapshot: string | null;
      supplier_name_snapshot: string | null;
      qty: number;
      unit_label: string;
      unit_price: number;
      currency: string;
      specified_image_url_snapshot: string | null;
      proposed_image_url_snapshot: string | null;
      notes: string | null;
      is_active: boolean;
    }>();

  if (quotationItemError || !quotationItem || !quotationItem.is_active) {
    console.error("SAVE QUOTATION ITEM TO LIBRARY READ ERROR", quotationItemError?.message);
    redirectWithMessage(redirectPath, "Quotation row could not be loaded.");
  }

  if (quotationItem.source_template_id) {
    redirectWithMessage(redirectPath, "This row is already linked to the Product Library.");
  }

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,project_id,title,quotation_no")
    .eq("id", quotationId)
    .maybeSingle<{ id: string; project_id: string | null; title: string; quotation_no: string | null }>();

  if (quotationError || !quotation) {
    console.error("SAVE QUOTATION ITEM TO LIBRARY QUOTATION ERROR", quotationError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be loaded.");
  }

  if (mainCategoryId || subCategoryId) {
    const categoryIds = [mainCategoryId, subCategoryId].filter(Boolean) as string[];
    const { data: categories, error: categoriesError } = await supabase
      .from("product_categories")
      .select("id,brand_id,parent_id")
      .in("id", categoryIds)
      .returns<Array<{ id: string; brand_id: string; parent_id: string | null }>>();

    if (categoriesError) {
      console.error("SAVE QUOTATION ITEM TO LIBRARY CATEGORY ERROR", categoriesError.message);
      redirectWithMessage(redirectPath, "Category selection could not be validated.");
    }

    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));
    if (mainCategoryId) {
      const mainCategory = categoryMap.get(mainCategoryId);
      if (!mainCategory || mainCategory.brand_id !== brandId || mainCategory.parent_id) {
        redirectWithMessage(redirectPath, "Select a valid main category for the chosen brand.");
      }
    }
    if (subCategoryId) {
      const subCategory = categoryMap.get(subCategoryId);
      if (!subCategory || subCategory.brand_id !== brandId || !subCategory.parent_id) {
        redirectWithMessage(redirectPath, "Select a valid subcategory for the chosen brand.");
      }
      if (!mainCategoryId || subCategory.parent_id !== mainCategoryId) {
        redirectWithMessage(redirectPath, "Selected subcategory does not belong to the chosen main category.");
      }
    }
  }

  if (saveMode === "existing_family_variant") {
    const existingTemplateId = textValue(formData, "existing_template_id");
    const variantName = textValue(formData, "variant_name");

    if (!existingTemplateId || !variantName) {
      redirectWithMessage(redirectPath, "Select a product family and variant label.");
    }

    const { data: existingTemplate, error: existingTemplateError } = await supabase
      .from("product_templates")
      .select("id,template_name,variant_pricing,is_active")
      .eq("id", existingTemplateId)
      .maybeSingle<{
        id: string;
        template_name: string;
        variant_pricing: VariantPricingRow[] | null;
        is_active: boolean;
      }>();

    if (existingTemplateError || !existingTemplate || !existingTemplate.is_active) {
      console.error("SAVE QUOTATION ITEM TO EXISTING FAMILY READ ERROR", existingTemplateError?.message);
      redirectWithMessage(redirectPath, "Selected product family could not be loaded.");
    }

    const dimension = optionalTextValue(formData, "dimension");
    const variantRows = Array.isArray(existingTemplate.variant_pricing)
      ? existingTemplate.variant_pricing
      : [];
    const duplicateVariant = variantRows.find((row) => {
      const sameName =
        (row.variant_name ?? "").trim().toLowerCase() === variantName.trim().toLowerCase();
      const sameDimension =
        (row.dimension ?? "").trim().toLowerCase() === (dimension ?? "").trim().toLowerCase();

      return row.is_active !== false && sameName && sameDimension;
    });

    if (duplicateVariant) {
      redirectWithMessage(
        redirectPath,
        "A similar variant already exists under the selected product family.",
      );
    }

    const variantItemCode = optionalTextValue(formData, "variant_item_code");
    const variantSpecification = [
      optionalTextValue(formData, "variant_specification"),
      variantItemCode ? `Item code: ${variantItemCode}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const manualSourcePricing = manualSourcePricingFromSourceData(quotationItem.source_component_data);
    const nextVariantRows = [
      ...variantRows,
      {
        id: `variant-${Date.now()}`,
        variant_name: variantName,
        dimension,
        price: numberValue(formData, "variant_price", manualSourcePricing?.price ?? quotationItem.unit_price),
        currency: normalizeCurrency(
          textValue(formData, "variant_currency") || manualSourcePricing?.currency || quotationItem.currency || defaultCurrency,
        ),
        specification: variantSpecification || undefined,
        sort_order: variantRows.length,
        is_active: true,
      },
    ];

    const { error: updateTemplateError } = await supabase
      .from("product_templates")
      .update({ variant_pricing: nextVariantRows })
      .eq("id", existingTemplate.id);

    if (updateTemplateError) {
      console.error("SAVE QUOTATION ITEM TO EXISTING FAMILY UPDATE ERROR", updateTemplateError.message);
      redirectWithMessage(redirectPath, "Product variant could not be saved to the Product Library.");
    }

    await createAuditLog(supabase, {
      entityType: "product_template",
      entityId: existingTemplate.id,
      parentEntityType: "quotation",
      parentEntityId: quotation.id,
      action: "product_template_variant_created_from_quote",
      title: "Product variant saved to library from quotation row",
      description: `${existingTemplate.template_name} / ${variantName}`,
      actorName: displayName,
      createdBy: user.id,
      metadata: {
        quotationItemId: quotationItem.id,
        quotationLabel: quotationLabel(quotation.title, quotation.quotation_no),
      },
    });

    revalidatePath("/products/templates");
    revalidatePath(`/quotations/${quotationId}`);
    revalidatePath(`/quotations/${quotationId}/builder`);
    redirect(
      pathWithParams(redirectPath, {
        message: "Item added under existing product family.",
        saved_template_id: existingTemplate.id,
        quote_library_brand_id: null,
        quote_library_image_notice: null,
        quote_library_item_id: quotationItem.id,
        quote_library_main_category_id: null,
        quote_library_saved_mode: "existing_family_variant",
        quote_library_sub_category_id: null,
      }),
    );
  }

  const description = optionalTextValue(formData, "description");
  const defaultSpecification = optionalTextValue(formData, "default_specification");
  const manualSourcePricing = manualSourcePricingFromSourceData(quotationItem.source_component_data);
  const requestedTemplateImage = parseProductLibraryImageReference(
    optionalTextValue(formData, "template_image_url"),
  );
  const requestedReferenceImage = parseProductLibraryImageReference(
    optionalTextValue(formData, "reference_image_url"),
  );
  const initialTemplateImageValue =
    requestedTemplateImage.kind === "direct"
      ? requestedTemplateImage.value
      : requestedTemplateImage.kind === "product"
        ? requestedTemplateImage.path
        : null;
  const initialReferenceImageValue =
    requestedReferenceImage.kind === "direct"
      ? requestedReferenceImage.value
      : requestedReferenceImage.kind === "product"
        ? requestedReferenceImage.path
        : null;
  const { data: productTemplate, error: productTemplateError } = await supabase
    .from("product_templates")
    .insert({
      brand_id: brandId,
      main_category_id: mainCategoryId,
      sub_category_id: subCategoryId,
      template_code: optionalTextValue(formData, "template_code"),
      template_name: templateName,
      item_code: optionalTextValue(formData, "item_code"),
      description,
      default_specification: defaultSpecification,
      origin: optionalTextValue(formData, "origin"),
      supplier_name: optionalTextValue(formData, "supplier_name"),
      default_image_url: initialTemplateImageValue,
      proposed_image_url_1: initialTemplateImageValue,
      reference_image_url: initialReferenceImageValue,
      unit_label: textValue(formData, "unit_label") || quotationItem.unit_label || "Pc",
      currency: normalizeCurrency(
        textValue(formData, "currency") || manualSourcePricing?.currency || quotationItem.currency || defaultCurrency,
      ),
      default_unit_price: numberValue(
        formData,
        "default_unit_price",
        manualSourcePricing?.price ?? quotationItem.unit_price,
      ),
      is_active: true,
      created_by: user.id,
    })
    .select("id,template_name")
    .single<{ id: string; template_name: string }>();

  if (productTemplateError || !productTemplate) {
    console.error("SAVE QUOTATION ITEM TO LIBRARY INSERT ERROR", productTemplateError?.message);
    redirectWithMessage(redirectPath, "Product could not be saved to the Product Library.");
  }

  let imageNotice: string | null = null;
  const copiedImagePaths = new Map<string, string | null>();
  const resolveProductTemplateImage = async (reference: ProductLibraryImageReference) => {
    if (reference.kind === "empty") return null;
    if (reference.kind === "direct") return reference.value;
    if (reference.kind === "product") return reference.path;

    if (copiedImagePaths.has(reference.path)) {
      return copiedImagePaths.get(reference.path) ?? null;
    }

    try {
      const copiedPath = await copyQuoteImageToProductImages({
        sourcePath: reference.path,
        supabase,
        templateId: productTemplate.id,
      });
      copiedImagePaths.set(reference.path, copiedPath);
      return copiedPath;
    } catch (error) {
      console.error(
        "SAVE QUOTATION ITEM TO LIBRARY IMAGE COPY ERROR",
        error instanceof Error ? error.message : error,
      );
      imageNotice = "Image was not copied; please upload product image in Product Library.";
      copiedImagePaths.set(reference.path, null);
      return null;
    }
  };

  const finalTemplateImageValue = await resolveProductTemplateImage(requestedTemplateImage);
  const finalReferenceImageValue = await resolveProductTemplateImage(requestedReferenceImage);
  if (
    finalTemplateImageValue !== initialTemplateImageValue ||
    finalReferenceImageValue !== initialReferenceImageValue
  ) {
    const { error: imageUpdateError } = await supabase
      .from("product_templates")
      .update({
        default_image_url: finalTemplateImageValue,
        proposed_image_url_1: finalTemplateImageValue,
        reference_image_url: finalReferenceImageValue,
      })
      .eq("id", productTemplate.id);

    if (imageUpdateError) {
      console.error("SAVE QUOTATION ITEM TO LIBRARY IMAGE UPDATE ERROR", imageUpdateError.message);
      imageNotice = "Image was not copied; please upload product image in Product Library.";
    }
  }

  await createAuditLog(supabase, {
    entityType: "product_template",
    entityId: productTemplate.id,
    parentEntityType: "quotation",
    parentEntityId: quotation.id,
    action: "product_template_created_from_quote",
    title: "Product saved to library from quotation row",
    description: productTemplate.template_name,
    actorName: displayName,
    createdBy: user.id,
    metadata: {
      quotationItemId: quotationItem.id,
      quotationLabel: quotationLabel(quotation.title, quotation.quotation_no),
    },
  });

  revalidatePath("/products/templates");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  redirect(
    pathWithParams(redirectPath, {
      message: "Item saved as new product family.",
      saved_template_id: productTemplate.id,
      quote_library_brand_id: null,
      quote_library_image_notice: imageNotice,
      quote_library_item_id: quotationItem.id,
      quote_library_main_category_id: null,
      quote_library_saved_mode: "new_family",
      quote_library_sub_category_id: null,
    }),
  );
}

export async function createBrandMainCategoryFromQuoteForm(formData: FormData) {
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");
  const quotationId = textValue(formData, "quotation_id");
  const quotationItemId = textValue(formData, "quotation_item_id");
  const name = textValue(formData, "name");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${quotationItemId}`);

  if (!brandId || !quotationId || !quotationItemId || !name) {
    redirectWithMessage(redirectPath, "Brand and main category name are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  if (brandError || !brand) {
    console.error("QUOTE FORM MAIN CATEGORY BRAND ERROR", brandError?.message);
    redirectWithMessage(redirectPath, "Select a valid brand before creating a category.");
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("product_categories")
    .select("id")
    .eq("brand_id", brandId)
    .is("parent_id", null)
    .ilike("name", name)
    .limit(1);

  if (duplicateError) {
    console.error("QUOTE FORM MAIN CATEGORY DUPLICATE ERROR", duplicateError.message);
    redirectWithMessage(redirectPath, "Main category could not be validated.");
  }

  if (duplicate?.length) {
    redirect(
      pathWithParams(redirectPath, {
        message: "A main category with that name already exists.",
        quote_library_brand_id: brandId,
        quote_library_item_id: quotationItemId,
      }),
    );
  }

  const { data: category, error: insertError } = await supabase
    .from("product_categories")
    .insert({
      brand_id: brandId,
      parent_id: null,
      name,
      is_active: true,
      sort_order: integerValue(formData, "sort_order", 0),
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !category) {
    console.error("QUOTE FORM MAIN CATEGORY CREATE ERROR", insertError?.message);
    redirectWithMessage(redirectPath, "Main category could not be created.");
  }

  revalidatePath("/products/templates");
  revalidatePath("/products/brands");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  redirect(
    pathWithParams(redirectPath, {
      message: "Main category created.",
      quote_library_brand_id: brandId,
      quote_library_item_id: quotationItemId,
      quote_library_main_category_id: category.id,
      quote_library_sub_category_id: null,
    }),
  );
}

export async function createBrandSubcategoryFromQuoteForm(formData: FormData) {
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");
  const parentId = textValue(formData, "parent_id");
  const quotationId = textValue(formData, "quotation_id");
  const quotationItemId = textValue(formData, "quotation_item_id");
  const name = textValue(formData, "name");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${quotationItemId}`);

  if (!brandId || !parentId || !quotationId || !quotationItemId || !name) {
    redirectWithMessage(redirectPath, "Brand, main category, and subcategory name are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: parentCategory, error: parentError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id")
    .eq("id", parentId)
    .maybeSingle<{ id: string; brand_id: string; parent_id: string | null }>();

  if (parentError || !parentCategory || parentCategory.brand_id !== brandId || parentCategory.parent_id) {
    console.error("QUOTE FORM SUBCATEGORY PARENT ERROR", parentError?.message);
    redirectWithMessage(redirectPath, "Select a valid main category before creating a subcategory.");
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("product_categories")
    .select("id")
    .eq("brand_id", brandId)
    .eq("parent_id", parentId)
    .ilike("name", name)
    .limit(1);

  if (duplicateError) {
    console.error("QUOTE FORM SUBCATEGORY DUPLICATE ERROR", duplicateError.message);
    redirectWithMessage(redirectPath, "Subcategory could not be validated.");
  }

  if (duplicate?.length) {
    redirect(
      pathWithParams(redirectPath, {
        message: "A subcategory with that name already exists.",
        quote_library_brand_id: brandId,
        quote_library_item_id: quotationItemId,
        quote_library_main_category_id: parentId,
      }),
    );
  }

  const { data: category, error: insertError } = await supabase
    .from("product_categories")
    .insert({
      brand_id: brandId,
      parent_id: parentId,
      name,
      is_active: true,
      sort_order: integerValue(formData, "sort_order", 0),
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !category) {
    console.error("QUOTE FORM SUBCATEGORY CREATE ERROR", insertError?.message);
    redirectWithMessage(redirectPath, "Subcategory could not be created.");
  }

  revalidatePath("/products/templates");
  revalidatePath("/products/brands");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  redirect(
    pathWithParams(redirectPath, {
      message: "Subcategory created.",
      quote_library_brand_id: brandId,
      quote_library_item_id: quotationItemId,
      quote_library_main_category_id: parentId,
      quote_library_sub_category_id: category.id,
    }),
  );
}

function actionQuotationId(formData: FormData) {
  return textValue(formData, "quotation_id");
}

function baseQuotationNo(quotationNo: string | null) {
  return quotationRevisionBaseNo(quotationNo);
}

function revisionNoFromQuotationNo(quotationNo: string | null, baseNo: string) {
  if (quotationNo === baseNo) return 0;

  const match = quotationNo?.match(new RegExp(`^${baseNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-R(\\d+)$`, "i"));

  return match ? Number.parseInt(match[1], 10) : null;
}

function baseRevisionTitle(title: string) {
  return title.replace(/(?:\s+Rev\s+\d+)+$/i, "");
}

function baseOptionTitle(title: string) {
  return baseRevisionTitle(title).replace(/\s+-\s+Option\s+\d+$/i, "").trim();
}

type QuotationRevisionChainMember = {
  id: string;
  quotation_no: string | null;
  option_no: number;
  revision_no: number;
  title: string;
  is_active?: boolean;
};

function quotationRevisionLabel(revisionNo: number) {
  return revisionNo > 0 ? `R${revisionNo}` : "Original";
}

function quotationBelongsToRevisionChain(
  quotation: Pick<QuotationRevisionChainMember, "quotation_no">,
  baseNo: string,
) {
  return baseQuotationNo(quotation.quotation_no) === baseNo;
}

type ProjectQuotationOptionMember = {
  id: string;
  quotation_no: string | null;
  option_no: number;
  revision_no: number;
  is_active?: boolean;
};

function normalizedOptionNo(quotation: Pick<ProjectQuotationOptionMember, "option_no" | "quotation_no">) {
  return Math.max(quotation.option_no || quotationOptionNoFromQuotationNo(quotation.quotation_no) || 1, 1);
}

function optionQuotationNo(baseNo: string, optionNo: number) {
  return optionNo > 1 ? `${baseNo} ${quotationOptionLabel(optionNo)}` : baseNo;
}

async function resolveProjectOptionBaseNo({
  clientId,
  projectId,
  sourceQuotationNo,
  supabase,
}: {
  clientId: string;
  projectId: string;
  sourceQuotationNo: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
}) {
  const { data: siblingQuotations, error: siblingQuotationsError } = await supabase
    .from("quotations")
    .select("id,quotation_no,option_no,revision_no,is_active")
    .eq("client_id", clientId)
    .eq("project_id", projectId)
    .returns<ProjectQuotationOptionMember[]>();

  if (siblingQuotationsError) {
    return {
      baseNo: null,
      errorMessage: "Quotation options could not be loaded.",
      siblingQuotations: [] as ProjectQuotationOptionMember[],
    };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("project_code")
    .eq("id", projectId)
    .maybeSingle<{ project_code: string | null }>();

  if (projectError) {
    console.error("PROJECT QUOTATION BASE READ ERROR", projectError.message);
  }

  const siblingBaseNo = (siblingQuotations ?? [])
    .map((quotation) => quotationRootBaseNo(quotation.quotation_no))
    .find((value): value is string => Boolean(value));
  const baseNo =
    quotationRootBaseNo(sourceQuotationNo) ??
    siblingBaseNo ??
    project?.project_code?.trim() ??
    null;

  return {
    baseNo,
    errorMessage: null,
    siblingQuotations: siblingQuotations ?? [],
  };
}

async function quotationRevisionChain({
  clientId,
  projectId,
  quotationId,
  supabase,
}: {
  clientId: string;
  projectId: string;
  quotationId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
}) {
  const { data: sourceQuotation, error: sourceQuotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,option_no,revision_no,title,is_active")
    .eq("id", quotationId)
    .eq("client_id", clientId)
    .eq("project_id", projectId)
    .maybeSingle<QuotationRevisionChainMember & { client_id: string; project_id: string }>();

  if (sourceQuotationError || !sourceQuotation) {
    return {
      errorMessage: "Quotation could not be loaded.",
      sourceQuotation: null,
    };
  }

  const baseNo = baseQuotationNo(sourceQuotation.quotation_no);

  if (!baseNo) {
    return {
      errorMessage: "Add a quotation number before creating revisions.",
      sourceQuotation,
    };
  }

  const { data: siblingQuotations, error: siblingQuotationsError } = await supabase
    .from("quotations")
    .select("id,quotation_no,option_no,revision_no,title,is_active")
    .eq("client_id", clientId)
    .eq("project_id", projectId)
    .returns<QuotationRevisionChainMember[]>();

  if (siblingQuotationsError) {
    return {
      errorMessage: "Revision history could not be loaded.",
      sourceQuotation,
    };
  }

  const chain = (siblingQuotations ?? [])
    .filter((quotation) => quotationBelongsToRevisionChain(quotation, baseNo))
    .sort((left, right) => {
      const revisionCompare = (left.revision_no ?? 0) - (right.revision_no ?? 0);
      if (revisionCompare !== 0) return revisionCompare;

      return (left.quotation_no ?? "").localeCompare(right.quotation_no ?? "");
    });
  const latestQuotation = chain[chain.length - 1] ?? sourceQuotation;

  return {
    baseNo,
    chain,
    errorMessage: null,
    latestQuotation,
    sourceQuotation,
  };
}

async function copyQuotation(
  formData: FormData,
  mode: QuotationCopyMode,
  message: string,
) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { data: source, error: sourceError } = await supabase
    .from("quotations")
    .select(quotationCopySelect)
    .eq("id", quotationId)
    .single<QuotationCopySource>();

  if (sourceError || !source) {
    console.error("QUOTATION COPY READ ERROR", sourceError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be copied.");
  }

  let title = `${source.title} - Copy`;
  let quotationNo: string | null = null;
  let optionNo = Math.max(source.option_no || 1, 1);
  let revisionNo = 0;

  if (mode === "revision") {
    const chainInfo = await quotationRevisionChain({
      clientId: source.client_id,
      projectId: source.project_id,
      quotationId: source.id,
      supabase,
    });

    if (chainInfo.errorMessage || !chainInfo.sourceQuotation || !chainInfo.baseNo || !chainInfo.latestQuotation) {
      console.error("QUOTATION REVISION CHAIN ERROR", chainInfo.errorMessage ?? "Missing revision chain.");
      redirectWithMessage(redirectPath, chainInfo.errorMessage ?? "Revision could not be created.");
    }

    if (chainInfo.latestQuotation.id !== source.id) {
      redirectWithMessage(
        redirectPath,
        `Please create revisions from the latest revision (${quotationRevisionLabel(chainInfo.latestQuotation.revision_no ?? 0)}).`,
      );
    }

    const highestRevisionNo = Math.max(
      0,
      ...chainInfo.chain
        .map((quotation) => quotation.revision_no ?? revisionNoFromQuotationNo(quotation.quotation_no, chainInfo.baseNo))
        .filter((value): value is number => value !== null && Number.isFinite(value)),
    );
    const nextRevisionNo = highestRevisionNo + 1;
    title = `${baseRevisionTitle(source.title)} Rev ${nextRevisionNo}`;
    quotationNo = `${chainInfo.baseNo}-R${nextRevisionNo}`;
    optionNo = Math.max(chainInfo.sourceQuotation.option_no || source.option_no || 1, 1);
    revisionNo = nextRevisionNo;
  }

  if (mode === "option") {
    const optionInfo = await resolveProjectOptionBaseNo({
      clientId: source.client_id,
      projectId: source.project_id,
      sourceQuotationNo: source.quotation_no,
      supabase,
    });

    if (optionInfo.errorMessage || !optionInfo.baseNo) {
      console.error("QUOTATION OPTION BASE ERROR", optionInfo.errorMessage ?? "Missing option base.");
      redirectWithMessage(
        redirectPath,
        optionInfo.errorMessage ?? "Add a project code or quotation number before creating options.",
      );
    }

    const highestOptionNo = Math.max(
      1,
      ...optionInfo.siblingQuotations
        .filter((quotation) => quotationRootBaseNo(quotation.quotation_no) === optionInfo.baseNo)
        .map((quotation) => normalizedOptionNo(quotation)),
    );
    const nextOptionNo = highestOptionNo + 1;
    const sourceBaseQuotationNo = optionQuotationNo(optionInfo.baseNo, 1);

    if (!source.quotation_no) {
      const { error: sourceUpdateError } = await supabase
        .from("quotations")
        .update({
          option_no: 1,
          quotation_no: sourceBaseQuotationNo,
        })
        .eq("id", source.id);

      if (sourceUpdateError) {
        console.error("QUOTATION OPTION SOURCE UPDATE ERROR", sourceUpdateError.message);
        redirectWithMessage(redirectPath, "Original quotation number could not be prepared.");
      }
    }

    optionNo = nextOptionNo;
    quotationNo = optionQuotationNo(optionInfo.baseNo, nextOptionNo);
    title = `${baseOptionTitle(source.title)} - ${quotationOptionLabel(nextOptionNo)}`;
  }

  const { data: newQuotation, error: insertError } = await supabase
    .from("quotations")
    .insert({
      client_id: source.client_id,
      project_id: source.project_id,
      quotation_no: quotationNo,
      option_no: optionNo,
      revision_no: revisionNo,
      title,
      quotation_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      currency: source.currency,
      vat_percent: source.vat_percent,
      payment_terms: source.payment_terms,
      validity: source.validity,
      delivery_terms: source.delivery_terms,
      warranty_terms: source.warranty_terms,
      notes: source.notes,
      layout_mode: source.layout_mode,
      layout_settings: source.layout_settings ?? {},
      overall_discount_type: source.overall_discount_type,
      overall_discount_value: source.overall_discount_value,
      is_active: true,
      created_by: user.id,
    })
    .select("id,quotation_no,option_no,title")
    .single<{ id: string; quotation_no: string | null; option_no: number; title: string }>();

  if (insertError || !newQuotation) {
    console.error("QUOTATION COPY CREATE ERROR", insertError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be copied.");
  }

  const { data: sections, error: sectionsError } = await supabase
    .from("quotation_sections")
    .select(sectionCopySelect)
    .eq("quotation_id", source.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationSectionCopySource[]>();

  if (sectionsError) {
    console.error("QUOTATION COPY SECTIONS READ ERROR", sectionsError.message);
    redirectWithMessage(redirectPath, "Quotation sections could not be copied.");
  }

  const pendingSectionParents: Array<{ id: string; parentSectionId: string | null }> = [];
  const sectionIdMap = new Map<string, string>();
  for (const section of sections ?? []) {
    const { id: _oldId, parent_section_id: parentSectionId, ...sectionPayload } = section;
    const { data: newSection, error: sectionInsertError } = await supabase
      .from("quotation_sections")
      .insert({
        ...sectionPayload,
        quotation_id: newQuotation.id,
        parent_section_id: null,
        is_active: true,
        created_by: user.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (sectionInsertError || !newSection) {
      console.error("QUOTATION COPY SECTION CREATE ERROR", sectionInsertError?.message);
      redirectWithMessage(redirectPath, "Quotation sections could not be copied.");
    }

    sectionIdMap.set(_oldId, newSection.id);
    pendingSectionParents.push({ id: newSection.id, parentSectionId });
  }

  for (const section of pendingSectionParents) {
    const newParentId = section.parentSectionId
      ? sectionIdMap.get(section.parentSectionId) ?? null
      : null;

    if (!newParentId) continue;

    const { error } = await supabase
      .from("quotation_sections")
      .update({ parent_section_id: newParentId })
      .eq("id", section.id);

    if (error) {
      console.error("QUOTATION COPY SECTION PARENT UPDATE ERROR", error.message);
      redirectWithMessage(redirectPath, "Quotation section hierarchy could not be copied.");
    }
  }

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select(itemCopySelect)
    .eq("quotation_id", source.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationItemCopySource[]>();

  if (itemsError) {
    console.error("QUOTATION COPY ITEMS READ ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Quotation items could not be copied.");
  }

  const itemPayloads = (items ?? []).map((item) => {
    const { id, section_id: sectionId, ...itemPayload } = item;
    void id;

    return {
      ...itemPayload,
      quotation_id: newQuotation.id,
      section_id: sectionId ? sectionIdMap.get(sectionId) ?? null : null,
      is_active: true,
      created_by: user.id,
    };
  });

  if (itemPayloads.length) {
    const { error: itemInsertError } = await supabase
      .from("quotation_items")
      .insert(itemPayloads);

    if (itemInsertError) {
      console.error("QUOTATION COPY ITEM CREATE ERROR", itemInsertError.message);
      redirectWithMessage(redirectPath, "Quotation items could not be copied.");
    }
  }

  await recalculateQuotationTotals(newQuotation.id);
  await createAuditLog(supabase, {
    entityType: "quotation",
    entityId: newQuotation.id,
    action:
      mode === "revision"
        ? "revision_created"
        : mode === "option"
          ? "quotation_option_created"
          : "quotation_created",
    title: mode === "revision"
      ? "Revision created"
      : mode === "option"
        ? "Quotation option created"
      : "Quotation created",
    description: mode === "revision"
      ? quotationLabel(title, quotationNo)
      : mode === "option"
        ? quotationLabel(newQuotation.title, newQuotation.quotation_no)
        : `${quotationLabel(title, quotationNo)} duplicated`,
    metadata: {
      mode,
      optionNo,
      quotationLabel: quotationLabel(newQuotation.title, newQuotation.quotation_no),
      newRevisionNo: revisionNo,
      sourceQuotationId: source.id,
      sourceQuotationNo: source.quotation_no,
      sourceOptionNo: source.option_no,
      sourceRevisionNo: source.revision_no,
      sourceTitle: source.title,
    },
    actorName: displayName,
    createdBy: user.id,
  });
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${newQuotation.id}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, message);
}

export async function duplicateQuotation(formData: FormData) {
  await copyQuotation(formData, "duplicate", "Quotation duplicated.");
}

export async function createQuotationRevision(formData: FormData) {
  await copyQuotation(formData, "revision", "Revision created.");
}

export async function createQuotationOption(formData: FormData) {
  await copyQuotation(formData, "option", "Option created.");
}

export async function deactivateQuotation(formData: FormData) {
  await requireRecordsManager();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({ is_active: false })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Quotation could not be deactivated.");
  }

  revalidatePath("/quotations");
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Quotation moved to Archive.");
}

export async function restoreQuotation(formData: FormData) {
  await requireRecordsManager();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({ is_active: true })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION RESTORE ERROR", error.message);
    redirectWithMessage(redirectPath, "Quotation could not be restored.");
  }

  revalidatePath("/quotations");
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Quotation restored.");
}

export async function permanentlyDeleteQuotation(formData: FormData) {
  const { profile } = await requireActiveUser();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";

  if (!canManageRecords) {
    redirectWithMessage(
      redirectPath,
      "You do not have permission to permanently delete quotations.",
    );
  }

  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,project_id,is_active")
    .eq("id", quotationId)
    .maybeSingle<{ id: string; project_id: string | null; is_active: boolean }>();

  if (quotationError) {
    console.error("QUOTATION PERMANENT DELETE READ ERROR", quotationError.message);
    redirectWithMessage(redirectPath, "Quotation could not be loaded.");
  }

  if (!quotation) {
    redirectWithMessage(redirectPath, "Quotation could not be deleted because it was not found.");
  }

  if (quotation.is_active) {
    redirectWithMessage(redirectPath, "Archive this quotation before permanent deletion.");
  }

  const { data: sections, error: sectionsReadError } = await supabase
    .from("quotation_sections")
    .select("id")
    .eq("quotation_id", quotationId)
    .returns<Array<{ id: string }>>();

  if (sectionsReadError) {
    console.error("QUOTATION SECTIONS PERMANENT DELETE READ ERROR", sectionsReadError.message);
    redirectWithMessage(
      redirectPath,
      `Quotation sections could not be loaded: ${sectionsReadError.message}`,
    );
  }

  const sectionIds = (sections ?? []).map((section) => section.id);

  if (sectionIds.length) {
    const { error: sectionItemsError } = await supabase
      .from("quotation_items")
      .delete()
      .in("section_id", sectionIds);

    if (sectionItemsError) {
      console.error("QUOTATION SECTION ITEMS PERMANENT DELETE ERROR", sectionItemsError.message);
      redirectWithMessage(
        redirectPath,
        `Quotation line items could not be permanently deleted: ${sectionItemsError.message}`,
      );
    }
  }

  const { error: unsectionedItemsError } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", quotationId)
    .is("section_id", null);

  if (unsectionedItemsError) {
    console.error("QUOTATION UNSECTIONED ITEMS PERMANENT DELETE ERROR", unsectionedItemsError.message);
    redirectWithMessage(
      redirectPath,
      `Quotation line items could not be permanently deleted: ${unsectionedItemsError.message}`,
    );
  }

  const { error: sectionsError } = await supabase
    .from("quotation_sections")
    .delete()
    .eq("quotation_id", quotationId);

  if (sectionsError) {
    console.error("QUOTATION SECTIONS PERMANENT DELETE ERROR", sectionsError.message);
    redirectWithMessage(
      redirectPath,
      `Quotation sections could not be permanently deleted: ${sectionsError.message}`,
    );
  }

  const { error: deleteError } = await supabase
    .from("quotations")
    .delete()
    .eq("id", quotationId)
    .eq("is_active", false);

  if (deleteError) {
    console.error("QUOTATION PERMANENT DELETE ERROR", deleteError.message);
    redirectWithMessage(
      redirectPath,
      `Quotation could not be permanently deleted: ${deleteError.message}`,
    );
  }

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  if (quotation.project_id) {
    revalidatePath(`/clients/projects/${quotation.project_id}`);
  }
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Quotation permanently deleted.");
}

export async function updateQuotation(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = quotationPayload(formData);
  const auditScope = textValue(formData, "audit_scope");

  if (!id || !payload.client_id || !payload.project_id || !payload.title) {
    redirectWithMessage("/quotations", "Quotation, client, project, and title are required.");
  }

  if (!quotationStatuses.has(payload.status) || !layoutModes.has(payload.layout_mode)) {
    redirectWithMessage(`/quotations/${id}`, "Select valid quotation settings.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentQuotation, error: currentQuotationError } = await supabase
    .from("quotations")
    .select("id,title,quotation_no")
    .eq("id", id)
    .maybeSingle<{ id: string; quotation_no: string | null; title: string }>();

  if (currentQuotationError || !currentQuotation) {
    console.error("QUOTATION UPDATE READ ERROR", currentQuotationError?.message);
    redirectWithMessage(`/quotations/${id}`, "Quotation could not be updated.");
  }

  const { error } = await supabase.from("quotations").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION UPDATE ERROR", error.message);
    redirectWithMessage(`/quotations/${id}`, "Quotation could not be updated.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation",
    entityId: currentQuotation.id,
    action: auditScope === "terms" ? "commercial_terms_updated" : "quotation_updated",
    title: auditScope === "terms" ? "Commercial terms updated" : "Quote details updated",
    description: quotationLabel(payload.title, payload.quotation_no),
    metadata: {
      layoutMode: payload.layout_mode,
      quotationLabel: quotationLabel(payload.title, payload.quotation_no),
      status: payload.status,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(id);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  redirectWithMessage(`/quotations/${id}`, "Quotation updated.");
}

export async function updateQuotationExtraDiscount(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const redirectPath = returnPath(formData, `/quotations/${id}`);
  const overallDiscountType = allowedText(
    formData,
    "overall_discount_type",
    discountTypes,
    "amount",
  );
  const overallDiscountValue = Math.max(numberValue(formData, "overall_discount_value", 0), 0);

  if (!id) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentQuotation, error: currentQuotationError } = await supabase
    .from("quotations")
    .select("id,title,quotation_no")
    .eq("id", id)
    .maybeSingle<{ id: string; quotation_no: string | null; title: string }>();

  if (currentQuotationError || !currentQuotation) {
    console.error("QUOTATION EXTRA DISCOUNT READ ERROR", currentQuotationError?.message);
    redirectWithMessage(redirectPath, "Extra discount could not be updated.");
  }

  const { error } = await supabase
    .from("quotations")
    .update({
      overall_discount_type: overallDiscountType,
      overall_discount_value: overallDiscountValue,
    })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION EXTRA DISCOUNT UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Extra discount could not be updated.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation",
    entityId: currentQuotation.id,
    action: "extra_discount_updated",
    title: "Extra discount updated",
    description: quotationLabel(currentQuotation.title, currentQuotation.quotation_no),
    metadata: {
      overallDiscountType,
      overallDiscountValue,
      quotationLabel: quotationLabel(currentQuotation.title, currentQuotation.quotation_no),
    },
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(id);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  revalidatePath(`/quotations/${id}/builder`);
  redirectWithMessage(redirectPath, "Extra discount updated.");
}

export async function updateQuotationStatus(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const nextStatus = textValue(formData, "status");
  const statusNote = optionalTextValue(formData, "status_note");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  if (!quotationStatuses.has(nextStatus)) {
    redirectWithMessage(redirectPath, "Select a valid quotation status.");
  }

  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,project_id,title,quotation_no,status")
    .eq("id", quotationId)
    .maybeSingle<QuotationStatusState>();

  if (quotationError || !quotation) {
    console.error("QUOTATION STATUS READ ERROR", quotationError?.message);
    redirectWithMessage(redirectPath, "Quotation status could not be updated.");
  }

  const { error: updateError } = await supabase
    .from("quotations")
    .update({
      status: nextStatus,
      status_note: statusNote,
      status_updated_at: new Date().toISOString(),
      status_updated_by: user.id,
    })
    .eq("id", quotationId);

  if (updateError) {
    console.error("QUOTATION STATUS UPDATE ERROR", updateError.message);
    redirectWithMessage(redirectPath, "Quotation status could not be updated.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation",
    entityId: quotation.id,
    action: "quotation_status_updated",
    title: "Quotation status updated",
    description: `Status changed to ${quotationStatusLabel(nextStatus)}`,
    metadata: {
      new_status: nextStatus,
      note: statusNote,
      old_status: quotation.status,
      quotationLabel: quotationLabel(quotation.title, quotation.quotation_no),
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/clients/projects/${quotation.project_id}`);
  redirectWithMessage(redirectPath, "Quotation status updated.");
}

export async function updateQuotationLayoutSettings(formData: FormData) {
  await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const submittedKeys = formData
    .getAll("column_key")
    .filter((value): value is string => typeof value === "string" && layoutColumnKeys.includes(value as (typeof layoutColumnKeys)[number]));
  const keys = Array.from(new Set(submittedKeys));
  const columns = keys.map((key) => {
    const width = optionalIntegerInRange(formData, `width_${key}`, 40, 800) ?? 120;

    return {
      key,
      visible: boolValue(formData, `visible_${key}`),
      width,
    };
  });

  const layoutSettings = {
    columns,
    specificationMetadata: {
      title: boolValue(formData, "show_spec_title"),
      model: boolValue(formData, "show_spec_model"),
      size: boolValue(formData, "show_spec_size"),
      finish: boolValue(formData, "show_spec_finish"),
      warranty: boolValue(formData, "show_spec_warranty"),
    },
  };
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({ layout_settings: layoutSettings })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION LAYOUT SETTINGS UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Column settings could not be saved.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Column settings saved.");
}

export async function updateQuotationColumnWidth(formData: FormData) {
  await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const columnKey = textValue(formData, "column_key");
  const width = optionalIntegerInRange(formData, "width", 40, 800);

  if (!quotationId || !layoutColumnKeys.includes(columnKey as (typeof layoutColumnKeys)[number]) || width === null) {
    return { ok: false, message: "Invalid column width." };
  }

  const supabase = await createSupabaseClient();
  const { data: quotation, error: readError } = await supabase
    .from("quotations")
    .select("layout_settings")
    .eq("id", quotationId)
    .single<{ layout_settings: { columns?: Array<{ key?: string; visible?: boolean; width?: number }> } | null }>();

  if (readError || !quotation) {
    console.error("QUOTATION LAYOUT SETTINGS READ ERROR", readError?.message);
    return { ok: false, message: "Column settings could not be read." };
  }

  const currentColumns = Array.isArray(quotation.layout_settings?.columns)
    ? quotation.layout_settings.columns
    : [];
  let found = false;
  const columns = currentColumns
    .filter((column) => typeof column.key === "string")
    .map((column) => {
      if (column.key !== columnKey) return column;

      found = true;
      return { ...column, width };
    });

  if (!found) {
    columns.push({ key: columnKey, visible: true, width });
  }

  const { error } = await supabase
    .from("quotations")
    .update({ layout_settings: { ...(quotation.layout_settings ?? {}), columns } })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION COLUMN WIDTH UPDATE ERROR", error.message);
    return { ok: false, message: "Column width could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

export async function updateQuotationItemRowHeight(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const rowHeight = optionalIntegerInRange(formData, "row_height", 40, 600);

  if (!id || !quotationId || rowHeight === null) {
    return { ok: false, message: "Invalid row height." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_items")
    .update({ row_height: rowHeight })
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION ITEM ROW HEIGHT UPDATE ERROR", error.message);
    return { ok: false, message: "Row height could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

export async function updateQuotationSectionRowHeight(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const rowHeight = optionalIntegerInRange(formData, "row_height", 40, 600);

  if (!id || !quotationId || rowHeight === null) {
    return { ok: false, message: "Invalid section height." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_sections")
    .update({ row_height: rowHeight })
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION SECTION ROW HEIGHT UPDATE ERROR", error.message);
    return { ok: false, message: "Section height could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

type OrderedSection = {
  id: string;
  sort_order: number;
  created_at: string;
};

async function sectionInsertSortOrder(
  quotationId: string,
  insertAfterSectionId: string | null,
) {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("quotation_sections")
    .select("id,sort_order,created_at")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<OrderedSection[]>();

  if (error) {
    console.error("QUOTATION SECTION SORT READ ERROR", error.message);
    return 10;
  }

  const orderedSections = data ?? [];
  const insertAfterIndex = insertAfterSectionId
    ? orderedSections.findIndex((section) => section.id === insertAfterSectionId)
    : orderedSections.length - 1;
  const insertIndex = insertAfterSectionId === "__start"
    ? 0
    : insertAfterIndex >= 0
      ? insertAfterIndex + 1
      : orderedSections.length;

  for (const [index, section] of orderedSections.slice(insertIndex).entries()) {
    const { error: updateError } = await supabase
      .from("quotation_sections")
      .update({ sort_order: (insertIndex + index + 2) * 10 })
      .eq("id", section.id);

    if (updateError) {
      console.error("QUOTATION SECTION SORT UPDATE ERROR", updateError.message);
      return ((orderedSections.at(-1)?.sort_order ?? 0) + 10);
    }
  }

  return (insertIndex + 1) * 10;
}

async function validParentSectionId(
  quotationId: string,
  parentSectionId: string | null,
) {
  if (!parentSectionId) return null;

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("quotation_sections")
    .select("id,section_kind")
    .eq("id", parentSectionId)
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .maybeSingle<{ id: string; section_kind: string }>();

  if (error) {
    console.error("QUOTATION SECTION PARENT READ ERROR", error.message);
    return null;
  }

  return data?.section_kind === "main" ? data.id : null;
}

export async function createQuotationSection(formData: FormData) {
  const { user } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionTitle = textValue(formData, "section_title");
  const sectionKind = allowedText(formData, "section_kind", sectionKinds, "sub");
  const requestedParentSectionId = sectionKind === "sub"
    ? optionalTextValue(formData, "parent_section_id")
    : null;
  const insertAfterSectionId = optionalTextValue(formData, "insert_after_section_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotation_sections").insert({
    quotation_id: quotationId,
    section_title: sectionTitle,
    section_notes: optionalTextValue(formData, "section_notes"),
    section_type: allowedText(formData, "section_type", sectionTypes, "section"),
    parent_section_id: await validParentSectionId(quotationId, requestedParentSectionId),
    section_kind: sectionKind,
    title_align: allowedText(formData, "title_align", titleAlignments, "center"),
    title_bold: formData.has("title_bold") ? boolValue(formData, "title_bold") : true,
    title_bg: allowedText(
      formData,
      "title_bg",
      titleBackgrounds,
      sectionKind === "main" ? "dark_grey" : "light_grey",
    ),
    title_size: allowedText(
      formData,
      "title_size",
      titleSizes,
      sectionKind === "main" ? "large" : "normal",
    ),
    row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
    sort_order: insertAfterSectionId
      ? await sectionInsertSortOrder(quotationId, insertAfterSectionId)
      : formData.has("sort_order")
        ? integerValue(formData, "sort_order", 0)
        : await sectionInsertSortOrder(quotationId, null),
    is_active: boolValue(formData, "is_active"),
    created_by: user.id,
  });

  if (error) {
    console.error("QUOTATION SECTION CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be created.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Section created.");
}

export async function updateQuotationSection(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const sectionTitle = textValue(formData, "section_title");
  const sectionKind = allowedText(formData, "section_kind", sectionKinds, "sub");
  const requestedParentSectionId = sectionKind === "sub"
    ? optionalTextValue(formData, "parent_section_id")
    : null;
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Section id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_sections")
    .update({
      section_title: sectionTitle,
      section_notes: optionalTextValue(formData, "section_notes"),
      section_type: allowedText(formData, "section_type", sectionTypes, "section"),
      parent_section_id: await validParentSectionId(quotationId, requestedParentSectionId),
      section_kind: sectionKind,
      title_align: allowedText(formData, "title_align", titleAlignments, "center"),
      title_bold: boolValue(formData, "title_bold"),
      title_bg: allowedText(formData, "title_bg", titleBackgrounds, "light_grey"),
      title_size: allowedText(formData, "title_size", titleSizes, "normal"),
      row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
      sort_order: integerValue(formData, "sort_order", 0),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION SECTION UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be updated.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Section updated.");
}

export async function deactivateQuotationSection(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Section id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: section, error: sectionReadError } = await supabase
    .from("quotation_sections")
    .select("id,section_title")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string; section_title: string | null }>();

  if (sectionReadError || !section) {
    console.error("QUOTATION SECTION DEACTIVATE READ ERROR", sectionReadError?.message);
    redirectWithMessage(redirectPath, "Section could not be deactivated.");
  }

  const { error } = await supabase
    .from("quotation_sections")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION SECTION DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be deactivated.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_section",
    entityId: section.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "deleted",
    title: "Section removed",
    description: quotationSectionAuditLabel(section.section_title),
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageAndParams(redirectPath, "Section deactivated.", {
    undo_kind: "section",
    undo_section_id: section.id,
  });
}

export async function createQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const payload = itemPayload(formData, user.id);
  payload.currency = "AED";
  const redirectPath = returnPath(formData, `/quotations/${payload.quotation_id}`);

  if (!payload.quotation_id) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  if (
    !itemTypes.has(payload.item_type) ||
    !discountTypes.has(payload.discount_type) ||
    !discountTypes.has(payload.margin_type) ||
    !lineStyles.has(payload.line_style)
  ) {
    redirectWithMessage(redirectPath, "Select valid item settings.");
  }

  const supabase = await createSupabaseClient();
  const { data: createdItem, error } = await supabase
    .from("quotation_items")
    .insert(payload)
    .select("id,item_name_snapshot")
    .single<{ id: string; item_name_snapshot: string | null }>();

  if (error || !createdItem) {
    console.error("QUOTATION ITEM CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be created.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: createdItem.id,
    parentEntityType: "quotation",
    parentEntityId: payload.quotation_id,
    action: "quotation_item_added",
    title: "Product added to quotation",
    description: quotationItemAuditLabel(createdItem.item_name_snapshot),
    metadata: {
      itemName: createdItem.item_name_snapshot,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(payload.quotation_id);
  revalidatePath(`/quotations/${payload.quotation_id}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Line item created.");
}

export async function createBlankQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionId = optionalTextValue(formData, "section_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder`);

  if (!quotationId) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const result = await createBlankQuotationItemRecord({
    displayName,
    formData,
    quotationId,
    sectionId,
    userId: user.id,
  });

  if (!result.ok) {
    redirectWithMessage(redirectPath, result.message);
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirect(pathWithParams(redirectPath, {
    message: "Blank row added.",
  }) + `#item-${result.itemId}`);
}

async function createBlankQuotationItemRecord({
  displayName,
  formData,
  quotationId,
  sectionId,
  userId,
}: {
  displayName: string;
  formData: FormData;
  quotationId: string;
  sectionId: string | null;
  userId: string;
}) {
  if (sectionId && !(await sectionBelongsToQuotation(sectionId, quotationId))) {
    return { ok: false as const, message: "Destination section was not found." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    quotation_id: quotationId,
    section_id: sectionId,
    item_type: "custom",
    manual_serial: null,
    item_code_snapshot: null,
    item_name_snapshot: null,
    specified_image_url_snapshot: null,
    proposed_image_url_snapshot: null,
    specification_snapshot: null,
    finish_selections_snapshot: [],
    room_name_snapshot: null,
    model_snapshot: null,
    finish_snapshot: null,
    size_snapshot: null,
    origin_snapshot: null,
    warranty_snapshot: null,
    supplier_name_snapshot: null,
    supplier_notes_snapshot: null,
    allow_material_continuation_page: false,
    qty: 1,
    unit_label: "Pc",
    unit_price: 0,
    discount_type: "amount",
    discount_value: 0,
    net_price: 0,
    net_total: 0,
    currency: "AED",
    sort_order: await nextSortOrder(quotationId, sectionId),
    is_optional: false,
    internal_cost: 0,
    margin_type: "amount",
    margin_value: 0,
    is_rate_only: false,
    line_style: "normal",
    row_height: null,
    cell_layout: cellLayoutValue(formData),
    is_active: true,
    notes: null,
    created_by: userId,
  };

  const { data: createdItem, error } = await supabase
    .from("quotation_items")
    .insert(payload)
    .select("id,item_name_snapshot")
    .single<{ id: string; item_name_snapshot: string | null }>();

  if (error || !createdItem) {
    console.error("BLANK QUOTATION ITEM CREATE ERROR", error?.message);
    return { ok: false as const, message: "Blank row could not be created." };
  }

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: createdItem.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "quotation_item_added",
    title: "Product added to quotation",
    description: quotationItemAuditLabel(createdItem.item_name_snapshot),
    metadata: {
      itemName: createdItem.item_name_snapshot,
      source: "blank_manual_row",
    },
    actorName: displayName,
    createdBy: userId,
  });

  return { ok: true as const, itemId: createdItem.id };
}

export async function createBlankQuotationItemOptimistic(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionId = optionalTextValue(formData, "section_id");

  if (!quotationId) {
    return { ok: false as const, message: "Quotation is required." };
  }

  const result = await createBlankQuotationItemRecord({
    displayName,
    formData,
    quotationId,
    sectionId,
    userId: user.id,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true as const,
    itemId: result.itemId,
    message: "Blank row added.",
  };
}

export async function addProductTemplateToQuotation(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionId = textValue(formData, "section_id");
  const templateId = textValue(formData, "template_id");
  const selectedTemplateImagePath = optionalTextValue(formData, "selected_template_image_path");
  const accessoryQtyById = accessoryQuantities(formData);
  const accessoryPricingQtyById = accessoryPricingQuantities(formData);
  const linkedProductSelectionInputs = linkedProductSelections(formData);
  const exchangeRateByCurrency = currencyExchangeRates(formData);
  const additionalClusterQty = deskingAdditionalClusterQty(formData);
  const selectedComponentIds = Array.from(
    new Set(
      formData
        .getAll("selected_component_id")
        .filter((value): value is string => typeof value === "string" && Boolean(value)),
    ),
  );
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId || !sectionId || !templateId) {
    redirectWithMessage(redirectPath, "Quotation, section, and product are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: section, error: sectionError } = await supabase
    .from("quotation_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  if (sectionError || !section) {
    console.error("PRODUCT TEMPLATE ADD SECTION ERROR", sectionError?.message);
    redirectWithMessage(redirectPath, "Section could not be loaded.");
  }

  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select(
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,image_settings,unit_label,currency,default_unit_price",
    )
    .eq("id", templateId)
    .eq("is_active", true)
    .eq("lifecycle_status", "active")
    .single<ProductTemplateSnapshotSource>();

  if (templateError || !template) {
    console.error("PRODUCT TEMPLATE ADD READ ERROR", templateError?.message);
    redirectWithMessage(redirectPath, "Product template could not be loaded.");
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("name,origin")
    .eq("id", template.brand_id)
    .eq("is_active", true)
    .maybeSingle<{ name: string; origin: string | null }>();

  const categoryIds = [template.main_category_id, template.sub_category_id].filter(
    (value): value is string => Boolean(value),
  );
  const { data: categories } = categoryIds.length
    ? await supabase
        .from("product_categories")
        .select("id,name")
        .eq("is_active", true)
        .in("id", categoryIds)
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] };
  const categoryNameById = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const categoryName = [
    template.main_category_id ? categoryNameById.get(template.main_category_id) : null,
    template.sub_category_id ? categoryNameById.get(template.sub_category_id) : null,
  ].filter(Boolean).join(" / ");
  const { data: selectedComponents, error: selectedComponentsError } = selectedComponentIds.length
    ? await supabase
        .from("product_components")
        .select("id,template_id,option_type,component_group,component_code,component_name,description,qty,unit_label,unit_price,currency,calculation_data")
        .eq("template_id", templateId)
        .eq("is_active", true)
        .in("id", selectedComponentIds)
        .returns<ProductComponentSnapshotSource[]>()
    : { data: [], error: null };

  if (selectedComponentsError) {
    console.error("PRODUCT TEMPLATE ADD OPTIONS ERROR", selectedComponentsError.message);
    redirectWithMessage(redirectPath, "Product options could not be loaded.");
  }

  const selectedLinkedIds = linkedProductSelectionInputs.map((selection) => selection.linkId);
  const { data: linkedFamilies, error: linkedFamiliesError } = selectedLinkedIds.length
    ? await supabase
        .from("product_template_linked_families")
        .select("id,parent_template_id,linked_template_id,label,is_required,allow_multiple,add_to_parent_price,append_to_specification,default_qty,sort_order,is_active")
        .eq("parent_template_id", templateId)
        .eq("is_active", true)
        .in("id", selectedLinkedIds)
        .returns<LinkedProductFamilySource[]>()
    : { data: [], error: null };

  if (linkedFamiliesError) {
    console.error("PRODUCT TEMPLATE ADD LINKED FAMILIES ERROR", linkedFamiliesError.message);
    redirectWithMessage(redirectPath, "Linked product families could not be loaded.");
  }

  const linkedTemplateIds = Array.from(new Set((linkedFamilies ?? []).map((link) => link.linked_template_id)));
  const { data: linkedTemplates, error: linkedTemplatesError } = linkedTemplateIds.length
    ? await supabase
        .from("product_templates")
        .select(
          "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,image_settings,unit_label,currency,default_unit_price",
        )
        .eq("is_active", true)
        .eq("lifecycle_status", "active")
        .in("id", linkedTemplateIds)
        .returns<ProductTemplateSnapshotSource[]>()
    : { data: [], error: null };

  if (linkedTemplatesError) {
    console.error("PRODUCT TEMPLATE ADD LINKED TEMPLATES ERROR", linkedTemplatesError.message);
    redirectWithMessage(redirectPath, "Linked product templates could not be loaded.");
  }

  const selectedOptions = selectedComponents ?? [];
  const originSnapshot = template.origin ?? brand?.origin ?? null;
  const supplierNameSnapshot = template.supplier_name ?? brand?.name ?? null;
  const selectedVariantPricingRow = selectedVariantPricing(formData, template.variant_pricing);
  const selectedCategoryPricingRow = selectedVariantPricingRow
    ? null
    : selectedCategoryPricing(formData, template.category_pricing);
  const selectedSizePricing = selectedVariantPricingRow || selectedCategoryPricingRow
    ? null
    : selectedDeskingSize(formData, template.desking_size_pricing);
  const selectedCategory = textValue(formData, "category_pricing_category") || "Cat A";
  const selectedCategoryPrice = selectedCategoryPricingRow
    ? money(calculationNumber(selectedCategoryPricingRow.prices?.[selectedCategory]))
    : 0;
  const isDesking =
    (!selectedVariantPricingRow && !selectedCategoryPricingRow && /workstation|desking/.test(categoryName.toLowerCase())) ||
    Boolean(selectedSizePricing) ||
    (!selectedVariantPricingRow && !selectedCategoryPricingRow && selectedOptions.some((option) => Boolean(deskingRole(option))));
  const derivedDesking = isDesking && selectedSizePricing
    ? deskingSizePricingSnapshot({
        accessoryQtyById,
        additionalClusterQty,
        baseText:
          template.default_specification ??
          template.description ??
          template.template_name,
        selectedSize: selectedSizePricing,
        template,
        selectedOptions,
      })
    : null;
  const selectedOptionNames = selectedOptions.map((option) => option.component_name);
  const selectedFinishOptions = selectedOptions
    .filter((option) => option.option_type === "material_finish" || option.option_type === "fabric_category")
    .map((option) => option.component_name);
  const selectedSizeOptions = selectedOptions
    .filter((option) => option.option_type === "size_variant")
    .map((option) => option.component_name);
  const selectedClusterOptions = selectedOptions
    .filter((option) => option.option_type === "cluster_preset")
    .map((option) => option.component_name);
  const selectedOptionPrice = money(
    selectedOptions.reduce((total, option) => {
      const optionQty = Number.isFinite(option.qty) && option.qty > 0 ? option.qty : 1;
      const optionPrice =
        Number.isFinite(option.unit_price) && option.unit_price > 0 ? option.unit_price : 0;

      return total + optionQty * optionPrice;
    }, 0),
  );
  const rowCurrency = normalizeCurrency(
    derivedDesking?.mainCurrency ||
    selectedCategoryPricingRow?.currency ||
    selectedVariantPricingRow?.currency ||
    template.currency ||
    defaultCurrency,
  );
  const selectedAccessoryPricing = activeAccessoryRows(template.accessory_pricing)
    .flatMap((group) =>
      group.items.map((accessory) => {
        const id = accessory.id ?? accessory.item_name ?? "";

        return {
          type: "add_on",
          item_type: "add_on",
          id,
          group_name: group.group_name,
          item_name: accessory.item_name ?? "",
          qty: accessoryPricingQtyById.get(id) ?? 0,
          price: calculationNumber(accessory.price),
          currency: normalizeCurrency(accessory.currency ?? rowCurrency),
          specification: accessory.specification ?? "",
        };
      }),
    )
    .filter((accessory) => accessory.qty > 0);
  const matchingAccessoryTotal = money(
    selectedAccessoryPricing
      .filter((accessory) => accessory.currency === rowCurrency)
      .reduce((total, accessory) => total + accessory.qty * accessory.price, 0),
  );
  const linkedFamilyById = new Map((linkedFamilies ?? []).map((link) => [link.id, link]));
  const linkedTemplateById = new Map((linkedTemplates ?? []).map((linkedTemplate) => [linkedTemplate.id, linkedTemplate]));
  const selectedLinkedProducts = linkedProductSelectionInputs
    .map((selection) => {
      const link = linkedFamilyById.get(selection.linkId);
      const linkedTemplate = link ? linkedTemplateById.get(link.linked_template_id) : null;

      if (!link || !linkedTemplate) return null;

      const categoryRow = activeCategoryRows(linkedTemplate.category_pricing)
        .find((row) => row.id === selection.categoryRowId) ??
        activeCategoryRows(linkedTemplate.category_pricing)[0] ??
        null;
      const variantRow = categoryRow
        ? null
        : activeVariantRows(linkedTemplate.variant_pricing)
            .find((row) => row.id === selection.variantRowId) ??
          activeVariantRows(linkedTemplate.variant_pricing)[0] ??
          null;
      const selectedCategoryLabel = selection.category || "Cat A";
      const unitPrice = categoryRow
        ? money(calculationNumber(categoryRow.prices?.[selectedCategoryLabel]))
        : variantRow
          ? money(calculationNumber(variantRow.price))
          : money(linkedTemplate.default_unit_price ?? 0);
      const currency = normalizeCurrency(
        categoryRow?.currency ||
        variantRow?.currency ||
        linkedTemplate.currency ||
        defaultCurrency,
      );
      const specification =
        categoryRow?.specification ||
        variantRow?.specification ||
        linkedTemplate.default_specification ||
        linkedTemplate.description ||
        "";

      return {
        type: "linked_product_family",
        label: link.label || linkedTemplate.template_name,
        linked_template_id: linkedTemplate.id,
        template_name: linkedTemplate.template_name,
        selected_variant: categoryRow?.variant_name || variantRow?.variant_name || null,
        selected_category: categoryRow ? selectedCategoryLabel : null,
        qty: selection.qty,
        unit_price: unitPrice,
        currency,
        line_total: money(unitPrice * selection.qty),
        specification,
        add_to_parent_price: link.add_to_parent_price,
        append_to_specification: link.append_to_specification,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const matchingLinkedProductsTotal = money(
    selectedLinkedProducts
      .filter((item) => item.add_to_parent_price && item.currency === rowCurrency)
      .reduce((total, item) => total + item.line_total, 0),
  );

  const { data: lastItem } = await supabase
    .from("quotation_items")
    .select("sort_order")
    .eq("quotation_id", quotationId)
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const baseUnitPrice = derivedDesking
    ? derivedDesking.unitPrice || money(template.default_unit_price ?? 0)
    : selectedCategoryPricingRow
      ? selectedCategoryPrice
      : selectedVariantPricingRow
        ? money(calculationNumber(selectedVariantPricingRow.price))
        : money((template.default_unit_price ?? 0) + selectedOptionPrice);
  const originalCurrencyTotals = new Map<string, number>();
  const addCurrencyTotal = (currency: string, amount: number) => {
    const normalizedCurrency = normalizeCurrency(currency || defaultCurrency);
    originalCurrencyTotals.set(
      normalizedCurrency,
      money((originalCurrencyTotals.get(normalizedCurrency) ?? 0) + amount),
    );
  };

  addCurrencyTotal(rowCurrency, baseUnitPrice);
  for (const accessory of selectedAccessoryPricing) {
    addCurrencyTotal(accessory.currency, accessory.qty * accessory.price);
  }
  for (const linkedProduct of selectedLinkedProducts) {
    if (linkedProduct.add_to_parent_price) {
      addCurrencyTotal(linkedProduct.currency, linkedProduct.line_total);
    }
  }

  const nonAedCurrencies = Array.from(originalCurrencyTotals.entries())
    .filter(([currency, amount]) => currency !== "AED" && amount > 0)
    .map(([currency]) => currency);

  for (const currency of nonAedCurrencies) {
    if (!exchangeRateByCurrency.get(currency)) {
      redirectWithMessage(redirectPath, `Enter ${currency} to AED exchange rate before adding this product.`);
    }
  }

  const convertedUnitPrice = money(
    Array.from(originalCurrencyTotals.entries()).reduce((total, [currency, amount]) => {
      if (currency === "AED") return total + amount;

      return total + amount * (exchangeRateByCurrency.get(currency) ?? 0);
    }, 0),
  );
  const rawUnitPrice = nonAedCurrencies.length
    ? convertedUnitPrice
    : money(baseUnitPrice + matchingAccessoryTotal + matchingLinkedProductsTotal);
  const unitPrice = quotationMoneyValue(rawUnitPrice);
  const rowOutputCurrency = nonAedCurrencies.length ? "AED" : rowCurrency;
  const currencyConversionData = nonAedCurrencies.length
    ? {
        target_currency: "AED",
        original_totals: Object.fromEntries(originalCurrencyTotals),
        rates: Object.fromEntries(
          nonAedCurrencies.map((currency) => [currency, exchangeRateByCurrency.get(currency)]),
        ),
        converted_total: rawUnitPrice,
        rounded_converted_total: unitPrice,
      }
    : null;
  const requestedDiscountType = textValue(formData, "product_library_discount_type");
  const discountType = requestedDiscountType === "percent" ? "percent" : "amount";
  const rawDiscountValue =
    requestedDiscountType === "none"
      ? 0
      : Math.max(numberValue(formData, "product_library_discount_value", 0), 0);
  const rawDiscountValueForType = discountType === "percent"
    ? Math.min(rawDiscountValue, 100)
    : rawDiscountValue;
  const linePricing = roundedLinePricing(unitPrice, discountType, rawDiscountValueForType);
  const discountValue = linePricing.discountValue;
  const unitDiscountAmount = linePricing.discountAmount;
  const netPrice = linePricing.netPrice;
  const pricingAdjustmentData = {
    discount_type: requestedDiscountType === "none" ? "none" : discountType,
    discount_value: requestedDiscountType === "none" ? 0 : discountValue,
    unit_discount_amount: unitDiscountAmount,
  };
  const sourceSelectedOptionsPrice =
    selectedAccessoryPricing.length || selectedLinkedProducts.length || currencyConversionData
      ? unitPrice
      : baseUnitPrice;
  const proposedImageFields = [
    "proposed_image_url_1",
    "proposed_image_url_2",
    "proposed_image_url_3",
  ] as const;
  const availableProposedImages = proposedImageFields
    .map((field) => ({
      field,
      path:
        field === "proposed_image_url_1"
          ? template.proposed_image_url_1 ?? template.default_image_url
          : template[field],
    }))
    .filter((image): image is { field: (typeof proposedImageFields)[number]; path: string } =>
      Boolean(image.path),
    );
  const proposedImages = availableProposedImages.map((image) => image.path);
  const selectedProposedImage =
    selectedTemplateImagePath && proposedImages.includes(selectedTemplateImagePath)
      ? selectedTemplateImagePath
      : proposedImages[0] ?? null;
  const selectedImageField =
    availableProposedImages.find((image) => image.path === selectedProposedImage)?.field ??
    null;
  const selectedImageSettings = selectedImageField
    ? template.image_settings?.[selectedImageField] ??
      (selectedImageField === "proposed_image_url_1"
        ? template.image_settings?.default_image_url
        : undefined)
    : undefined;
  const proposedImagePath = productImageSnapshotPath(selectedProposedImage);
  const baseSpecification = template.default_specification ?? template.description ?? "";
  const specification = derivedDesking?.specification ||
    selectedCategoryPricingRow?.specification ||
    selectedVariantPricingRow?.specification ||
    (selectedOptionNames.length
    ? [baseSpecification, `Selected options: ${selectedOptionNames.join(", ")}`]
        .filter(Boolean)
        .join("\n")
    : baseSpecification || null);
  const accessoryNamesByGroup = new Map<string, string[]>();
  for (const accessory of selectedAccessoryPricing) {
    if (!accessory.item_name) continue;

    accessoryNamesByGroup.set(accessory.group_name, [
      ...(accessoryNamesByGroup.get(accessory.group_name) ?? []),
      accessory.item_name,
    ]);
  }
  const accessorySpecificationLines = Array.from(accessoryNamesByGroup.entries()).map(
    ([groupName, names]) => `${groupName}: ${names.join(", ")}`,
  );
  const linkedProductSpecificationLines = selectedLinkedProducts
    .filter((item) => item.append_to_specification)
    .map((item) => {
      const parts = [
        item.template_name,
        item.selected_variant,
        item.selected_category,
        `Qty ${item.qty}`,
      ].filter(Boolean);

      return `${item.label}: ${parts.join(", ")}`;
    });
  const specificationWithAccessories = accessorySpecificationLines.length || linkedProductSpecificationLines.length
    ? [specification, ...accessorySpecificationLines, ...linkedProductSpecificationLines]
        .filter(Boolean)
        .join("\n")
    : specification;
  const snapshotSelectedOptions = derivedDesking
    ? [
        {
          item_type: "desking_size",
          label: derivedDesking.sizeLabel,
          additional_qty: derivedDesking.additionalClusterQty,
          dimension: derivedDesking.dimension,
          default_price: derivedDesking.basePrice,
          additional_price: derivedDesking.additionalUnitPrice,
          final_price: derivedDesking.unitPrice,
        },
        ...derivedDesking.selectedOptions,
      ]
    : selectedOptions;
  const variantSnapshot = selectedVariantPricingRow
    ? {
        item_type: "variant_pricing",
        selected_variant: selectedVariantPricingRow,
      }
    : null;
  const categorySnapshot = selectedCategoryPricingRow
    ? {
        item_type: "category_pricing",
        selected_variant: selectedCategoryPricingRow,
        selected_category: selectedCategory,
        selected_price: selectedCategoryPrice,
      }
    : null;
  const finalSelectedOptions = categorySnapshot
    ? [categorySnapshot, ...snapshotSelectedOptions]
    : variantSnapshot
      ? [variantSnapshot, ...snapshotSelectedOptions]
      : snapshotSelectedOptions;
  const finalSelectedOptionsWithAccessories = selectedAccessoryPricing.length
    ? [...finalSelectedOptions, ...selectedAccessoryPricing]
    : finalSelectedOptions;
  const finalSelectedOptionsWithLinkedProducts = selectedLinkedProducts.length
    ? [...finalSelectedOptionsWithAccessories, ...selectedLinkedProducts]
    : finalSelectedOptionsWithAccessories;
  const deskingSourceData = derivedDesking
    ? {
        size_label: derivedDesking.sizeLabel,
        cluster_label: derivedDesking.clusterLabel,
        additional_qty: derivedDesking.additionalClusterQty,
        total_seats: derivedDesking.totalSeats,
        total_modules: derivedDesking.totalModules,
        dimension: derivedDesking.dimension,
        default_price: derivedDesking.basePrice,
        additional_price: derivedDesking.additionalUnitPrice,
        additional_total: derivedDesking.additionalClusterPrice,
        accessory_price: derivedDesking.accessoryPrice,
        final_price: derivedDesking.unitPrice,
      }
    : null;
  const originalSourceTotals = Array.from(originalCurrencyTotals.entries())
    .map(([currency, amount]) => [normalizeCurrency(currency), money(amount)] as const)
    .filter(([, amount]) => amount > 0);
  const singleOriginalSourceTotal = originalSourceTotals.length === 1 ? originalSourceTotals[0] : null;
  const baseSourcePriceType = derivedDesking
    ? "desking_size_pricing"
    : selectedCategoryPricingRow
      ? "category_pricing"
      : selectedVariantPricingRow
        ? "variant_pricing"
        : selectedOptions.length
          ? "component_options"
          : "template_default";
  const sourcePriceLabel = derivedDesking
    ? [derivedDesking.sizeLabel, derivedDesking.clusterLabel].filter(Boolean).join(" / ")
    : selectedCategoryPricingRow
      ? [selectedCategoryPricingRow.variant_name, selectedCategory].filter(Boolean).join(" / ")
      : selectedVariantPricingRow
        ? [selectedVariantPricingRow.variant_name, selectedVariantPricingRow.dimension].filter(Boolean).join(" / ")
        : selectedOptions.length
          ? selectedOptionNames.join(", ")
          : template.template_name;
  const sourcePriceKey = derivedDesking
    ? derivedDesking.sizeLabel
    : selectedCategoryPricingRow
      ? [selectedCategoryPricingRow.id, selectedCategory].filter(Boolean).join(":")
      : selectedVariantPricingRow
        ? selectedVariantPricingRow.id
        : selectedOptions.length
          ? selectedOptions.map((option) => option.id).filter(Boolean).join(",")
          : template.id;
  const sourcePriceReference = {
    original_source_price: singleOriginalSourceTotal?.[1] ?? null,
    original_source_currency: singleOriginalSourceTotal?.[0] ?? null,
    original_source_totals: Object.fromEntries(originalSourceTotals),
    source_price_type: baseSourcePriceType,
    source_price_label: sourcePriceLabel || null,
    source_price_key: sourcePriceKey || null,
    converted_quotation_price: unitPrice,
    quotation_currency: rowOutputCurrency,
  };
  const payload = {
    quotation_id: quotationId,
    section_id: sectionId,
    item_type: "product",
    source_template_id: template.id,
    source_component_data: {
      template_code: template.template_code,
      template_name: template.template_name,
      brand_id: template.brand_id,
      brand_name: brand?.name ?? null,
      origin: originSnapshot,
      supplier_name: supplierNameSnapshot,
      main_category_id: template.main_category_id,
      main_category_name: template.main_category_id
        ? categoryNameById.get(template.main_category_id) ?? null
        : null,
      sub_category_id: template.sub_category_id,
      sub_category_name: template.sub_category_id
        ? categoryNameById.get(template.sub_category_id) ?? null
        : null,
      default_image_url: template.default_image_url,
      reference_image_url: template.reference_image_url,
      proposed_image_url_1: template.proposed_image_url_1,
      proposed_image_url_2: template.proposed_image_url_2,
      proposed_image_url_3: template.proposed_image_url_3,
      selected_proposed_image_url: selectedProposedImage,
      selected_options: finalSelectedOptionsWithLinkedProducts,
      selected_options_price: sourceSelectedOptionsPrice,
      source_price_reference: sourcePriceReference,
      ...(deskingSourceData ? { desking: deskingSourceData } : {}),
      ...(selectedVariantPricingRow ? { variant_pricing: selectedVariantPricingRow } : {}),
      ...(selectedCategoryPricingRow
        ? {
            category_pricing: {
              selected_row: selectedCategoryPricingRow,
              selected_category: selectedCategory,
              selected_price: selectedCategoryPrice,
            },
          }
        : {}),
      ...(selectedAccessoryPricing.length
        ? {
            add_ons: {
              groups: Array.from(
                selectedAccessoryPricing.reduce((groups, item) => {
                  const currentItems = groups.get(item.group_name) ?? [];
                  groups.set(item.group_name, [...currentItems, item]);
                  return groups;
                }, new Map<string, typeof selectedAccessoryPricing>()),
              ).map(([group_name, items]) => ({ group_name, items })),
              matching_currency_total: matchingAccessoryTotal,
              mixed_currency_warning: selectedAccessoryPricing.some(
                (item) => item.currency !== rowCurrency,
              ),
            },
          }
        : {}),
      ...(selectedLinkedProducts.length
        ? {
            linked_products: {
              items: selectedLinkedProducts,
              matching_currency_total: matchingLinkedProductsTotal,
              mixed_currency_warning: selectedLinkedProducts.some(
                (item) => item.add_to_parent_price && item.currency !== rowCurrency,
              ),
            },
          }
        : {}),
      ...(currencyConversionData ? { currency_conversion: currencyConversionData } : {}),
      pricing_adjustment: pricingAdjustmentData,
    },
    item_code_snapshot: template.item_code ?? template.template_code,
    item_name_snapshot: template.template_name,
    brand_name_snapshot: brand?.name ?? null,
    category_name_snapshot: categoryName || null,
    specified_image_url_snapshot: null,
    proposed_image_url_snapshot: proposedImagePath,
    specification_snapshot: specificationWithAccessories,
    finish_selections_snapshot: finishSelectionsValue(formData),
    selected_options_snapshot: finalSelectedOptionsWithLinkedProducts,
    model_snapshot: derivedDesking
      ? `Cluster of ${derivedDesking.totalSeats}`
      : selectedCategoryPricingRow?.variant_name ||
        selectedVariantPricingRow?.variant_name ||
        selectedClusterOptions.join(", ") ||
        null,
    finish_snapshot: selectedCategoryPricingRow
      ? selectedCategory
      : derivedDesking?.finishOptions.join(", ") || selectedFinishOptions.join(", ") || null,
    size_snapshot: derivedDesking?.dimensionValue ||
      selectedCategoryPricingRow?.dimension ||
      selectedVariantPricingRow?.dimension ||
      selectedSizeOptions.join(", ") ||
      null,
    origin_snapshot: originSnapshot,
    supplier_name_snapshot: supplierNameSnapshot,
    allow_material_continuation_page: boolValue(formData, "allow_material_continuation_page"),
    qty: 1,
    unit_label: template.unit_label || "Pc",
    unit_price: unitPrice,
    discount_type: discountType,
    discount_value: discountValue,
    net_price: netPrice,
    net_total: linePricing.netTotal,
    currency: rowOutputCurrency,
    sort_order: (lastItem?.sort_order ?? 0) + 10,
    is_optional: false,
    internal_cost: 0,
    margin_type: "amount",
    margin_value: 0,
    is_rate_only: false,
    line_style: "normal",
    cell_layout: selectedImageSettings
      ? { images: { proposed_image_url_snapshot: selectedImageSettings } }
      : {},
    is_active: true,
    created_by: user.id,
  };

  const { data: createdItem, error } = await supabase
    .from("quotation_items")
    .insert(payload)
    .select("id,item_name_snapshot")
    .single<{ id: string; item_name_snapshot: string | null }>();

  if (error || !createdItem) {
    console.error("PRODUCT TEMPLATE ADD ITEM ERROR", error?.message);
    redirectWithMessage(redirectPath, "Product could not be added to quotation.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: createdItem.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "quotation_item_added",
    title: "Product added to quotation",
    description: quotationItemAuditLabel(createdItem.item_name_snapshot),
    metadata: {
      itemName: createdItem.item_name_snapshot,
      sourceTemplateId: template.id,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Product added to quotation.");
}

export async function updateQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = itemPayload(formData);
  const redirectPath = returnPath(formData, `/quotations/${payload.quotation_id}/builder#item-${id}`);

  if (!id || !payload.quotation_id) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  if (
    !itemTypes.has(payload.item_type) ||
    !discountTypes.has(payload.discount_type) ||
    !discountTypes.has(payload.margin_type) ||
    !lineStyles.has(payload.line_style)
  ) {
    redirectWithMessage(redirectPath, "Select valid item settings.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,source_template_id,source_component_data,item_name_snapshot,unit_price,currency,discount_value,net_price,net_total")
    .eq("id", id)
    .eq("quotation_id", payload.quotation_id)
    .single<QuotationItemPriceState>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM UPDATE READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Line item could not be loaded.");
  }

  if (!currentItem.source_template_id) {
    payload.currency = "AED";
  }

  const nextPriceValues = {
    currency: payload.currency,
    discount_value: payload.discount_value,
    net_price: payload.net_price,
    net_total: payload.net_total,
    unit_price: payload.unit_price,
  };
  const { error } = await supabase.from("quotation_items").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be updated.");
  }

  await insertQuotationItemPriceHistory({
    changeType: "manual",
    changedBy: user.id,
    actorName: displayName,
    current: currentItem,
    newValues: nextPriceValues,
    note: "Updated row price manually.",
    supabase,
  });

  await recalculateQuotationTotals(payload.quotation_id);
  revalidatePath(`/quotations/${payload.quotation_id}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Line item updated.");
}

export async function applyManualCurrencyConversion(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const quotationItemId = textValue(formData, "quotation_item_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${quotationItemId}`);

  if (!quotationId || !quotationItemId) {
    redirectWithMessage("/quotations", "Quotation row is required.");
  }

  const sourceCurrency = normalizeCurrency(textValue(formData, "source_currency") || defaultCurrency);
  const sourcePrice = Math.max(numberValue(formData, "source_price", 0), 0);
  const requestedRate = Math.max(numberValue(formData, "conversion_rate", 0), 0);
  const conversionRate = sourceCurrency === "AED" ? 1 : requestedRate;

  if (!manualConversionCurrencies.has(sourceCurrency)) {
    redirectWithMessage(redirectPath, "Select a valid source currency.");
  }

  if (sourcePrice <= 0) {
    redirectWithMessage(redirectPath, "Enter a valid source price.");
  }

  if (sourceCurrency !== "AED" && conversionRate <= 0) {
    redirectWithMessage(redirectPath, "Enter a valid conversion rate to AED.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,item_type,source_template_id,source_component_data,item_name_snapshot,qty,unit_price,currency,discount_type,discount_value,net_price,net_total,is_active")
    .eq("id", quotationItemId)
    .eq("quotation_id", quotationId)
    .single<{
      id: string;
      quotation_id: string;
      item_type: string;
      source_template_id: string | null;
      source_component_data: unknown;
      item_name_snapshot: string | null;
      qty: number;
      unit_price: number;
      currency: string;
      discount_type: string;
      discount_value: number;
      net_price: number;
      net_total: number;
      is_active: boolean;
    }>();

  if (readError || !currentItem || !currentItem.is_active) {
    console.error("MANUAL CURRENCY CONVERSION READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Quotation row could not be loaded.");
  }

  if (currentItem.source_template_id || !["product", "custom"].includes(currentItem.item_type)) {
    redirectWithMessage(redirectPath, "Manual currency conversion is available for manual quotation rows only.");
  }

  const convertedUnitPrice = quotationMoneyValue(sourcePrice * conversionRate);
  const linePricing = roundedLinePricing(
    convertedUnitPrice,
    currentItem.discount_type,
    currentItem.discount_value,
    currentItem.qty,
  );
  const nextSourceComponentData = manualConversionSourceComponentData({
    convertedPrice: linePricing.unitPrice,
    conversionRate,
    currentSourceData: currentItem.source_component_data,
    sourceCurrency,
    sourcePrice,
  });
  const nextPriceValues = {
    currency: "AED",
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    unit_price: linePricing.unitPrice,
  };

  const { error: updateError } = await supabase
    .from("quotation_items")
    .update({
      currency: "AED",
      discount_value: linePricing.discountValue,
      net_price: linePricing.netPrice,
      net_total: linePricing.netTotal,
      source_component_data: nextSourceComponentData,
      unit_price: linePricing.unitPrice,
    })
    .eq("id", quotationItemId);

  if (updateError) {
    console.error("MANUAL CURRENCY CONVERSION UPDATE ERROR", updateError.message);
    redirectWithMessage(redirectPath, "Manual currency conversion could not be applied.");
  }

  await insertQuotationItemPriceHistory({
    changeType: "other",
    changedBy: user.id,
    actorName: displayName,
    current: currentItem,
    newValues: nextPriceValues,
    note: `Converted manual source price ${sourceCurrency} ${preciseDecimalValue(sourcePrice, 2)} to AED using rate ${preciseDecimalValue(conversionRate, 4)}.`,
    supabase,
  });

  await recalculateQuotationTotals(quotationId);
  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: quotationItemId,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "manual_currency_converted",
    title: "Manual row currency converted",
    description: `${quotationItemAuditLabel(currentItem.item_name_snapshot)} - ${sourceCurrency} ${quotationMoneyValue(sourcePrice)} -> AED ${linePricing.unitPrice}`,
    metadata: {
      manual_conversion_rate: preciseDecimalValue(conversionRate, 4),
      manual_converted_currency: "AED",
      manual_converted_price: linePricing.unitPrice,
      manual_source_currency: sourceCurrency,
      manual_source_price: preciseDecimalValue(sourcePrice, 2),
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Manual currency conversion applied.");
}

export async function updateQuotationItemInline(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${id}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,source_template_id,source_component_data,item_name_snapshot,qty,unit_price,currency,discount_type,discount_value,net_price,net_total,cell_layout")
    .eq("id", id)
    .single<{
      id: string;
      quotation_id: string;
      source_template_id: string | null;
      source_component_data: unknown;
      item_name_snapshot: string | null;
      qty: number;
      unit_price: number;
      currency: string;
      discount_type: string;
      discount_value: number;
      net_price: number;
      net_total: number;
      cell_layout: CellLayoutPayload | null;
    }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM INLINE READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Line item could not be loaded.");
  }

  const payload: Record<string, string | number | CellLayoutPayload | null> = {};
  const textFields = [
    "manual_serial",
    "item_code_snapshot",
    "item_name_snapshot",
    "specified_image_url_snapshot",
    "proposed_image_url_snapshot",
    "specification_snapshot",
    "room_name_snapshot",
    "model_snapshot",
    "finish_snapshot",
    "size_snapshot",
    "origin_snapshot",
    "warranty_snapshot",
    "supplier_name_snapshot",
    "unit_label",
  ];

  for (const field of textFields) {
    if (formData.has(field)) {
      payload[field] = optionalTextValue(formData, field);
    }
  }

  const qty = formData.has("qty")
    ? numberValue(formData, "qty", currentItem.qty)
    : currentItem.qty;
  const rawUnitPrice = formData.has("unit_price")
    ? numberValue(formData, "unit_price", currentItem.unit_price)
    : currentItem.unit_price;
  const rawDiscountValue = formData.has("discount_value")
    ? numberValue(formData, "discount_value", currentItem.discount_value)
    : currentItem.discount_value;
  const linePricing = roundedLinePricing(rawUnitPrice, currentItem.discount_type, rawDiscountValue, qty);

  if (formData.has("qty")) payload.qty = qty;
  if (formData.has("unit_price")) payload.unit_price = linePricing.unitPrice;
  if (formData.has("discount_value")) payload.discount_value = linePricing.discountValue;
  if (formData.has("row_height")) {
    payload.row_height = optionalIntegerInRange(formData, "row_height", 40, 600);
  }
  if (formData.has("merge_mode") || formData.has("cell_style_key")) {
    payload.cell_layout = cellLayoutValue(formData, currentItem.cell_layout);
  }
  payload.net_price = linePricing.netPrice;
  payload.net_total = linePricing.netTotal;

  const nextPriceValues = {
    currency: currentItem.currency,
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    unit_price: linePricing.unitPrice,
  };

  const { error } = await supabase.from("quotation_items").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM INLINE UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be updated.");
  }

  await insertQuotationItemPriceHistory({
    changeType: "manual",
    changedBy: user.id,
    actorName: displayName,
    current: currentItem,
    newValues: nextPriceValues,
    note: "Updated row price manually.",
    supabase,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Row saved.");
}

export async function useCurrentSourcePriceForQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "quotation_item_id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${id}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,is_active")
    .eq("id", quotationId)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (quotationError || !quotation || !quotation.is_active) {
    console.error("USE SOURCE PRICE QUOTATION READ ERROR", quotationError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be loaded.");
  }

  const { data: item, error: itemError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,source_template_id,source_component_data,item_name_snapshot,qty,unit_price,currency,discount_type,discount_value,net_price,net_total,is_active")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .maybeSingle<{
      id: string;
      quotation_id: string;
      source_template_id: string | null;
      source_component_data: unknown;
      item_name_snapshot: string | null;
      qty: number;
      unit_price: number;
      currency: string;
      discount_type: string;
      discount_value: number;
      net_price: number;
      net_total: number;
      is_active: boolean;
    }>();

  if (itemError || !item || !item.is_active) {
    console.error("USE SOURCE PRICE ITEM READ ERROR", itemError?.message);
    redirectWithMessage(redirectPath, "Line item could not be loaded.");
  }

  if (!item.source_template_id) {
    redirectWithMessage(redirectPath, "Line item has no linked source template.");
  }

  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,default_unit_price,currency")
    .eq("id", item.source_template_id)
    .maybeSingle<SourcePriceTemplate>();

  if (templateError || !template) {
    console.error("USE SOURCE PRICE TEMPLATE READ ERROR", templateError?.message);
    redirectWithMessage(redirectPath, "Current source template price could not be loaded.");
  }

  const { data: components, error: componentsError } = await supabase
    .from("product_components")
    .select("id,template_id,option_type,component_group,component_code,component_name,description,qty,unit_label,unit_price,currency,calculation_data")
    .eq("template_id", template.id)
    .eq("is_active", true)
    .returns<ProductComponentSnapshotSource[]>();

  if (componentsError) {
    console.error("USE SOURCE PRICE COMPONENTS READ ERROR", componentsError.message);
    redirectWithMessage(redirectPath, "Current source component prices could not be loaded.");
  }

  const currentSourcePrice = currentSourcePriceFromSnapshot({
    components: components ?? [],
    sourceData: item.source_component_data,
    template,
  });

  if (!currentSourcePrice) {
    redirectWithMessage(redirectPath, "Current source price could not be resolved safely.");
  }

  const linePricing = roundedLinePricing(
    currentSourcePrice.price,
    item.discount_type,
    item.discount_value,
    item.qty,
  );
  const updatedCurrency = normalizeCurrency(currentSourcePrice.currency || defaultCurrency);
  const nextPriceValues = {
    currency: updatedCurrency,
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    unit_price: linePricing.unitPrice,
  };
  const { error: updateError } = await supabase
    .from("quotation_items")
    .update({
      unit_price: linePricing.unitPrice,
      currency: updatedCurrency,
      discount_value: linePricing.discountValue,
      net_price: linePricing.netPrice,
      net_total: linePricing.netTotal,
    })
    .eq("id", item.id)
    .eq("quotation_id", quotationId);

  if (updateError) {
    console.error("USE SOURCE PRICE ITEM UPDATE ERROR", updateError.message);
    redirectWithMessage(redirectPath, "Line item source price could not be applied.");
  }

  await insertQuotationItemPriceHistory({
    changeType: "use_current_source_price",
    changedBy: user.id,
    actorName: displayName,
    current: item,
    newValues: nextPriceValues,
    note: "Updated row from current source price.",
    supabase,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Current source price applied to this row.");
}

export async function copyQuotationItem(formData: FormData) {
  const { user } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const sourceQuotationId = textValue(formData, "quotation_id");
  const destinationQuotationId = textValue(formData, "destination_quotation_id");
  const destinationSectionId = optionalTextValue(formData, "destination_section_id");
  const copyPosition = textValue(formData, "copy_position");
  const redirectPath = returnPath(
    formData,
    `/quotations/${sourceQuotationId}/builder`,
  );

  if (!id || !sourceQuotationId || !destinationQuotationId) {
    redirectWithMessage(
      redirectPath || "/quotations",
      "Source row and destination quotation are required.",
    );
  }

  const supabase = await createSupabaseClient();
  const { data: sourceItem, error: sourceError } = await supabase
    .from("quotation_items")
    .select(itemCopySelect)
    .eq("id", id)
    .eq("quotation_id", sourceQuotationId)
    .eq("is_active", true)
    .single<QuotationItemCopySource>();

  if (sourceError || !sourceItem) {
    console.error("QUOTATION ITEM COPY READ ERROR", sourceError?.message);
    redirectWithMessage(redirectPath, "Source row could not be copied.");
  }

  const { data: destinationQuotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,quotation_no,title")
    .eq("id", destinationQuotationId)
    .eq("is_active", true)
    .single<{ id: string; quotation_no: string | null; title: string }>();

  if (quotationError || !destinationQuotation) {
    console.error("QUOTATION ITEM COPY QUOTATION ERROR", quotationError?.message);
    redirectWithMessage(redirectPath, "Destination quotation was not found.");
  }

  if (destinationSectionId) {
    const { data: section, error: sectionError } = await supabase
      .from("quotation_sections")
      .select("id")
      .eq("id", destinationSectionId)
      .eq("quotation_id", destinationQuotationId)
      .eq("is_active", true)
      .maybeSingle<{ id: string }>();

    if (sectionError || !section) {
      console.error("QUOTATION ITEM COPY SECTION ERROR", sectionError?.message);
      redirectWithMessage(
        redirectPath,
        "Destination section does not belong to the selected quotation.",
      );
    }
  }

  let itemsQuery = supabase
    .from("quotation_items")
    .select("id,sort_order,created_at")
    .eq("quotation_id", destinationQuotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  itemsQuery = destinationSectionId
    ? itemsQuery.eq("section_id", destinationSectionId)
    : itemsQuery.is("section_id", null);

  const { data: destinationItems, error: itemsError } = await itemsQuery.returns<
    Array<{ id: string; sort_order: number; created_at: string }>
  >();

  if (itemsError) {
    console.error("QUOTATION ITEM COPY SORT READ ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Destination section could not be loaded.");
  }

  let sortOrder = ((destinationItems ?? []).at(-1)?.sort_order ?? 0) + 10;
  const sameLocation =
    destinationQuotationId === sourceQuotationId &&
    (destinationSectionId ?? null) === sourceItem.section_id;

  if (sameLocation && copyPosition === "after_current") {
    const orderedItems = destinationItems ?? [];
    const sourceIndex = orderedItems.findIndex((item) => item.id === id);

    if (sourceIndex >= 0) {
      const afterItems = orderedItems.slice(sourceIndex + 1);

      for (const [index, item] of afterItems.entries()) {
        const { error } = await supabase
          .from("quotation_items")
          .update({ sort_order: (sourceIndex + index + 3) * 10 })
          .eq("id", item.id);

        if (error) {
          console.error("QUOTATION ITEM COPY REORDER ERROR", error.message);
          redirectWithMessage(redirectPath, "Destination rows could not be reordered.");
        }
      }

      sortOrder = (sourceIndex + 2) * 10;
    }
  }

  const {
    id: _sourceItemId,
    quotation_id: _sourceItemQuotationId,
    section_id: _sourceItemSectionId,
    manual_serial: _manualSerial,
    sort_order: _sourceSortOrder,
    ...copyPayload
  } = sourceItem;
  void _sourceItemId;
  void _sourceItemQuotationId;
  void _sourceItemSectionId;
  void _manualSerial;
  void _sourceSortOrder;

  const { error: insertError } = await supabase.from("quotation_items").insert({
    ...copyPayload,
    quotation_id: destinationQuotationId,
    section_id: destinationSectionId,
    manual_serial: null,
    sort_order: sortOrder,
    is_active: true,
    created_by: user.id,
  });

  if (insertError) {
    console.error("QUOTATION ITEM COPY INSERT ERROR", insertError.message);
    redirectWithMessage(redirectPath, "Row could not be copied.");
  }

  await recalculateQuotationTotals(destinationQuotationId);
  revalidatePath(`/quotations/${destinationQuotationId}`);
  revalidatePath(`/quotations/${destinationQuotationId}/builder`);
  revalidatePath(`/quotations/${sourceQuotationId}`);
  revalidatePath(redirectPath);

  const destinationLabel =
    destinationQuotation.quotation_no || destinationQuotation.title || "destination quotation";
  redirectWithMessage(redirectPath, `Row copied to quotation ${destinationLabel}.`);
}

function copiedItemPayload(
  item: Omit<
    QuotationItemCopySource,
    "id" | "quotation_id" | "section_id" | "manual_serial" | "sort_order"
  >,
  userId: string,
  quotationId: string,
  sectionId: string | null,
  sortOrder: number,
) {
  return {
    ...item,
    quotation_id: quotationId,
    section_id: sectionId,
    manual_serial: null,
    sort_order: sortOrder,
    is_active: true,
    created_by: userId,
  };
}

async function sectionBelongsToQuotation(
  sectionId: string,
  quotationId: string,
) {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("quotation_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("QUOTATION SECTION VERIFY ERROR", error.message);
    return false;
  }

  return Boolean(data);
}

async function nextSortOrder(quotationId: string, sectionId: string | null) {
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("quotation_items")
    .select("sort_order")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .limit(1);

  query = sectionId ? query.eq("section_id", sectionId) : query.is("section_id", null);

  const { data, error } = await query.returns<Array<{ sort_order: number }>>();

  if (error) {
    console.error("QUOTATION ITEM SORT READ ERROR", error.message);
    return 10;
  }

  return ((data ?? [])[0]?.sort_order ?? 0) + 10;
}

export async function duplicateQuotationItemBelow(formData: FormData) {
  const { user } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${id}`);

  if (!id || !quotationId) {
    redirectWithMessage(redirectPath || "/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: sourceItem, error: sourceError } = await supabase
    .from("quotation_items")
    .select(itemCopySelect)
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .single<QuotationItemCopySource>();

  if (sourceError || !sourceItem) {
    console.error("QUOTATION ITEM DUPLICATE READ ERROR", sourceError?.message);
    redirectWithMessage(redirectPath, "Source row could not be duplicated.");
  }

  let query = supabase
    .from("quotation_items")
    .select("id,sort_order,created_at")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  query = sourceItem.section_id
    ? query.eq("section_id", sourceItem.section_id)
    : query.is("section_id", null);

  const { data: orderedItems, error: itemsError } = await query.returns<
    Array<{ id: string; sort_order: number; created_at: string }>
  >();

  if (itemsError) {
    console.error("QUOTATION ITEM DUPLICATE SORT READ ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Rows could not be reordered.");
  }

  const sourceIndex = (orderedItems ?? []).findIndex((item) => item.id === id);
  const afterItems = sourceIndex >= 0 ? (orderedItems ?? []).slice(sourceIndex + 1) : [];

  for (const [index, item] of afterItems.entries()) {
    const { error } = await supabase
      .from("quotation_items")
      .update({ sort_order: (sourceIndex + index + 3) * 10 })
      .eq("id", item.id);

    if (error) {
      console.error("QUOTATION ITEM DUPLICATE REORDER ERROR", error.message);
      redirectWithMessage(redirectPath, "Rows could not be reordered.");
    }
  }

  const {
    id: _id,
    quotation_id: _quotationId,
    section_id: _sectionId,
    manual_serial: _manualSerial,
    sort_order: _sortOrder,
    ...copySource
  } = sourceItem;
  void _id;
  void _quotationId;
  void _sectionId;
  void _manualSerial;
  void _sortOrder;

  const sortOrder = sourceIndex >= 0
    ? (sourceIndex + 2) * 10
    : await nextSortOrder(quotationId, sourceItem.section_id);
  const { error: insertError } = await supabase.from("quotation_items").insert(
    copiedItemPayload(
      copySource,
      user.id,
      quotationId,
      sourceItem.section_id,
      sortOrder,
    ),
  );

  if (insertError) {
    console.error("QUOTATION ITEM DUPLICATE INSERT ERROR", insertError.message);
    redirectWithMessage(redirectPath, "Row could not be duplicated.");
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Row duplicated.");
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeCopiedRowSnapshot(value: unknown) {
  const source = objectValue(value);
  const qty = numberOr(source.qty, 1);
  const unitPrice = numberOr(source.unit_price, 0);
  const discountType = discountTypes.has(String(source.discount_type))
    ? String(source.discount_type)
    : "amount";
  const discountValue = numberOr(source.discount_value, 0);
  const linePricing = roundedLinePricing(unitPrice, discountType, discountValue, qty);

  return {
    item_type: itemTypes.has(String(source.item_type)) ? String(source.item_type) : "custom",
    source_template_id: stringOrNull(source.source_template_id),
    source_component_data: source.source_component_data ?? null,
    item_code_snapshot: stringOrNull(source.item_code_snapshot),
    item_name_snapshot: stringOrNull(source.item_name_snapshot),
    brand_name_snapshot: stringOrNull(source.brand_name_snapshot),
    category_name_snapshot: stringOrNull(source.category_name_snapshot),
    specified_image_url_snapshot: stringOrNull(source.specified_image_url_snapshot),
    proposed_image_url_snapshot: stringOrNull(source.proposed_image_url_snapshot),
    specification_snapshot: stringOrNull(source.specification_snapshot),
    finish_selections_snapshot: Array.isArray(source.finish_selections_snapshot)
      ? source.finish_selections_snapshot
      : [],
    selected_options_snapshot: source.selected_options_snapshot ?? null,
    internal_components_snapshot: source.internal_components_snapshot ?? null,
    room_name_snapshot: stringOrNull(source.room_name_snapshot),
    model_snapshot: stringOrNull(source.model_snapshot),
    finish_snapshot: stringOrNull(source.finish_snapshot),
    size_snapshot: stringOrNull(source.size_snapshot),
    origin_snapshot: stringOrNull(source.origin_snapshot),
    warranty_snapshot: stringOrNull(source.warranty_snapshot),
    supplier_name_snapshot: stringOrNull(source.supplier_name_snapshot),
    supplier_notes_snapshot: stringOrNull(source.supplier_notes_snapshot),
    allow_material_continuation_page: booleanOr(source.allow_material_continuation_page, false),
    qty,
    unit_label: stringOrNull(source.unit_label) ?? "Pc",
    unit_price: linePricing.unitPrice,
    discount_type: discountType,
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    currency: normalizeCurrency(String(source.currency || defaultCurrency)),
    is_optional: booleanOr(source.is_optional, false),
    internal_cost: numberOr(source.internal_cost, 0),
    margin_type: discountTypes.has(String(source.margin_type)) ? String(source.margin_type) : "amount",
    margin_value: numberOr(source.margin_value, 0),
    is_rate_only: booleanOr(source.is_rate_only, false),
    line_style: lineStyles.has(String(source.line_style)) ? String(source.line_style) : "normal",
    row_height: Number.isFinite(Number(source.row_height))
      ? Math.min(Math.max(Number(source.row_height), 40), 600)
      : null,
    cell_layout: objectValue(source.cell_layout),
    notes: stringOrNull(source.notes),
  };
}

export async function pasteCopiedQuotationItem(formData: FormData) {
  const { user } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionId = textValue(formData, "section_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder`);
  const rawSnapshot = textValue(formData, "row_snapshot");

  if (!quotationId || !sectionId || !rawSnapshot) {
    redirectWithMessage(redirectPath || "/quotations", "Copied row and destination section are required.");
  }

  if (!(await sectionBelongsToQuotation(sectionId, quotationId))) {
    redirectWithMessage(redirectPath, "Destination section was not found.");
  }

  let parsedSnapshot: unknown;
  try {
    parsedSnapshot = JSON.parse(rawSnapshot);
  } catch {
    redirectWithMessage(redirectPath, "Copied row data is invalid.");
  }

  const payload = sanitizeCopiedRowSnapshot(parsedSnapshot);
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotation_items").insert({
    ...payload,
    quotation_id: quotationId,
    section_id: sectionId,
    manual_serial: null,
    sort_order: await nextSortOrder(quotationId, sectionId),
    is_active: true,
    created_by: user.id,
  });

  if (error) {
    console.error("QUOTATION ITEM PASTE ERROR", error.message);
    redirectWithMessage(redirectPath, "Copied row could not be pasted.");
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Copied row pasted.");
}

export async function autosaveQuotationItemInline(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");

  if (!id || !quotationId) {
    return { ok: false, message: "Line item id and quotation are required." };
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,source_template_id,source_component_data,item_name_snapshot,qty,unit_price,currency,discount_type,discount_value,net_price,net_total,cell_layout")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .single<{
      id: string;
      quotation_id: string;
      source_template_id: string | null;
      source_component_data: unknown;
      item_name_snapshot: string | null;
      qty: number;
      unit_price: number;
      currency: string;
      discount_type: string;
      discount_value: number;
      net_price: number;
      net_total: number;
      cell_layout: CellLayoutPayload | null;
    }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM AUTOSAVE READ ERROR", readError?.message);
    return { ok: false, message: "Line item could not be loaded." };
  }

  const payload: Record<string, string | number | CellLayoutPayload | null> = {};
  const textFields = [
    "manual_serial",
    "item_code_snapshot",
    "item_name_snapshot",
    "specified_image_url_snapshot",
    "proposed_image_url_snapshot",
    "specification_snapshot",
    "room_name_snapshot",
    "model_snapshot",
    "finish_snapshot",
    "size_snapshot",
    "origin_snapshot",
    "warranty_snapshot",
    "supplier_name_snapshot",
    "unit_label",
  ];

  for (const field of textFields) {
    if (formData.has(field)) {
      payload[field] = optionalTextValue(formData, field);
    }
  }

  const discountType = formData.has("discount_type")
    ? allowedText(formData, "discount_type", discountTypes, currentItem.discount_type)
    : currentItem.discount_type;
  const qty = formData.has("qty")
    ? numberValue(formData, "qty", currentItem.qty)
    : currentItem.qty;
  const rawUnitPrice = formData.has("unit_price")
    ? numberValue(formData, "unit_price", currentItem.unit_price)
    : currentItem.unit_price;
  const rawDiscountValue = formData.has("discount_value")
    ? numberValue(formData, "discount_value", currentItem.discount_value)
    : currentItem.discount_value;
  const linePricing = roundedLinePricing(rawUnitPrice, discountType, rawDiscountValue, qty);

  if (formData.has("discount_type")) payload.discount_type = discountType;
  if (formData.has("line_style")) {
    payload.line_style = allowedText(formData, "line_style", lineStyles, "normal");
  }
  if (formData.has("qty")) payload.qty = qty;
  if (formData.has("unit_price")) payload.unit_price = linePricing.unitPrice;
  if (formData.has("discount_value")) payload.discount_value = linePricing.discountValue;
  if (formData.has("row_height")) {
    payload.row_height = optionalIntegerInRange(formData, "row_height", 40, 600);
  }
  if (formData.has("merge_mode") || formData.has("cell_style_key")) {
    payload.cell_layout = cellLayoutValue(formData, currentItem.cell_layout);
  }
  payload.net_price = linePricing.netPrice;
  payload.net_total = linePricing.netTotal;

  const nextPriceValues = {
    currency: currentItem.currency,
    discount_value: linePricing.discountValue,
    net_price: linePricing.netPrice,
    net_total: linePricing.netTotal,
    unit_price: linePricing.unitPrice,
  };

  const { error } = await supabase
    .from("quotation_items")
    .update(payload)
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION ITEM AUTOSAVE ERROR", error.message);
    return { ok: false, message: "Save failed." };
  }

  await insertQuotationItemPriceHistory({
    changeType: "manual",
    changedBy: user.id,
    actorName: displayName,
    current: currentItem,
    newValues: nextPriceValues,
    note: "Updated row price manually.",
    supabase,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  return {
    ok: true,
    row: {
      discount_value: linePricing.discountValue,
      net_price: linePricing.netPrice,
      net_total: linePricing.netTotal,
      qty,
      unit_price: linePricing.unitPrice,
    },
  };
}

async function moveQuotationItem(formData: FormData, direction: "up" | "down") {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${id}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,section_id")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .single<{ id: string; quotation_id: string; section_id: string | null }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM MOVE READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Line item could not be moved.");
  }

  let query = supabase
    .from("quotation_items")
    .select("id,sort_order,created_at")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  query = currentItem.section_id
    ? query.eq("section_id", currentItem.section_id)
    : query.is("section_id", null);

  const { data: items, error: itemsError } = await query.returns<
    Array<{ id: string; sort_order: number; created_at: string }>
  >();

  if (itemsError) {
    console.error("QUOTATION ITEM MOVE LIST ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Line item could not be moved.");
  }

  const orderedItems = items ?? [];
  const index = orderedItems.findIndex((item) => item.id === id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) {
    redirectWithMessage(redirectPath, "Row is already in that position.");
  }

  const reorderedItems = [...orderedItems];
  [reorderedItems[index], reorderedItems[targetIndex]] = [
    reorderedItems[targetIndex],
    reorderedItems[index],
  ];

  for (const [position, item] of reorderedItems.entries()) {
    const { error } = await supabase
      .from("quotation_items")
      .update({ sort_order: (position + 1) * 10 })
      .eq("id", item.id);

    if (error) {
      console.error("QUOTATION ITEM MOVE UPDATE ERROR", error.message);
      redirectWithMessage(redirectPath, "Line item could not be moved.");
    }
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Row moved.");
}

export async function moveQuotationItemUp(formData: FormData) {
  await moveQuotationItem(formData, "up");
}

export async function moveQuotationItemDown(formData: FormData) {
  await moveQuotationItem(formData, "down");
}

export async function deactivateQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder`);
  const { pathname, queryString } = splitRelativePath(redirectPath);
  const redirectBasePath = queryString ? `${pathname}?${queryString}` : pathname;

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: currentItemError } = await supabase
    .from("quotation_items")
    .select("id,item_name_snapshot,section_id")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string; item_name_snapshot: string | null; section_id: string | null }>();

  if (currentItemError || !currentItem) {
    console.error("QUOTATION ITEM DEACTIVATE READ ERROR", currentItemError?.message);
    redirectWithMessage(redirectPath, "Line item could not be deactivated.");
  }

  const { error } = await supabase
    .from("quotation_items")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be deactivated.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: currentItem.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "deleted",
    title: "Quotation row removed",
    description: quotationItemAuditLabel(currentItem.item_name_snapshot),
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageAndParams(
    currentItem.section_id ? `${redirectBasePath}#section-${currentItem.section_id}` : redirectBasePath,
    "Line item deactivated.",
    {
      undo_item_id: currentItem.id,
      undo_kind: "item",
    },
  );
}

export async function restoreQuotationItem(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const quotationItemId = textValue(formData, "quotation_item_id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#item-${quotationItemId}`);

  if (!quotationItemId || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: item, error: itemReadError } = await supabase
    .from("quotation_items")
    .select("id,item_name_snapshot,is_active")
    .eq("id", quotationItemId)
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string; item_name_snapshot: string | null; is_active: boolean }>();

  if (itemReadError || !item) {
    console.error("QUOTATION ITEM RESTORE READ ERROR", itemReadError?.message);
    redirectWithMessage(redirectPath, "Line item could not be restored.");
  }

  if (item.is_active) {
    redirectWithMessage(redirectPath, "Line item is already active.");
  }

  const { error: restoreError } = await supabase
    .from("quotation_items")
    .update({ is_active: true })
    .eq("id", quotationItemId)
    .eq("quotation_id", quotationId);

  if (restoreError) {
    console.error("QUOTATION ITEM RESTORE ERROR", restoreError.message);
    redirectWithMessage(redirectPath, "Line item could not be restored.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_item",
    entityId: item.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "quotation_item_restored",
    title: "Line item restored",
    description: quotationItemAuditLabel(item.item_name_snapshot),
    actorName: displayName,
    createdBy: user.id,
  });

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Line item restored.");
}

export async function restoreQuotationSection(formData: FormData) {
  const { user, displayName } = await requireRecordsManager();
  const sectionId = textValue(formData, "quotation_section_id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}/builder#section-${sectionId}`);

  if (!sectionId || !quotationId) {
    redirectWithMessage("/quotations", "Section id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: section, error: sectionReadError } = await supabase
    .from("quotation_sections")
    .select("id,section_title,is_active")
    .eq("id", sectionId)
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string; section_title: string | null; is_active: boolean }>();

  if (sectionReadError || !section) {
    console.error("QUOTATION SECTION RESTORE READ ERROR", sectionReadError?.message);
    redirectWithMessage(redirectPath, "Section could not be restored.");
  }

  if (section.is_active) {
    redirectWithMessage(redirectPath, "Section is already active.");
  }

  const { error: restoreError } = await supabase
    .from("quotation_sections")
    .update({ is_active: true })
    .eq("id", sectionId)
    .eq("quotation_id", quotationId);

  if (restoreError) {
    console.error("QUOTATION SECTION RESTORE ERROR", restoreError.message);
    redirectWithMessage(redirectPath, "Section could not be restored.");
  }

  await createAuditLog(supabase, {
    entityType: "quotation_section",
    entityId: section.id,
    parentEntityType: "quotation",
    parentEntityId: quotationId,
    action: "restored",
    title: "Section restored",
    description: quotationSectionAuditLabel(section.section_title),
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessage(redirectPath, "Section restored.");
}
