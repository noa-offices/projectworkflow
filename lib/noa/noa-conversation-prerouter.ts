import type { NoaPendingChoiceAction } from "./noa-conversation-state";
import type { NoaChoice } from "./noa-types";

// Single source of truth for the daily-status pendingChoice options: the closed action token, its
// clicked-chip value (fed back into normal business routing, exactly like any other chip click)
// and its typed-label equivalent. Shared with noa-shadow-turn.ts so typed/clicked resolution can
// never drift from what this clarification actually offered.
export const NOA_DAILY_STATUS_OPTIONS: Record<NoaPendingChoiceAction, { label: string; value: string }> = {
  attention: { label: "Attention items", value: "what needs my attention" },
  changes_today: { label: "Changes today", value: "what changed today" },
  my_activity: { label: "My activity today", value: "show my activity today" },
  project_status: { label: "Project status", value: "How are our projects doing?" },
};
export const NOA_DAILY_STATUS_ORDER: readonly NoaPendingChoiceAction[] = ["attention", "changes_today", "my_activity", "project_status"];

export type NoaConversationKind = "greeting" | "assistant_identity" | "acknowledgement" | "thanks" | "social" | "unclear" | "business_passthrough";
export type NoaConversationTurn = { kind: Exclude<NoaConversationKind, "business_passthrough">; reply: string } | { kind: "business_passthrough" };

// Classification only: never return rewritten user input. Whole-turn matches ensure a
// greeting attached to a business question cannot steal its existing business route.
export function prerouteNoaConversation(message: string): NoaConversationTurn {
  const normalized = message.toLowerCase().replace(/[’']/g, "").replace(/[.,!?;:…]+/g, " ").replace(/\s+/g, " ").trim();
  const text = normalized.replace(/^(?:hello|hi|hey) noa\s+/, "");
  if (/^(?:(?:hello|hi|hey)(?: there| noa)?|good morning|good afternoon|good evening|bonjour)$/.test(normalized)) {
    return { kind: "greeting", reply: normalized === "bonjour" ? "Bonjour ! Comment puis-je vous aider ?" : "Hello! How can I help?" };
  }
  if (/^(?:who are you|what are you|tell me about yourself|what can you do|who is noa)$/.test(text)) {
    return { kind: "assistant_identity", reply: "I'm NOA, the ProjectWorkflow assistant. I can help with products, quotations, Project Files, procurement, activity, analytics, attention items, and supported briefings." };
  }
  if (/^(?:(?:ok|okay)(?: (?:ok|okay))*|alright|got it)$/.test(text)) return { kind: "acknowledgement", reply: "Got it." };
  if (/^(?:well|hmm)$/.test(text)) return { kind: "acknowledgement", reply: "I'm listening." };
  if (/^(?:thanks|thank you)$/.test(text)) return { kind: "thanks", reply: "You're welcome." };
  if (/^(?:how are you(?: doing)?(?: today)?|hows it going(?: today)?|nice to hear from you)$/.test(text)) return { kind: "social", reply: "I'm doing well and ready to help. What would you like to check?" };
  if (!/[\p{L}\p{N}]/u.test(text) || /^(?:um|uh|erm|hmm)(?: (?:um|uh|erm|hmm))+$/.test(text)) {
    return { kind: "unclear", reply: "I didn't catch that. Could you say it another way?" };
  }
  return { kind: "business_passthrough" };
}

export type NoaBusinessParaphrase = { kind: "passthrough" } | { kind: "canonical"; message: string }
  | { kind: "clarify"; text: string; choices: NoaChoice[] };

// CFI2.2: closed whole-turn aliases only. No substring matching, entity extraction,
// new calculations, or interpretation of filters. The caller protects stronger routes.
export function normalizeNoaBusinessParaphrase(message: string, protectedMeaning = false): NoaBusinessParaphrase {
  if (protectedMeaning) return { kind: "passthrough" };
  const text = message.toLowerCase().replace(/[’']/g, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
  const canonical = (message: string): NoaBusinessParaphrase => ({ kind: "canonical", message });
  const clarify = (text: string, choices: Array<[string, string]>): NoaBusinessParaphrase => ({ kind: "clarify", text, choices: choices.map(([label, value]) => ({ label, value })) });
  if (/^(?:whats|what is|give me) todays status$|^how are things today$|^give me an update for today$|^whats (?:going on|happening) today$|^anything i should know today$/.test(text)) {
    return clarify("What would you like to check today?", NOA_DAILY_STATUS_ORDER.map((action) => [NOA_DAILY_STATUS_OPTIONS[action].label, NOA_DAILY_STATUS_OPTIONS[action].value]));
  }
  if (/^(?:anything important today|anything i need to deal with|what do i need to deal with|what should i look at today|is there anything i should check|anything urgent|what needs checking|what needs my attention today)$/.test(text)) return canonical("what needs my attention");
  if (/^(?:whats changed today|what happened today|whats been happening today|any updates today|catch me up on today|whats going on with updates today)$/.test(text)) return canonical("what changed today");
  if (/^(?:what did i do today|what have i worked on today|what was my activity today|show my activity today|what have i done today)$/.test(text)) return canonical("show my activity today");
  if (/^(?:how are our projects doing|whats the status of our projects)$/.test(text)) return clarify("Which Project File status would you like?", [["Active projects", "show active project files"], ["Completed projects", "show completed project files"]]);
  if (/^(?:show active projects|which projects are active)$/.test(text)) return canonical("show active project files");
  // 'Which projects are finished?' remains owned by its existing I4 path.
  if (/^(?:any quotations i should check|whats happening with quotations|are there quotations waiting|any quotation updates)$/.test(text)) return clarify("Would you like pending quotations, a quotation list, or quotation analytics? For one quotation's changes, give its QN number.", [["Pending quotations", "show pending quotations"], ["Quotation list", "show quotations"], ["Quotation analytics", "quotation analytics"]]);
  if (text === "show me pending quotations") return canonical("show pending quotations");
  if (text === "what procurement orders are active") return canonical("show active procurement orders");
  if (/^(?:any procurement issues|whats happening with procurement|anything missing in procurement)$/.test(text)) return clarify("I can list procurement orders. For details about missing information, name the order; these choices do not filter issues.", [["Active orders", "show active procurement orders"], ["Completed orders", "show completed procurement orders"]]);
  if (/^(?:whos our biggest client|who is our biggest client|which customer gives us the most business)$/.test(text)) return clarify("Which metric should I use to compare clients?", [["Quotation value", "top clients by quotation value"], ["Client-confirmed value", "top clients by confirmed value"], ["Project File value", "top clients by project value"]]);
  return { kind: "passthrough" };
}
