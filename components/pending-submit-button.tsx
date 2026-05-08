"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
};

function inferPendingLabel(children: ReactNode) {
  if (typeof children !== "string") {
    return "Working...";
  }

  const label = children.trim();
  const normalized = label.toLowerCase();

  if (
    normalized === "save extra discount" ||
    normalized.includes("discount")
  ) {
    return "Saving discount...";
  }

  if (normalized.startsWith("save")) return "Saving...";
  if (normalized.startsWith("saving")) return "Saving...";
  if (
    normalized.startsWith("move to archive") ||
    normalized.startsWith("archive")
  ) {
    return "Archiving...";
  }
  if (normalized.startsWith("discontinue")) return "Discontinuing...";
  if (normalized.startsWith("delete")) return "Deleting...";
  if (normalized.startsWith("restore")) return "Restoring...";
  if (normalized.startsWith("deactivate")) return "Deactivating...";
  if (normalized.startsWith("create")) return "Creating...";
  if (normalized.startsWith("creating")) return "Creating...";
  if (normalized.startsWith("add")) return "Adding...";
  if (normalized.startsWith("update status")) return "Updating status...";
  if (normalized.startsWith("update")) return "Updating...";
  if (normalized.startsWith("mark checked")) return "Marking checked...";
  if (normalized.startsWith("check ")) return "Checking...";
  if (normalized.startsWith("upload")) return "Uploading...";
  if (normalized.startsWith("download pdf")) return "Preparing PDF...";
  if (normalized.startsWith("download specification")) {
    return "Preparing Specification...";
  }
  if (normalized.startsWith("apply")) return "Applying...";
  if (normalized.startsWith("use ")) return "Updating...";

  return "Working...";
}

export function PendingSubmitButton({
  children,
  disabled,
  pendingLabel,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      {...props}
    >
      {pending ? pendingLabel ?? inferPendingLabel(children) : children}
    </button>
  );
}
