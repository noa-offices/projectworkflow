import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireActiveUser } from "@/lib/auth";
import { getCompanyProfile, isRemoteOrAppLogo } from "@/lib/company-profile";
import {
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";
import {
  documentSetupRecord,
  resolveDocumentSetup,
  type DocumentVisibilitySettings,
  type SpecificationLayoutSettings,
} from "@/lib/quotations/document-setup";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import {
  SpecificationPreview,
  type SpecificationImageItem,
  type SpecificationItemImageOverride,
  type SpecificationSettings,
} from "@/components/quotations/specification-preview";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SpecificationPageProps = {
  params: Promise<{ id: string }>;
};

type Client = {
  id: string;
  client_number?: string | null;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
  project_number: string | null;
  project_year: number | null;
  project_code: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type Quotation = {
  id: string;
  client_id: string;
  currency?: string | null;
  delivery_terms?: string | null;
  layout_settings?: unknown;
  legacy_reference?: string | null;
  notes?: string | null;
  option_no?: number | null;
  overall_discount_type?: string | null;
  overall_discount_value?: number | null;
  payment_terms?: string | null;
  project_id: string | null;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  validity?: string | null;
  vat_percent?: number | null;
  warranty_terms?: string | null;
};

type QuotationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

type QuotationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
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
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  allow_material_continuation_page: boolean;
  sort_order: number;
  is_optional: boolean;
  is_rate_only: boolean;
  line_style: string;
  is_active: boolean;
  cell_layout: CellLayout | null;
  notes: string | null;
};

type CellLayout = {
  images?: Record<string, Partial<ImageDisplaySettings> | undefined>;
};

type DisplaySection = QuotationSection & {
  renderAsMainOnly?: boolean;
};

type SpecDocumentPage =
  | { type: "divider"; section: QuotationSection; pageNumber: number }
  | {
      type: "product";
      item: QuotationItem;
      mainSection: QuotationSection | null;
      section: QuotationSection;
      serial: number;
      pageNumber: number;
      description: string | null;
      descriptionContinues: boolean;
      showMaterials: boolean;
    }
  | {
      type: "text";
      item: QuotationItem;
      mainSection: QuotationSection | null;
      section: QuotationSection;
      pageNumber: number;
    }
  | {
      type: "description_continuation";
      description: string;
      descriptionContinues: boolean;
      item: QuotationItem;
      mainSection: QuotationSection | null;
      pageNumber: number;
      section: QuotationSection;
      serial: number;
    }
  | {
      type: "materials_continuation";
      chartId?: string;
      chartStart?: number;
      item: QuotationItem;
      mainSection: QuotationSection | null;
      pageNumber: number;
      section: QuotationSection;
      selectedStart?: number;
      serial: number;
    };

type SelectedFinish = {
  id: string;
  label: string;
  code: string | null;
  value: string;
  description: string | null;
  groupSortOrder: number;
  imageUrl: string | null;
  firstIndex: number;
  sortOrder: number;
};

type ProductTemplateMaterialGroupOrder = {
  id: string;
  sort_order: number;
};

function validUuidOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

type MaterialChartSwatch = {
  code: string | null;
  name: string | null;
  imageUrl: string | null;
};

type MaterialChart = {
  id: string;
  title: string;
  groupLabel: string;
  swatches: MaterialChartSwatch[];
};

type SelectedFinishGroup = {
  label: string;
  finishes: SelectedFinish[];
  firstIndex: number;
  sortOrder: number;
};

type SelectedFinishLayoutMode = "few" | "compact" | "dense";

const selectedFinishesPerProductPage = 6;
const chartSwatchesPerProductPage = 15;

function hasUsableCompanyLogo(logoUrl: string | null) {
  if (!logoUrl) return false;
  if (!isRemoteOrAppLogo(logoUrl)) return false;
  if (!logoUrl.startsWith("/")) return true;
  return existsSync(join(process.cwd(), "public", logoUrl.replace(/^\//, "")));
}

function specificationDocumentTitle(quotation?: Pick<Quotation, "quotation_no" | "title"> | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Specification Sheet";

  return `${quotationNo} - ${title} Specification Sheet`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function generateMetadata({ params }: SpecificationPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<Pick<Quotation, "quotation_no" | "title">>();

  return {
    title: specificationDocumentTitle(quotation),
  };
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

async function signedImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createSupabaseClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const bucket = value.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value.startsWith("quote-images:")
      ? value.slice("quote-images:".length)
      : value;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("SPECIFICATION IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function projectContactLine(project?: Project | null) {
  return [
    project?.attention_to ? `Attn: ${project.attention_to}` : null,
    project?.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project?.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project?.attention_email ? `Email: ${project.attention_email}` : null,
    project?.po_box ? `PO Box: ${project.po_box}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function InfoLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-xs text-zinc-900">{value || "-"}</dd>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <>
      <dt className="text-right text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">{value || "-"}</dd>
    </>
  );
}

function isHeadingRow(item: QuotationItem) {
  return item.line_style === "heading" || item.item_type === "heading";
}

function isNoteRow(item: QuotationItem) {
  return item.line_style === "note" || item.item_type === "note";
}

function isBlankRow(item: QuotationItem) {
  return item.item_type === "blank" || item.line_style === "blank";
}

function isSerialCountedLine(item: QuotationItem) {
  return !["heading", "note", "no_quote"].includes(item.line_style) && !["heading", "note", "blank", "subtotal"].includes(item.item_type);
}

function rowText(item: QuotationItem) {
  return [item.item_name_snapshot, item.specification_snapshot]
    .filter(Boolean)
    .join(" - ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string, fallback: boolean) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function finishSelections(value: unknown) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function materialEntries(item: QuotationItem) {
  return finishSelections(item.finish_selections_snapshot)
    .filter((finish) => booleanFromRecord(finish, "show_in_specification", true));
}

function selectedFinishEntries(item: QuotationItem) {
  return materialEntries(item)
    .filter((finish) => stringFromRecord(finish, ["type"]) !== "material_group_chart");
}

function swatchRecords(finish: Record<string, unknown>) {
  const swatches = finish.swatches;
  return Array.isArray(swatches) ? swatches.filter(isRecord) : [];
}

function materialContent(
  item: QuotationItem,
  finishImageUrlById: Map<string, string | null>,
  materialGroupSortOrderByLinkId: Map<string, number>,
) {
  const selectedFinishes = materialEntries(item)
    .flatMap((finish, index): SelectedFinish[] => {
      if (stringFromRecord(finish, ["type"]) === "material_group_chart") return [];
      const id = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
      const label = stringFromRecord(finish, ["group_label"]) || "Other Finishes";
      const code = stringFromRecord(finish, ["finish_code"]);
      const value = stringFromRecord(finish, ["finish_name"]) || code || "";
      const description = stringFromRecord(finish, ["finish_description"]);
      const sortOrderValue = finish.sort_order;
      const linkedGroupId = stringFromRecord(finish, ["product_template_material_group_id"]);
      const linkedGroupSortOrder = linkedGroupId
        ? materialGroupSortOrderByLinkId.get(linkedGroupId)
        : undefined;

      return [{
        id,
        label,
        code,
        value,
        description,
        groupSortOrder: typeof linkedGroupSortOrder === "number" ? linkedGroupSortOrder : Number.MAX_SAFE_INTEGER,
        imageUrl: finishImageUrlById.get(id) ?? null,
        firstIndex: index,
        sortOrder: typeof sortOrderValue === "number" && Number.isFinite(sortOrderValue) ? sortOrderValue : index,
      }];
    })
    .filter((finish) => Boolean(finish.code || finish.value || finish.description || finish.imageUrl))
    .sort(
      (left, right) =>
        left.groupSortOrder - right.groupSortOrder ||
        left.sortOrder - right.sortOrder,
    );
  const charts = materialEntries(item)
    .flatMap((finish, index): MaterialChart[] => {
      if (stringFromRecord(finish, ["type"]) !== "material_group_chart") return [];
      const id = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
      const groupLabel = stringFromRecord(finish, ["group_label"]) || "Material Group";
      const displayTitle = stringFromRecord(finish, ["display_title"]) || "Material Options";

      return [{
        id,
        groupLabel,
        title: `${displayTitle} - ${groupLabel}`,
        swatches: swatchRecords(finish)
          .map((swatch, swatchIndex) => ({
            code: stringFromRecord(swatch, ["code"]),
            name: stringFromRecord(swatch, ["name"]),
            imageUrl: finishImageUrlById.get(`${id}:${swatchIndex}`) ?? null,
          }))
          .filter((swatch) => Boolean(swatch.code || swatch.name || swatch.imageUrl)),
      }];
    })
    .filter((chart) => chart.swatches.length);

  return { charts, selectedFinishes };
}

function DetailLine({ compact, label, value }: { compact?: boolean; label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`spec-detail-value mt-[3px] whitespace-pre-wrap text-zinc-800 ${compact ? "text-[9.5px] leading-[13px]" : "text-[10.5px] leading-[15px]"}`}>{value}</dd>
    </div>
  );
}

function SpecImage({
  imageSettings,
  src,
  label,
  fallbackFit,
  mainImageSize,
  specificationOverride,
}: {
  imageSettings?: Partial<ImageDisplaySettings> | null;
  src: string | null;
  label: string;
  fallbackFit: SpecificationLayoutSettings["productImageFit"];
  mainImageSize?: SpecificationLayoutSettings["productImageSize"];
  specificationOverride?: SpecificationItemImageOverride;
}) {
  const settings = normalizeImageDisplaySettings({
    ...imageSettings,
    ...specificationOverride,
    fit: specificationOverride?.fit ?? (
      imageSettings?.fit === "contain" || imageSettings?.fit === "cover"
        ? imageSettings.fit
        : fallbackFit
    ),
  }, 0.5);
  const resolvedMainImageSize = specificationOverride?.size ?? mainImageSize;
  const heightClass = resolvedMainImageSize === "small"
    ? "h-[260px]"
    : resolvedMainImageSize === "medium"
      ? "h-[310px]"
      : resolvedMainImageSize === "current"
        ? "h-[350px]"
        : "h-28";

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <div data-spec-main-image={mainImageSize ? "" : undefined} className={`flex items-center justify-center overflow-hidden bg-white ${heightClass}`}>
        <QuotationImageFrame
          alt={label}
          className="h-full w-full overflow-hidden"
          emptyContent={<span data-spec-image-empty className="text-xs text-zinc-400">No image</span>}
          imageUrl={src}
          minimumZoom={0.5}
          settings={settings}
        />
      </div>
    </div>
  );
}

function PageFooter({
  companyName,
  pageNumber,
  showCompanyName = true,
  showPageNumber = true,
  totalPages,
}: {
  companyName: string;
  pageNumber: number;
  showCompanyName?: boolean;
  showPageNumber?: boolean;
  totalPages: number;
}) {
  if (!showCompanyName && !showPageNumber) return null;

  return (
    <footer className="mt-auto flex items-center justify-between border-t border-zinc-200 pt-4 text-[10px] uppercase tracking-wide text-zinc-400">
      {showCompanyName ? <span>{companyName}</span> : <span />}
      {showPageNumber ? <span>Page {pageNumber} of {totalPages}</span> : null}
    </footer>
  );
}

function specificationItemImageOverride(value: unknown): SpecificationItemImageOverride | null {
  if (!isRecord(value)) return null;

  const image = normalizeImageDisplaySettings(value, 0.5);
  const size = value.size;
  const replacementImageUrl = typeof value.replacementImageUrl === "string" && value.replacementImageUrl.startsWith("quote-images:quotation-specifications/")
    ? value.replacementImageUrl
    : undefined;
  return {
    fit: image.fit,
    positionX: image.positionX,
    positionY: image.positionY,
    replacementImageUrl,
    size: size === "small" || size === "medium" ? size : "current",
    zoom: image.zoom,
  };
}

function descriptionChunks(value: string, compact: boolean) {
  // Conservative character budgets for the fixed Specification product and continuation layouts.
  const firstPageBudget = compact ? 900 : 700;
  const continuationBudget = compact ? 6000 : 4500;
  const firstPageLines = compact ? 18 : 14;
  const continuationLines = compact ? 52 : 45;
  const chunks: string[] = [];
  let remaining = value.replace(/\r\n?/g, "\n").trim();
  let budget = firstPageBudget;
  let lineBudget = firstPageLines;

  while (remaining) {
    if (remaining.length <= budget && remaining.split("\n").length <= lineBudget) {
      chunks.push(remaining);
      break;
    }

    let candidateEnd = Math.min(remaining.length, budget + 1);
    let newlineCount = 0;
    for (let index = 0; index < candidateEnd; index += 1) {
      if (remaining[index] !== "\n") continue;
      newlineCount += 1;
      if (newlineCount === lineBudget) {
        candidateEnd = index + 1;
        break;
      }
    }
    const candidate = remaining.slice(0, candidateEnd);
    const paragraphBoundary = candidate.lastIndexOf("\n\n");
    const wordBoundary = candidate.search(/\s+\S*$/);
    const boundary = paragraphBoundary >= budget * 0.55
      ? paragraphBoundary + 2
      : wordBoundary > 0
        ? wordBoundary
        : remaining.search(/\s/);

    if (boundary <= 0) {
      chunks.push(remaining);
      break;
    }

    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
    budget = continuationBudget;
    lineBudget = continuationLines;
  }

  return chunks;
}

function ProductPageHeader({
  companyProfile,
  hasLogo,
  pageNumber,
  projectReferenceDisplay,
  quotation,
  totalPages,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  hasLogo: boolean;
  pageNumber: number;
  projectReferenceDisplay: string;
  quotation: Quotation;
  totalPages: number;
}) {
  return (
    <header className="flex items-start justify-between border-b border-zinc-200 pb-4">
      <div className="min-w-0">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={companyProfile.logoPath ?? ""} alt={companyProfile.displayName} className="h-10 w-32 object-contain" />
        ) : (
          <div className="text-sm font-black uppercase tracking-tight text-zinc-950">{companyProfile.displayName}</div>
        )}
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Specification Sheet</p>
      </div>
      <dl className="spec-client-reference grid min-w-[190px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-right">
        <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
        <MetaLine label="Date" value={quotation.quotation_date} />
        <MetaLine label="Project" value={projectReferenceDisplay} />
        <MetaLine label="Page" value={`${pageNumber} / ${totalPages}`} />
      </dl>
    </header>
  );
}

function DividerPage({
  companyProfile,
  client,
  page,
  project,
  quotation,
  totalPages,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  client?: Client | null;
  page: Extract<SpecDocumentPage, { type: "divider" }>;
  project?: Project | null;
  quotation: Quotation;
  totalPages: number;
}) {
  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-12 shadow-sm ring-1 ring-zinc-200">
      <div className="flex items-start justify-between text-xs text-zinc-500">
        <span className="font-bold uppercase tracking-[0.2em]">Specification Sheet</span>
        <span>{quotation.quotation_no ?? "Draft"}</span>
      </div>
      <div className="flex flex-1 items-center justify-center py-16 text-center">
        <div>
          <p className="mb-6 text-xs font-bold uppercase tracking-[0.3em] text-zinc-400">
            {client?.company_name ?? "Client"} / {project?.project_name ?? "Project"}
          </p>
          <h1 className="text-5xl font-bold uppercase tracking-[0.12em] text-zinc-950">{page.section.section_title}</h1>
          {project?.location ? (
            <p className="mt-6 text-sm uppercase tracking-[0.2em] text-zinc-500">{project.location}</p>
          ) : null}
        </div>
      </div>
      <PageFooter companyName={companyProfile.companyName} pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function TextBlockPage({
  companyProfile,
  hasLogo,
  page,
  projectReferenceDisplay,
  quotation,
  totalPages,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  hasLogo: boolean;
  page: Extract<SpecDocumentPage, { type: "text" }>;
  projectReferenceDisplay: string;
  quotation: Quotation;
  totalPages: number;
}) {
  const text = rowText(page.item) || "-";

  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader companyProfile={companyProfile} hasLogo={hasLogo} pageNumber={page.pageNumber} projectReferenceDisplay={projectReferenceDisplay} quotation={quotation} totalPages={totalPages} />
      <div className="mt-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
          {[page.mainSection?.section_title, page.section.section_title].filter(Boolean).join(" / ") || "Specification note"}
        </p>
        <div className="mt-8 border-l border-zinc-300 pl-8">
          {isHeadingRow(page.item) ? (
            <h2 className="text-3xl font-bold leading-tight text-zinc-950">
              {text}
              {page.item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
              {page.item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
            </h2>
          ) : (
            <p className="whitespace-pre-wrap text-lg leading-8 text-zinc-700">
              {text}
              {page.item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
              {page.item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
            </p>
          )}
        </div>
      </div>
      <PageFooter companyName={companyProfile.companyName} pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function SelectedFinishCard({
  finish,
  mode,
}: {
  finish: SelectedFinish;
  mode: SelectedFinishLayoutMode;
}) {
  const codeName = [finish.code, finish.value].filter(Boolean).join(" | ") || finish.description || "Finish";
  const swatchClass = mode === "few"
    ? "flex h-[52px] w-[52px] items-center justify-center bg-white"
    : mode === "dense"
      ? "mx-auto flex h-8 w-8 items-center justify-center bg-white"
      : "flex h-9 w-9 items-center justify-center bg-white";
  const cardClass = mode === "few"
    ? "grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-3"
    : mode === "dense"
      ? "min-w-0 bg-white text-center"
      : "grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2 bg-white";
  const titleClass = mode === "few"
    ? "text-[12px] font-semibold leading-4 text-zinc-950"
    : mode === "dense"
      ? "mt-1 line-clamp-2 text-[8.5px] font-semibold leading-3 text-zinc-900"
      : "truncate text-[9px] font-semibold leading-3 text-zinc-900";

  return (
    <div className={cardClass}>
      <div className={swatchClass}>
        {finish.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={finish.imageUrl} alt={finish.value || finish.label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[9px] uppercase text-zinc-400">Finish</span>
        )}
      </div>
      <div className={mode === "dense" ? "min-w-0 px-0.5" : "min-w-0"}>
        <p className={titleClass}>{codeName}</p>
        {mode !== "dense" && finish.description && (finish.code || finish.value) ? (
          <p className={mode === "few" ? "mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] leading-4 text-zinc-500" : "mt-0.5 line-clamp-1 whitespace-pre-wrap text-[8px] leading-3 text-zinc-500"}>{finish.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function selectedFinishGroups(finishes: SelectedFinish[]): SelectedFinishGroup[] {
  const groups: SelectedFinishGroup[] = [];
  const groupByLabel = new Map<string, SelectedFinishGroup>();

  for (const finish of finishes) {
    const label = finish.label || "Other Finishes";
    const existingGroup = groupByLabel.get(label);

    if (existingGroup) {
      existingGroup.finishes.push(finish);
      existingGroup.sortOrder = Math.min(existingGroup.sortOrder, finish.groupSortOrder);
      existingGroup.firstIndex = Math.min(existingGroup.firstIndex, finish.firstIndex);
      continue;
    }

    const group = {
      label,
      finishes: [finish],
      firstIndex: finish.firstIndex,
      sortOrder: finish.groupSortOrder,
    };
    groups.push(group);
    groupByLabel.set(label, group);
  }

  return groups
    .map((group) => ({
      ...group,
      finishes: [...group.finishes].sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          (left.code ?? "").localeCompare(right.code ?? "") ||
          left.value.localeCompare(right.value),
      ),
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.firstIndex - right.firstIndex ||
        left.label.localeCompare(right.label),
    );
}

function selectedFinishLayoutMode(groups: SelectedFinishGroup[], totalCount: number): SelectedFinishLayoutMode {
  const largestGroupCount = Math.max(0, ...groups.map((group) => group.finishes.length));
  const fewFinishes = totalCount <= 4 || (groups.length <= 2 && groups.every((group) => group.finishes.length <= 2));

  if (totalCount > 12 || largestGroupCount > 8) return "dense";
  if (fewFinishes) return "few";
  return "compact";
}

function SelectedFinishGroups({ finishes }: { finishes: SelectedFinish[] }) {
  const groups = selectedFinishGroups(finishes);
  const totalCount = groups.reduce((total, group) => total + group.finishes.length, 0);
  const mode = selectedFinishLayoutMode(groups, totalCount);

  if (mode === "few") {
    return (
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0 border border-zinc-200 bg-white p-3">
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-700">{group.label}</h4>
            <div className="grid gap-3">
              {group.finishes.map((finish) => (
                <SelectedFinishCard key={finish.id} finish={finish} mode={mode} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={mode === "dense" ? "mt-2 grid gap-2" : "mt-3 grid gap-3"}>
      {groups.map((group) => (
        <div key={group.label} className={mode === "dense" ? "border-t border-zinc-200 pt-1.5 first:border-t-0 first:pt-0" : "border border-zinc-200 bg-white p-2.5"}>
          <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-700">{group.label}</h4>
          <div className={mode === "dense" ? "mt-1.5 grid grid-cols-5 gap-x-2 gap-y-2 md:grid-cols-7" : "mt-2 grid grid-cols-3 gap-2 md:grid-cols-5"}>
            {group.finishes.map((finish) => (
              <SelectedFinishCard key={finish.id} finish={finish} mode={mode} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MaterialChartBlock({
  chart,
  hasMore,
  limitSwatches = true,
  start = 0,
}: {
  chart: MaterialChart;
  hasMore?: boolean;
  limitSwatches?: boolean;
  start?: number;
}) {
  const swatches = limitSwatches ? chart.swatches.slice(start, start + chartSwatchesPerProductPage) : chart.swatches.slice(start);

  if (!swatches.length) return null;

  return (
    <div className="mt-4">
      <div className="flex items-end justify-between gap-3">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-700">{chart.title}</h4>
        {hasMore ? <p className="text-[10px] font-semibold text-zinc-500">More options continued on next page</p> : null}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {swatches.map((swatch, index) => (
          <div key={`${chart.id}-${start + index}`} className="bg-white p-1.5">
            <div className="flex h-14 items-center justify-center bg-white">
              {swatch.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={swatch.imageUrl} alt={swatch.name || swatch.code || chart.groupLabel} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-[9px] uppercase text-zinc-400">Swatch</span>
              )}
            </div>
            {swatch.code ? <p className="mt-1 text-[10px] font-bold text-zinc-950">{swatch.code}</p> : null}
            {swatch.name ? <p className="truncate text-[10px] text-zinc-600">{swatch.name}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MaterialsFinishesArea({
  allowContinuation,
  charts,
  selectedFinishes,
}: {
  allowContinuation: boolean;
  charts: MaterialChart[];
  selectedFinishes: SelectedFinish[];
}) {
  const visibleSelected = allowContinuation ? selectedFinishes.slice(0, selectedFinishesPerProductPage) : selectedFinishes;
  const hasMoreSelected = allowContinuation && selectedFinishes.length > selectedFinishesPerProductPage;
  const visibleCharts = charts.filter((chart) => chart.swatches.length);
  const hasContent = visibleSelected.length || visibleCharts.length;

  return (
    <section className="spec-material-details mt-4 border-t border-zinc-300 pt-3">
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-800">Materials & Finishes</h3>
        {hasMoreSelected ? <p className="text-[10px] font-semibold text-zinc-500">Additional finishes continued on next page</p> : null}
      </div>

      {hasContent ? (
        <>
          {visibleSelected.length ? (
            <SelectedFinishGroups finishes={visibleSelected} />
          ) : null}

          {visibleCharts.map((chart) => (
            <MaterialChartBlock
              key={chart.id}
              chart={chart}
              hasMore={allowContinuation && chart.swatches.length > chartSwatchesPerProductPage}
              limitSwatches={allowContinuation}
            />
          ))}
        </>
      ) : null}
    </section>
  );
}

function MaterialsContinuationPage({
  companyProfile,
  finishImageUrlById,
  hasLogo,
  materialGroupSortOrderByLinkId,
  page,
  projectReferenceDisplay,
  quotation,
  totalPages,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  finishImageUrlById: Map<string, string | null>;
  hasLogo: boolean;
  materialGroupSortOrderByLinkId: Map<string, number>;
  page: Extract<SpecDocumentPage, { type: "materials_continuation" }>;
  projectReferenceDisplay: string;
  quotation: Quotation;
  totalPages: number;
}) {
  const title = page.item.item_name_snapshot || page.item.model_snapshot || page.item.item_code_snapshot || "Product";
  const { charts, selectedFinishes } = materialContent(page.item, finishImageUrlById, materialGroupSortOrderByLinkId);
  const selectedSlice = typeof page.selectedStart === "number"
    ? selectedFinishes.slice(page.selectedStart, page.selectedStart + selectedFinishesPerProductPage)
    : [];
  const chart = page.chartId ? charts.find((candidate) => candidate.id === page.chartId) ?? null : null;

  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader companyProfile={companyProfile} hasLogo={hasLogo} pageNumber={page.pageNumber} projectReferenceDisplay={projectReferenceDisplay} quotation={quotation} totalPages={totalPages} />
      <div className="mt-8 border-b border-zinc-200 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
          {[page.mainSection?.section_title, page.section.section_title].filter(Boolean).join(" / ") || "Specification"}
        </p>
        <h2 className="mt-2 text-3xl font-bold leading-tight text-zinc-950">{title}</h2>
        <div className="mt-1 flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">Materials & Finishes continuation</p>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Item No. {page.serial || "-"}</p>
        </div>
      </div>

      <section className="mt-6">
        <h3 className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-800">Materials & Finishes</h3>
        {selectedSlice.length ? (
          <SelectedFinishGroups finishes={selectedSlice} />
        ) : null}
        {chart ? (
          <MaterialChartBlock
            chart={chart}
            start={page.chartStart ?? chartSwatchesPerProductPage}
            hasMore={(page.chartStart ?? 0) + chartSwatchesPerProductPage < chart.swatches.length}
          />
        ) : null}
      </section>
      <PageFooter companyName={companyProfile.companyName} pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function DescriptionContinuationPage({
  companyProfile,
  hasLogo,
  layout,
  page,
  projectReferenceDisplay,
  quotation,
  totalPages,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  hasLogo: boolean;
  layout: SpecificationLayoutSettings;
  page: Extract<SpecDocumentPage, { type: "description_continuation" }>;
  projectReferenceDisplay: string;
  quotation: Quotation;
  totalPages: number;
}) {
  const title = page.item.item_name_snapshot || page.item.model_snapshot || page.item.item_code_snapshot || "Product";
  const compact = layout.textDensity === "compact";

  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader companyProfile={companyProfile} hasLogo={hasLogo} pageNumber={page.pageNumber} projectReferenceDisplay={projectReferenceDisplay} quotation={quotation} totalPages={totalPages} />
      <div className="mt-8 border-b border-zinc-200 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
          {[page.mainSection?.section_title, page.section.section_title].filter(Boolean).join(" / ") || "Specification"}
        </p>
        <h2 className="mt-2 text-3xl font-bold leading-tight text-zinc-950">{title}</h2>
        <div className="mt-1 flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">Description / Specification — continued</p>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Item No. {page.serial || "-"}</p>
        </div>
      </div>
      <section className="mt-6">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Description / Specification — continued</h3>
        <p className={`mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-700 ${compact ? "text-[9.5px] leading-[13px]" : "text-[10.5px] leading-[15px]"}`}>{page.description}</p>
        {page.descriptionContinues ? <p className="mt-4 text-[10px] font-medium text-zinc-500">Description continues on the next page.</p> : null}
      </section>
      <PageFooter companyName={companyProfile.companyName} pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function ProductSpecPage({
  companyProfile,
  description,
  descriptionContinues,
  hasLogo,
  item,
  layout,
  finishImageUrlById,
  mainSection,
  materialGroupSortOrderByLinkId,
  pageNumber,
  projectReferenceDisplay,
  proposedImage,
  quotation,
  section,
  showMaterials,
  specificationImageOverride,
  specifiedImage,
  serial,
  totalPages,
  visibility,
}: {
  companyProfile: Awaited<ReturnType<typeof getCompanyProfile>>;
  description: string | null;
  descriptionContinues: boolean;
  hasLogo: boolean;
  item: QuotationItem;
  layout: SpecificationLayoutSettings;
  finishImageUrlById: Map<string, string | null>;
  mainSection: QuotationSection | null;
  materialGroupSortOrderByLinkId: Map<string, number>;
  pageNumber: number;
  projectReferenceDisplay: string;
  proposedImage: string | null;
  quotation: Quotation;
  section: QuotationSection;
  showMaterials: boolean;
  specificationImageOverride?: SpecificationItemImageOverride;
  specifiedImage: string | null;
  serial: number;
  totalPages: number;
  visibility: DocumentVisibilitySettings["specification"];
}) {
  const title = item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || `Item ${serial}`;
  const compactText = layout.textDensity === "compact";
  const originSupplierDisplay = formatBrandOriginSupplier({
    brandName: item.brand_name_snapshot,
    origin: item.origin_snapshot,
    supplier: item.supplier_name_snapshot,
  });
  const originSupplier = [
    originSupplierDisplay.primaryLine,
    originSupplierDisplay.supplier ? `Supplier: ${originSupplierDisplay.supplier}` : null,
  ].filter(Boolean).join("\n");
  const { charts, selectedFinishes } = materialContent(item, finishImageUrlById, materialGroupSortOrderByLinkId);
  const productEyebrow =
    (visibility.showBrand ? item.brand_name_snapshot : null) ||
    (visibility.showCategory ? item.category_name_snapshot : null) ||
    "Product";

  return (
    <section data-spec-item-id={item.id} className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader companyProfile={companyProfile} hasLogo={hasLogo} pageNumber={pageNumber} projectReferenceDisplay={projectReferenceDisplay} quotation={quotation} totalPages={totalPages} />

      <div className="mt-6 flex items-center justify-between gap-6 border-b border-zinc-200 pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            {[mainSection?.section_title, section.section_title].filter(Boolean).join(" / ") || "Specification"}
          </p>
          <p className="mt-1 text-sm text-zinc-600">{item.room_name_snapshot || section.section_notes || "Product detail"}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Item No.</p>
          <p className="mt-1 text-xl font-bold text-zinc-950">{serial || "-"}</p>
        </div>
      </div>

      <div className={`spec-product-layout mt-5 grid gap-7 ${visibility.showItemImages ? "md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" : "grid-cols-1"}`}>
        {visibility.showItemImages ? <div className="spec-item-images space-y-4">
          <SpecImage
            src={proposedImage}
            label="Proposed image"
            fallbackFit={layout.productImageFit}
            mainImageSize={layout.productImageSize}
            specificationOverride={specificationImageOverride}
          />
          {specifiedImage ? (
            <div className="max-w-[260px]">
              <SpecImage
                imageSettings={item.cell_layout?.images?.specified_image_url_snapshot}
                src={specifiedImage}
                label="Specified / reference image"
                fallbackFit={layout.productImageFit}
              />
            </div>
          ) : null}
        </div> : null}

        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{productEyebrow}</p>
          <h2 className="mt-2 text-3xl font-bold leading-tight text-zinc-950">
            {title}
            {item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
            {item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
            {visibility.showBrand ? <DetailLine compact={compactText} label="Brand" value={item.brand_name_snapshot} /> : null}
            {visibility.showModel ? <DetailLine compact={compactText} label="Model" value={item.model_snapshot} /> : null}
            {visibility.showCode ? <DetailLine compact={compactText} label="Code" value={item.item_code_snapshot} /> : null}
            {visibility.showCategory ? <DetailLine compact={compactText} label="Category" value={item.category_name_snapshot} /> : null}
            {visibility.showDimensions ? <div className="spec-dimensions">
              <DetailLine compact={compactText} label="Dimensions" value={item.size_snapshot} />
            </div> : null}
            {visibility.showOriginSupplier ? <DetailLine compact={compactText} label="Origin / Supplier" value={originSupplier} /> : null}
            <DetailLine compact={compactText} label="Warranty" value={item.warranty_snapshot} />
          </dl>

          {visibility.showDescriptionSpecification && description ? (
            <div className="mt-4 border-t border-zinc-200 pt-3">
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">Description / Specification</h3>
              <p className={`spec-description-body mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-700 ${compactText ? "text-[9.5px] leading-[13px]" : "text-[10.5px] leading-[15px]"}`}>{description}</p>
              {descriptionContinues ? <p className="mt-2 text-[10px] font-medium text-zinc-500">Description continues on the next page.</p> : null}
            </div>
          ) : null}

        </div>
      </div>
      {visibility.showMaterialDetails && showMaterials ? (
        <MaterialsFinishesArea
          allowContinuation={item.allow_material_continuation_page}
          charts={charts}
          selectedFinishes={selectedFinishes}
        />
      ) : null}
      <PageFooter companyName={companyProfile.companyName} pageNumber={pageNumber} totalPages={totalPages} />
    </section>
  );
}

export default async function SpecificationPage({ params }: SpecificationPageProps) {
  const { profile } = await requireActiveUser();
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,revision_no,title,quotation_date,legacy_reference,option_no,layout_settings,currency,vat_percent,overall_discount_type,overall_discount_value,payment_terms,validity,delivery_terms,warranty_terms,notes")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const projectId = validUuidOrNull(quotation.project_id);
  const [
    { data: client },
    projectResult,
    { data: sections },
    { data: items },
    { data: materialGroupOrders, error: materialGroupOrdersError },
  ] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,client_number,company_name")
        .eq("id", quotation.client_id)
        .single<Client>(),
      projectId
        ? supabase
            .from("projects")
            .select("id,project_name,project_number,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
            .eq("id", projectId)
            .maybeSingle<Project>()
        : Promise.resolve({ data: null }),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("section_title", { ascending: true })
        .returns<QuotationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,sort_order,is_optional,is_rate_only,line_style,is_active,cell_layout,notes")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<QuotationItem[]>(),
      supabase
        .from("product_template_material_groups")
        .select("id,sort_order")
        .eq("is_active", true)
        .returns<ProductTemplateMaterialGroupOrder[]>(),
    ]);
  const project = projectResult.data;
  const resolvedDocumentSetup = resolveDocumentSetup({
    client: client ?? null,
    project: project ?? null,
    quotation,
  });
  const projectReferenceDisplay = resolvedDocumentSetup.header.reference.trim() || "-";
  const specificationVisibility = resolvedDocumentSetup.visibility.specification;
  const specificationLayout = resolvedDocumentSetup.specificationLayout;

  if (materialGroupOrdersError) {
    console.error("SPECIFICATION MATERIAL GROUP ORDER ERROR", materialGroupOrdersError.message);
  }

  const activeItems = (items ?? []).filter((item) => item.is_active);
  const savedDocumentSetup = documentSetupRecord(quotation.layout_settings);
  const savedVisibility = isRecord(savedDocumentSetup.visibility) ? savedDocumentSetup.visibility : {};
  const savedSpecification = isRecord(savedVisibility.specification) ? savedVisibility.specification : {};
  const savedItemImageOverrides = savedSpecification.itemImageOverrides;
  const hasSavedItemImageOverrides = isRecord(savedItemImageOverrides);
  const itemImageOverrides: Record<string, SpecificationItemImageOverride> = {};

  for (const item of activeItems) {
    const savedOverride = hasSavedItemImageOverrides
      ? specificationItemImageOverride(savedItemImageOverrides[item.id])
      : null;
    if (savedOverride?.replacementImageUrl && !savedOverride.replacementImageUrl.startsWith(`quote-images:quotation-specifications/${quotation.id}/${item.id}/`)) {
      delete savedOverride.replacementImageUrl;
    }
    const legacySettings = item.cell_layout?.images?.proposed_image_url_snapshot;
    const legacyOverride = !hasSavedItemImageOverrides && legacySettings && Object.keys(legacySettings).length
      ? specificationItemImageOverride({ ...legacySettings, size: specificationLayout.productImageSize })
      : null;
    const override = savedOverride ?? legacyOverride;
    if (override) itemImageOverrides[item.id] = override;
  }
  const replacementImageEntries = await Promise.all(
    Object.entries(itemImageOverrides).map(async ([itemId, override]) => [
      itemId,
      override.replacementImageUrl
        ? await signedImageUrl(override.replacementImageUrl, supabase)
        : null,
    ] as const),
  );
  for (const [itemId, replacementPreviewUrl] of replacementImageEntries) {
    if (replacementPreviewUrl) itemImageOverrides[itemId].replacementPreviewUrl = replacementPreviewUrl;
  }
  const proposedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot, supabase),
    ] as const),
  );
  const specifiedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const finishImageEntries = await Promise.all(
    activeItems.flatMap((item) =>
      materialEntries(item).flatMap((finish, index) => {
        const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;

        if (stringFromRecord(finish, ["type"]) === "material_group_chart") {
          return swatchRecords(finish).map(async (swatch, swatchIndex) => [
            `${item.id}:${finishId}:${swatchIndex}`,
            await signedImageUrl(stringFromRecord(swatch, ["image_url"]), supabase),
          ] as const);
        }

        return [
          (async () => [
            `${item.id}:${finishId}`,
            await signedImageUrl(stringFromRecord(finish, ["finish_image_url"]), supabase),
          ] as const)(),
        ];
      }),
    ),
  );
  const proposedImageUrlByItemId = new Map(proposedImageEntries);
  const specifiedImageUrlByItemId = new Map(specifiedImageEntries);
  const finishImageUrlByItemAndFinishId = new Map(finishImageEntries);
  const materialGroupSortOrderByLinkId = new Map(
    (materialGroupOrders ?? []).map((row) => [row.id, row.sort_order] as const),
  );
  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    const sectionItems = itemsBySection.get(key) ?? [];
    sectionItems.push(item);
    itemsBySection.set(key, sectionItems);
  }

  const activeSections = [
    ...(sections ?? []),
    ...(itemsBySection.has("unsectioned")
      ? [{
          id: "unsectioned",
          section_title: "General Items",
          section_notes: null,
          parent_section_id: null,
          section_kind: "sub" as const,
          sort_order: 999999,
          is_active: true,
        }]
      : []),
  ];
  const mainSectionIds = new Set(
    activeSections
      .filter((section) => section.section_kind === "main")
      .map((section) => section.id),
  );
  const childrenByParent = new Map<string, QuotationSection[]>();

  for (const section of activeSections) {
    if (section.section_kind !== "sub" || !section.parent_section_id) continue;

    const children = childrenByParent.get(section.parent_section_id) ?? [];
    children.push(section);
    childrenByParent.set(section.parent_section_id, children);
  }

  const printableSections: DisplaySection[] = [];

  for (const section of activeSections) {
    if (section.section_kind === "main") {
      printableSections.push({ ...section, renderAsMainOnly: true });

      for (const child of childrenByParent.get(section.id) ?? []) {
        printableSections.push(child);
      }

      continue;
    }

    if (section.parent_section_id && mainSectionIds.has(section.parent_section_id)) {
      continue;
    }

    printableSections.push(section);
  }

  const sectionById = new Map(activeSections.map((section) => [section.id, section]));
  const documentPages: SpecDocumentPage[] = [];
  let nextPageNumber = specificationVisibility.showFrontPage ? 2 : 1;
  let productSerial = 0;

  for (const section of printableSections) {
    if (section.renderAsMainOnly) {
      documentPages.push({ type: "divider", section, pageNumber: nextPageNumber });
      nextPageNumber += 1;
      continue;
    }

    const mainSection = section.parent_section_id ? sectionById.get(section.parent_section_id) ?? null : null;
    const sectionItems = itemsBySection.get(section.id) ?? [];

    for (const item of sectionItems) {
      if (isBlankRow(item)) continue;

      if (isHeadingRow(item) || isNoteRow(item)) {
        documentPages.push({
          type: "text",
          item,
          mainSection,
          pageNumber: nextPageNumber,
          section,
        });
        nextPageNumber += 1;
        continue;
      }

      const rowSerial = isSerialCountedLine(item) ? ++productSerial : 0;
      const cleanedDescription = specificationVisibility.showDescriptionSpecification
        ? specificationWithoutDuplicateCode({
            code: item.item_code_snapshot,
            specification: item.specification_snapshot,
          })
        : null;
      const chunks = cleanedDescription
        ? descriptionChunks(cleanedDescription, specificationLayout.textDensity === "compact")
        : [];
      const descriptionContinues = chunks.length > 1;
      documentPages.push({
        type: "product",
        description: chunks[0] ?? null,
        descriptionContinues,
        item,
        mainSection,
        pageNumber: nextPageNumber,
        section,
        serial: rowSerial,
        showMaterials: !descriptionContinues,
      });
      nextPageNumber += 1;

      for (const [chunkIndex, description] of chunks.slice(1).entries()) {
        documentPages.push({
          type: "description_continuation",
          description,
          descriptionContinues: chunkIndex < chunks.length - 2,
          item,
          mainSection,
          pageNumber: nextPageNumber,
          section,
          serial: rowSerial,
        });
        nextPageNumber += 1;
      }

      if (specificationVisibility.showMaterialDetails && (descriptionContinues || item.allow_material_continuation_page)) {
        const selectedCount = selectedFinishEntries(item).length;
        for (
          let selectedStart = descriptionContinues ? 0 : selectedFinishesPerProductPage;
          selectedStart < selectedCount;
          selectedStart += selectedFinishesPerProductPage
        ) {
          documentPages.push({
            type: "materials_continuation",
            item,
            mainSection,
            pageNumber: nextPageNumber,
            section,
            selectedStart,
            serial: rowSerial,
          });
          nextPageNumber += 1;
        }

        for (const [chartIndex, chart] of materialEntries(item).entries()) {
          if (stringFromRecord(chart, ["type"]) !== "material_group_chart") continue;

          const chartId = stringFromRecord(chart, ["id"]) || `finish-${chartIndex + 1}`;
          const swatchCount = swatchRecords(chart).length;

          for (
            let chartStart = descriptionContinues ? 0 : chartSwatchesPerProductPage;
            chartStart < swatchCount;
            chartStart += chartSwatchesPerProductPage
          ) {
            documentPages.push({
              type: "materials_continuation",
              chartId,
              chartStart,
              item,
              mainSection,
              pageNumber: nextPageNumber,
              section,
              serial: rowSerial,
            });
            nextPageNumber += 1;
          }
        }
      }
    }
  }

  const totalPages = Math.max(nextPageNumber - 1, specificationVisibility.showFrontPage ? 1 : 0);
  const COMPANY_PROFILE = await getCompanyProfile();
  const hasLogo = hasUsableCompanyLogo(COMPANY_PROFILE.logoPath);
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "procurement_manager" ||
    profile?.role === "sales_designer" ||
    profile?.role === "sales_coordinator" ||
    profile?.role === "designer";
  const specificationSettings: SpecificationSettings = {
    itemImageOverrides,
    productImageFit: specificationLayout.productImageFit,
    productImageSize: specificationLayout.productImageSize,
    showBrand: specificationVisibility.showBrand,
    showCategory: specificationVisibility.showCategory,
    showClientReferenceHeader: specificationVisibility.showClientReferenceHeader,
    showCode: specificationVisibility.showCode,
    showDescriptionSpecification: specificationVisibility.showDescriptionSpecification,
    showDimensions: specificationVisibility.showDimensions,
    showFrontPage: specificationVisibility.showFrontPage,
    showFrontPageAttentionContact: specificationVisibility.showFrontPageAttentionContact,
    showFrontPageClient: specificationVisibility.showFrontPageClient,
    showFrontPageCompanyFooter: specificationVisibility.showFrontPageCompanyFooter,
    showFrontPageLocation: specificationVisibility.showFrontPageLocation,
    showFrontPagePageNumber: specificationVisibility.showFrontPagePageNumber,
    showFrontPagePoBox: specificationVisibility.showFrontPagePoBox,
    showFrontPageProjectAddress: specificationVisibility.showFrontPageProjectAddress,
    showFrontPageProjectReference: specificationVisibility.showFrontPageProjectReference,
    showFrontPageProjectTitle: specificationVisibility.showFrontPageProjectTitle,
    showFrontPageTelephone: specificationVisibility.showFrontPageTelephone,
    showItemImages: specificationVisibility.showItemImages,
    showMaterialDetails: specificationVisibility.showMaterialDetails,
    showModel: specificationVisibility.showModel,
    showOriginSupplier: specificationVisibility.showOriginSupplier,
    textDensity: specificationLayout.textDensity,
  };
  const specificationImageItems: SpecificationImageItem[] = documentPages
    .filter((page): page is Extract<SpecDocumentPage, { type: "product" }> => page.type === "product")
    .map((page) => ({
      brand: page.item.brand_name_snapshot,
      id: page.item.id,
      itemNumber: page.serial,
      name: page.item.item_name_snapshot || page.item.model_snapshot || page.item.item_code_snapshot || `Item ${page.serial}`,
      thumbnailUrl: proposedImageUrlByItemId.get(page.item.id) ?? null,
    }));
  const showFrontPageLeftColumn =
    specificationVisibility.showFrontPageClient ||
    specificationVisibility.showFrontPageLocation ||
    specificationVisibility.showFrontPageAttentionContact;
  const showFrontPageRightColumn =
    specificationVisibility.showFrontPageProjectReference ||
    specificationVisibility.showFrontPageTelephone ||
    specificationVisibility.showFrontPagePoBox ||
    specificationVisibility.showFrontPageProjectAddress;

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-100 px-4 py-5 font-sans text-zinc-950 xl:overflow-x-visible print:bg-white print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .spec-page + .spec-page { margin-top: 24px; }
        @media screen and (max-width: 767px) {
          .spec-sheet .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .spec-sheet .md\\:grid-cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
          .spec-sheet .md\\:grid-cols-7 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
          .spec-sheet .spec-product-layout { grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); }
        }
        .spec-hide-client-reference .spec-client-reference { display: none !important; }
        .spec-hide-item-images .spec-item-images { display: none !important; }
        .spec-hide-item-images .spec-product-layout { grid-template-columns: minmax(0, 1fr) !important; }
        .spec-hide-dimensions .spec-dimensions { display: none !important; }
        .spec-hide-material-details .spec-material-details { display: none !important; }
        .spec-draft-density-standard .spec-detail-value,
        .spec-draft-density-standard .spec-description-body { font-size: 10.5px !important; line-height: 15px !important; }
        .spec-draft-density-compact .spec-detail-value,
        .spec-draft-density-compact .spec-description-body { font-size: 9.5px !important; line-height: 13px !important; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; background: #fff !important; print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
          img { break-inside: avoid; page-break-inside: avoid; }
          .no-print { display: none !important; }
          .spec-workspace { display: block !important; }
          .spec-preview-viewport { overflow: visible !important; }
          .spec-preview-reservation { position: static !important; width: auto !important; height: auto !important; margin: 0 !important; }
          .spec-preview-scale { position: static !important; width: auto !important; transform: none !important; }
          .spec-sheet { box-shadow: none !important; display: block !important; width: 210mm !important; max-width: 210mm !important; margin: 0 !important; }
          .spec-page { box-shadow: none !important; box-sizing: border-box !important; width: 210mm !important; height: 297mm !important; min-height: 297mm !important; overflow: hidden !important; break-after: page; break-inside: avoid; page-break-after: always; page-break-inside: avoid; margin: 0 !important; print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
          .spec-page + .spec-page { margin-top: 0 !important; }
          .spec-page:last-child { break-after: auto; page-break-after: auto; }
          .avoid-break, .spec-heading, .spec-page-header { break-inside: avoid; page-break-inside: avoid; }
          .spec-heading { break-after: avoid; page-break-after: avoid; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 hidden w-[210mm] max-w-full items-center justify-between gap-3 xl:flex">
        <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900">
          Back to quotation
        </Link>
      </div>

      <SpecificationPreview
        backHref={`/quotations/${quotation.id}`}
        canManage={canManageRecords}
        downloadHref={`/quotations/${quotation.id}/download-specification`}
        initialSettings={specificationSettings}
        imageItems={specificationImageItems}
        pageCount={totalPages}
        quotationId={quotation.id}
        quotationNo={quotation.quotation_no ?? "Draft"}
      >
        <div className="spec-sheet mx-auto box-border w-[210mm] max-w-full">
        {specificationVisibility.showFrontPage ? (
          <section className="spec-page flex min-h-[277mm] flex-col bg-white px-12 py-11 shadow-sm ring-1 ring-zinc-200">
          <header className="spec-page-header border-b border-zinc-300 pb-6">
            <div className="grid w-full grid-cols-[240px_minmax(0,1fr)_220px] items-start gap-6">
              <div className="min-w-0">
                {hasLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={COMPANY_PROFILE.logoPath ?? ""} alt={COMPANY_PROFILE.name} className="h-[54px] w-[168px] object-contain" />
                ) : (
                  <div className="flex h-[54px] w-[168px] items-center justify-center border-2 border-zinc-900 px-4 text-center text-sm font-black leading-tight tracking-tight">
                    {COMPANY_PROFILE.displayName}
                  </div>
                )}
                <div className="mt-2">
                  <p className="text-[13px] font-bold leading-tight text-zinc-950">{COMPANY_PROFILE.name}</p>
                  <p className="mt-1 text-[11px] leading-4 text-zinc-600">
                    {COMPANY_PROFILE.offices.map((office) => office.location).join(" / ")}
                  </p>
                  <p className="text-[11px] leading-4 text-zinc-600">TRN: {COMPANY_PROFILE.trn}</p>
                </div>
              </div>
              <div className="justify-self-center pt-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400">Document</p>
                <p className="mt-2 text-[24px] font-bold leading-none tracking-[0.08em] text-zinc-950">SPECIFICATION SHEET</p>
              </div>
              <div className="flex justify-end pt-1 text-right">
                <dl className="spec-client-reference grid w-full max-w-[230px] grid-cols-[70px_minmax(0,1fr)] gap-x-4 gap-y-2 border-l border-zinc-200 pl-5">
                  <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
                  <MetaLine label="Date" value={quotation.quotation_date} />
                </dl>
              </div>
            </div>
          </header>

          <section className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[680px]">
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-zinc-400">Project Summary</p>
              {specificationVisibility.showFrontPageProjectTitle ? (
                <h1 className="mt-4 text-[46px] font-bold leading-[1.05] tracking-tight text-zinc-950">
                  {projectReferenceDisplay}
                </h1>
              ) : null}
              <div className="mt-8 h-px w-28 bg-zinc-300" />
              {showFrontPageLeftColumn || showFrontPageRightColumn ? (
                <div className={`mt-10 grid gap-x-14 gap-y-8 ${showFrontPageLeftColumn && showFrontPageRightColumn ? "md:grid-cols-2" : "grid-cols-1"}`}>
                  {showFrontPageLeftColumn ? (
                    <dl className="grid content-start gap-7">
                      {specificationVisibility.showFrontPageClient ? <InfoLine label="Client" value={resolvedDocumentSetup.header.clientDisplayName || client?.company_name || "Client"} /> : null}
                      {specificationVisibility.showFrontPageLocation ? <InfoLine label="Location" value={resolvedDocumentSetup.header.location || project?.location} /> : null}
                      {specificationVisibility.showFrontPageAttentionContact ? <InfoLine label="Attention / Contact" value={resolvedDocumentSetup.header.contactName || projectContactLine(project)} /> : null}
                    </dl>
                  ) : null}
                  {showFrontPageRightColumn ? (
                    <dl className="grid content-start gap-7">
                      {specificationVisibility.showFrontPageProjectReference ? <InfoLine label="Project / Reference" value={projectReferenceDisplay} /> : null}
                      {specificationVisibility.showFrontPageTelephone ? <InfoLine label="Telephone" value={resolvedDocumentSetup.header.telephone || project?.attention_landline} /> : null}
                      {specificationVisibility.showFrontPagePoBox ? <InfoLine label="PO Box" value={resolvedDocumentSetup.header.poBox || project?.po_box} /> : null}
                      {specificationVisibility.showFrontPageProjectAddress ? <InfoLine label="Project Address" value={resolvedDocumentSetup.header.projectAddress || project?.project_address} /> : null}
                    </dl>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <PageFooter
            companyName={COMPANY_PROFILE.companyName}
            pageNumber={1}
            showCompanyName={specificationVisibility.showFrontPageCompanyFooter}
            showPageNumber={specificationVisibility.showFrontPagePageNumber}
            totalPages={totalPages}
          />
          </section>
        ) : null}

        {documentPages.map((page) => {
          if (page.type === "divider") {
            return (
              <DividerPage
                companyProfile={COMPANY_PROFILE}
                key={`divider-${page.section.id}-${page.pageNumber}`}
                client={client}
                page={page}
                project={project}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          if (page.type === "text") {
            return (
              <TextBlockPage
                companyProfile={COMPANY_PROFILE}
                key={`text-${page.item.id}-${page.pageNumber}`}
                hasLogo={hasLogo}
                page={page}
                projectReferenceDisplay={projectReferenceDisplay}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          if (page.type === "materials_continuation") {
            return (
              <MaterialsContinuationPage
                companyProfile={COMPANY_PROFILE}
                key={`materials-${page.item.id}-${page.pageNumber}`}
                finishImageUrlById={new Map(
                  materialEntries(page.item).flatMap((finish, index) => {
                    const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
                    if (stringFromRecord(finish, ["type"]) === "material_group_chart") {
                      return swatchRecords(finish).map((_, swatchIndex) => [
                        `${finishId}:${swatchIndex}`,
                        finishImageUrlByItemAndFinishId.get(`${page.item.id}:${finishId}:${swatchIndex}`) ?? null,
                      ] as const);
                    }

                    return [[finishId, finishImageUrlByItemAndFinishId.get(`${page.item.id}:${finishId}`) ?? null] as const];
                  }),
                )}
                hasLogo={hasLogo}
                materialGroupSortOrderByLinkId={materialGroupSortOrderByLinkId}
                page={page}
                projectReferenceDisplay={projectReferenceDisplay}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          if (page.type === "description_continuation") {
            return (
              <DescriptionContinuationPage
                companyProfile={COMPANY_PROFILE}
                hasLogo={hasLogo}
                key={`description-${page.item.id}-${page.pageNumber}`}
                layout={specificationLayout}
                page={page}
                projectReferenceDisplay={projectReferenceDisplay}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          return (
            <ProductSpecPage
              companyProfile={COMPANY_PROFILE}
              description={page.description}
              descriptionContinues={page.descriptionContinues}
              key={`product-${page.item.id}`}
              finishImageUrlById={new Map(
                materialEntries(page.item).flatMap((finish, index) => {
                    const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
                    if (stringFromRecord(finish, ["type"]) === "material_group_chart") {
                      return swatchRecords(finish).map((_, swatchIndex) => [
                        `${finishId}:${swatchIndex}`,
                        finishImageUrlByItemAndFinishId.get(`${page.item.id}:${finishId}:${swatchIndex}`) ?? null,
                      ] as const);
                    }

                    return [[finishId, finishImageUrlByItemAndFinishId.get(`${page.item.id}:${finishId}`) ?? null] as const];
                  }),
              )}
              hasLogo={hasLogo}
              item={page.item}
              layout={specificationLayout}
              mainSection={page.mainSection}
              materialGroupSortOrderByLinkId={materialGroupSortOrderByLinkId}
              pageNumber={page.pageNumber}
              projectReferenceDisplay={projectReferenceDisplay}
              proposedImage={itemImageOverrides[page.item.id]?.replacementPreviewUrl ?? proposedImageUrlByItemId.get(page.item.id) ?? null}
              quotation={quotation}
              section={page.section}
              serial={page.serial}
              showMaterials={page.showMaterials}
              specificationImageOverride={itemImageOverrides[page.item.id]}
              specifiedImage={specifiedImageUrlByItemId.get(page.item.id) ?? null}
              totalPages={totalPages}
              visibility={specificationVisibility}
            />
          );
        })}
        </div>
      </SpecificationPreview>
    </main>
  );
}
