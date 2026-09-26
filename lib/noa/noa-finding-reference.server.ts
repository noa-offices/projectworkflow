import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { detectNoaFindingFollowUp, sanitizeNoaConversationReference, sanitizeNoaPreviousFinding, type NoaConversationReference, type NoaPreviousFinding } from "./noa-conversation-reference";
import type { NoaAnswer } from "./noa-types";

// A round-tripped status cannot be trusted like a freshly authorized capability result.
// Sign only this closed observation, not entity references used for normal fresh reads.
// Existing server credential provides cross-worker stability; without it, references expire
// on worker change/restart as well as after 15 minutes. No persistent state or new DB read.
const processKey = randomBytes(32);
function proof(finding: NoaPreviousFinding): string {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim() || processKey;
  return createHmac("sha256", key).update(JSON.stringify(["noa-finding-v1", finding.domain, finding.entityType,
    finding.entityLabel, finding.findingKind, finding.allowedFollowUps, finding.issuedAt])).digest("hex");
}

export function buildNoaPreviousFinding(data: unknown, now = Date.now()): NoaPreviousFinding | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  let label: unknown;
  if (record.kind === "price_summary") {
    const counts = record.counts;
    if (!Array.isArray(counts) || counts.length !== 1) return undefined;
    const entry = counts[0];
    if (!entry || entry.statusKey !== "no_price_list_date" || !Number.isInteger(entry.count) || entry.count <= 0 || entry.count > 100 ||
      record.scanCapped !== false || entry.count !== record.scannedCount || record.totalMatching !== record.scannedCount) return undefined;
    label = record.entityLabel;
  } else if (record.kind === "price_list") {
    if (!Array.isArray(record.rows) || !record.rows.length || record.rows.length > 20 ||
      record.scanCapped !== false || record.truncatedCount !== 0 || record.totalMatching !== record.rows.length ||
      !record.rows.every((row) => row?.statusKey === "no_price_list_date")) return undefined;
    label = record.entityLabel;
  } else if (!("kind" in record) && record.statusKey === "no_price_list_date" && typeof record.name === "string") {
    label = typeof record.brand === "string" ? `${record.brand} ${record.name}` : record.name;
  } else return undefined;
  const finding = sanitizeNoaPreviousFinding({ domain: "Price", entityType: "product_template", entityLabel: label,
    findingKind: "no_price_list_date", allowedFollowUps: ["explain", "guidance", "confirm"], issuedAt: now, proof: "0".repeat(64) });
  return finding ? { ...finding, proof: proof(finding) } : undefined;
}

export function resolveNoaFindingFollowUp(message: string, incoming: unknown, now = Date.now()): NoaAnswer | undefined {
  const cue = detectNoaFindingFollowUp(message);
  if (!cue) return undefined;
  const reference = sanitizeNoaConversationReference(incoming);
  const finding = reference?.previousFinding;
  if (!finding || finding.issuedAt > now || now - finding.issuedAt > 15 * 60_000 ||
    !timingSafeEqual(Buffer.from(finding.proof, "hex"), Buffer.from(proof(finding), "hex"))) {
    return { domain: "Help", sources: [], text: "Which finding do you mean? Please repeat the product or price-status question so I can check it." };
  }
  const explanation = `The previous price-status result for ${finding.entityLabel} reported no brand price-list date. Without that date, I can't confirm price freshness.`;
  // Proven in app/products/templates/page.tsx: selected brand -> Price list updates -> Add update.
  const guidance = "In Product Library, select the brand, open Price list updates, then Add update to record the actual price-list information.";
  const text = cue === "action"
    ? `I can explain what needs to be configured, but I can't change that setting from NOA yet. ${explanation}`
    : `${explanation}${cue === "guidance" || cue === "confirm" ? ` ${guidance}` : ""}`;
  return { domain: "Price", sources: [], conversationReference: reference, text };
}

export function withoutNoaPreviousFinding(reference: NoaConversationReference | undefined): NoaConversationReference | undefined {
  if (!reference?.previousFinding) return reference;
  const { previousFinding: _finding, ...rest } = reference;
  void _finding;
  return rest.intent === "price_finding" && !rest.entities?.length ? undefined : rest;
}
