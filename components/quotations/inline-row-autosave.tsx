"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { autosaveQuotationItemInline } from "@/app/quotations/actions";

type SaveStatus = "saved" | "editing" | "saving" | "failed";

const statusLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  editing: "Editing...",
  saving: "Saving...",
  failed: "Save failed",
};

function isAutosaveControl(target: EventTarget | null, formId: string) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return false;
  }

  if (target.type === "submit" || target.type === "button") {
    return false;
  }

  return target.form?.id === formId || target.getAttribute("form") === formId;
}

export function InlineRowAutosave({ formId }: { formId: string }) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [, startTransition] = useTransition();
  const timerRef = useRef<number | null>(null);
  const saveVersionRef = useRef(0);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function saveNow() {
      const form = document.getElementById(formId);
      if (!(form instanceof HTMLFormElement)) return;

      clearTimer();
      const version = ++saveVersionRef.current;
      setStatus("saving");

      startTransition(() => {
        void autosaveQuotationItemInline(new FormData(form))
          .then((result) => {
            if (version !== saveVersionRef.current) return;
            setStatus(result.ok ? "saved" : "failed");
          })
          .catch(() => {
            if (version !== saveVersionRef.current) return;
            setStatus("failed");
          });
      });
    }

    function scheduleSave(event: Event) {
      if (!isAutosaveControl(event.target, formId)) return;

      setStatus("editing");
      clearTimer();
      timerRef.current = window.setTimeout(saveNow, 1000);
    }

    function saveOnBlur(event: Event) {
      if (!isAutosaveControl(event.target, formId)) return;
      saveNow();
    }

    document.addEventListener("input", scheduleSave);
    document.addEventListener("change", scheduleSave);
    document.addEventListener("focusout", saveOnBlur);

    return () => {
      clearTimer();
      document.removeEventListener("input", scheduleSave);
      document.removeEventListener("change", scheduleSave);
      document.removeEventListener("focusout", saveOnBlur);
    };
  }, [formId, startTransition]);

  return (
    <span
      className={`text-[10px] font-semibold ${
        status === "failed"
          ? "text-red-700"
          : status === "saving"
            ? "text-amber-700"
            : status === "editing"
              ? "text-zinc-500"
              : "text-emerald-800"
      }`}
    >
      {statusLabels[status]}
    </span>
  );
}
