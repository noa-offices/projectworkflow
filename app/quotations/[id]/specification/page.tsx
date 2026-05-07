import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireActiveUser } from "@/lib/auth";
import { COMPANY_PROFILE } from "@/lib/company-profile";
import {
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SpecificationPageProps = {
  params: Promise<{ id: string }>;
};

type Client = {
  id: string;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
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
  project_id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  status: string;
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
    }
  | {
      type: "text";
      item: QuotationItem;
      mainSection: QuotationSection | null;
      section: QuotationSection;
      pageNumber: number;
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

function DetailLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{value}</dd>
    </div>
  );
}

function SpecImage({
  imageSettings,
  src,
  label,
  large,
}: {
  imageSettings?: Partial<ImageDisplaySettings> | null;
  src: string | null;
  label: string;
  large?: boolean;
}) {
  const settings = normalizeImageDisplaySettings(imageSettings);

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <div className={`flex items-center justify-center overflow-hidden bg-white ${large ? "h-[350px]" : "h-28"}`}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={label}
            className="block h-full w-full"
            style={imageDisplayStyle(settings)}
          />
        ) : (
          <span className="text-xs text-zinc-400">No image</span>
        )}
      </div>
    </div>
  );
}

function PageFooter({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) {
  return (
    <footer className="mt-auto flex items-center justify-between border-t border-zinc-200 pt-4 text-[10px] uppercase tracking-wide text-zinc-400">
      <span>{COMPANY_PROFILE.name}</span>
      <span>Page {pageNumber} of {totalPages}</span>
    </footer>
  );
}

function ProductPageHeader({
  hasLogo,
  pageNumber,
  project,
  quotation,
  totalPages,
}: {
  hasLogo: boolean;
  pageNumber: number;
  project?: Project | null;
  quotation: Quotation;
  totalPages: number;
}) {
  return (
    <header className="flex items-start justify-between border-b border-zinc-200 pb-4">
      <div className="min-w-0">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={COMPANY_PROFILE.logoPath} alt={COMPANY_PROFILE.name} className="h-10 w-32 object-contain" />
        ) : (
          <div className="text-sm font-black uppercase tracking-tight text-zinc-950">NOA Office Solutions</div>
        )}
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Specification Sheet</p>
      </div>
      <dl className="grid min-w-[190px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-right">
        <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
        <MetaLine label="Date" value={quotation.quotation_date} />
        <MetaLine label="Project" value={project?.project_name} />
        <MetaLine label="Page" value={`${pageNumber} / ${totalPages}`} />
      </dl>
    </header>
  );
}

