"use client";

import Link from "next/link";
import { type InvalidEvent, type ReactNode, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { PendingSubmitButton } from "@/components/pending-submit-button";

type TemplateFormShellProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  children: ReactNode;
  initialMessage?: string;
  pendingMessage: string;
  pendingLabel: string;
  submitLabel: string;
};

type NoticeTone = "error" | "info" | "success";

function inferNoticeTone(message: string): NoticeTone {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("could not") ||
    normalized.includes("required") ||
    normalized.includes("does not belong") ||
    normalized.includes("invalid") ||
    normalized.includes("failed")
  ) {
    return "error";
  }

  if (normalized.includes("adding product") || normalized.includes("being added")) {
    return "info";
  }

  return "success";
}

function noticeClassName(tone: NoticeTone) {
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (tone === "info") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

function validationMessage(name: string) {
  if (name === "brand_id") {
    return "Brand is required.";
  }

  if (name === "template_name") {
    return "Please add at least item name/template name.";
  }

  return "Template could not be saved. Please check required fields.";
}

function TemplateFormNotice({
  initialMessage,
  pendingMessage,
  validationNotice,
}: {
  initialMessage?: string;
  pendingMessage: string;
  validationNotice: string | null;
}) {
  const { pending } = useFormStatus();

  const notice = useMemo(() => {
    if (pending) {
      return {
        message: pendingMessage,
        tone: "info" as const,
      };
    }

    if (validationNotice) {
      return {
        message: validationNotice,
        tone: "error" as const,
      };
    }

    if (initialMessage) {
      return {
        message: initialMessage,
        tone: inferNoticeTone(initialMessage),
      };
    }

    return null;
  }, [initialMessage, pending, pendingMessage, validationNotice]);

  if (!notice) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-sm ${noticeClassName(notice.tone)}`}
    >
      {notice.message}
    </p>
  );
}

export function TemplateFormShell({
  action,
  cancelHref,
  children,
  initialMessage,
  pendingMessage,
  pendingLabel,
  submitLabel,
}: TemplateFormShellProps) {
  const [validationNotice, setValidationNotice] = useState<string | null>(null);

  return (
    <form
      action={action}
      className="space-y-4"
      onInput={() => {
        if (validationNotice) {
          setValidationNotice(null);
        }
      }}
      onInvalidCapture={(event: InvalidEvent<HTMLFormElement>) => {
        const target = event.target;

        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        ) {
          setValidationNotice(validationMessage(target.name));
        }
      }}
      onSubmit={() => {
        setValidationNotice(null);
      }}
    >
      <TemplateFormNotice
        initialMessage={initialMessage}
        pendingMessage={pendingMessage}
        validationNotice={validationNotice}
      />
      {children}
      <div className="sticky bottom-4 z-10 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Primary Action
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Save the template after reviewing each section.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Link
              href={cancelHref}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
            >
              Cancel
            </Link>
            <PendingSubmitButton
              className="h-10 rounded-md bg-emerald-900 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
              pendingLabel={pendingLabel}
            >
              {submitLabel}
            </PendingSubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}
