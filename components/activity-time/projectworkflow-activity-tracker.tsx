"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { shouldSendActivityTouch } from "@/lib/activity-time/activity-tracker-policy";

export function ProjectWorkflowActivityTracker() {
  const pathname = usePathname();
  const lastSentAtRef = useRef<number | null>(null);
  const previousPathnameRef = useRef(pathname);

  const recordIntentionalActivity = useCallback(() => {
    const now = Date.now();
    if (!shouldSendActivityTouch({
      isVisible: document.visibilityState === "visible",
      lastSentAt: lastSentAtRef.current,
      now,
    })) {
      return;
    }

    lastSentAtRef.current = now;
    void fetch("/api/activity-time/touch", {
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname !== pathname) recordIntentionalActivity();
  }, [pathname, recordIntentionalActivity]);

  useEffect(() => {
    const handleIntentionalActivity = () => recordIntentionalActivity();
    document.addEventListener("click", handleIntentionalActivity, true);
    document.addEventListener("keydown", handleIntentionalActivity, true);
    document.addEventListener("pointerdown", handleIntentionalActivity, true);
    document.addEventListener("submit", handleIntentionalActivity, true);

    return () => {
      document.removeEventListener("click", handleIntentionalActivity, true);
      document.removeEventListener("keydown", handleIntentionalActivity, true);
      document.removeEventListener("pointerdown", handleIntentionalActivity, true);
      document.removeEventListener("submit", handleIntentionalActivity, true);
    };
  }, [recordIntentionalActivity]);

  return null;
}
