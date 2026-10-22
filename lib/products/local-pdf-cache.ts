import Dexie, { type Table } from "dexie";

// Manufacturer PDFs for Smart Product Setup stay in THIS browser (IndexedDB). Separate database from the Material Library import and from
// the quotation builder. Nothing here is ever uploaded. Every call is wrapped: when storage is blocked or full the caller keeps working
// with the file chosen in this session.
export const MAX_RECENT_PDFS = 3;
export const MAX_STORED_PDF_BYTES = 150 * 1024 * 1024;

export type LocalPdfInfo = { id: number; lastModified: number; lastOpened: number; lastPage: number; name: string; size: number; zoom: number };
type LocalPdfRecord = Omit<LocalPdfInfo, "id"> & { blob: Blob; id?: number };

class SourcePdfDb extends Dexie {
  pdfs!: Table<LocalPdfRecord, number>;
  constructor() {
    super("source-pdf-cache");
    this.version(1).stores({ pdfs: "++id, lastOpened" });
  }
}
let database: SourcePdfDb | null = null;
const db = () => (database ??= new SourcePdfDb());

// Which entries to drop so only the `max` most recently opened remain.
export function pdfsToDelete<T extends { id?: number; lastOpened: number }>(items: T[], max = MAX_RECENT_PDFS): T[] {
  return [...items].sort((left, right) => right.lastOpened - left.lastOpened).slice(max);
}

const info = (record: LocalPdfRecord): LocalPdfInfo => ({ id: record.id as number, lastModified: record.lastModified, lastOpened: record.lastOpened, lastPage: record.lastPage, name: record.name, size: record.size, zoom: record.zoom });

export async function rememberPdf(file: Blob, name: string, lastModified = 0): Promise<{ id: number | null; remembered: boolean }> {
  if (file.size > MAX_STORED_PDF_BYTES) return { id: null, remembered: false };
  try {
    const existing = (await db().pdfs.toArray()).find((item) => item.name === name && item.size === file.size && item.lastModified === lastModified);
    const id = await db().pdfs.put({ blob: file, id: existing?.id, lastModified, lastOpened: Date.now(), lastPage: existing?.lastPage ?? 1, name, size: file.size, zoom: existing?.zoom ?? 1 });
    await Promise.all(pdfsToDelete(await db().pdfs.toArray()).map((item) => (item.id ? db().pdfs.delete(item.id) : Promise.resolve())));
    return { id, remembered: true };
  } catch {
    return { id: null, remembered: false };
  }
}

export async function listRecentPdfs(): Promise<LocalPdfInfo[]> {
  try {
    return (await db().pdfs.orderBy("lastOpened").reverse().toArray()).map(info);
  } catch {
    return [];
  }
}

// Opens a remembered PDF (and marks it as just opened).
export async function openRecentPdf(id: number): Promise<{ blob: Blob; info: LocalPdfInfo } | null> {
  try {
    const record = await db().pdfs.get(id);
    if (!record) return null;
    await db().pdfs.update(id, { lastOpened: Date.now() });
    return { blob: record.blob, info: info(record) };
  } catch {
    return null;
  }
}

export async function updatePdfView(id: number, lastPage: number, zoom: number) {
  try { await db().pdfs.update(id, { lastPage, zoom }); } catch { /* not remembered */ }
}
export async function removePdf(id: number) {
  try { await db().pdfs.delete(id); } catch { /* ignore */ }
}
export async function clearPdfs() {
  try { await db().pdfs.clear(); } catch { /* ignore */ }
}
