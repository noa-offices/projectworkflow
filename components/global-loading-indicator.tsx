"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  GLOBAL_LOADING_EVENT,
  type GlobalLoadingSource,
} from "@/lib/global-loading";

const SHOW_DELAY_MS = 180;
const MIN_VISIBLE_MS = 350;
const FALLBACK_TIMEOUT_MS = 12000;
const ACTION_SETTLE_MS = 900;

type PendingState = {
  source: GlobalLoadingSource;
  token: number;
};

export function GlobalLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isVisible, setIsVisible] = useState(false);
  const isVisibleRef = useRef(false);
  const pendingRef = useRef<PendingState | null>(null);
  const tokenRef = useRef(0);
  const visibleSinceRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const mutationTimerRef = useRef<number | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const clearTimer = useCallback((timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const disconnectObserver = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    clearTimer(mutationTimerRef);
  }, [clearTimer]);

  const clearPendingTimers = useCallback(() => {
    clearTimer(showTimerRef);
    clearTimer(fallbackTimerRef);
    clearTimer(hideTimerRef);
  }, [clearTimer]);

  const finishPending = useCallback(() => {
    pendingRef.current = null;
    disconnectObserver();
    clearTimer(showTimerRef);
    clearTimer(fallbackTimerRef);

    if (!isVisibleRef.current) {
      clearTimer(hideTimerRef);
      visibleSinceRef.current = null;
      setIsVisible(false);
      return;
    }

    const visibleSince = visibleSinceRef.current ?? Date.now();
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - visibleSince));

    clearTimer(hideTimerRef);
    hideTimerRef.current = window.setTimeout(() => {
      visibleSinceRef.current = null;
      setIsVisible(false);
      hideTimerRef.current = null;
    }, remaining);
  }, [clearTimer, disconnectObserver]);

  const hasMeaningfulMutation = useCallback((records: MutationRecord[]) => {
    return records.some((record) => {
      if (indicatorRef.current?.contains(record.target)) {
        return false;
      }

      return Array.from(record.addedNodes).some(
        (node) => !indicatorRef.current?.contains(node),
      ) || Array.from(record.removedNodes).some(
        (node) => !indicatorRef.current?.contains(node),
      ) || record.type === "attributes" || record.type === "characterData";
    });
  }, []);

  const watchForActionSettled = useCallback((token: number) => {
    disconnectObserver();

    observerRef.current = new MutationObserver((records) => {
      const pending = pendingRef.current;
      if (!pending || pending.token !== token || pending.source !== "action") {
        return;
      }

      if (!hasMeaningfulMutation(records)) {
        return;
      }

      clearTimer(mutationTimerRef);
      mutationTimerRef.current = window.setTimeout(() => {
        if (pendingRef.current?.token === token) {
          finishPending();
        }
      }, ACTION_SETTLE_MS);
    });

    observerRef.current.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }, [clearTimer, disconnectObserver, finishPending, hasMeaningfulMutation]);

  const startPending = useCallback((source: GlobalLoadingSource) => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    pendingRef.current = { source, token };
    clearPendingTimers();
    disconnectObserver();

    if (!isVisibleRef.current) {
      showTimerRef.current = window.setTimeout(() => {
        if (pendingRef.current?.token !== token) {
          return;
        }

        visibleSinceRef.current = Date.now();
        setIsVisible(true);
        showTimerRef.current = null;
      }, SHOW_DELAY_MS);
    }

    fallbackTimerRef.current = window.setTimeout(() => {
      if (pendingRef.current?.token === token) {
        finishPending();
      }
    }, FALLBACK_TIMEOUT_MS);

    if (source === "action") {
      watchForActionSettled(token);
    }
  }, [clearPendingTimers, disconnectObserver, finishPending, isVisibleRef, watchForActionSettled]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    return () => {
      clearPendingTimers();
      disconnectObserver();
    };
  }, [clearPendingTimers, disconnectObserver]);

  useEffect(() => {
    if (pendingRef.current) {
      finishPending();
    }
  }, [finishPending, routeKey]);

  useEffect(() => {
    function handleGlobalLoading(event: Event) {
      const customEvent = event as CustomEvent<{
        action: "start" | "stop";
        source?: GlobalLoadingSource;
      }>;

      if (customEvent.detail.action === "stop") {
        finishPending();
        return;
      }

      startPending(customEvent.detail.source ?? "action");
    }

    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-no-global-loading]")) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (
        anchor.hasAttribute("download") ||
        anchor.getAttribute("aria-disabled") === "true" ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) {
        return;
      }

      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      startPending("navigation");
    }

    function handleSubmit(event: Event) {
      if (event.defaultPrevented) {
        return;
      }

      const submitEvent = event as SubmitEvent;
      const form = submitEvent.target;
      if (!(form instanceof HTMLFormElement)) {
        return;
      }

      const submitter = submitEvent.submitter;
      if (
        form.closest("[data-no-global-loading]") ||
        submitter?.closest?.("[data-no-global-loading]")
      ) {
        return;
      }

      if (
        submitter instanceof HTMLButtonElement ||
        submitter instanceof HTMLInputElement
      ) {
        if (submitter.disabled || submitter.getAttribute("aria-disabled") === "true") {
          return;
        }

        const formAction = submitter.getAttribute("formaction");
        if (formAction) {
          const url = new URL(formAction, window.location.href);
          if (url.origin !== window.location.origin) {
            return;
          }
        }
      }

      const action = form.getAttribute("action");
      if (action) {
        const url = new URL(action, window.location.href);
        if (url.origin !== window.location.origin) {
          return;
        }
      }

      startPending("action");
    }

    window.addEventListener(GLOBAL_LOADING_EVENT, handleGlobalLoading as EventListener);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      window.removeEventListener(
        GLOBAL_LOADING_EVENT,
        handleGlobalLoading as EventListener,
      );
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, [finishPending, startPending]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50">
      <div
        ref={indicatorRef}
        aria-hidden={!isVisible}
        className={`flex items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-sm text-zinc-700 shadow-sm ring-1 ring-black/5 backdrop-blur-sm transition-all duration-200 ${
          isVisible
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
      >
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-700" />
        <span className="font-medium">Loading...</span>
      </div>
    </div>
  );
}
