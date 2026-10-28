import assert from "node:assert/strict";
import test from "node:test";
import { plainChatText } from "./noa-plain-text";

const cases: Array<[string, string, string]> = [
  ["bold names", "**Sam** and __Amina__", "Sam and Amina"],
  ["several bold parts", "**Sam** found **3** items for __Amina__.", "Sam found 3 items for Amina."],
  ["bold inside a bullet", "- **Oak**: __available__", "- Oak: available"],
  ["backticks", "Use `Oak` and ```plain```.", "Use Oak and plain."],
  ["headings", "# One\n## Two\r\n### Three", "One\nTwo\r\nThree"],
  ["star bullets", "* item\n* another\n- existing", "- item\n- another\n- existing"],
  ["multiplication", "5 * 3 = 15", "5 * 3 = 15"],
  ["unpaired bold mark", "An unpaired ** remains", "An unpaired ** remains"],
  ["empty string", "", ""],
  ["non-English letters", "مرحبا بالعالم — café 日本語", "مرحبا بالعالم — café 日本語"],
  ["normal single asterisks", "A *normal* word and a lone *", "A *normal* word and a lone *"],
  ["bold pairs cannot cross lines", "**first\nsecond**\n__third\r\nfourth__", "**first\nsecond**\n__third\r\nfourth__"],
  ["other heading marks stay unchanged", "#### Four\n#hashtag\n  # indented", "#### Four\n#hashtag\n  # indented"],
];

for (const [name, input, expected] of cases) {
  test(name, () => assert.equal(plainChatText(input), expected));
}

test("non-string inputs return an empty string without throwing", () => {
  for (const input of [null, undefined, 42, false, {}, [], Symbol("text")]) {
    assert.equal(plainChatText(input as unknown as string), "");
  }
});
