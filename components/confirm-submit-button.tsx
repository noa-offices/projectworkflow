"use client";

import type { ReactNode } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";

type ConfirmSubmitButtonProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  message: string;
  pendingLabel?: ReactNode;
};

export function ConfirmSubmitButton({
  children,
  className,
  disabled,
  message,
  pendingLabel,
}: ConfirmSubmitButtonProps) {
  return (
    <PendingSubmitButton
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className={className}
      disabled={disabled}
      pendingLabel={pendingLabel}
    >
      {children}
    </PendingSubmitButton>
  );
}
