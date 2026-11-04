import { readPricingRule, type PricingRule } from "../quotation-pricing";

// Step B2: the ONE place that decides what a Project is made of. A Project that has a frozen copy (project_snapshots, Step B1) is read from the copy,
// so a later change to the quotation cannot change the Project. A Project without a copy (an older Project) is read from the live quotation, as it
// always was. Pages and document loaders ask this module and never read quotation_items to show a Project.
// Step C2 changes this module only: it will return the latest applied variation instead of the original copy.
//
// Rows come back in the shape the pages already use: the columns asked for, with the ORIGINAL ids (item id = original_item_id, section id =
// original_section_id), so procurement progress, vendor groups, vendor documents and anything keyed by item id stay linked.

export type ProjectScopeSource = "snapshot" | "live";
/** Why a Project is read live: it has no copy (older Project), or its copy could not be read completely. */
export type ProjectScopeFallback = "no_snapshot" | "unreadable";

export type ProjectScopeOptions = {
  /** Columns of quotation_items, as the page selects them today. */
  itemColumns: string;
  /** Live order. "id", "sort_order" and "section_title" are the only columns a copy can be ordered by. Default: sort_order. */
  itemOrder?: Array<readonly [string, boolean]>;
  sectionColumns?: string;
  sectionOrder?: Array<readonly [string, boolean]>;
  /** Columns of the quotation row (totals, terms, ...). */
  headerColumns?: string;
};

export type ProjectScope<TItem = Record<string, unknown>, TSection = Record<string, unknown>, THeader = Record<string, unknown>> = {
  source: ProjectScopeSource;
  fallback: ProjectScopeFallback | null;
  snapshotId: string | null;
  /** The frozen contract amount; null for a live read, where the caller keeps using projectFile.total. */
  contractTotal: number | null;
  /** The pricing rule the Project was frozen with; null for a live read. */
  pricingRule: PricingRule | null;
  header: THeader | null;
  sections: TSection[];
  items: TItem[];
};

type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: { count?: "exact" }): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): PromiseLike<Result>;
};
type Client = { from(table: string): Query };

const PAGE = 1000;
type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const columnList = (columns: string) => columns.split(",").map((column) => column.trim()).filter(Boolean);

/** Only the asked-for columns of the saved full row. A column the row does not have is null, as in a live read. */
export function pickColumns(data: unknown, columns: string, ids?: Row): Row {
  const source = isRow(data) ? data : {};
  return { ...Object.fromEntries(columnList(columns).map((column) => [column, source[column] ?? null])), ...ids };
}

function applyOrder(query: Query, order: Array<readonly [string, boolean]>, idColumn: string) {
  let ordered = query;
  for (const [column, ascending] of order) ordered = ordered.order(column === "id" ? idColumn : column, { ascending });
  return ordered.order(idColumn, { ascending: true }); // a stable tie-break, so pages of a long list never overlap
}

/** Every row of a table, with the exact count checked. Null when anything is missing, so the caller can fall back. */
async function readAll(client: Client, table: string, snapshotId: string, order: Array<readonly [string, boolean]>, idColumn: string): Promise<Row[] | null> {
  const rows: Row[] = [];
  let expected: number | null = null;
  for (let from = 0; expected === null || from < expected; from += PAGE) {
    const base = client.from(table).select(`${idColumn},data`, { count: "exact" }).eq("snapshot_id", snapshotId);
    const { data, error, count } = await applyOrder(base, order, idColumn).range(from, from + PAGE - 1);
    if (error || !Array.isArray(data) || typeof count !== "number") return null;
    expected = count;
    rows.push(...data.filter(isRow));
    if (!data.length) break;
  }
  return expected !== null && rows.length === expected ? rows : null;
}

