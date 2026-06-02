"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { startGlobalLoading } from "@/lib/global-loading";

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
          startGlobalLoading("navigation");
          router.back();
          return;
        }

        startGlobalLoading("navigation");
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
