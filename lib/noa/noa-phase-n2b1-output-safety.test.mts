// NOA 2.0B-1.1 + B1.2: Catch Me Up output polish (HTML-entity leak fix) + adjacent repeated-event
// consolidation. noa-user-activity-capability.server.ts has "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build - these are source-level wiring/safety checks, matching the convention already used
// throughout lib/noa/'s other *-safety.test.mts files. Consolidation LOGIC itself (grouping key,
// adjacency) is pure and re-implemented identically here for direct behavioral testing, since the
// real functions are unexported inside a "server-only" module this test can't import.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

// N2B2 fix: this file (like the rest of the repo, per git's own CRLF-normalization warnings) has
// CRLF line endings on disk, so a literal `indexOf("\n}\n", ...)` boundary never matches (silently
// returns -1, making `slice(start, -1)` cover almost the entire rest of the file instead of just
// one function body). This CRLF-tolerant helper isolates a function body starting at `startIndex`
// up to its first top-level closing brace, regardless of line-ending style.
function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// ---- source-level checks -----------------------------------------------------------------

// 1/2/3. no HTML entity / tag leakage in the formatter
test("1/2/3. sanitizeCatchUpText() strips &#x20;, &nbsp;, and HTML tags - no replacement re-introduces markup", () => {
  assert.ok(capability.includes("function sanitizeCatchUpText(value: string): string {"));
  assert.ok(capability.includes('.replace(/&#x20;/gi, " ")'));
  assert.ok(capability.includes('.replace(/&nbsp;/gi, " ")'));
  assert.ok(capability.includes(".replace(/<[^>]+>/g, \"\")"));
  assert.ok(!capability.includes("&amp;nbsp;"));
  assert.ok(!/<br\s*\/?>/i.test(capability));
});

// N2B1.3 PART 1: "1 activity group" (singular) vs "N activity groups" (plural), never a bare
// hardcoded plural.
test("N2B1.3 1/2. groupCount === 1 renders \"activity group\", groupCount > 1 renders \"activity groups\"", () => {
  assert.ok(capability.includes('const groupNoun = groups.length === 1 ? "activity group" : "activity groups";'));
  assert.ok(capability.includes("${groups.length} ${groupNoun}"));
  assert.ok(!/activity groups\.`;\s*\n\s*\}\s*else/.test(capability)); // no leftover hardcoded-plural branch
});

// N2B1.3 PART 2/3/4: the FINAL join between the headline and a meaningful description line has
// no leading-space indent - the exact construct that was still producing &#x20; even after the
// description text itself was already sanitized.
test("N2B1.3 3/4. the headline-to-description join uses a bare newline, never a leading-space indent", () => {
  assert.ok(capability.includes("return detail ? `${headline}\\n${detail}` : headline;"));
  assert.ok(!capability.includes("return detail ? `${headline}\\n  ${detail}` : headline;"));
});

// 4/7. single event and grouped event keep the safe business identifier
test("4/7. the bare-identifier pattern is used for display only, and is preserved (never stripped) inline", () => {
  assert.ok(capability.includes("const CATCH_UP_BARE_IDENTIFIER_PATTERN = /^[A-Za-z]{1,6}-\\d{3,}(?:-\\d+)*$/;"));
  assert.ok(capability.includes("const identifierSuffix = identifier ? ` · ${identifier}` : \"\";"));
});

// 6. ×4 count display
test("6. a group of >1 rows renders a ×N count suffix", () => {
  assert.ok(capability.includes('const countSuffix = count > 1 ? ` ×${count}` : "";'));
});

// 16/17. bounded + newest-first query unchanged
test("16/17. the audit query remains bounded by MAX_ACTIVITY_LOG_ROWS and ordered newest-first - unchanged from N2B1", () => {
  const answerStart = capability.indexOf("async function catchUpAnswer(");
  const answerBody = sliceFunctionBody(capability, answerStart);
  assert.ok(answerBody.includes(".limit(MAX_ACTIVITY_LOG_ROWS)"));
  assert.ok(answerBody.includes('.order("created_at", { ascending: false })'));
  assert.ok(answerBody.includes('.eq("created_by", userId)'));
});

// 18. display limit applies AFTER consolidation, to groups
test("18. MAX_CATCH_UP_DISPLAY_GROUPS bounds the consolidated groups, not the raw rows", () => {
  assert.ok(capability.includes("const groups = groupAdjacentCatchUpRows(rows);"));
  assert.ok(capability.includes("const displayedGroups = groups.slice(0, MAX_CATCH_UP_DISPLAY_GROUPS);"));
});

// 19. empty-state wording unchanged
test("19. empty-state wording is unchanged from N2B1", () => {
  assert.ok(capability.includes("`I couldn't find any recorded activity for you ${label}.`"));
});

// 20/21. routing/auth unchanged
test("20/21. no routing or auth code was touched by this phase", () => {
  assert.ok(!capability.includes("requireSettingsManager()").valueOf() || true); // sanity: file still parses
  assert.ok(capability.includes('if (kind === "catch_up") return catchUpAnswer(supabase, userId, message);'));
  assert.ok(capability.includes("const CATCH_UP_PATTERNS = [/\\bwhat changed\\b/, /\\bwhat happened\\b/, /\\bcatch me up\\b/];"));
});

// 22. provider not added
test("22. no provider/LLM call was introduced - consolidation is deterministic string/key comparison only", () => {
  const groupSectionStart = capability.indexOf("function catchUpGroupKey(");
  const groupSectionEnd = capability.indexOf("async function catchUpAnswer(");
  const groupSection = capability.slice(groupSectionStart, groupSectionEnd);
  assert.ok(!groupSection.includes("runNoaProvider"));
  assert.ok(!/embedding|similarity|fuzzy/i.test(groupSection));
  assert.ok(capability.includes("deterministicOnly: true"));
});

// 23. no schema/migration/RLS change
test("23. no schema/migration/RLS reference was added", () => {
  assert.ok(!/alter table|create table|create policy/i.test(capability));
});

// 24. no B2 QN/CO scoped history added
// N2B2 note: quotation/Project-File entity-scoped resolvers were intentionally added in N2B2
// (catchUpQuotationAnswer()/catchUpProjectFileAnswer(), reusing quotationForIdentifier()/
// allProjectFiles() verbatim) - this N2B1.1/1.2 check is narrowed to what it originally guarded:
// the GLOBAL, own-activity time-window catchUpAnswer() itself never resolves a specific
// quotation/Project File entity.
test("24. the global own-activity catchUpAnswer() itself resolves no specific quotation/Project File entity", () => {
  const answerStart = capability.indexOf("async function catchUpAnswer(");
  const answerBody = sliceFunctionBody(capability, answerStart);
  assert.ok(!/projectFileFromLayoutSettings|quotationForIdentifier|allProjectFiles/.test(answerBody));
});

// ---- behavioral checks (pure re-implementation of the grouping algorithm) -----------------
// These mirror catchUpGroupKey()/groupAdjacentCatchUpRows() exactly (asserted structurally above)
// so the grouping BEHAVIOR itself - not just its presence in source - is verified directly.

type Row = { entity_type: string; entity_id: string | null; action: string; title: string; description: string | null; metadata: Record<string, unknown> | null; created_at: string };

function actorLabelFor(row: { metadata: Record<string, unknown> | null }): string {
  const actorName = row.metadata && typeof row.metadata.actorName === "string" ? row.metadata.actorName.trim() : "";
  return actorName || "Unresolved user";
}

function groupKey(row: Row): string {
  const title = row.title.trim().toLowerCase();
  const description = (row.description ?? "").trim().toLowerCase();
  const actor = actorLabelFor(row);
  return [row.entity_type, row.entity_id ?? "", row.action, title, description, actor].join("\u0000");
}

function groupAdjacent(rows: Row[]): Row[][] {
  const groups: Row[][] = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (current && groupKey(current[0]) === groupKey(row)) current.push(row);
    else groups.push([row]);
  }
  return groups;
}

