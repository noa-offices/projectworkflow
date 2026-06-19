export type DeliveryNoteLogoMode = "logo_if_available" | "text_wordmark_fallback";

export type DeliveryNoteColumnVisibility = {
  image: boolean;
  code: boolean;
  brand: boolean;
  specification: boolean;
  size: boolean;
  finish: boolean;
  model: boolean;
  condition: boolean;
};

export type DeliveryNoteItemOverride = {
  hidden: boolean;
  description: string;
  remark: string;
};

export type DeliveryNoteSettings = {
  dnNumber: string;
  dnDate: string;
  scope: string;
  showLogo: boolean;
  logoMode: DeliveryNoteLogoMode;
  orientation: "portrait" | "landscape";
  firstPageHeaderOnly: boolean;
  projectDisplayName: string;
  clientDisplayName: string;
  deliveryAddress: string;
  deliveryDate: string;
  driverName: string;
  vehicleDetails: string;
  columnVisibility: DeliveryNoteColumnVisibility;
  headerText: string;
  footerText: string;
  itemOverrides: Record<string, DeliveryNoteItemOverride>;
  updatedAt: string | null;
};

export const DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY: DeliveryNoteColumnVisibility = {
  image: true,
  code: true,
  brand: true,
  specification: true,
  size: true,
  finish: true,
  model: true,
  condition: false,
};

export const DEFAULT_DELIVERY_NOTE_SETTINGS: DeliveryNoteSettings = {
  dnNumber: "",
  dnDate: "",
  scope: "all",
  showLogo: true,
  logoMode: "logo_if_available",
  orientation: "portrait",
  firstPageHeaderOnly: true,
  projectDisplayName: "",
  clientDisplayName: "",
  deliveryAddress: "",
  deliveryDate: "",
  driverName: "",
  vehicleDetails: "",
  columnVisibility: DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY,
  headerText: "",
  footerText: "",
  itemOverrides: {},
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(src: Record<string, unknown> | undefined, key: string, fallback = "") {
  return typeof src?.[key] === "string" ? (src[key] as string).trim() : fallback;
}

function bool(src: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  return typeof src?.[key] === "boolean" ? (src[key] as boolean) : fallback;
}

export function normalizeDeliveryNoteSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): DeliveryNoteSettings {
  const r = isRecord(value) ? value : {};
  const col = isRecord(r.columnVisibility) ? r.columnVisibility : undefined;
  const rawOverrides = isRecord(r.itemOverrides) ? r.itemOverrides : {};

  const itemOverrides = Object.fromEntries(
    Object.entries(rawOverrides)
      .map(([key, raw]) => {
        if (!isRecord(raw)) return null;
        const entry: DeliveryNoteItemOverride = {
          hidden: bool(raw, "hidden", false),
          description: str(raw, "description"),
          remark: str(raw, "remark"),
        };
        const hasValue = entry.hidden || entry.description.length > 0 || entry.remark.length > 0;
        return hasValue ? [key, entry] : null;
      })
      .filter((e): e is [string, DeliveryNoteItemOverride] => Boolean(e)),
  );

  return {
    dnNumber: str(r, "dnNumber"),
    dnDate: str(r, "dnDate"),
    scope: str(r, "scope", DEFAULT_DELIVERY_NOTE_SETTINGS.scope),
    showLogo: bool(r, "showLogo", DEFAULT_DELIVERY_NOTE_SETTINGS.showLogo),
    logoMode: r.logoMode === "text_wordmark_fallback" ? "text_wordmark_fallback" : "logo_if_available",
    orientation: r.orientation === "landscape" ? "landscape" : "portrait",
    firstPageHeaderOnly: bool(r, "firstPageHeaderOnly", DEFAULT_DELIVERY_NOTE_SETTINGS.firstPageHeaderOnly),
    projectDisplayName: str(r, "projectDisplayName"),
    clientDisplayName: str(r, "clientDisplayName"),
    deliveryAddress: str(r, "deliveryAddress"),
    deliveryDate: str(r, "deliveryDate"),
    driverName: str(r, "driverName"),
    vehicleDetails: str(r, "vehicleDetails"),
    columnVisibility: {
      image: bool(col, "image", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.image),
      code: bool(col, "code", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.code),
      brand: bool(col, "brand", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.brand),
      specification: bool(col, "specification", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.specification),
      size: bool(col, "size", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.size),
      finish: bool(col, "finish", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.finish),
      model: bool(col, "model", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.model),
      condition: bool(col, "condition", DEFAULT_DELIVERY_NOTE_COLUMN_VISIBILITY.condition),
    },
    headerText: str(r, "headerText"),
    footerText: str(r, "footerText"),
    itemOverrides,
    updatedAt:
      (typeof r.updatedAt === "string" && r.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
