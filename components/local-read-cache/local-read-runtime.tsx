"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readCacheDb, readSnapshot, rememberDraftAccess } from "@/lib/local-read-cache/db";
import { isProductEditor, readEntity, type CacheLease, type ReadEntity, type ReadSnapshot } from "@/lib/local-read-cache/types";
import { clearReadSession, establishReadSession, fetchReadProjection, notifyReadCache, ReadFailure, setReadHealth } from "@/lib/local-read-cache/runtime";
import { CachedReadSurface } from "./read-surface";

type Preview = { entity: ReadEntity; snapshot?: ReadSnapshot; message: string; sourcePath: string };
export function LocalReadRuntime({ userId }: { userId: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [lease, setLease] = useState<CacheLease>();
  const [preview, setPreview] = useState<Preview>();
  const leaseRef = useRef<CacheLease | undefined>(undefined);
  const requests = useRef(new Map<ReadEntity, Promise<void>>());
  const lastProbe = useRef(0);
  const previewEntity = preview?.sourcePath === pathname ? preview.entity : undefined;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!userId) { await clearReadSession(); return; }
        const next = await establishReadSession(userId);
        if (!cancelled) { leaseRef.current = next; setLease(next); }
      } catch {
        setReadHealth("Refresh failed", "Device storage unavailable. Normal server pages remain available.");
      }
    })();
    return () => { cancelled = true; leaseRef.current = undefined; };
  }, [userId]);

  useEffect(() => {
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session?.user && session.user.id !== userId)) {
        leaseRef.current = undefined; setLease(undefined); setPreview(undefined);
        void clearReadSession().catch(() => setReadHealth("Refresh failed", "Saved read cleanup failed."));
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [userId, router]);

  async function refresh(entity: ReadEntity) {
    const owner = leaseRef.current;
    if (!owner) return;
    const pending = requests.current.get(entity);
    if (pending) return pending;
    const task = (async () => {
      setReadHealth("Refreshing");
      const started = performance.now();
      try {
        const snapshot = await fetchReadProjection(owner, entity);
        if (leaseRef.current?.generation !== owner.generation) return;
        setReadHealth("Online");
        performance.measure("pw:read-refresh:" + entity, { start: started, end: performance.now() });
        notifyReadCache(entity);
        setPreview(current => current?.entity === entity ? { ...current, snapshot, message: "Fresh server result" } : current);
      } catch (error) {
        if (leaseRef.current?.generation !== owner.generation) return;
        const boundary = await readCacheDb().boundary.get("active").catch(() => undefined);
        if (boundary?.generation !== owner.generation) {
          leaseRef.current = undefined; setLease(undefined); setPreview(undefined); notifyReadCache();
          setReadHealth("Service unavailable", "Sign in again to verify access."); router.replace("/login"); return;
        }
        const status = !navigator.onLine ? "Offline — saved data" : error instanceof ReadFailure ? error.status : "Refresh failed";
        const message = status + " · saved data retained; server actions unavailable";
        setReadHealth(status, error instanceof Error ? error.message : message);
        setPreview(current => current?.entity === entity ? { ...current, message } : current);
      }
    })();
    requests.current.set(entity, task);
    try { await task; } finally { requests.current.delete(entity); }
  }

  async function openPreview(entity: ReadEntity) {
    const owner = leaseRef.current;
    if (!owner) return;
    const started = performance.now();
    const sourcePath = window.location.pathname;
    setPreview({ entity, sourcePath, message: navigator.onLine ? "Reading saved data · refreshing" : "Offline · reading saved data" });
    try {
      const snapshot = await readSnapshot(owner, entity);
      if (leaseRef.current?.generation !== owner.generation) return;
      performance.measure("pw:cache-read:" + entity, { start: started, end: performance.now() });
      setPreview(current => current?.entity === entity ? { entity, sourcePath, snapshot, message: navigator.onLine ? "Showing saved data · verifying current access" : "Offline — saved data · session unverified" } : current);
      requestAnimationFrame(() => performance.measure("pw:first-usable-read:" + entity, { start: started, end: performance.now() }));
      if (navigator.onLine) void refresh(entity);
      else setReadHealth("Offline — saved data", snapshot ? "Session unverified. Read-only saved data." : "No saved snapshot.");
    } catch {
      setReadHealth("Refresh failed", "Device storage unavailable.");
      if (navigator.onLine) void refresh(entity);
    }
  }

  useEffect(() => {
    if (pathname === "/login" || pathname === "/pending-approval") {
      leaseRef.current = undefined;
      void clearReadSession().catch(() => setReadHealth("Refresh failed", "Saved read cleanup failed."));
    }
    if (!lease) return;
    const entity = readEntity(pathname, window.location.search);
    if (entity) void refresh(entity);
    const id = pathname.match(/^\/quotations\/([^/]+)\/local-builder$/)?.[1];
    if (id) {
      void fetch("/api/local-read-cache/builder?id=" + encodeURIComponent(id), { cache: "no-store", signal: AbortSignal.timeout(15000) })
        .then(async response => {
          if (!response.ok) return;
          const result = await response.json();
          if (result.userId === lease.userId && result.quotationId === id) await rememberDraftAccess(lease, id);
        }).catch(() => undefined);
    }
    // refresh reads the current lease via a ref; don't tie the lifecycle to function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, lease]);

  useEffect(() => {
    async function probe(force = false) {
      if (!leaseRef.current || (!force && Date.now() - lastProbe.current < 45000)) return;
      lastProbe.current = Date.now();
      if (!navigator.onLine) { setReadHealth("Offline — saved data", "Read-only; session cannot be verified offline."); return; }
      try {
        const response = await fetch("/api/local-read-cache/session", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (response.status === 401 || response.status === 403) { await clearReadSession(); router.replace("/login"); return; }
        const result = await response.json();
        if (response.ok && result.userId !== leaseRef.current?.userId) {
          await clearReadSession(); router.refresh(); return;
        }
        if (!response.ok) { setReadHealth("Service unavailable"); return; }
        setReadHealth("Online");
        const entity = previewEntity ?? readEntity(window.location.pathname, window.location.search);
        if (entity) void refresh(entity);
      } catch { setReadHealth(navigator.onLine ? "Service unavailable" : "Offline — saved data"); }
    }
    const reconnect = () => { void probe(true); };
    const offline = () => {
      setReadHealth("Offline — saved data", "No server writes are queued.");
      setPreview(current => current ? { ...current, message: "Offline — saved data · session unverified" } : current);
    };
    const focus = () => { void probe(); };
    const manual = () => {
      const entity = previewEntity ?? readEntity(window.location.pathname, window.location.search);
      if (entity) { void openPreview(entity); } else { void probe(true); }
    };
    const locked = () => { leaseRef.current = undefined; setLease(undefined); setPreview(undefined); };
    const changed = async () => {
      const owner = leaseRef.current;
      if (!owner) return;
      const active = await readCacheDb().boundary.get("active").catch(() => undefined);
      if (active?.generation !== owner.generation) { locked(); return; }
      if (previewEntity) {
        const snapshot = await readSnapshot(owner, previewEntity).catch(() => undefined);
        setPreview(current => current ? { ...current, snapshot } : current);
      }
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("projectworkflow-read-cache") : null;
    if (channel) channel.onmessage = () => { void changed(); };
    window.addEventListener("online", reconnect); window.addEventListener("offline", offline);
    window.addEventListener("focus", focus); window.addEventListener("pw-read-refresh", manual);
    window.addEventListener("pw-read-cache-locked", locked);
    window.addEventListener("pw-read-cache-changed", changed);
    void probe();
    return () => {
      channel?.close();
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline);
      window.removeEventListener("focus", focus); window.removeEventListener("pw-read-refresh", manual);
      window.removeEventListener("pw-read-cache-locked", locked);
      window.removeEventListener("pw-read-cache-changed", changed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lease, previewEntity, router]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !leaseRef.current) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!navigator.onLine && isProductEditor(url.pathname, url.search)) {
        event.preventDefault(); event.stopPropagation();
        setReadHealth("Offline — saved data", "Product Template editors require an online authoritative read. Nothing was queued.");
        setPreview(current => current ? { ...current, message: "Offline — Product Template editors are unavailable. Saved list retained." } : current);
        return;
      }
      if (!navigator.onLine && /^\/quotations\/[^/]+\/local-builder$/.test(url.pathname)) {
        event.preventDefault(); event.stopPropagation();
        window.location.assign("/offline.html?draft=" + encodeURIComponent(url.pathname.split("/")[2])); return;
      }
      const entity = readEntity(url.pathname, url.search);
      if (!entity) return;
      event.preventDefault(); event.stopPropagation();
      void openPreview(entity);
      if (navigator.onLine) router.push(url.pathname + url.search);
    };
    const submit = (event: SubmitEvent) => {
      if (!navigator.onLine && event.target instanceof HTMLFormElement && event.target.method.toLowerCase() === "post") {
        event.preventDefault(); event.stopImmediatePropagation();
        setReadHealth("Offline — saved data", "Reconnect before server-confirmed actions. Nothing was queued.");
      }
    };
    document.addEventListener("click", click, true); document.addEventListener("submit", submit, true);
    return () => { document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, lease]);

  return preview && previewEntity && lease?.userId === userId && pathname !== "/login" && pathname !== "/pending-approval"
    ? <CachedReadSurface key={preview.entity} {...preview} refresh={() => { void refresh(preview.entity); }} close={() => setPreview(undefined)} /> : null;
}
