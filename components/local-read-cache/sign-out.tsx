"use client";
import { useState } from "react";
import { signOut } from "@/app/auth/actions";
import { clearReadSession } from "@/lib/local-read-cache/runtime";
export function ReadCacheSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="hidden lg:block" action={async () => {
    setBusy(true); setError("");
    try { await clearReadSession(); }
    catch { setError("Could not clear saved reads. Close this app before changing accounts."); setBusy(false); return; }
    await signOut();
  }}>
    <button disabled={busy} className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700">{busy ? "Signing out…" : "Sign out"}</button>
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </form>;
}
