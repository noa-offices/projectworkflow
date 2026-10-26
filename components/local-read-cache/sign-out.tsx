"use client";
import { useState } from "react";
import { signOut } from "@/app/auth/actions";
import { clearReadSession } from "@/lib/local-read-cache/runtime";
/** `large` is the full-width, tap-friendly button on the Inventory profile page and mobile menu (shown at every width). */
export function ReadCacheSignOut({ large = false }: { large?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className={large ? "" : "hidden lg:block"} action={async () => {
    setBusy(true); setError("");
    try { await clearReadSession(); }
    catch { setError("Could not clear saved reads. Close this app before changing accounts."); setBusy(false); return; }
    await signOut();
  }}>
    <button disabled={busy} className={large ? "inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-red-300 bg-white px-4 text-base font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 sm:w-auto" : "rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700"}>{busy ? "Signing out…" : "Sign out"}</button>
    {error ? <p role="alert" className={large ? "mt-2 text-sm text-red-700" : "text-xs text-red-700"}>{error}</p> : null}
  </form>;
}
