export function plainChatText(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\*\*([^\r\n]+?)\*\*/g, "$1")
    .replace(/__([^\r\n]+?)__/g, "$1")
    .replace(/`/g, "")
    .replace(/^#{1,3} /gm, "")
    .replace(/^\* /gm, "- ");
}
