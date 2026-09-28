// Phase 2 Acceptance: LIVE Semantic Planner evaluation. Deliberately NOT a *.test.mts file, so
// `npm run test:noa` (fully offline) never loads it. Run with `npm run eval:noa-planner`.
//
// - Drives the exact production planner boundary (requestNoaSemanticPlan: same instructions, same
//   strict schema, same runAiProvider router) and the exact production validator
//   (validateNoaSemanticPlan) and gate (shouldRunNoaSemanticPlanner). No provider-specific rules.
// - Only runtime-config resolution is replaced (it reads Supabase settings); provider credentials
//   are read by the existing adapters from the environment and are never printed.
// - State is synthetic: fake UUIDs/order numbers, no names, prices, totals or real records. The
//   planner only ever sees handles/kinds/counts/closed statuses anyway.
// - Output is closed metadata only (plan kind, source label, ordinal index, validation reason).
//
// Options (env): NOA_EVAL_RUNS (default 5), NOA_EVAL_PROVIDERS (comma list, default all),
// NOA_EVAL_<OPENAI|ANTHROPIC|GEMINI>_MODEL (must be an approved model). `--dry-run` swaps the
// provider for a local oracle to self-check the harness offline (no network).
import { mock } from "node:test";
import { appendNoaResultSet, createEmptyNoaConversationState, focusNoaResultSet, type NoaConversationState } from "../noa-conversation-state";
import { createNoaResultSetHandle, type NoaResultSet } from "../noa-result-set";
import { buildNoaPlannerInput, shouldRunNoaSemanticPlanner, validateNoaSemanticPlan, type NoaPlannerInput } from "../noa-semantic-planner";
import { isApprovedAiModel } from "../../ai/provider-config";
import type { AiProviderId } from "../../ai/types";

const DRY_RUN = process.argv.includes("--dry-run");
const RUNS = Math.max(1, Math.min(10, Number(process.env.NOA_EVAL_RUNS ?? 5) || 5));
const CREDENTIAL_ENV: Record<AiProviderId, string[]> = {
  openai: ["OPENAI_API_KEY", "SOURCE_QA_AI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GEMINI_API_KEY"],
};
const DEFAULT_MODEL: Record<AiProviderId, string> = { openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-6", gemini: "gemini-3.5-flash-lite" };

let current: { provider: AiProviderId; model: string } = { provider: "openai", model: DEFAULT_MODEL.openai };
mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: {
  resolveAiAgentRuntimeConfig: async () => ({ agentId: "noa_orchestrator", enabled: true, apiKeyConfigured: true, provider: current.provider,
    model: current.model, source: { model: "env_override", provider: "agent_override" } }),
} });
// Nothing in the planner boundary touches the database; guard it anyway.
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("eval: database access is not allowed"); } } });

// ── Synthetic state (same contracts as production) ─────────────────────────────────────────────
const T = "2026-01-01T00:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aggregate = (): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T, kind: "aggregate", entityType: "quotation", count: 5,
  querySpec: { capability: "quotation", operation: "status_summary", filters: {} },
  groups: [{ status: "sent_to_client", count: 1 }, { status: "draft", count: 2 }, { status: "client_confirmed", count: 2 }] });
const quotations = (status: "client_confirmed" | "draft", ids: number[]): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T,
  kind: "list", entityType: "quotation", count: ids.length, items: ids.map((n) => ({ id: uuid(n) })),
  querySpec: { capability: "quotation", operation: "status_list", filters: { status } } });
const projects = (): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T, kind: "list", entityType: "project_file", count: 2,
  items: [{ orderNo: "CO-0003-001" }, { orderNo: "CO-0004-001" }] });
const stack = (...sets: NoaResultSet[]) => sets.reduce(appendNoaResultSet, createEmptyNoaConversationState());

type Expected =
  | { outcome: "skipped" }
  | { outcome: "plan"; kind: "passthrough" | "clarify" }
  | { outcome: "plan"; kind: "select" | "relation"; source: string; itemIndex: number | null };
type EvalCase = { id: string; group: string; message: string; state: NoaConversationState; labels: Map<string, string>; expected: Expected };

