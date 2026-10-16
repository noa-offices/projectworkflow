import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSupportedCurrency } from "../currencies";
import { normalizeManufacturerCode } from "./manufacturer-code";
import { smartSetupCellsToTargets, type SmartSetupPriceArchitecture, type SmartSetupPriceCell } from "./smart-setup-supplier-targets";
import type { DimensionRule, DurableBinding, PriceBasis, PriceMatch, PriceTarget, SourceIdentity, SourceVersion } from "./supplier-price-contracts";
import { comparisonCode, matchSupplierPrices } from "./supplier-price-matching";
import { resolveApplicableSupplierSourceVersion, supplierBusinessDate, supplierRows } from "./supplier-price-repository";

export const SMART_SETUP_CHECK_MAX_CELLS = 500;
export type SmartSetupSupplierCheckStatus = "MATCHED" | "MISMATCH" | "NOT_FOUND" | "NEEDS_REVIEW";
export type SmartSetupSupplierCheckReason =
  | "same_price" | "price_differs" | "no_source_candidate" | "missing_draft_price" | "currency_mismatch" | "basis_mismatch"
  | "ambiguous_source_contexts" | "shared_price_unconfirmed" | "shared_price_baseline_drift" | "needs_dimension_mapping" | "invalid_source_evidence" | "companion_reference";
export type SmartSetupSupplierCheckResult = {
  locator: string; role: string; code: string; priceField: string; dimension: string;
  status: SmartSetupSupplierCheckStatus; reason: SmartSetupSupplierCheckReason;
  /** The draft (imported) price. Null is missing evidence, never zero. */
  importedPrice: number | null; importedCurrency: string;
  /** The Supplier source price, only when a unique source identity and context were established. */
  referencePrice: number | null; referenceCurrency: string | null;
  source: { versionId: string; definitionId: string; title: string; currency: string; basis: string };
  evidence: { identityKey: string; sheet: string; rowNumber: number; sourceRowCount: number | null } | null;
};
export type SmartSetupSupplierCheckInput = { brandId: unknown; definitionId: unknown; sourceVersionId: unknown; priceBasis?: unknown; cells: unknown };
export type SmartSetupSupplierCheckOutput = { source: SmartSetupSupplierCheckResult["source"]; results: SmartSetupSupplierCheckResult[] };

const architectures = new Set<SmartSetupPriceArchitecture>(["base_model", "workstation", "price_matrix", "modular_matrix", "modular_direct", "option_direct", "option_category"]);
const priceFields = new Set(["unit_price", "default_price", "additional_price"]);
const idText = (value: unknown, what: string) => { if (typeof value !== "string" || !value.trim() || value.length > 100) throw Error(`${what} is required.`); return value.trim(); };
const boundedText = (value: unknown, max: number) => typeof value === "string" && value.length <= max;

/** Structural validation of the submitted projection. The projection is the user's own draft; it never carries authorization. */
export function parseSmartSetupPriceCells(value: unknown): SmartSetupPriceCell[] {
  if (!Array.isArray(value) || !value.length) throw Error("No draft prices to check.");
  if (value.length > SMART_SETUP_CHECK_MAX_CELLS) throw Error(`At most ${SMART_SETUP_CHECK_MAX_CELLS} draft prices can be checked at once.`);
  const locators = new Set<string>();
  return value.map((raw) => {
    const c = raw as Partial<SmartSetupPriceCell> | null;
    if (!c || typeof c !== "object" || !boundedText(c.locator, 300) || !c.locator || locators.has(c.locator)) throw Error("Invalid or duplicate draft price locator.");
    locators.add(c.locator);
    const currency = parseSupportedCurrency(c.currency);
    if (!currency) throw Error("Unsupported draft price currency.");
    if (!architectures.has(c.architecture as SmartSetupPriceArchitecture) || !priceFields.has(c.priceField as string)) throw Error("Invalid draft price field.");
    if (c.price !== null && (typeof c.price !== "number" || !Number.isFinite(c.price) || c.price < 0)) throw Error("Draft price must be a non-negative number or empty.");
    if (!boundedText(c.code, 100) || !c.code?.trim() || !boundedText(c.role, 60) || !boundedText(c.groupId, 200) || !boundedText(c.rowId, 200) || !boundedText(c.columnId, 200) || !boundedText(c.label, 300) || !boundedText(c.dimension, 100) || (c.dimensionLabel !== undefined && !boundedText(c.dimensionLabel, 100))) throw Error("Invalid draft price context.");
    return { locator: c.locator, architecture: c.architecture as SmartSetupPriceArchitecture, role: c.role!, groupId: c.groupId!, rowId: c.rowId!, columnId: c.columnId!, label: c.label!, code: normalizeManufacturerCode(c.code), priceField: c.priceField as SmartSetupPriceCell["priceField"], price: c.price as number | null, currency, dimension: c.dimension!, ...(c.dimensionLabel ? { dimensionLabel: c.dimensionLabel } : {}) };
  });
}

