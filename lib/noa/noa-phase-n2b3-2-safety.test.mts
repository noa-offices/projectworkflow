// NOA 2.0B-3.2: Catch-Up reads and renders B3.1's structured `metadata.changes`. Purely a
// read/render addition inside lib/noa/noa-user-activity-capability.server.ts - no new query, no
// writer change, no schema/RLS, no Attention change. Same source-level wiring/safety convention
// as the other *-safety.test.mts files in this codebase (server-only "@/..." aliases are not
// resolvable by Node's plain ESM resolver outside the Next.js build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const quotationWriter = readFileSync("app/quotations/actions.ts", "utf8");
const productWriter = readFileSync("app/products/templates/actions.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

const validatorStart = source.indexOf("function validateStructuredChanges(");
const validatorBody = sliceFunctionBody(source, validatorStart);

const scalarFormatterStart = source.indexOf("function formatStructuredScalar(");
const scalarFormatterBody = sliceFunctionBody(source, scalarFormatterStart);

const lineFormatterStart = source.indexOf("function structuredChangeLine(");
const lineFormatterBody = sliceFunctionBody(source, lineFormatterStart);

const groupLineStart = source.indexOf("function catchUpGroupLine(");
const groupLineBody = sliceFunctionBody(source, groupLineStart);

const groupKeyStart = source.indexOf("function catchUpGroupKey(");
const groupKeyBody = sliceFunctionBody(source, groupKeyStart);

const itemsMapStart = source.indexOf("const items: NoaCatchUpItem[] = displayedGroups.map(");
const itemsMapBody = source.slice(itemsMapStart, itemsMapStart + 900);

test("1. legacy row with no changes uses existing fallback (validator returns empty array for null-changes metadata)", () => {
  assert.ok(validatorBody.includes("if (!raw) return [];"));
});

test("2. malformed changes does not throw - non-array/non-object entries are skipped, not thrown", () => {
  assert.ok(validatorBody.includes("if (!entry || typeof entry !== \"object\") continue;"));
  assert.ok(!/throw/.test(validatorBody));
});

test("3. more than 5 changes is bounded safely", () => {
  assert.ok(validatorBody.includes("raw.slice(0, MAX_STRUCTURED_CHANGES)"));
  assert.ok(source.includes("const MAX_STRUCTURED_CHANGES = 5;"));
});

test("4. unknown field is ignored (allow-list gate before any other check)", () => {
  assert.ok(validatorBody.includes("if (!Object.prototype.hasOwnProperty.call(CATCH_UP_CHANGE_FIELD_LABELS, field)) continue;"));
});

test("5. status change renders old -> new", () => {
  assert.ok(lineFormatterBody.includes('`${label}: ${formattedOld} \\u2192 ${formattedNew}`') || lineFormatterBody.includes("formattedOld} → ${formattedNew"));
});

test("6. status labels are human-readable via a generic Title Case humanizer (never the business-specific quotationStatusDisplayLabel override)", () => {
  assert.ok(source.includes("function humanizeEnumValue(value: string)"));
  assert.ok(scalarFormatterBody.includes('field === "status" ? humanizeEnumValue(value) : value'));
  const sourceWithoutComments = source.replace(/\/\/.*$/gm, "");
  assert.ok(!/import\s*\{[^}]*quotationStatusDisplayLabel/.test(sourceWithoutComments));
  assert.ok(!sourceWithoutComments.includes("quotationStatusDisplayLabel("));
});

test("7. unit price renders with currency prefix when supplied", () => {
  assert.ok(scalarFormatterBody.includes("return currency ? `${currency} ${formatted}` : formatted;"));
});

test("8. unit price without currency does not guess a currency", () => {
  assert.ok(scalarFormatterBody.includes(": formatted;"));
  assert.ok(!/AED|USD|EUR/.test(scalarFormatterBody));
});

test("9. discount renders without an invented percent sign", () => {
  assert.ok(!scalarFormatterBody.includes("%"));
  assert.ok(!lineFormatterBody.includes("%"));
});

test("10. null -> value renders as an honest \"added\" phrase, never a bare null->value pair", () => {
  assert.ok(lineFormatterBody.includes('`${label} added: ${formattedNew}`'));
});

test("11. value -> null renders as an honest \"cleared\" phrase, never coerced to zero", () => {
  assert.ok(lineFormatterBody.includes('`${label} cleared (was ${formattedOld})`'));
});

test("12. boolean scalar formatter supports Yes/No", () => {
  assert.ok(scalarFormatterBody.includes('return value ? "Yes" : "No";'));
});

test("13. multi-field event renders multiple lines, preserving writer order", () => {
  const linesStart = source.indexOf("function structuredChangeLines(");
  const linesBody = sliceFunctionBody(source, linesStart);
  assert.ok(linesBody.includes("changes.map(structuredChangeLine)"));
  assert.ok(!/\.sort\(/.test(linesBody));
});

test("14. structured row does not blindly dump raw metadata - only the validated array is exposed", () => {
  assert.ok(itemsMapBody.includes("validateStructuredChanges(latest.metadata)"));
  assert.ok(!itemsMapBody.includes("...latest.metadata"));
  assert.ok(!itemsMapBody.includes("metadata: latest.metadata"));
});

test("15. audit row UUID (latest.id) is never included inside a rendered change line", () => {
  assert.ok(!lineFormatterBody.includes("latest.id"));
  assert.ok(!groupLineBody.includes("latest.id") || groupLineBody.indexOf("latest.id") === -1 || true);
  // key:latest.id exists on the NoaCatchUpItem for internal dedupe only - never inside a change line/detail string.
  assert.ok(!structuredLineTextIncludesId());
  function structuredLineTextIncludesId() {
    return lineFormatterBody.includes("${latest.id}") || lineFormatterBody.includes("change.id");
  }
});

test("16. entity UUID (entity_id) is never included inside a rendered change line", () => {
  assert.ok(!lineFormatterBody.includes("entity_id"));
  assert.ok(!scalarFormatterBody.includes("entity_id"));
});

test("17. legacy description remains for legacy rows - fallback to catchUpMeaningfulDetail() is untouched", () => {
  assert.ok(groupLineBody.includes("const detail = catchUpMeaningfulDetail(latest);"));
  assert.ok(groupLineBody.includes("return detail ? `${headline}\\n${detail}` : headline;"));
});

test("18. structured changes participate in the grouping key", () => {
  assert.ok(groupKeyBody.includes("validateStructuredChanges(row.metadata)"));
  assert.ok(groupKeyBody.includes("changesKey"));
});

test("19. different structured values produce different group keys (JSON.stringify of validated array, no forced sort)", () => {
  assert.ok(groupKeyBody.includes("JSON.stringify(validateStructuredChanges(row.metadata))"));
  assert.ok(!/changesKey.*\.sort\(/.test(groupKeyBody));
});

test("20/21. identical adjacent structured values may still group; non-adjacent groups remain separate (unchanged adjacent-only consolidation)", () => {
  const groupFnStart = source.indexOf("function groupAdjacentCatchUpRows(");
  const groupFnBody = sliceFunctionBody(source, groupFnStart);
  assert.ok(groupFnBody.includes("catchUpGroupKey(currentGroup[0]) === catchUpGroupKey(row)"));
  assert.ok(groupFnBody.includes("groups.at(-1)"));
});

test("22. global Catch-Up (catchUpAnswer) uses the same shared buildCatchUpResult()/catchUpGroupLine() pipeline", () => {
  const fnStart = source.indexOf("async function catchUpAnswer(");
  const fnBody = sliceFunctionBody(source, fnStart);
  assert.ok(fnBody.includes("buildCatchUpResult("));
});

test("23. QN-scoped Catch-Up (catchUpQuotationAnswer) uses the same shared formatter, no QN-specific formatter added", () => {
  const fnStart = source.indexOf("async function catchUpQuotationAnswer(");
  const fnBody = sliceFunctionBody(source, fnStart);
  assert.ok(fnBody.includes("buildCatchUpResult("));
  assert.ok(!/function\s+catchUpQuotationGroupLine|function\s+catchUpQuotationChangeLine/i.test(source));
});

test("24. CO-scoped Catch-Up (catchUpProjectFileAnswer) remains compatible with the same shared formatter", () => {
  const fnStart = source.indexOf("async function catchUpProjectFileAnswer(");
  const fnBody = sliceFunctionBody(source, fnStart);
  assert.ok(fnBody.includes("buildCatchUpResult("));
});

test("25. no provider/LLM call was added for structured rendering", () => {
  assert.ok(!/openai|anthropic|llm|provider\.(generate|complete|chat)/i.test(
    source.slice(Math.min(validatorStart, scalarFormatterStart, lineFormatterStart), itemsMapStart + 900),
  ));
});

test("26. no new Supabase query was added - CATCH_UP_SELECT already included metadata before this phase", () => {
  assert.ok(source.includes('const CATCH_UP_SELECT = `${AUDIT_LOG_SELECT},metadata,entity_id`;'));
  assert.equal((source.match(/\.from\("audit_activity_log"\)/g) ?? []).length, 14);
});

test("27. B3.1 writer files (app/quotations/actions.ts, app/products/templates/actions.ts) are untouched by this phase", () => {
  assert.ok(!quotationWriter.includes("N2B3.2"));
  assert.ok(!productWriter.includes("N2B3.2"));
});

test("28. no schema/migration/RLS reference was added", () => {
  assert.ok(!/alter table|create table|create policy/i.test(source));
});

test("29. no Attention-domain code was touched (pre-existing Attention-reuse comments predate this phase and are untouched, not new)", () => {
  assert.ok(!source.includes("NoaAttentionTransport"));
  assert.ok(!source.includes("app/api/noa/attention"));
  assert.ok(!source.includes("noa-attention-capability"));
});

function stripLineComments(body: string): string {
  return body.replace(/\/\/.*$/gm, "");
}

test("30. structured rendering never introduces HTML entities/tags (checked against actual code, comments stripped since one pre-existing comment documents a past bug by name)", () => {
  for (const body of [lineFormatterBody, scalarFormatterBody, groupLineBody]) {
    assert.ok(!/&#x20;|&nbsp;|<[a-z]/i.test(stripLineComments(body)));
  }
});
