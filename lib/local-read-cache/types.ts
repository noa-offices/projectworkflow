export const entities = ["products", "quotations", "projects", "completed", "clients"] as const;
export type ReadEntity = typeof entities[number];
export const limits: Record<ReadEntity, number> = { products: 500, quotations: 200, projects: 200, completed: 200, clients: 500 };
export const schemaVersion = 1;
export const retentionMs = 30 * 24 * 60 * 60 * 1000;
export type ReadRow = {
  id: string; title: string; code: string; subtitle: string; status: string; href: string;
  date?: string; currency?: string; total?: number; thumbnail?: string;
  brand?: string; category?: string; clientId?: string; projectId?: string; year?: string;
  archived?: boolean; count?: number;
};
export type ReadSnapshot = {
  userId: string; key: ReadEntity; entityType: ReadEntity; data: ReadRow[];
  fetchedAt: number; expiresAt: number; schemaVersion: number;
};
export type CacheLease = { key: "active"; userId: string; generation: string };
export function readEntity(path: string, search = ""): ReadEntity | null {
  const params = new URLSearchParams(search);
  if (path === "/products" || path === "/products/templates") {
    return ["manage", "template", "addTemplate", "editTemplate", "quoteImportMode", "priceStatus"].some(k => params.has(k)) ? null : "products";
  }
  if (path === "/quotations" || path === "/sales/quotations") return "quotations";
  if (path === "/projects/orders") return "projects";
  if (path === "/projects/completed") return "completed";
  if (path === "/sales/clients") return "clients";
  return null;
}
// Whitelist at the persistence boundary too: server payloads never become arbitrary dumps.
export function minimizedRows(entity: ReadEntity, rows: ReadRow[]): ReadRow[] {
  return rows.slice(0, limits[entity]).map(r => {
    const row: ReadRow = {
      id: String(r.id).slice(0, 200), title: String(r.title).slice(0, 400),
      code: String(r.code).slice(0, 200), subtitle: String(r.subtitle).slice(0, 500),
      status: String(r.status).slice(0, 200),
      href: /^\/(?!\/)/.test(r.href) ? r.href.slice(0, 500) : "",
    };
    for (const key of ["date", "currency", "thumbnail", "brand", "category", "clientId", "projectId", "year"] as const) {
      if (typeof r[key] === "string") row[key] = r[key].slice(0, key === "thumbnail" ? 1200 : 200);
    }
    if (row.thumbnail) {
      try {
        const url = new URL(row.thumbnail, "https://device.invalid");
        if (!["http:", "https:"].includes(url.protocol) || url.pathname.includes("/object/sign/") ||
            [...url.searchParams.keys()].some(key => /token|signature|authorization|api.?key/i.test(key))) delete row.thumbnail;
      } catch { delete row.thumbnail; }
    }
    if (typeof r.total === "number" && Number.isFinite(r.total)) row.total = r.total;
    if (typeof r.count === "number" && Number.isFinite(r.count)) row.count = r.count;
    if (typeof r.archived === "boolean") row.archived = r.archived;
    return row;
  });
}
