"use client";
import { activateUser, clearReadBoundary, readSnapshot, storeSnapshot, type ReadCacheDb } from "./db";
import type { CacheLease, ReadEntity, ReadRow } from "./types";

export type ReadStatus = "Online" | "Refreshing" | "Offline — saved data" | "Service unavailable" | "Refresh failed";
type Health = { status: ReadStatus; detail: string };
const initial: Health = { status: "Refreshing", detail: "Checking service" };
let health = initial;
const listeners = new Set<() => void>();
export const subscribeHealth = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getHealth = () => health;
export const getServerHealth = () => initial;
export function setReadHealth(status: ReadStatus, detail = "") {
  health = { status, detail }; listeners.forEach(listener => listener());
}
let channel: BroadcastChannel | undefined;
export function notifyReadCache(key = "boundary") {
  channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("projectworkflow-read-cache") : undefined;
  channel?.postMessage({ key });
  window.dispatchEvent(new CustomEvent("pw-read-cache-changed", { detail: key }));
}
export async function clearReadSession() {
  // Hide local views immediately; transactional generation revocation then blocks late writes.
  window.dispatchEvent(new Event("pw-read-cache-locked"));
  await clearReadBoundary();
  notifyReadCache();
}
export async function establishReadSession(userId: string) {
  return activateUser(userId);
}
export class ReadFailure extends Error {
  constructor(public status: ReadStatus, message: string) { super(message); }
}
export async function fetchReadProjection(lease: CacheLease, key: ReadEntity, send: typeof fetch = fetch, db?: ReadCacheDb) {
  const response = await send("/api/local-read-cache/" + key, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (response.status === 401 || response.status === 403) {
    await clearReadBoundary(db);
    throw new ReadFailure("Service unavailable", "Sign in again to verify access.");
  }
  if (!response.ok) throw new ReadFailure(response.status >= 500 ? "Service unavailable" : "Refresh failed", "The saved snapshot was kept.");
  const body = await response.json() as { ok: boolean; userId: string; entity: string; data: ReadRow[]; fetchedAt: number };
  if (!body.ok || body.userId !== lease.userId || body.entity !== key || !Array.isArray(body.data) || !Number.isFinite(body.fetchedAt)) {
    if (body.userId && body.userId !== lease.userId) await clearReadBoundary(db);
    throw new ReadFailure("Refresh failed", "The server response could not be verified.");
  }
  if (!await storeSnapshot(lease, key, body.data, body.fetchedAt, db)) throw new ReadFailure("Refresh failed", "This account session has changed.");
  return readSnapshot(lease, key, db);
}
export function requestReadRefresh() {
  window.dispatchEvent(new Event("pw-read-refresh"));
}
