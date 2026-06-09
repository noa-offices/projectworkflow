"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type StoredUiState = {
  activeElement: {
    id: string;
    name: string;
    stateKey: string;
  } | null;
  anchorId: string | null;
  openDetails: string[];
  scrollX: number;
  scrollY: number;
  savedAt: number;
};

const STORAGE_PREFIX = "preserve-ui-state:v1";
const TRANSIENT_SEARCH_KEYS = ["message", "undo_item_id", "undo_kind", "undo_section_id"];
const MAX_STATE_AGE_MS = 5 * 60 * 1000;
const FORM_OPENING_SEARCH_KEYS = ["addClient", "addProject"];

function normalizedSearch(searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams.toString());

  for (const key of TRANSIENT_SEARCH_KEYS) {
    params.delete(key);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function exactStorageKey(pathname: string, search: string) {
  return `${STORAGE_PREFIX}:exact:${pathname}${search}`;
}

function pathStorageKey(pathname: string) {
  return `${STORAGE_PREFIX}:path:${pathname}`;
}

function resolveAnchorId(start: HTMLElement | null) {
  let current: HTMLElement | null = start;

  while (current) {
    const explicitAnchor = current.dataset.preserveAnchor;
    if (explicitAnchor) return explicitAnchor;
    if (current.id) return current.id;
    current = current.parentElement;
  }

  return null;
}

function captureOpenDetails() {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("details[open]"))
    .map((element) => element.dataset.stateKey || element.id || null)
    .filter((value): value is string => Boolean(value));
}

function captureActiveElement() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;

  return {
    id: active.id || "",
    name: active.getAttribute("name") || "",
    stateKey: active.dataset?.stateKey || "",
  };
}

function sanitizeStoredUiState(state: StoredUiState): StoredUiState {
  return {
    activeElement: state.activeElement
      ? {
          id: String(state.activeElement.id || ""),
          name: String(state.activeElement.name || ""),
          stateKey: String(state.activeElement.stateKey || ""),
        }
      : null,
    anchorId: state.anchorId ? String(state.anchorId) : null,
    openDetails: state.openDetails.map((value) => String(value)),
    savedAt: Number.isFinite(state.savedAt) ? state.savedAt : Date.now(),
    scrollX: Number.isFinite(state.scrollX) ? state.scrollX : 0,
    scrollY: Number.isFinite(state.scrollY) ? state.scrollY : 0,
  };
}

function readStoredUiState(keys: string[]) {
  for (const key of keys) {
    const raw = sessionStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as StoredUiState;
      if (Date.now() - parsed.savedAt > MAX_STATE_AGE_MS) {
        sessionStorage.removeItem(key);
        continue;
      }

      return { key, value: parsed };
    } catch {
      sessionStorage.removeItem(key);
    }
  }

  return null;
}

function restoreOpenDetails(openDetails: string[]) {
  const detailMap = new Map<string, HTMLDetailsElement>();

  for (const element of document.querySelectorAll<HTMLDetailsElement>("details[data-state-key], details[id]")) {
    if (element.dataset.stateKey) {
      detailMap.set(element.dataset.stateKey, element);
    }
    if (element.id) {
      detailMap.set(element.id, element);
    }
  }

  for (const key of openDetails) {
    const target = detailMap.get(key);
    if (target) {
      target.open = true;
    }
  }
}

function openDetailsAncestors(target: HTMLElement) {
  let current: HTMLElement | null = target;

  while (current) {
    if (current instanceof HTMLDetailsElement) {
      current.open = true;
    }
    current = current.parentElement;
  }
}

function restoreHashTarget() {
  const hash = window.location.hash;
  if (!hash || hash === "#") return false;

  const anchorId = decodeURIComponent(hash.slice(1));
  const target = document.getElementById(anchorId)
    || document.querySelector<HTMLElement>(`[data-preserve-anchor="${anchorId}"]`);

  if (!target) return false;

  openDetailsAncestors(target);
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  }

  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  return true;
}

function restoreScrollPosition(anchorId: string | null, scrollX: number, scrollY: number) {
  if (restoreHashTarget()) return;

  if (anchorId) {
    const anchor = document.getElementById(anchorId)
      || document.querySelector<HTMLElement>(`[data-preserve-anchor="${anchorId}"]`);
    if (anchor) {
      openDetailsAncestors(anchor);
      const top = Math.max(anchor.getBoundingClientRect().top + window.scrollY - 24, 0);
      window.scrollTo({ top, left: Math.max(scrollX, 0), behavior: "auto" });
      return;
    }
  }

  window.scrollTo({ top: Math.max(scrollY, 0), left: Math.max(scrollX, 0), behavior: "auto" });
}

export function PreserveUiState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const normalized = normalizedSearch(new URLSearchParams(searchParams.toString()));
  const hasFormOpeningSearch = FORM_OPENING_SEARCH_KEYS.some((key) => searchParams.get(key) === "1");

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.preserveUiState === "false") return;

      const submitEvent = event as SubmitEvent;
      const submitter = submitEvent.submitter instanceof HTMLElement ? submitEvent.submitter : null;
      const formMethod = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
        ? submitter.formMethod
        : null;
      const method = (formMethod || form.getAttribute("method") || "").toLowerCase();

      if (method === "get" || method === "dialog") return;

      const state: StoredUiState = {
        activeElement: captureActiveElement(),
        anchorId: resolveAnchorId(submitter || form),
        openDetails: captureOpenDetails(),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        savedAt: Date.now(),
      };

      const exactKey = exactStorageKey(pathname, normalized);
      const pathKey = pathStorageKey(pathname);
      const safeState = sanitizeStoredUiState(state);

      try {
        sessionStorage.setItem(exactKey, JSON.stringify(safeState));
        sessionStorage.setItem(pathKey, JSON.stringify(safeState));
      } catch (error) {
        console.warn("Could not preserve UI state", error);
      }
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => {
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, [normalized, pathname]);

  useEffect(() => {
    const exactKey = exactStorageKey(pathname, normalized);
    const fallbackKey = pathStorageKey(pathname);
    const stored = readStoredUiState(hasFormOpeningSearch ? [exactKey] : [exactKey, fallbackKey]);

    if (!stored) return;

    const runRestore = () => {
      restoreOpenDetails(stored.value.openDetails);
      restoreScrollPosition(stored.value.anchorId, stored.value.scrollX, stored.value.scrollY);
    };

    requestAnimationFrame(() => {
      runRestore();
      window.setTimeout(runRestore, 140);
      window.setTimeout(() => {
        sessionStorage.removeItem(exactKey);
        sessionStorage.removeItem(fallbackKey);
      }, 220);
    });
  }, [hasFormOpeningSearch, normalized, pathname]);

  return null;
}
