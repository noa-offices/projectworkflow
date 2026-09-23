import type { NoaVisualState } from "./noa-types";

// All valid transitions live here, and only here, so no component has to reason about which
// visual states an event is allowed to move away from.
export type NoaStateEvent =
  | { type: "HOVER_START" }
  | { type: "HOVER_END" }
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SEND" }
  | { type: "STREAM_START" }
  | { type: "RESPONSE_SUCCESS" }
  | { type: "RESPONSE_ERROR" }
  | { type: "SETTLE" };

export function noaStateReducer(state: NoaVisualState, event: NoaStateEvent): NoaVisualState {
  switch (event.type) {
    case "HOVER_START":
      return state === "idle" ? "hover" : state;

    case "HOVER_END":
      return state === "hover" ? "idle" : state;

    case "OPEN":
      return state === "idle" || state === "hover" ? "open" : state;

    // Only closes from a settled "open" (no pending request) - closing while thinking/responding
    // leaves the visual state untouched, so the launcher keeps reflecting the in-flight request.
    case "CLOSE":
      return state === "open" ? "idle" : state;

    case "SEND":
      return state === "open" ? "thinking" : state;

    case "STREAM_START":
      return state === "thinking" ? "responding" : state;

    case "RESPONSE_SUCCESS":
      return state === "thinking" || state === "responding" ? "success" : state;

    case "RESPONSE_ERROR":
      return state === "thinking" || state === "responding" ? "error" : state;

    case "SETTLE":
      return state === "success" || state === "error" ? "open" : state;

    default:
      return state;
  }
}