type VersionRow = SourceVersion & { created_at: string };
/** Ownership + applicability of the selected source version. Submitted ids are never trusted; every row is read through the caller's RLS client. */
async function loadApplicableVersion(client: SupabaseClient, brandId: string, definitionId: string, versionId: string) {
  const brand = (await supplierRows<{ id: string }>(client, "brands", "id", { id: brandId })).at(0);
  if (!brand) throw Error("Brand unavailable.");
  const definition = (await supplierRows<{ id: string }>(client, "supplier_source_definitions", "id", { id: definitionId, brand_id: brandId, is_active: true })).at(0);
  if (!definition) throw Error("Supplier source unavailable for this Brand.");
  const selected = (await supplierRows<VersionRow>(client, "supplier_source_versions", "*", { id: versionId, brand_id: brandId, definition_id: definitionId })).at(0);
  if (!selected) throw Error("Supplier source version unavailable for this Brand and source.");
  if (selected.status !== "imported") throw Error("Supplier source version is archived or incomplete.");
  const today = supplierBusinessDate();
  if (selected.effective_from && selected.effective_from > today) throw Error("Supplier source version is not effective yet.");
  const imported = await supplierRows<VersionRow>(client, "supplier_source_versions", "*", { brand_id: brandId, definition_id: definitionId, status: "imported" }, "created_at");
  if (resolveApplicableSupplierSourceVersion(imported, today)?.id !== selected.id) throw Error("Supplier source version is not the applicable version.");
  if (!["list", "net"].includes(selected.basis)) throw Error("Supplier source version has no explicit price basis.");
  if (!parseSupportedCurrency(selected.currency)) throw Error("Supplier source version has an unsupported currency.");
  return selected;
}

/** Only identities of the submitted codes are read, and only their identity data (never unrelated supplier evidence). */
async function loadIdentities(client: SupabaseClient, sourceId: string, codes: string[]) {
  const wanted = new Set(codes.map(comparisonCode));
  const variants = [...new Set(codes.flatMap((code) => [code, comparisonCode(code)]))];
  const identities: SourceIdentity[] = []; const firstEvidence = new Map<string, SourceIdentity["evidence"]>();
  for (let from = 0; from < variants.length; from += 100) {
    const found = await client.from("supplier_source_identities").select("key,code,data").eq("source_id", sourceId).in("code", variants.slice(from, from + 100)).order("key").returns<Array<{ key: string; code: string; data: SourceIdentity }>>();
    if (found.error) throw Error(found.error.message);
    for (const row of found.data ?? []) if (wanted.has(comparisonCode(row.code))) {
      const { evidence, ...identity } = row.data; firstEvidence.set(identity.key, evidence); identities.push(identity);
    }
  }
  return { identities, firstEvidence };
}

/** Confirmed Brand "shared" bindings only apply to transient targets of the same code and price field; persisted target keys are never reused. */
function transientBindings(bindings: DurableBinding[], targets: PriceTarget[]): DurableBinding[] {
  return bindings.filter((b) => b.confirmed && b.kind === "shared").flatMap((b) => {
    const keys = targets.filter((t) => comparisonCode(t.code) === comparisonCode(b.code) && t.price_field === b.price_field).map((t) => t.key);
    return keys.length > 1 ? [{ ...b, target_keys: keys }] : [];
  });
}

type Outcome = { status: SmartSetupSupplierCheckStatus; reason: SmartSetupSupplierCheckReason; source: SourceIdentity | null };
const review = (reason: SmartSetupSupplierCheckReason, source: SourceIdentity | null): Outcome => ({ status: "NEEDS_REVIEW", reason, source });

