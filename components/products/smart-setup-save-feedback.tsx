"use client";

/**
 * What Smart Setup shows while "Save Changes" runs. The Product Template form keeps doing the saving and
 * reports its steps here; nothing in this file saves, uploads or calls the server.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export type SmartSaveStatus =
  | { state: "idle" }
  | { state: "saving"; step: string }
  | { state: "saved"; message: string }
  | { state: "failed"; message: string };

export const SMART_SAVE_SAVED_HOLD_MS = 900;
export const SMART_SAVE_INVALID_FIELDS_MESSAGE = "Template was not saved. Please check the required fields in the Product Template form, then press Save again.";
export const SMART_SAVE_CLOSE_CONFIRM_MESSAGE = "A save is still running. Close Smart Setup anyway? The save may still finish.";
const UNCONFIRMED_MESSAGE = "The save could not be confirmed. Press Save again.";
// The start of the server's success messages; any other redirect message means the save did not happen.
const SUCCESS_MESSAGE = /^Product template (updated|added)\./i;

/** Reads a server action redirect. The update action redirects both on success and on some failures. */
export function smartSaveRedirectOutcome(error: unknown): { ok: boolean; message: string } | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  const url = digest.split(";")[2] ?? "";
  const message = new URL(url, "http://local.invalid").searchParams.get("message")?.trim() ?? "";
  if (!SUCCESS_MESSAGE.test(message)) return { ok: false, message: message || UNCONFIRMED_MESSAGE };
  const warning = message.replace(SUCCESS_MESSAGE, "").trim();
  return { ok: true, message: warning ? `Saved. ${warning}` : "Saved" };
}

/** Every call except begin() is ignored unless a Smart Setup save is running, so the form's own Save is unaffected. */
export function createSmartSaveReporter(
  setStatus: (status: SmartSaveStatus) => void,
  hold: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let active = false;
  const fail = (message: string) => {
    if (!active) return;
    active = false;
    setStatus({ state: "failed", message });
  };
  const saved = async (message = "Saved") => {
    if (!active) return;
    active = false;
    setStatus({ state: "saved", message });
    await hold(SMART_SAVE_SAVED_HOLD_MS);
  };
  return {
    begin(step: string) { active = true; setStatus({ state: "saving", step }); },
    step(step: string) { if (active) setStatus({ state: "saving", step }); },
    fail,
    saved,
    async redirected(error: unknown) {
      const outcome = smartSaveRedirectOutcome(error);
      if (!outcome) return;
      if (outcome.ok) await saved(outcome.message);
      else fail(outcome.message);
    },
    reset() { if (!active) setStatus({ state: "idle" }); },
  };
}

export function useSmartSetupSaveFeedback() {
  const [status, setStatus] = useState<SmartSaveStatus>({ state: "idle" });
  const [reporter] = useState(() => createSmartSaveReporter(setStatus));
  return { status, ...reporter };
}
export type SmartSetupSaveFeedback = ReturnType<typeof useSmartSetupSaveFeedback>;

/**
 * Shows "saving" at once, lets the browser paint it, then runs the (heavy, synchronous) apply step.
 * Locked synchronously, so a second press cannot start a second save.
 */
export function createSaveStartGate(
  setStarting: (starting: boolean) => void,
  afterPaint: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 30)),
) {
  let locked = false;
  return async (run: () => void) => {
    if (locked) return false;
    locked = true;
    setStarting(true);
    try {
      await afterPaint();
      run();
      return true;
    } finally {
      locked = false;
      setStarting(false);
    }
  };
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function SmartSetupSaveButton({ saving, blocked, onPress, className, children }: { saving: boolean; blocked: boolean; onPress: () => void; className: string; children: ReactNode }) {
  return (
    <button type="button" disabled={blocked || saving} aria-busy={saving || undefined} onClick={onPress} className={`${className} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700`}>
      {saving ? <span className="inline-flex items-center gap-2"><Spinner />Saving...</span> : children}
    </button>
  );
}

export function SmartSetupSaveNotice({ status }: { status: SmartSaveStatus }) {
  const alertRef = useRef<HTMLParagraphElement>(null);
  const failure = status.state === "failed" ? status.message : null;
  useEffect(() => { if (failure) alertRef.current?.scrollIntoView({ block: "nearest" }); }, [failure]);
  return (
    <div className="w-full min-w-0 break-words text-xs lg:max-w-sm lg:text-right">
      {/* Always mounted, so screen readers announce changes. */}
      <p aria-live="polite" className={status.state === "saved" ? "font-semibold text-emerald-700" : "text-zinc-700"}>{status.state === "saving" ? status.step : status.state === "saved" ? status.message : ""}</p>
      {failure ? <p ref={alertRef} role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-left font-semibold text-red-800">{failure}</p> : null}
    </div>
  );
}
