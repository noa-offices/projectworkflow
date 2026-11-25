import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SAVE_REQUEST_FAILED_MESSAGE, stagedUploadFailureMessage } from "../../lib/products/staged-image-upload";
import {
  createSaveStartGate,
  createSmartSaveReporter,
  SmartSetupSaveButton,
  SmartSetupSaveNotice,
  smartSaveRedirectOutcome,
  type SmartSaveStatus,
} from "./smart-setup-save-feedback";

const redirect = (message: string | null) => Object.assign(new Error("NEXT_REDIRECT"), {
  digest: `NEXT_REDIRECT;replace;/products/templates?editTemplate=1${message === null ? "" : `&message=${encodeURIComponent(message)}`}#template-1;307;`,
});

function reporterWithLog() {
  const log: SmartSaveStatus[] = [];
  const holds: number[] = [];
  const reporter = createSmartSaveReporter((next) => log.push(next), async (ms) => { holds.push(ms); });
  return { reporter, log, holds, last: () => log[log.length - 1] };
}

const button = (saving: boolean, blocked = false) => renderToStaticMarkup(<SmartSetupSaveButton saving={saving} blocked={blocked} onPress={() => {}} className="x">Save Changes</SmartSetupSaveButton>);
const notice = (status: SmartSaveStatus) => renderToStaticMarkup(<SmartSetupSaveNotice status={status} />);

test("saving disables the button and shows a spinner with Saving...", () => {
  assert.match(button(false), />Save Changes<\/button>/);
  assert.ok(!button(false).includes("disabled="));
  const saving = button(true);
  assert.match(saving, /disabled=""/);
  assert.match(saving, /aria-busy="true"/);
  assert.match(saving, /animate-spin/);
  assert.ok(saving.includes("Saving..."));
  assert.ok(!saving.includes("Save Changes"));
  assert.match(saving, /focus-visible:/);
  assert.match(button(false, true), /disabled=""/);
});

test("the first press shows saving before any work runs, and a double press starts one save", async () => {
  const events: string[] = [];
  let paint!: () => void;
  const start = createSaveStartGate((starting) => events.push(`starting:${starting}`), () => new Promise<void>((resolve) => { paint = resolve; }));
  const first = start(() => events.push("save"));
  assert.deepEqual(events, ["starting:true"], "feedback is set synchronously, within the press");
  assert.equal(await start(() => events.push("second save")), false);
  paint();
  assert.equal(await first, true);
  assert.deepEqual(events, ["starting:true", "save", "starting:false"]);
});

test("the gate opens again after the save step throws", async () => {
  const states: boolean[] = [];
  const start = createSaveStartGate((starting) => states.push(starting), async () => {});
  await assert.rejects(start(() => { throw new Error("boom"); }));
  assert.equal(await start(() => {}), true);
  assert.deepEqual(states, [true, false, true, false]);
});

test("progress text follows the save steps and is announced politely", () => {
  const { reporter, log, last } = reporterWithLog();
  reporter.begin("Preparing changes...");
  reporter.step("Uploading images 3 of 24...");
  assert.deepEqual(last(), { state: "saving", step: "Uploading images 3 of 24..." });
  reporter.step("Saving template...");
  assert.deepEqual(log.map((status) => status.state === "saving" && status.step), ["Preparing changes...", "Uploading images 3 of 24...", "Saving template..."]);
  assert.match(notice(last()!), /aria-live="polite"[^>]*>.*Saving template\.\.\./);
});

test("upload and request failures show the same text as an alert and re-enable saving", () => {
  for (const message of [stagedUploadFailureMessage(2, 24, "storage error"), SAVE_REQUEST_FAILED_MESSAGE]) {
    const { reporter, last } = reporterWithLog();
    reporter.begin("Preparing changes...");
    reporter.fail(message);
    assert.deepEqual(last(), { state: "failed", message });
    const html = notice(last()!);
    assert.match(html, /role="alert"/);
    assert.match(html, /text-red-/);
    assert.ok(html.includes("Press Save again."));
  }
});

test("success shows a green Saved and holds briefly before handing off", async () => {
  const { reporter, holds, last } = reporterWithLog();
  reporter.begin("Saving template...");
  await reporter.saved();
  assert.deepEqual(last(), { state: "saved", message: "Saved" });
  assert.deepEqual(holds, [900]);
  assert.match(notice(last()!), /text-emerald-[^>]*>Saved</);
});

test("a success redirect is Saved, including its partial-image warning", async () => {
  for (const [message, shown] of [
    ["Product template updated.", "Saved"],
    ["Product template updated. Product Template saved, but 2 reference images could not be uploaded.", "Saved. Product Template saved, but 2 reference images could not be uploaded."],
  ]) {
    const { reporter, last } = reporterWithLog();
    reporter.begin("Saving template...");
    await reporter.redirected(redirect(message!));
    assert.deepEqual(last(), { state: "saved", message: shown });
  }
});

test("an error redirect is a failure carrying the server's own message", async () => {
  const { reporter, holds, last } = reporterWithLog();
  reporter.begin("Saving template...");
  await reporter.redirected(redirect("Product template could not be updated: payload too large"));
  assert.deepEqual(last(), { state: "failed", message: "Product template could not be updated: payload too large" });
  assert.deepEqual(holds, []);
});

test("a redirect without a message is never reported as Saved, and other errors are not redirects", () => {
  assert.equal(smartSaveRedirectOutcome(redirect(null))?.ok, false);
  assert.equal(smartSaveRedirectOutcome(new Error("413")), null);
  assert.equal(smartSaveRedirectOutcome(Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" })), null);
});

test("an ordinary template Save (no Smart Setup save running) reports nothing and is not delayed", async () => {
  const { reporter, log, holds } = reporterWithLog();
  reporter.step("Uploading images 1 of 2...");
  reporter.fail("x");
  await reporter.saved();
  await reporter.redirected(redirect("Product template updated."));
  assert.deepEqual([log, holds], [[], []]);
});

test("reset clears an old result but cannot hide a save that is still running", () => {
  const { reporter, log, last } = reporterWithLog();
  reporter.begin("Saving template...");
  reporter.reset();
  assert.equal(log.length, 1);
  reporter.fail("x");
  reporter.reset();
  assert.deepEqual(last(), { state: "idle" });
});

test("form and modal are wired to the reporter without changing the save calls", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const form = read("./product-template-form.tsx");
  [
    'smartSave.begin("Preparing changes...");',
    'smartSave.step(imageCountToUpload ? `Uploading images 0 of ${imageCountToUpload}...` : "Saving template...");',
    "smartSave.fail(staged.message);",
    "smartSave.fail(SAVE_REQUEST_FAILED_MESSAGE);",
    "smartSave.fail(result.message);",
    "smartSave.fail(SMART_SAVE_INVALID_FIELDS_MESSAGE);",
    "await smartSave.redirected(error); throw error;",
    "await smartSave.saved();",
    "saveFeedback={smartSave}",
    "result = await baseSubmitAction(formData);",
  ].forEach((expected) => assert.ok(form.includes(expected), `form: ${expected}`));
  const modal = read("./smart-product-json-import.tsx");
  [
    "<SmartSetupSaveButton saving={saving}",
    "<SmartSetupSaveNotice status={saveStatus}",
    "void startSave(requestApply);",
    "if (saving) { closeWhileSaving(); return; }",
    "window.confirm(SMART_SAVE_CLOSE_CONFIRM_MESSAGE)",
  ].forEach((expected) => assert.ok(modal.includes(expected), `modal: ${expected}`));
});
