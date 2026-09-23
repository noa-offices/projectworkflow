import "server-only";

import { requireSystemOwner } from "@/lib/auth";
import { listAiAgents } from "@/lib/ai/agent-registry";
import { listAiProviderConfigs } from "@/lib/ai/provider-config";
import { isProviderCredentialConfigured, resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import type { AiAgentConfig, AiAgentId, AiProviderId } from "@/lib/ai/types";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

// B6: Admin/System is the most permission-sensitive NOA capability - every branch below is only
// ever reached after requireSystemOwner() has already succeeded (see the entry point). No other
// NOA capability requires this role; do not weaken it to requireSettingsManager() or a custom
// role comparison.

const MAX_USER_ROWS = 20;
const MAX_PROVIDER_ROWS = 10;
const MAX_AGENT_ROWS = 10;

const USER_SELECT = "full_name,role,account_status";

type UserRow = { account_status: AccountStatus; full_name: string | null; role: AppRole };

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access Admin/System data for this account.",
  ok: false,
  reason: "unauthorized",
};

function isNextRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

const ROLE_LABEL: Record<AppRole, string> = {
  admin_manager: "Admin Manager",
  designer: "Designer",
  procurement_manager: "Procurement Manager",
  sales_coordinator: "Sales Coordinator",
  sales_designer: "Sales Designer",
  system_owner: "System Owner",
  viewer: "Viewer",
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: "active",
  disabled: "disabled",
  pending: "pending",
};

function providerLabel(providerId: AiProviderId): string {
  return listAiProviderConfigs().find((provider) => provider.id === providerId)?.label ?? providerId;
}

// Longer/more-specific phrases checked before their shorter substrings ("sales designer" before
// bare "designer"), so "how many sales designers" never matches the generic Designer role.
const ROLE_PHRASES: ReadonlyArray<readonly [string, AppRole]> = [
  ["system owners", "system_owner"],
  ["system owner", "system_owner"],
  ["admin managers", "admin_manager"],
  ["admin manager", "admin_manager"],
  ["procurement managers", "procurement_manager"],
  ["procurement manager", "procurement_manager"],
  ["sales designers", "sales_designer"],
  ["sales designer", "sales_designer"],
  ["sales coordinators", "sales_coordinator"],
  ["sales coordinator", "sales_coordinator"],
  ["designers", "designer"],
  ["designer", "designer"],
  ["viewers", "viewer"],
  ["viewer", "viewer"],
];

function detectRoleInMessage(normalized: string): AppRole | null {
  for (const [phrase, role] of ROLE_PHRASES) {
    if (normalized.includes(phrase)) return role;
  }
  return null;
}

function userNameTarget(message: string): string | null {
  const patterns = [
    /what role does (.+?) have\??$/i,
    /what is (.+?)'s account status\??$/i,
    /what is (.+?) account status\??$/i,
    /role for (.+?)$/i,
  ];
  for (const pattern of patterns) {
    const target = message.match(pattern)?.[1]?.trim();
    if (target) return target;
  }
  return null;
}

// Matches a registry agent by its human-readable label (or the "noa" alias for NOA Assistant),
// never by inventing an agent id - only lib/ai/agent-registry.ts's real entries are ever matched.
function targetAgentFromMessage(message: string, agents: readonly Readonly<AiAgentConfig>[]): Readonly<AiAgentConfig> | null {
  const normalized = message.toLowerCase();
  for (const agent of agents) {
    if (normalized.includes(agent.label.toLowerCase())) return agent;
  }
  if (/\bnoa\b/.test(normalized)) {
    return agents.find((agent) => agent.id === "noa_orchestrator") ?? null;
  }
  return null;
}

type AdminQuestionKind =
  | "agent_summary"
  | "provider_summary"
  | "role_summary"
  | "system_summary"
  | "user_count"
  | "user_detail"
  | "user_list";

