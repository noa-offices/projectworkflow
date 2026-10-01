/* Public read-only recovery shell. No tokens, roles, mutations, or draft writes. */
(() => {
  const names = { products: "Product Library", quotations: "Quotations", projects: "Active Projects", completed: "Completed Projects", clients: "Clients", drafts: "Local Builder drafts" };
  let lease, entity = "products", rows = [], draft;
  const el = id => document.getElementById(id);
  const status = message => { el("status").textContent = message; };
  const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = String(text ?? ""); return value; };
  function openExisting(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("No saved data yet.")); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function read(store, key, database = "projectworkflow-read-cache", index) {
    const db = await openExisting(database);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const table = tx.objectStore(store);
        const request = index ? table.index(index).getAll(key) : key === undefined ? table.getAll() : table.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async function clearReads() {
    const db = await openExisting("projectworkflow-read-cache");
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["snapshots", "boundary", "draftAccess"], "readwrite");
        for (const name of ["snapshots", "boundary", "draftAccess"]) tx.objectStore(name).clear();
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    if (typeof BroadcastChannel !== "undefined") { const c = new BroadcastChannel("projectworkflow-read-cache"); c.postMessage({ key: "boundary" }); c.close(); }
    lease = undefined; rows = []; draft = undefined;
    el("results").replaceChildren(); el("views").hidden = true; el("boundary").hidden = false;
    el("unlock").disabled = true;
    status("Saved reads cleared. Builder drafts were not deleted. Sign in online to establish access again.");
  }
  async function verify() {
    if (!navigator.onLine) return false;
    try {
      const response = await fetch("/api/local-read-cache/session", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (response.status === 401 || response.status === 403) { await clearReads(); return false; }
      const result = await response.json();
      if (!response.ok) { status("Service unavailable — read-only saved data; session unverified."); return false; }
      if (result.userId !== lease?.userId) { await clearReads(); return false; }
      return true;
    } catch { status("Service unavailable — read-only saved data; session unverified."); return false; }
  }
  async function load(next) {
    entity = next; draft = undefined; rows = [];
    el("title").textContent = names[entity]; el("search").value = ""; el("results").className = entity === "products" ? "products" : "";
    const active = await read("boundary", "active");
    if (!lease || active?.generation !== lease.generation || active.userId !== lease.userId) { await clearReads(); return; }
    if (entity === "drafts") {
      const access = (await read("draftAccess", undefined)).filter(r => r.userId === lease.userId && r.verifiedAt > Date.now() - 30 * 86400000);
      for (const hint of access) {
        const records = await read("quotationWorkspaces", hint.quotationId, "projectworkflow-quotation-workspaces", "server_quotation_id").catch(() => []);
        const w = records[0];
        if (w) rows.push({ id: hint.quotationId, title: w.title, code: w.quotation_no, subtitle: w.has_unsaved_changes ? "Local unpublished changes" : "Local saved draft", workspace: w });
      }
      el("timestamp").textContent = "Drafts remain in their original database. Only previously verified quotation access is listed.";
      render();
      const requested = new URLSearchParams(location.search).get("draft") ?? location.pathname.match(/^\/quotations\/([^/]+)\/local-builder$/)?.[1];
      if (requested) {
        const row = rows.find(r => r.id === requested);
        if (row) openDraft(row.workspace);
        else status("This draft has not had access verified for this account on this device. Reconnect and open the current Builder once. Stored drafts were not changed.");
      }
      return;
    }
    const snapshot = await read("snapshots", [lease.userId, entity]);
    if (snapshot?.userId === lease.userId && snapshot.schemaVersion === 1 && snapshot.expiresAt > Date.now()) {
      rows = Array.isArray(snapshot.data) ? snapshot.data : [];
      el("timestamp").textContent = "Last refreshed " + new Date(snapshot.fetchedAt).toLocaleString() + " · recent bounded snapshot";
    } else el("timestamp").textContent = "You're offline and this page has not been saved on this device yet, or its snapshot expired.";
    render();
  }
  function render() {
    const query = el("search").value.toLowerCase();
    const result = el("results"); result.replaceChildren();
    for (const r of rows.filter(r => [r.title, r.code, r.subtitle, r.status, r.brand, r.category].some(v => String(v ?? "").toLowerCase().includes(query)))) {
      const card = node("article");
      if (entity === "products" && /^(https?:\/\/|\/)/.test(r.thumbnail ?? "")) {
        const image = node("img"); image.src = r.thumbnail; image.alt = ""; image.loading = "lazy"; image.onerror = () => image.remove(); card.append(image);
      }
      card.append(node("small", r.code), node("h3", r.title), node("p", [r.brand, r.category, r.subtitle].filter(Boolean).join(" · ")), node("p", r.status));
      if (r.total !== undefined) card.append(node("p", (r.currency ?? "") + " " + r.total));
      if (entity === "drafts") {
        const button = node("button", "Reopen local draft (read-only)"); button.onclick = () => openDraft(r.workspace); card.append(button);
      }
      result.append(card);
    }
    if (!result.children.length) result.append(node("p", rows.length ? "No matching saved results." : "No saved results available. Reconnect and visit this page once."));
  }
  function openDraft(w) {
    if (!w || !Array.isArray(w.items) || !Array.isArray(w.sections) || typeof w.title !== "string") {
      status("Malformed draft. Stored data has not been replaced."); return;
    }
    draft = w; el("title").textContent = "Local draft · " + (w.quotation_no ?? w.title);
    el("timestamp").textContent = "Local values only · not the server quotation · editing/publication requires the authenticated current Builder.";
    const result = el("results"); result.replaceChildren(); result.className = "";
    const card = node("article"); card.append(node("h3", w.title), node("p", "Last local edit: " + (w.updated_at ?? "unknown")));
    const backup = node("button", "Export JSON backup");
    backup.onclick = () => {
      try {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
        const a = node("a"); a.href = url; a.download = (draft.quotation_no ?? "quotation") + "-local-backup.json"; a.click(); URL.revokeObjectURL(url);
      } catch { status("Backup could not be serialized. Stored data was kept untouched."); }
    };
    const publish = node("button", "Save to Software unavailable in recovery"); publish.disabled = true;
    const online = node("a", "Open authenticated current Builder"); online.href = "/quotations/" + encodeURIComponent(w.server_quotation_id) + "/local-builder";
    online.onclick = e => { if (!navigator.onLine) { e.preventDefault(); status("Reconnect before opening the full Builder editor. This local draft remains available for export."); } };
    card.append(backup, publish, node("p"), online); result.append(card);
    const wrap = node("div"); wrap.className = "scroll";
    const table = node("table"); const head = node("tr");
    for (const label of ["Local item", "Qty", "Unit price", "Net total"]) head.append(node("th", label));
    table.append(head);
    for (const item of w.items.filter(r => r.is_active !== false)) {
      const row = node("tr"); for (const value of [item.item_name_snapshot ?? item.specification_snapshot ?? item.item_type, item.qty, item.unit_price, item.net_total]) row.append(node("td", value));
      table.append(row);
    }
    wrap.append(table); result.append(wrap);
    status(navigator.onLine ? "Recovery preview — server actions disabled." : "Offline — local draft reopened; session unverified.");
  }
  async function start() {
    try {
      lease = await read("boundary", "active");
      if (!lease?.userId) { el("unlock").disabled = true; status("No saved account boundary. Sign in online and visit the target page first."); return; }
      status("Saved data belongs to the last signed-in account (" + lease.userId.slice(-8) + "). Session has not been verified.");
      const paths = { "/products": "products", "/products/templates": "products", "/quotations": "quotations", "/sales/quotations": "quotations", "/projects/orders": "projects", "/projects/completed": "completed", "/sales/clients": "clients" };
      entity = paths[location.pathname] ?? (/local-builder$/.test(location.pathname) || new URLSearchParams(location.search).has("draft") ? "drafts" : "products");
    } catch { el("unlock").disabled = true; status("No saved reads, or device storage is unavailable. Existing Builder storage has not been changed."); }
  }
  el("unlock").onclick = async () => {
    const hadLease = lease;
    const verified = await verify();
    if (!lease || lease !== hadLease) return;
    el("boundary").hidden = true; el("views").hidden = false;
    status(verified ? "Online — read-only saved snapshot. Use Refresh to open authoritative data." : "Offline/stale — saved data; session unverified. No server writes.");
    await load(entity).catch(() => status("Saved data could not be read. Stored records were not changed."));
  };
  for (const [key, title] of Object.entries(names)) {
    const button = node("button", title); button.onclick = () => { void load(key).catch(() => status("Device read failed. Stored data was kept.")); }; el("nav").append(button);
  }
  el("search").oninput = render;
  el("clear").onclick = () => { void clearReads().catch(() => status("Could not clear saved reads. Close this app before switching accounts.")); };
  el("refresh").onclick = async () => {
    if (await verify()) location.assign(entity === "drafts" && draft ? "/quotations/" + encodeURIComponent(draft.server_quotation_id) + "/local-builder" : ({ products: "/products", quotations: "/sales/quotations", projects: "/projects/orders", completed: "/projects/completed", clients: "/sales/clients" }[entity] ?? "/dashboard"));
    else if (lease) status("Offline or service unavailable. Saved data kept; reconnect to refresh.");
  };
  window.addEventListener("online", () => { status("Reconnected. Verifying session…"); void verify().then(ok => { if (ok) status("Online — session verified. Refresh to open authoritative data."); }); });
  window.addEventListener("offline", () => status("Offline — saved data; session unverified."));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("projectworkflow-read-cache");
    channel.onmessage = () => { void read("boundary", "active").then(active => {
      if (active?.generation !== lease?.generation) { lease = undefined; el("results").replaceChildren(); el("views").hidden = true; el("boundary").hidden = false; el("unlock").disabled = true; status("Account boundary changed. Reconnect and sign in again."); }
      else if (!el("views").hidden && !draft) void load(entity);
    }).catch(() => status("Account boundary could not be checked.")); };
  }
  if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined);
  void start();
})();