function evalCase(id: string, group: string, message: string, sets: Record<string, NoaResultSet>, focus: string, expected: Expected): EvalCase {
  let state = stack(...Object.values(sets));
  state = focusNoaResultSet(state, sets[focus].handle);
  return { id, group, message, state, expected, labels: new Map(Object.entries(sets).map(([label, set]) => [set.handle, label])) };
}
function buildCases(): EvalCase[] {
  const d = () => ({ aggregate: aggregate(), confirmed: quotations("client_confirmed", [4, 5]) });
  const g = () => ({ aggregate: aggregate(), confirmed: quotations("client_confirmed", [4, 5]), projects: projects() });
  const relation = (source: string) => ({ outcome: "plan", kind: "relation", source, itemIndex: null }) as const;
  const select = (source: string, itemIndex: number | null) => ({ outcome: "plan", kind: "select", source, itemIndex }) as const;
  return [
    evalCase("D1", "D relation", "Can you mention the name of the project?", d(), "confirmed", relation("confirmed")),
    evalCase("D2", "D relation", "What projects are these quotations for?", d(), "confirmed", relation("confirmed")),
    evalCase("F1", "F ordinal", "Tell me about the second one.", { confirmed: quotations("client_confirmed", [4, 5]) }, "confirmed", select("confirmed", 1)),
    evalCase("F2", "F ordinal", "What about the first one?", { confirmed: quotations("client_confirmed", [4, 5]) }, "confirmed", select("confirmed", 0)),
    evalCase("F3", "F ordinal", "Tell me about the last one.", { confirmed: quotations("client_confirmed", [4, 5]) }, "confirmed", select("confirmed", 1)),
    // Exact live Vercel UAT failure shape: aggregate + quotation list + focused Project list. A
    // live run of this case chose the AGGREGATE handle (rejected by validateNoaSemanticPlan as
    // incompatible_type) instead of the "confirmed" quotation list - see the fix in
    // noa-semantic-planner.server.ts's PLANNER_INSTRUCTIONS and the new `selectable` input field.
    evalCase("G1", "G older set", "Go back to the quotations.", g(), "projects", select("confirmed", null)),
    evalCase("G2", "G older set", "What projects are those for?", g(), "confirmed", relation("confirmed")),
    evalCase("DC", "D continuation", "List them.", g(), "projects", select("projects", null)),
    // Focus is the status summary (not selectable) and two quotation lists fit "them": must clarify.
    evalCase("H1", "H ambiguity", "Show them.", { confirmed: quotations("client_confirmed", [4, 5]), pending: quotations("draft", [2, 3]),
      aggregate: aggregate() }, "aggregate", { outcome: "plan", kind: "clarify" }),
    evalCase("P1", "passthrough exact ID", "Tell me about CO-0003-001", d(), "confirmed", { outcome: "skipped" }),
    evalCase("U1", "unrelated domain", "Show me products", d(), "confirmed", { outcome: "plan", kind: "passthrough" }),
  ];
}

// Offline self-check oracle: answers each case's expected plan through the same schema fields.
function oracle(cases: EvalCase[]) {
  return async ({ userContent }: { userContent: NoaPlannerInput }) => {
    const match = cases.find((c) => c.message === userContent.message && JSON.stringify(buildNoaPlannerInput(c.state, { message: c.message }).resultSets) === JSON.stringify(userContent.resultSets));
    const e = match?.expected;
    const handle = e && e.outcome === "plan" && (e.kind === "select" || e.kind === "relation")
      ? [...match!.labels].find(([, label]) => label === e.source)?.[0] ?? null : null;
    const kind = e?.outcome === "plan" ? e.kind : "passthrough";
    const itemIndex = e?.outcome === "plan" && (e.kind === "select" || e.kind === "relation") ? e.itemIndex : null;
    return { text: JSON.stringify({ kind, sourceResultSetHandle: handle, relation: kind === "relation" ? "quotation.project_file" : null,
      status: null, ordinal: itemIndex === null ? null : itemIndex + 1 }) };
  };
}

