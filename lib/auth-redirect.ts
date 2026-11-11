/** Keep auth return destinations on this site, including after URL decoding. */
export function safeAuthRedirectPath(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";

  let decoded = value;
  try {
    while (decoded.includes("%")) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return "/";
  }

  if (
    !decoded.startsWith("/")
    || decoded.startsWith("//")
    || decoded.includes("\\")
    || /[a-z][a-z\d+.-]*:/i.test(decoded)
    || Array.from(decoded).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  ) return "/";

  return value;
}