// PART 3: deterministic classification only, checked in this priority order - a named-user
// lookup first (most specific), then a role count, then agent/provider phrasing (checked before
// the generic "users" catch-all so e.g. "which agents are enabled" is never misread as a user
// question), then an explicit summary phrase, then user count/list, "system_summary" as the final
// default (a safe, always-computable fallback - never a guess at user data).
function adminQuestionKind(message: string, agents: readonly Readonly<AiAgentConfig>[]): AdminQuestionKind {
  const normalized = message.toLowerCase();

  if (userNameTarget(message)) return "user_detail";

  if (detectRoleInMessage(normalized) && /\b(how many|count|number of)\b/.test(normalized)) {
    return "role_summary";
  }

  const targetAgent = targetAgentFromMessage(message, agents);
  if (targetAgent && /\b(provider|model|use|uses|enabled|status)\b/.test(normalized)) {
    return "agent_summary";
  }
  if (/\bagents?\b/.test(normalized)) return "agent_summary";
  if (/\bproviders?\b/.test(normalized)) return "provider_summary";

  if (/\b(admin|system) summary\b/.test(normalized)) return "system_summary";
  if (/\b(how many|count|number of) users?\b/.test(normalized)) return "user_count";
  if (/\busers?\b/.test(normalized)) return "user_list";

  return "system_summary";
}