function DividerPage({
  client,
  page,
  project,
  quotation,
  totalPages,
}: {
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
      <PageFooter pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function TextBlockPage({
  hasLogo,
  page,
  project,
  quotation,
  totalPages,
}: {
  hasLogo: boolean;
  page: Extract<SpecDocumentPage, { type: "text" }>;
  project?: Project | null;
  quotation: Quotation;
  totalPages: number;
}) {
  const text = rowText(page.item) || "-";

  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader hasLogo={hasLogo} pageNumber={page.pageNumber} project={project} quotation={quotation} totalPages={totalPages} />
      <div className="mt-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
          {[page.mainSection?.section_title, page.section.section_title].filter(Boolean).join(" / ") || "Specification note"}
        </p>
        <div className="mt-8 border-l border-zinc-300 pl-8">
          {isHeadingRow(page.item) ? (
            <h2 className="text-3xl font-bold leading-tight text-zinc-950">{text}</h2>
          ) : (
            <p className="whitespace-pre-wrap text-lg leading-8 text-zinc-700">{text}</p>
          )}
        </div>
      </div>
      <PageFooter pageNumber={page.pageNumber} totalPages={totalPages} />
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
    <section className="mt-5 border-t border-zinc-300 pt-4">
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-800">Materials & Finishes</h3>
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
  finishImageUrlById,
  hasLogo,
  materialGroupSortOrderByLinkId,
  page,
  project,
  quotation,
  totalPages,
}: {
  finishImageUrlById: Map<string, string | null>;
  hasLogo: boolean;
  materialGroupSortOrderByLinkId: Map<string, number>;
  page: Extract<SpecDocumentPage, { type: "materials_continuation" }>;
  project?: Project | null;
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
      <ProductPageHeader hasLogo={hasLogo} pageNumber={page.pageNumber} project={project} quotation={quotation} totalPages={totalPages} />
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
      <PageFooter pageNumber={page.pageNumber} totalPages={totalPages} />
    </section>
  );
}

function ProductSpecPage({
  hasLogo,
  item,
  finishImageUrlById,
  mainSection,
  materialGroupSortOrderByLinkId,
  pageNumber,
  project,
  proposedImage,
  quotation,
  section,
  specifiedImage,
  serial,
  totalPages,
}: {
  hasLogo: boolean;
  item: QuotationItem;
  finishImageUrlById: Map<string, string | null>;
  mainSection: QuotationSection | null;
  materialGroupSortOrderByLinkId: Map<string, number>;
  pageNumber: number;
  project?: Project | null;
  proposedImage: string | null;
  quotation: Quotation;
  section: QuotationSection;
  specifiedImage: string | null;
  serial: number;
  totalPages: number;
}) {
  const title = item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || `Item ${serial}`;
  const originSupplier = [item.supplier_name_snapshot, item.origin_snapshot].filter(Boolean).join(" / ");
  const { charts, selectedFinishes } = materialContent(item, finishImageUrlById, materialGroupSortOrderByLinkId);

  return (
    <section className="spec-page flex min-h-[277mm] flex-col bg-white p-10 shadow-sm ring-1 ring-zinc-200">
      <ProductPageHeader hasLogo={hasLogo} pageNumber={pageNumber} project={project} quotation={quotation} totalPages={totalPages} />

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

      <div className="mt-6 grid gap-7 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <SpecImage
            imageSettings={item.cell_layout?.images?.proposed_image_url_snapshot}
            src={proposedImage}
            label="Proposed image"
            large
          />
          {specifiedImage ? (
            <div className="max-w-[260px]">
              <SpecImage
                imageSettings={item.cell_layout?.images?.specified_image_url_snapshot}
                src={specifiedImage}
                label="Specified / reference image"
              />
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">{item.brand_name_snapshot || item.category_name_snapshot || "Product"}</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight text-zinc-950">{title}</h2>
          <dl className="mt-6 grid gap-x-6 gap-y-4 md:grid-cols-2">
            <DetailLine label="Brand" value={item.brand_name_snapshot} />
            <DetailLine label="Model" value={item.model_snapshot} />
            <DetailLine label="Code" value={item.item_code_snapshot} />
            <DetailLine label="Category" value={item.category_name_snapshot} />
            <DetailLine label="Dimensions" value={item.size_snapshot} />
            <DetailLine label="Origin / Supplier" value={originSupplier} />
            <DetailLine label="Warranty" value={item.warranty_snapshot} />
          </dl>

          {item.specification_snapshot ? (
            <div className="mt-5 border-t border-zinc-200 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Description / Specification</h3>
              <p className="mt-3 max-h-44 overflow-hidden whitespace-pre-wrap text-sm leading-7 text-zinc-700">{item.specification_snapshot}</p>
            </div>
          ) : null}

        </div>
      </div>
      <MaterialsFinishesArea
        allowContinuation={item.allow_material_continuation_page}
        charts={charts}
        selectedFinishes={selectedFinishes}
      />
      <PageFooter pageNumber={pageNumber} totalPages={totalPages} />
    </section>
  );
}

export default async function SpecificationPage({ params }: SpecificationPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,revision_no,title,quotation_date,status")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const [
    { data: client },
    { data: project },
    { data: sections },
    { data: items },
    { data: materialGroupOrders, error: materialGroupOrdersError },
  ] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .single<Client>(),
      supabase
        .from("projects")
        .select("id,project_name,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", quotation.project_id)
        .single<Project>(),
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
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,sort_order,line_style,is_active,cell_layout,notes")
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

  if (materialGroupOrdersError) {
    console.error("SPECIFICATION MATERIAL GROUP ORDER ERROR", materialGroupOrdersError.message);
  }

  const activeItems = (items ?? []).filter((item) => item.is_active);
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
  let nextPageNumber = 2;
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
      documentPages.push({
        type: "product",
        item,
        mainSection,
        pageNumber: nextPageNumber,
        section,
        serial: rowSerial,
      });
      nextPageNumber += 1;

      if (item.allow_material_continuation_page) {
        const selectedCount = selectedFinishEntries(item).length;
        for (
          let selectedStart = selectedFinishesPerProductPage;
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
            let chartStart = chartSwatchesPerProductPage;
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

  const totalPages = Math.max(nextPageNumber - 1, 1);
  const hasLogo = existsSync(join(process.cwd(), "public", COMPANY_PROFILE.logoPath.replace(/^\//, "")));

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5 font-sans text-zinc-950 print:bg-white print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .spec-page + .spec-page { margin-top: 24px; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; background: #fff !important; print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
          img { break-inside: avoid; page-break-inside: avoid; }
          .no-print { display: none !important; }
          .spec-sheet { box-shadow: none !important; display: block !important; width: 210mm !important; max-width: 210mm !important; margin: 0 !important; }
          .spec-page { box-shadow: none !important; box-sizing: border-box !important; width: 210mm !important; height: 297mm !important; min-height: 297mm !important; overflow: hidden !important; break-after: page; break-inside: avoid; page-break-after: always; page-break-inside: avoid; margin: 0 !important; print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
          .spec-page + .spec-page { margin-top: 0 !important; }
          .spec-page:last-child { break-after: auto; page-break-after: auto; }
          .avoid-break, .spec-heading, .spec-page-header { break-inside: avoid; page-break-inside: avoid; }
          .spec-heading { break-after: avoid; page-break-after: avoid; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-3">
        <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900">
          Back to quotation
        </Link>
      </div>

      <div className="spec-sheet mx-auto box-border w-[210mm] max-w-full">
        <section className="spec-page flex min-h-[277mm] flex-col bg-white px-12 py-11 shadow-sm ring-1 ring-zinc-200">
          <header className="spec-page-header border-b border-zinc-300 pb-6">
            <div className="grid w-full grid-cols-[240px_minmax(0,1fr)_220px] items-start gap-6">
              <div className="min-w-0">
                {hasLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={COMPANY_PROFILE.logoPath} alt={COMPANY_PROFILE.name} className="h-[54px] w-[168px] object-contain" />
                ) : (
                  <div className="flex h-[54px] w-[168px] items-center justify-center border-2 border-zinc-900 px-4 text-center text-sm font-black leading-tight tracking-tight">
                    NOA Office Solutions
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
                <dl className="grid w-full max-w-[230px] grid-cols-[70px_minmax(0,1fr)] gap-x-4 gap-y-2 border-l border-zinc-200 pl-5">
                  <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
                  <MetaLine label="Date" value={quotation.quotation_date} />
                  <MetaLine label="Status" value={quotation.status} />
                </dl>
              </div>
            </div>
          </header>

          <section className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[680px]">
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-zinc-400">Project Summary</p>
              <h1 className="mt-4 text-[46px] font-bold leading-[1.05] tracking-tight text-zinc-950">
                {project?.project_name ?? quotation.title}
              </h1>
              <div className="mt-8 h-px w-28 bg-zinc-300" />
              <div className="mt-10 grid gap-x-14 gap-y-8 md:grid-cols-2">
                <dl className="grid content-start gap-7">
                  <InfoLine label="Client" value={client?.company_name ?? "Unknown client"} />
                  <InfoLine label="Location" value={project?.location} />
                  <InfoLine label="Attention / Contact" value={projectContactLine(project)} />
                </dl>
                <dl className="grid content-start gap-7">
                  <InfoLine label="Project" value={project?.project_name ?? "Unknown project"} />
                  <InfoLine label="Project No. / Year" value={[project?.project_code, project?.project_year].filter(Boolean).join(" / ")} />
                  <InfoLine label="Project Address" value={project?.project_address} />
                </dl>
              </div>
            </div>
          </section>

          <PageFooter pageNumber={1} totalPages={totalPages} />
        </section>

        {documentPages.map((page) => {
          if (page.type === "divider") {
            return (
              <DividerPage
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
                key={`text-${page.item.id}-${page.pageNumber}`}
                hasLogo={hasLogo}
                page={page}
                project={project}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          if (page.type === "materials_continuation") {
            return (
              <MaterialsContinuationPage
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
                project={project}
                quotation={quotation}
                totalPages={totalPages}
              />
            );
          }

          return (
            <ProductSpecPage
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
              mainSection={page.mainSection}
              materialGroupSortOrderByLinkId={materialGroupSortOrderByLinkId}
              pageNumber={page.pageNumber}
              project={project}
              proposedImage={proposedImageUrlByItemId.get(page.item.id) ?? null}
              quotation={quotation}
              section={page.section}
              serial={page.serial}
              specifiedImage={specifiedImageUrlByItemId.get(page.item.id) ?? null}
              totalPages={totalPages}
            />
          );
        })}
      </div>
    </main>
  );
}
