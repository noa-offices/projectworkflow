export const NETWORK_MESSAGE = "No connection. Check your internet and try again. Your entries are kept.";

/** Plain message for a save that threw: a network problem gets its own words. */
export function saveFailureMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const text = error instanceof Error ? error.message : "";
  if (offline || (error instanceof TypeError && /fetch|network|load failed|connection/i.test(text))) return NETWORK_MESSAGE;
  return fallback;
}