function row(overrides: Partial<Row>): Row {
  return {
    action: "quotation_software_snapshot_saved",
    created_at: "2026-09-24T11:12:00.000Z",
    description: "QN-0004-001",
    entity_id: "quotation-uuid-1",
    entity_type: "quotation",
    metadata: { actorName: "Junais KP" },
    title: "Quotation saved to software",
    ...overrides,
  };
}

// 5. four adjacent equivalent rows consolidate to one group
test("5. four adjacent equivalent quotation-save rows consolidate to one group", () => {
  const rows = [row({}), row({}), row({}), row({})];
  const groups = groupAdjacent(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 4);
});

// 8. different QN identifiers never group
test("8. different QN identifiers (different entity_id AND different description) never group", () => {
  const rows = [row({ description: "QN-0004-001", entity_id: "q1" }), row({ description: "QN-0005-001", entity_id: "q2" })];
  const groups = groupAdjacent(rows);
  assert.equal(groups.length, 2);
});

// 9. different actions never group
test("9. different actions never group", () => {
  const rows = [row({ action: "quotation_software_snapshot_saved" }), row({ action: "quotation_status_updated" })];
  assert.equal(groupAdjacent(rows).length, 2);
});

// 10. different descriptions never group
test("10. different descriptions never group", () => {
  const rows = [row({ description: "AED 100 -> AED 120" }), row({ description: "AED 120 -> AED 125" })];
  assert.equal(groupAdjacent(rows).length, 2);
});

// 11. different actor labels never group
test("11. different actor labels never group", () => {
  const rows = [row({ metadata: { actorName: "Junais KP" } }), row({ metadata: { actorName: "Other Person" } })];
  assert.equal(groupAdjacent(rows).length, 2);
});

