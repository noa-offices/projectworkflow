import type { NoaChoice } from "./noa-types";

export type NoaConversationKind = "greeting" | "assistant_identity" | "acknowledgement" | "thanks" | "social" | "unclear" | "business_passthrough";
export type NoaConversationTurn = { kind: Exclude<NoaConversationKind, "business_passthrough">; reply: string } | { kind: "business_passthrough" };

// Classification only: never return rewritten user input. Whole-turn matches ensure a
// greeting attached to a business question cannot steal its existing business route.
export function prerouteNoaConversation(message: string): NoaConversationTurn {
  const normalized = message.toLowerCase().replace(/[’']/g, "").replace(/[.,!?;:…]+/g, " ").replace(/\s+/g, " ").trim();
  const text = normalized.replace(/^(?:hello|hi|hey) noa\s+/, "");
  // A typed "Hey Noah"/"Hello, Noah" is still a plain greeting - transcription/spelling drift on
  // the assistant's own name, never a reference to a person named Noah (this only matches when
  // the ENTIRE message is just the greeting + name, so "ask Noah about the quotation" still falls
  // through to business_passthrough untouched).
  if (/^(?:(?:hello|hi|hey)(?: there| noa| noah)?|good morning|good afternoon|good evening|bonjour)$/.test(normalized)) {
    return { kind: "greeting", reply: normalized === "bonjour" ? "Bonjour ! Comment puis-je vous aider ?" : "Hello! How can I help?" };
  }
  if (/^(?:who are you|what are you|tell me about yourself|what can you do|who is noa)$/.test(text)) {
    return { kind: "assistant_identity", reply: "I'm NOA, the ProjectWorkflow assistant. I can help with products, quotations, Project Files, procurement, activity, analytics, attention items, and supported briefings." };
  }
  // CFI2.4: a compound acknowledgement + thanks ("OK, thank you.") is still one closed whole-turn
  // alias - the second word is deliberately limited to thanks/thank you (never ok/okay) so "OK,
  // OK." keeps matching the plain acknowledgement rule below instead of this one.
  if (/^(?:ok|okay|alright|perfect|got it) (?:thanks|thank you)$/.test(text)) return { kind: "thanks", reply: "You're welcome." };
  if (/^(?:(?:ok|okay)(?: (?:ok|okay))*|alright|got it)$/.test(text)) return { kind: "acknowledgement", reply: "Got it." };
  if (/^(?:well|hmm)$/.test(text)) return { kind: "acknowledgement", reply: "I'm listening." };
  if (/^(?:thanks|thank you)$/.test(text)) return { kind: "thanks", reply: "You're welcome." };
  if (/^(?:how are you(?: doing)?|hows it going|nice to hear from you)$/.test(text)) return { kind: "social", reply: "I'm here and ready to help. What would you like to check?" };
  if (!/[\p{L}\p{N}]/u.test(text) || /^(?:um|uh|erm|hmm)(?: (?:um|uh|erm|hmm))+$/.test(text)) {
    return { kind: "unclear", reply: "I didn't catch that. Could you say it another way?" };
  }
  return { kind: "business_passthrough" };
}

export type NoaBusinessParaphrase = { kind: "passthrough" } | { kind: "canonical"; message: string }
  | { kind: "clarify"; text: string; choices: NoaChoice[]; contextTag?: "daily_status" };

// CFI2.5b: the SAME four values the daily-status chips themselves already send - typing/speaking a
// chip's visible label must reach the exact same route as clicking it, never a second definition.
const DAILY_STATUS_OPTIONS = {
  attention: "what needs my attention",
  changes: "what changed today",
  my_activity: "show my activity today",
  project_status: "How are our projects doing?",
} as const;

// CFI2.2: closed whole-turn aliases only. No substring matching, entity extraction,
// new calculations, or interpretation of filters. The caller protects stronger routes.
export function normalizeNoaBusinessParaphrase(message: string, protectedMeaning = false, priorProjectReferenceClarification = false, priorDailyStatusClarification = false): NoaBusinessParaphrase {
  if (protectedMeaning) return { kind: "passthrough" };
  const text = message.toLowerCase().replace(/[’']/g, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
  const canonical = (message: string): NoaBusinessParaphrase => ({ kind: "canonical", message });
  const clarify = (text: string, choices: Array<[string, string]>, contextTag?: "daily_status"): NoaBusinessParaphrase => ({ kind: "clarify", text, choices: choices.map(([label, value]) => ({ label, value })), ...(contextTag ? { contextTag } : {}) });
  // CFI2.4: only continues an IMMEDIATELY preceding "Please specify the Project File number or
  // reference." clarification (the caller gates this on that exact stored marker) - never fires
  // for these same narrow phrases outside that context, so nothing is ever invented.
  if (priorProjectReferenceClarification && /^(?:give me the references?|show me the options|which projects|list them|what are the references?)$/.test(text)) {
    return canonical("show active project files");
  }
  // CFI2.5b: only continues an IMMEDIATELY preceding daily-status clarification (the caller gates
  // this on that exact stored marker) - these are deliberately narrow, closed aliases for the four
  // chip labels themselves, never a global redefinition of "Changes"/"Projects" outside this
  // context (see the ungated identical bare words falling through to normal routing below).
  if (priorDailyStatusClarification) {
    if (/^(?:attention items|attention|what needs attention)$/.test(text)) return canonical(DAILY_STATUS_OPTIONS.attention);
    if (/^(?:changes today|todays changes|what changed today|changes)$/.test(text)) return canonical(DAILY_STATUS_OPTIONS.changes);
    if (/^(?:my activity today|my activity|todays activity|what did i do today)$/.test(text)) return canonical(DAILY_STATUS_OPTIONS.my_activity);
    if (/^(?:project status|active projects|projects|show project status)$/.test(text)) return canonical(DAILY_STATUS_OPTIONS.project_status);
  }
  if (/^(?:whats|what is|give me) todays status$|^how are things today$|^give me an update for today$|^whats (?:going on|happening) today$|^anything i should know today$/.test(text)) {
    return clarify("What would you like to check?", [["Attention items", DAILY_STATUS_OPTIONS.attention], ["Changes today", DAILY_STATUS_OPTIONS.changes], ["My activity today", DAILY_STATUS_OPTIONS.my_activity], ["Project status", DAILY_STATUS_OPTIONS.project_status]], "daily_status");
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