async function readSnapshot(client: Client, quotationId: string, options: ProjectScopeOptions): Promise<ProjectScope | ProjectScopeFallback> {
  const { data: snapshot, error } = await client.from("project_snapshots").select("id,contract_total,pricing_rule,quotation_data").eq("quotation_id", quotationId).maybeSingle();
  if (error) return "unreadable";
  if (!snapshot) return "no_snapshot";
  if (!isRow(snapshot) || typeof snapshot.id !== "string") return "unreadable";
  const contractTotal = snapshot.contract_total === null || snapshot.contract_total === undefined || snapshot.contract_total === "" ? NaN : Number(snapshot.contract_total);
  if (!Number.isFinite(contractTotal)) return "unreadable";

  const [sectionRows, itemRows] = await Promise.all([
    options.sectionColumns ? readAll(client, "project_snapshot_sections", snapshot.id, options.sectionOrder ?? [["sort_order", true]], "original_section_id") : Promise.resolve([] as Row[]),
    readAll(client, "project_snapshot_items", snapshot.id, options.itemOrder ?? [["sort_order", true]], "original_item_id"),
  ]);
  if (!sectionRows || !itemRows) return "unreadable";

  return {
    source: "snapshot",
    fallback: null,
    snapshotId: snapshot.id,
    contractTotal,
    pricingRule: snapshot.pricing_rule === "whole_aed_v1" ? "whole_aed_v1" : readPricingRule(null),
    header: options.headerColumns ? pickColumns(snapshot.quotation_data, options.headerColumns) : null,
    sections: sectionRows.map((row) => pickColumns(row.data, options.sectionColumns ?? "id", { id: row.original_section_id as string })),
    items: itemRows.map((row) => pickColumns(row.data, options.itemColumns, { id: row.original_item_id as string })),
  };
}

async function readLive(client: Client, quotationId: string, options: ProjectScopeOptions, fallback: ProjectScopeFallback): Promise<ProjectScope> {
  const log = (label: string, error: { message: string } | null) => { if (error) console.error(label, error.message); };
  let items = client.from("quotation_items").select(options.itemColumns).eq("quotation_id", quotationId).eq("is_active", true);
  for (const [column, ascending] of options.itemOrder ?? [["sort_order", true]]) items = items.order(column, { ascending });
  const itemsResult = await items;
  log("PROJECT SCOPE LIVE ITEMS ERROR", itemsResult.error);

  let sections: Row[] = [];
  if (options.sectionColumns) {
    let query = client.from("quotation_sections").select(options.sectionColumns).eq("quotation_id", quotationId).eq("is_active", true);
    for (const [column, ascending] of options.sectionOrder ?? [["sort_order", true]]) query = query.order(column, { ascending });
    const result = await query;
    log("PROJECT SCOPE LIVE SECTIONS ERROR", result.error);
    sections = Array.isArray(result.data) ? result.data.filter(isRow) : [];
  }

  let header: Row | null = null;
  if (options.headerColumns) {
    const result = await client.from("quotations").select(options.headerColumns).eq("id", quotationId).maybeSingle();
    log("PROJECT SCOPE LIVE HEADER ERROR", result.error);
    header = isRow(result.data) ? result.data : null;
  }
  return { source: "live", fallback, snapshotId: null, contractTotal: null, pricingRule: null, header, sections, items: Array.isArray(itemsResult.data) ? itemsResult.data.filter(isRow) : [] };
}

/**
 * A Project's scope: header, sections and items. The copy when there is one and every row of it can be read, otherwise the live quotation exactly as before.
 * A half-read copy is never shown.
 */
export async function loadProjectScope<TItem = Record<string, unknown>, TSection = Record<string, unknown>, THeader = Record<string, unknown>>(
  supabase: object,
  quotationId: string,
  options: ProjectScopeOptions,
): Promise<ProjectScope<TItem, TSection, THeader>> {
  const client = supabase as Client;
  let result: ProjectScope | ProjectScopeFallback;
  try {
    result = await readSnapshot(client, quotationId, options);
  } catch (error) {
    console.error("PROJECT SCOPE SNAPSHOT ERROR", error instanceof Error ? error.message : String(error));
    result = "unreadable";
  }
  return (typeof result === "string" ? await readLive(client, quotationId, options, result) : result) as unknown as ProjectScope<TItem, TSection, THeader>;
}