/** Pure mapping of existing matcher output to per-draft-cell outcomes. No second matching algorithm. */
export function mapSmartSetupMatches(matches: PriceMatch[], targets: PriceTarget[], sourceBasisMismatch: boolean): Map<string, Outcome> {
  const claims = new Map<string, Set<string>>();
  for (const match of matches) if (match.source && match.targets.length && !["ambiguous", "needs_dimension_mapping", "invalid_source", "baseline_drift"].includes(match.classification)) for (const t of match.targets) claims.set(t.key, new Set([...(claims.get(t.key) ?? []), match.source.key]));
  const outcomes = new Map<string, Outcome>(); const unmapped: PriceTarget[] = [];
  for (const match of matches) {
    if (match.source === null) { for (const t of match.targets) outcomes.set(t.key, { status: "NOT_FOUND", reason: "no_source_candidate", source: null }); continue; }
    const source = match.source;
    // A source identity that mapped to no draft target (for example supplier category D when the draft only has A-C) lists every candidate of the
    // code. That is not a claim on any of them: it must neither compete with a resolved identity nor hide it. It only explains targets left unresolved.
    if (match.classification === "needs_dimension_mapping") { unmapped.push(...match.targets); continue; }
    for (const t of match.targets) {
      const resolved = ["unchanged", "increased", "decreased", "changed", "shared"].includes(match.classification);
      let outcome: Outcome;
      if (match.classification === "ambiguous") outcome = review(match.candidate_shared || match.targets.length > 1 ? "shared_price_unconfirmed" : "needs_dimension_mapping", source);
      else if (match.classification === "baseline_drift") outcome = review("shared_price_baseline_drift", source);
      else if (!resolved) outcome = review("invalid_source_evidence", source);
      else if ((claims.get(t.key)?.size ?? 0) > 1) outcome = review("ambiguous_source_contexts", source);
      else if (t.currency !== source.currency) outcome = review("currency_mismatch", source);
      else if (t.price === null || source.price === null) outcome = review("missing_draft_price", source);
      else if (sourceBasisMismatch) outcome = review("basis_mismatch", source);
      else outcome = t.price === source.price ? { status: "MATCHED", reason: "same_price", source } : { status: "MISMATCH", reason: "price_differs", source };
      const previous = outcomes.get(t.key);
      // A cell reached by several matches is never silently resolved by the first one.
      outcomes.set(t.key, previous && (previous.source?.key !== source.key || previous.status !== outcome.status) ? review("ambiguous_source_contexts", source) : outcome);
    }
  }
  for (const t of unmapped) if (!outcomes.has(t.key)) outcomes.set(t.key, review("needs_dimension_mapping", null));
  // Left over: the code exists in the source but no identity maps to this target's category/size (needs mapping), unless an unusable identity of that code explains it.
  const unusable = new Set(matches.filter((m) => m.source && m.classification === "invalid_source").map((m) => JSON.stringify([comparisonCode(m.source!.code), m.source!.price_field])));
  for (const t of targets) if (!outcomes.has(t.key)) outcomes.set(t.key, review(unusable.has(JSON.stringify([comparisonCode(t.code), t.price_field])) ? "invalid_source_evidence" : "needs_dimension_mapping", null));
  return outcomes;
}

export type SmartSetupSupplierCheckDeps = { requireReviewer: () => Promise<unknown>; getClient: () => Promise<SupabaseClient> };

/** Read-only. Authorization first; then ownership/applicability of the source; then the existing matcher. Performs no writes. */
export async function runSmartSetupSupplierCheck(deps: SmartSetupSupplierCheckDeps, input: SmartSetupSupplierCheckInput): Promise<SmartSetupSupplierCheckOutput> {
  await deps.requireReviewer();
  const brandId = idText(input.brandId, "Brand"); const definitionId = idText(input.definitionId, "Supplier source"); const versionId = idText(input.sourceVersionId, "Supplier source version");
  const expectedBasis = input.priceBasis === undefined || input.priceBasis === null ? null : input.priceBasis;
  if (expectedBasis !== null && expectedBasis !== "list" && expectedBasis !== "net") throw Error("Price basis must be list or net.");
  const cells = parseSmartSetupPriceCells(input.cells);
  const client = await deps.getClient();
  const version = await loadApplicableVersion(client, brandId, definitionId, versionId);
  const targets = smartSetupCellsToTargets(brandId, cells);
  const [{ identities, firstEvidence }, rules, bindings] = await Promise.all([
    loadIdentities(client, version.id, [...new Set(cells.map((c) => c.code))]),
    supplierRows<DimensionRule>(client, "supplier_dimension_vocabulary", "*", { brand_id: brandId, is_active: true }),
    supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: brandId }),
  ]);
  const matches = matchSupplierPrices(identities, targets, rules, transientBindings(bindings, targets));
  const outcomes = mapSmartSetupMatches(matches, targets, expectedBasis !== null && expectedBasis !== (version.basis as PriceBasis));
  const source = { versionId: version.id, definitionId, title: version.title, currency: version.currency, basis: version.basis };
  const byKey = new Map(targets.map((t, i) => [t.key, cells[i]]));
  const results = targets.map<SmartSetupSupplierCheckResult>((t) => {
    const cell = byKey.get(t.key)!; let outcome = outcomes.get(t.key)!;
    // Null is missing evidence, never zero: it can never be MATCHED or MISMATCH.
    if (cell.price === null && outcome.status !== "NOT_FOUND") outcome = review("missing_draft_price", outcome.source);
    const established = outcome.status === "MATCHED" || outcome.status === "MISMATCH";
    const evidence = outcome.source ? firstEvidence.get(outcome.source.key)?.[0] : undefined;
    return { locator: cell.locator, role: cell.role, code: cell.code, priceField: cell.priceField, dimension: cell.dimension, status: outcome.status, reason: outcome.reason, importedPrice: cell.price, importedCurrency: cell.currency,
      referencePrice: established ? outcome.source!.price : null, referenceCurrency: established ? outcome.source!.currency : null, source,
      evidence: outcome.source && established ? { identityKey: outcome.source.key, sheet: evidence?.sheet ?? "", rowNumber: evidence?.row_number ?? 0, sourceRowCount: outcome.source.source_row_count ?? null } : null };
  });
  return { source, results };
}
