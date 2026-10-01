import Dexie, { type Table } from "dexie";
import { entities, minimizedRows, retentionMs, schemaVersion, type CacheLease, type ReadEntity, type ReadRow, type ReadSnapshot } from "./types";

export type DraftAccess = { userId: string; quotationId: string; verifiedAt: number };
export class ReadCacheDb extends Dexie {
  snapshots!: Table<ReadSnapshot, [string, string]>;
  boundary!: Table<CacheLease, string>;
  draftAccess!: Table<DraftAccess, [string, string]>;
  constructor() {
    super("projectworkflow-read-cache");
    this.version(1).stores({
      snapshots: "[userId+key],userId,fetchedAt,expiresAt",
      boundary: "key",
      draftAccess: "[userId+quotationId],userId,verifiedAt",
    });
  }
}
let instance: ReadCacheDb | undefined;
export function readCacheDb() { return instance ??= new ReadCacheDb(); }
function sameLease(a: CacheLease | undefined, b: CacheLease) {
  return a?.userId === b.userId && a.generation === b.generation;
}
export async function activateUser(userId: string, db = readCacheDb()): Promise<CacheLease> {
  return db.transaction("rw", db.boundary, db.snapshots, db.draftAccess, async () => {
    const old = await db.boundary.get("active");
    await db.snapshots.where("expiresAt").belowOrEqual(Date.now()).delete();
    await db.draftAccess.where("verifiedAt").belowOrEqual(Date.now() - retentionMs).delete();
    if (old?.userId === userId) return old;
    // Account switch clears read projections and authorization hints, never draft documents.
    await db.snapshots.clear();
    await db.draftAccess.clear();
    const lease: CacheLease = { key: "active", userId, generation: crypto.randomUUID() };
    await db.boundary.put(lease);
    return lease;
  });
}
export async function clearReadBoundary(db = readCacheDb()) {
  await db.transaction("rw", db.boundary, db.snapshots, db.draftAccess, async () => {
    await db.boundary.clear(); await db.snapshots.clear(); await db.draftAccess.clear();
  });
}
export async function readSnapshot(lease: CacheLease, key: ReadEntity, db = readCacheDb()) {
  return db.transaction("r", db.boundary, db.snapshots, async () => {
    if (!sameLease(await db.boundary.get("active"), lease)) return undefined;
    const record = await db.snapshots.get([lease.userId, key]);
    return record?.schemaVersion === schemaVersion && record.expiresAt > Date.now() ? record : undefined;
  });
}
export async function storeSnapshot(lease: CacheLease, key: ReadEntity, rows: ReadRow[], fetchedAt: number, db = readCacheDb()) {
  return db.transaction("rw", db.boundary, db.snapshots, async () => {
    if (!sameLease(await db.boundary.get("active"), lease)) return false;
    const record: ReadSnapshot = {
      userId: lease.userId, key, entityType: key, data: minimizedRows(key, rows),
      fetchedAt, expiresAt: fetchedAt + retentionMs, schemaVersion,
    };
    // Out-of-order responses from other tabs cannot replace a newer snapshot.
    const existing = await db.snapshots.get([lease.userId, key]);
    if (!existing || existing.fetchedAt <= fetchedAt) await db.snapshots.put(record);
    await db.snapshots.where("expiresAt").belowOrEqual(Date.now()).delete();
    const records = await db.snapshots.toArray();
    await db.snapshots.bulkDelete(records.filter(r => r.userId !== lease.userId || !entities.includes(r.key)).map(r => [r.userId, r.key]));
    return true;
  });
}
export async function rememberDraftAccess(lease: CacheLease, quotationId: string, db = readCacheDb()) {
  await db.transaction("rw", db.boundary, db.draftAccess, async () => {
    if (!sameLease(await db.boundary.get("active"), lease)) return;
    await db.draftAccess.put({ userId: lease.userId, quotationId, verifiedAt: Date.now() });
    const rows = await db.draftAccess.orderBy("verifiedAt").reverse().toArray();
    await db.draftAccess.bulkDelete(rows.slice(500).map(r => [r.userId, r.quotationId]));
  });
}