// PART 4/6: bounded user list/count, filtered only by the actual stored account_status
// vocabulary (pending/active/disabled) - never a status value that isn't one of those three.
async function userListAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  countOnly: boolean,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const statusFilter: AccountStatus | null = /\bdisabled\b/.test(normalized)
    ? "disabled"
    : /\bpending\b/.test(normalized)
      ? "pending"
      : /\bactive\b/.test(normalized)
        ? "active"
        : null;

  let query = supabase.from("profiles").select(USER_SELECT, { count: "exact" }).order("full_name", { ascending: true });
  if (statusFilter) query = query.eq("account_status", statusFilter);
  const { count, data } = await query.limit(MAX_USER_ROWS).returns<UserRow[]>();

  const totalMatching = count ?? 0;
  const rows = countOnly ? [] : (data ?? []).map((row) => ({
    accountStatus: STATUS_LABEL[row.account_status],
    fullName: row.full_name ?? "Unnamed user",
    role: ROLE_LABEL[row.role],
  }));
  const description = statusFilter ? STATUS_LABEL[statusFilter] : "all";

  return {
    data: {
      kind: countOnly ? "admin_user_count" : "admin_user_list",
      returnedCount: rows.length,
      rows,
      totalMatching,
      truncatedCount: Math.max(0, totalMatching - rows.length),
      deterministicText: `There are ${totalMatching} ${description === "all" ? "" : `${description} `}user account${totalMatching === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Admin · Checked user accounts", type: "admin" }],
  };
}

// PART 5: counts by proven AppRole values only.
async function roleSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const targetRole = detectRoleInMessage(normalized);
  const roles: AppRole[] = targetRole
    ? [targetRole]
    : ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer"];

  const results = await Promise.all(
    roles.map((role) => supabase.from("profiles").select("full_name", { count: "exact", head: true }).eq("role", role)),
  );

  const rows = roles.map((role, index) => ({ count: results[index].count ?? 0, role: ROLE_LABEL[role] }));
  const summaryText = targetRole
    ? `There ${rows[0].count === 1 ? "is" : "are"} ${rows[0].count} ${ROLE_LABEL[targetRole]}${rows[0].count === 1 ? "" : "s"}.`
    : `User accounts by role: ${rows.map((row) => `${row.role} (${row.count})`).join(", ")}.`;

  return {
    data: { deterministicText: summaryText, kind: "admin_role_summary", rows },
    ok: true,
    sources: [{ label: "Admin · Checked user accounts", type: "admin" }],
  };
}

// PART 7: bounded exact/ilike match, never a guess between multiple matches.
async function userDetailAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const target = userNameTarget(message);
  if (!target) {
    return { message: "Please specify the user's name.", ok: false, reason: "ambiguous" };
  }

  const safeTarget = target.replace(/[%_,().?!]/g, " ").trim();
  if (!safeTarget) {
    return { message: "Please specify the user's name.", ok: false, reason: "ambiguous" };
  }

  const { data } = await supabase
    .from("profiles")
    .select(USER_SELECT)
    .ilike("full_name", `%${safeTarget}%`)
    .limit(2)
    .returns<UserRow[]>();

  const rows = data ?? [];
  if (rows.length === 0) {
    return { message: "I couldn't find a matching ProjectWorkflow user for that name.", ok: false, reason: "not_found" };
  }
  if (rows.length > 1) {
    return { message: "More than one ProjectWorkflow user matches that name - please provide a more specific name.", ok: false, reason: "ambiguous" };
  }

  const user = rows[0];
  const fullName = user.full_name ?? "That user";
  return {
    data: {
      accountStatus: STATUS_LABEL[user.account_status],
      fullName,
      kind: "admin_user_detail",
      role: ROLE_LABEL[user.role],
      deterministicText: `${fullName} has the role ${ROLE_LABEL[user.role]} and their account status is ${STATUS_LABEL[user.account_status]}.`,
    },
    ok: true,
    sources: [{ label: "Admin · Checked user accounts", type: "admin" }],
  };
}

// PART 8: safe provider status only - enabled/default/model id, plus a credential-configured
// boolean reused from the existing resolver (never re-deriving secret detection here). Never
// exposes an API key, env var value, or raw secret.
async function providerSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const { data } = await supabase
    .from("ai_provider_settings")
    .select("provider_id,enabled,default_model,is_default")
    .limit(MAX_PROVIDER_ROWS)
    .returns<Array<{ default_model: string | null; enabled: boolean; is_default: boolean; provider_id: string }>>();
  const settingsById = new Map((data ?? []).map((row) => [row.provider_id, row]));

  const rows = listAiProviderConfigs().slice(0, MAX_PROVIDER_ROWS).map((provider) => {
    const settings = settingsById.get(provider.id);
    return {
      credentialConfigured: isProviderCredentialConfigured(provider.id),
      defaultModel: settings?.default_model ?? null,
      enabled: settings?.enabled ?? false,
      isGlobalDefault: settings?.is_default ?? false,
      label: provider.label,
    };
  });

  const globalDefault = rows.find((row) => row.isGlobalDefault);
  const enabledLabels = rows.filter((row) => row.enabled).map((row) => row.label);

  const summaryText = [
    enabledLabels.length > 0
      ? `Enabled AI providers: ${enabledLabels.join(", ")}.`
      : "No AI providers are currently enabled.",
    globalDefault ? `The global default provider is ${globalDefault.label}.` : "No global default provider is set.",
  ].join(" ");

  return {
    data: { deterministicText: summaryText, kind: "admin_provider_summary", rows },
    ok: true,
    sources: [{ label: "Admin · Checked AI provider settings", type: "admin" }],
  };
}

// PART 9/10: reuses resolveAiAgentRuntimeConfig() for every agent (registry, 4 real ids, always
// bounded/cheap) rather than re-deriving agent override -> global default -> registry default
// precedence here - this guarantees the answer matches what actually runs, never a stale/
// duplicated copy of that logic. Never exposes a credential value, only the same
// apiKeyConfigured boolean the resolver already returns.
async function agentSummaryAnswer(message: string): Promise<NoaCapabilityResult> {
  const agents = listAiAgents();
  const targetAgent = targetAgentFromMessage(message, agents);
  const targets = targetAgent ? [targetAgent] : agents.slice(0, MAX_AGENT_ROWS);

  const runtimes = await Promise.all(
    targets.map(async (agent) => {
      try {
        return await resolveAiAgentRuntimeConfig(agent.id as AiAgentId);
      } catch {
        return null;
      }
    }),
  );

  const rows = targets.map((agent, index) => {
    const runtime = runtimes[index];
    return {
      credentialConfigured: runtime?.apiKeyConfigured ?? false,
      enabled: runtime?.enabled ?? agent.enabled,
      label: agent.label,
      model: runtime?.enabled ? runtime.model : null,
      provider: providerLabel(runtime?.provider ?? agent.provider),
    };
  });

  const summaryText = targetAgent
    ? `${rows[0].label} is ${rows[0].enabled ? "enabled" : "disabled"} and uses ${rows[0].provider}${rows[0].enabled && rows[0].model ? ` with model ${rows[0].model}` : ""}.`
    : `AI agents: ${rows.map((row) => `${row.label} (${row.enabled ? "enabled" : "disabled"}, ${row.provider})`).join(", ")}.`;

  return {
    data: { deterministicText: summaryText, kind: "admin_agent_summary", rows },
    ok: true,
    sources: [{ label: "Admin · Checked AI agent settings", type: "admin" }],
  };
}

// PART 11: every fact computed in code from already-bounded reads above - never raw rows handed
// to the model to tally.
async function systemSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const [{ count: activeCount }, { count: disabledCount }, { count: pendingCount }, providerResult, agentResult] = await Promise.all([
    supabase.from("profiles").select("full_name", { count: "exact", head: true }).eq("account_status", "active"),
    supabase.from("profiles").select("full_name", { count: "exact", head: true }).eq("account_status", "disabled"),
    supabase.from("profiles").select("full_name", { count: "exact", head: true }).eq("account_status", "pending"),
    providerSummaryAnswer(supabase),
    agentSummaryAnswer(""),
  ]);

  const active = activeCount ?? 0;
  const disabled = disabledCount ?? 0;
  const pending = pendingCount ?? 0;
  const total = active + disabled + pending;

  const providerData = providerResult.ok ? (providerResult.data as { rows: Array<{ enabled: boolean; label: string }> }) : null;
  const agentData = agentResult.ok ? (agentResult.data as { rows: Array<{ enabled: boolean; label: string }> }) : null;
  const enabledProviderCount = providerData?.rows.filter((row) => row.enabled).length ?? 0;
  const enabledAgentCount = agentData?.rows.filter((row) => row.enabled).length ?? 0;

  return {
    data: {
      activeUsers: active,
      disabledUsers: disabled,
      enabledAgentCount,
      enabledProviderCount,
      kind: "admin_system_summary",
      pendingUsers: pending,
      totalUsers: total,
      deterministicText: `There are ${total} user account${total === 1 ? "" : "s"}: ${active} active, ${disabled} disabled, and ${pending} pending. ${enabledProviderCount} AI provider${enabledProviderCount === 1 ? " is" : "s are"} enabled and ${enabledAgentCount} AI agent${enabledAgentCount === 1 ? " is" : "s are"} enabled.`,
    },
    ok: true,
    sources: [{ label: "Admin · Checked system status", type: "admin" }],
  };
}

// PART 2 entry point: requireSystemOwner() is the FIRST and only gate - nothing is queried before
// it succeeds. No writes anywhere in this file, no cross-capability chaining.
export async function fetchNoaAdminCapability(
  message: string,
  _context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  try {
    await requireSystemOwner();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const agents = listAiAgents();
  const kind = adminQuestionKind(message, agents);

  if (kind === "agent_summary") return agentSummaryAnswer(message);

  const supabase = await createClient();

  if (kind === "user_detail") return userDetailAnswer(supabase, message);
  if (kind === "role_summary") return roleSummaryAnswer(supabase, message);
  if (kind === "provider_summary") return providerSummaryAnswer(supabase);
  if (kind === "system_summary") return systemSummaryAnswer(supabase);
  if (kind === "user_count") return userListAnswer(supabase, message, true);
  return userListAnswer(supabase, message, false);
}