type Outcome = "expected" | "valid_other" | "clarify_unexpected" | "invalid" | "unavailable" | "skipped_unexpected";
async function runOnce(c: EvalCase, requestPlan: (input: NoaPlannerInput) => Promise<unknown | null>): Promise<{ outcome: Outcome; detail: string }> {
  const gated = shouldRunNoaSemanticPlanner(c.state, { message: c.message });
  if (!gated) return c.expected.outcome === "skipped" ? { outcome: "expected", detail: "skipped" } : { outcome: "skipped_unexpected", detail: "skipped" };
  if (c.expected.outcome === "skipped") return { outcome: "valid_other", detail: "gate_open" };
  const raw = await requestPlan(buildNoaPlannerInput(c.state, { message: c.message }));
  if (raw === null) return { outcome: "unavailable", detail: "unavailable" };
  const validated = validateNoaSemanticPlan(raw, c.state);
  if (!validated.ok) return { outcome: "invalid", detail: `invalid:${validated.reason}` };
  const plan = validated.plan;
  const source = "sourceResultSetHandle" in plan ? c.labels.get(plan.sourceResultSetHandle) ?? "?" : "-";
  const itemIndex = plan.kind === "select" || plan.kind === "relation" ? plan.itemIndex : null;
  const detail = `${plan.kind}:${source}${itemIndex === null ? "" : `#${itemIndex}`}`;
  const e = c.expected;
  const match = e.kind === plan.kind && ("source" in e ? source === e.source && itemIndex === e.itemIndex : true);
  if (match) return { outcome: "expected", detail };
  return { outcome: plan.kind === "clarify" ? "clarify_unexpected" : "valid_other", detail };
}

async function main() {
  const cases = buildCases();
  if (DRY_RUN) mock.module("@/lib/ai/provider-router.server", { namedExports: { runAiProvider: oracle(cases) } });
  const { requestNoaSemanticPlan } = await import("../noa-semantic-planner.server");
  const selected = (process.env.NOA_EVAL_PROVIDERS ?? "openai,gemini,anthropic").split(",").map((p) => p.trim()) as AiProviderId[];
  console.log(`# NOA Semantic Planner live eval${DRY_RUN ? " (DRY RUN - local oracle, no provider calls)" : ""}\nruns per case: ${RUNS}\n`);
  for (const provider of selected) {
    if (!(provider in CREDENTIAL_ENV)) { console.log(`## ${provider}: unknown provider - NOT RUN\n`); continue; }
    const configured = CREDENTIAL_ENV[provider].some((name) => Boolean(process.env[name]?.trim()));
    if (!DRY_RUN && !configured) { console.log(`## ${provider}: credentials not configured - NOT RUN\n`); continue; }
    const model = process.env[`NOA_EVAL_${provider.toUpperCase()}_MODEL`]?.trim() || DEFAULT_MODEL[provider];
    if (!isApprovedAiModel(provider, model)) { console.log(`## ${provider}: model not approved - NOT RUN\n`); continue; }
    current = { provider, model };
    console.log(`## ${provider} (${model})\n\n| case | group | expected | valid_other | clarify_unexpected | invalid | unavailable | observed |\n|---|---|---|---|---|---|---|---|`);
    const totals: Record<Outcome, number> = { expected: 0, valid_other: 0, clarify_unexpected: 0, invalid: 0, unavailable: 0, skipped_unexpected: 0 };
    for (const c of cases) {
      const counts: Record<Outcome, number> = { expected: 0, valid_other: 0, clarify_unexpected: 0, invalid: 0, unavailable: 0, skipped_unexpected: 0 };
      const details = new Map<string, number>();
      for (let run = 0; run < RUNS; run += 1) {
        const { outcome, detail } = await runOnce(c, requestNoaSemanticPlan);
        counts[outcome] += 1;
        totals[outcome] += 1;
        details.set(detail, (details.get(detail) ?? 0) + 1);
      }
      const observed = [...details].map(([detail, n]) => `${detail}×${n}`).join(", ");
      console.log(`| ${c.id} | ${c.group} | ${counts.expected}/${RUNS} | ${counts.valid_other + counts.skipped_unexpected} | ${counts.clarify_unexpected} | ${counts.invalid} | ${counts.unavailable} | ${observed} |`);
    }
    const all = cases.length * RUNS;
    console.log(`\ntotals: expected ${totals.expected}/${all}, valid_other ${totals.valid_other + totals.skipped_unexpected}, clarify_unexpected ${totals.clarify_unexpected}, invalid ${totals.invalid}, unavailable ${totals.unavailable}\n`);
  }
}

await main();
