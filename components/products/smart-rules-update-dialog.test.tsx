import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { applySmartRulesOnlyUpdate, planSmartRulesOnlyUpdate } from "../../lib/products/smart-rules-only-update";
import { FRONT_ID, incomingDraft, workspace } from "../../lib/products/testing/universal-screen-rules-fixture";
import { SmartRulesUpdateDialog, SmartRulesUpdateReview } from "./smart-rules-update-dialog";

const KEY = "option:us-og-front-stirrups";
const { draft, plan } = workspace();
const review = (manual: Record<string, string>, addItems = true) => {
  const report = planSmartRulesOnlyUpdate(draft, plan, incomingDraft(), manual);
  const choices = { [KEY]: { apply: true, addItems } };
  const result = applySmartRulesOnlyUpdate(draft, plan, incomingDraft(), choices, manual);
  return renderToStaticMarkup(<SmartRulesUpdateReview report={report} choices={choices} manual={manual} unnamed={result.unnamed} onChoice={() => {}} onManual={() => {}} />);
};

test("the first screen offers a file upload and a paste box", () => {
  const html = renderToStaticMarkup(<SmartRulesUpdateDialog draft={draft} plan={plan} parse={() => { throw new Error("not called"); }} renderParseProblems={() => null} onApply={() => {}} onClose={() => {}} />);
  assert.match(html, /aria-label="Update Rules from JSON"/);
  assert.match(html, /type="file" accept="\.json,\.txt,application\/json,text\/plain"/);
  assert.match(html, /aria-label="Rules JSON"/);
  assert.ok(html.includes("Nothing is saved until you press Save Changes."));
  assert.ok(!html.includes("Apply Rules"));
});

test("an unmatched group is listed as ignored, with a suggestion and a choice that defaults to Ignore", () => {
  const html = review({});
  assert.ok(html.includes("No rule differences found · 5 groups unchanged"));
  assert.ok(html.includes("Not found in this template (ignored)"));
  assert.match(html, /<option value="" selected="">Ignore<\/option>/);
  assert.ok(html.includes("Possibly &quot;Front Stirrups Kit Art.880&quot; (1 shared item)"));
});

test("once picked, only the changed group is shown, ticked, with counts, targets and the new items", () => {
  const html = review({ "us-og-front-stirrups": FRONT_ID });
  assert.ok(html.includes("1 group with different rules · 5 groups unchanged"));
  assert.ok(html.includes("7 targets before -&gt; 46 after"));
  assert.ok(html.includes("Targets added (39)"));
  assert.ok(html.includes("6 new items needed"));
  assert.ok(html.includes("Front Stirrup 466"));
  assert.ok(html.includes("Also add these 6 items"));
  assert.equal((html.match(/type="checkbox" class="[^"]*" checked=""/g) ?? []).length, 2, "group and add-items start ticked");
  assert.ok(!html.includes("Sound-Proofing Cover Kits</span>"));
});
