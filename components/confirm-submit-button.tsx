"use client";

import type { ReactNode } from "react";

type ConfirmSubmitButtonProps = {
  children: ReactNode;
  className?: string;
  message: string;
};

export function ConfirmSubmitButton({
  children,
  className,
  message,
}: ConfirmSubmitButtonProps) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className={className}
    >
      {children}
    </button>
  );
}
