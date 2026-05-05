"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type ContextBackLinkProps = {
  fallbackHref: string;
  children?: ReactNode;
  className?: string;
};

export function ContextBackLink({
  fallbackHref,
  children = "Back",
  className,
}: ContextBackLinkProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push(fallbackHref);
      }}
      className={
        className ??
        "text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
      }
    >
      {children}
    </button>
  );
}