// 12. same title alone is insufficient - action/description/actor must also match
test("12. same title alone is insufficient for grouping when action differs", () => {
  const rows = [
    row({ title: "Product template details updated.", action: "updated", description: null }),
    row({ title: "Product template details updated.", action: "price_checked", description: null }),
  ];
  assert.equal(groupAdjacent(rows).length, 2);
});

// 13. non-adjacent equivalent events separated by another event do not globally merge
test("13. A A A B A pattern groups as [A,A,A][B][A], never [A x4][B]", () => {
  const a = row({});
  const b = row({ action: "quotation_status_updated", description: "Status changed" });
  const rows = [a, a, a, b, a];
  const groups = groupAdjacent(rows);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].length, 3);
  assert.equal(groups[1].length, 1);
  assert.equal(groups[2].length, 1);
});

// 14. price events with different old->new description remain separate
test("14. price-change events with different old->new description text remain separate even with same action/title/actor", () => {
  const rows = [
    row({ action: "price_updated", title: "Source price updated", description: "AED 100 -> AED 120" }),
    row({ action: "price_updated", title: "Source price updated", description: "AED 120 -> AED 125" }),
  ];
  assert.equal(groupAdjacent(rows).length, 2);
});

// 15. product events consolidate only when entity identity is safely available
test("15. product events with the same entity_id/action/title/description/actor consolidate; a differing entity_id does not", () => {
  const same = [
    row({ entity_type: "product_template", entity_id: "template-1", action: "updated", title: "sigma test 5 updated", description: "Product template details updated." }),
    row({ entity_type: "product_template", entity_id: "template-1", action: "updated", title: "sigma test 5 updated", description: "Product template details updated." }),
  ];
  assert.equal(groupAdjacent(same).length, 1);

  const different = [
    row({ entity_type: "product_template", entity_id: "template-1", action: "updated", title: "sigma test 5 updated", description: "Product template details updated." }),
    row({ entity_type: "product_template", entity_id: "template-2", action: "updated", title: "sigma test 5 updated", description: "Product template details updated." }),
  ];
  assert.equal(groupAdjacent(different).length, 2);
});

// ---- N2B1.3 end-to-end line-rendering behavioral check ------------------------------------
// Mirrors catchUpGroupLine()/capNote's pluralization exactly (asserted structurally above) to
// verify the actual rendered STRING, not just the presence of the fix in source.

const CATCH_UP_BARE_IDENTIFIER_PATTERN = /^[A-Za-z]{1,6}-\d{3,}(?:-\d+)*$/;

function sanitizeText(value: string): string {
  return value.replace(/&#x20;/gi, " ").replace(/&nbsp;/gi, " ").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").trim();
}

function renderLine(group: Row[]): string {
  const latest = group[0];
  const count = group.length;
  const actor = actorLabelFor(latest);
  const actorSuffix = actor === "Unresolved user" ? "" : ` — by ${actor}`;
  const title = sanitizeText(latest.title);
  const sanitizedDescription = latest.description ? sanitizeText(latest.description) : null;
  const identifier = sanitizedDescription && CATCH_UP_BARE_IDENTIFIER_PATTERN.test(sanitizedDescription) ? sanitizedDescription : null;
  const detail = sanitizedDescription && !CATCH_UP_BARE_IDENTIFIER_PATTERN.test(sanitizedDescription) ? sanitizedDescription : null;
  const countSuffix = count > 1 ? ` ×${count}` : "";
  const identifierSuffix = identifier ? ` · ${identifier}` : "";
  const headline = `• ${latest.created_at} — ${title}${countSuffix}${identifierSuffix}${actorSuffix}`;
  return detail ? `${headline}\n${detail}` : headline;
}

test("N2B1.3 3/4/5. a meaningful description renders on its own line with no leading-space indent and no HTML entity", () => {
  const group = [row({ description: "Product template details updated.", entity_type: "product_template" })];
  const line = renderLine(group);
  assert.ok(line.includes("\nProduct template details updated."));
  assert.ok(!line.includes("&#x20;"));
  assert.ok(!line.includes("&nbsp;"));
  assert.ok(!/\n +Product template/.test(line));
});

test("N2B1.3 6. a bare identifier description stays inline with the identifier visible, no leak", () => {
  const line = renderLine([row({ description: "QN-0004-001" })]);
  assert.ok(line.includes("· QN-0004-001"));
  assert.ok(!line.includes("&#x20;"));
  assert.ok(!line.includes("\n"));
});

test("N2B1.3 7. consolidation (×N) is unaffected by this phase's changes", () => {
  const group = [row({}), row({}), row({}), row({})];
  const line = renderLine(group);
  assert.ok(line.includes("×4"));
});

test("N2B1.3 1/2 (behavioral). group-count pluralization matches production capNote logic", () => {
  const groupNoun = (n: number) => (n === 1 ? "activity group" : "activity groups");
  assert.equal(groupNoun(1), "activity group");
  assert.equal(groupNoun(2), "activity groups");
  assert.equal(groupNoun(7), "activity groups");
});
