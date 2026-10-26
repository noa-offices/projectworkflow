"use client";

import { useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { saveAvatarUrl } from "@/lib/settings/avatar-action";
import { ResolvedAvatar } from "@/components/ui/resolved-avatar";
import { compressInventoryPhoto } from "@/lib/inventory/photo-compress";
import { inventoryPhotoError } from "@/lib/inventory/photo-limits";

type AvatarUploadProps = {
  currentAvatarUrl: string | null;
  userId: string;
  displayName: string;
  /** Inventory profile: large tap target, photo compressed in the browser and held to the 2 MB limit. */
  inventory?: boolean;
};

export function AvatarUpload({ currentAvatarUrl, userId, displayName, inventory = false }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  const initials = (displayName ?? "").trim().charAt(0).toUpperCase() || "?";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    let file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsUploading(true);
    setErrorMsg(null);

    try {
      if (inventory) {
        try { file = (await compressInventoryPhoto(file)).file; }
        catch (error) { setErrorMsg(error instanceof Error ? error.message : "Could not prepare this photo."); return; }
        const tooBig = inventoryPhotoError(file.size, file.type);
        if (tooBig) { setErrorMsg(tooBig); return; }
      }
      const supabase = createBrowserClient();
      const storagePath = `${userId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(storagePath, file, { upsert: false });

      if (uploadError) {
        setErrorMsg("Upload failed: " + uploadError.message);
        return;
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from("avatars")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

      if (signedError || !signedData?.signedUrl) {
        setErrorMsg("Could not generate avatar URL.");
        return;
      }

      const result = await saveAvatarUrl(storagePath);
      if (!result.ok) {
        setErrorMsg("Could not save avatar: " + result.error);
        return;
      }

      setUploadedPreviewUrl(signedData.signedUrl);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className={`flex shrink-0 ${inventory ? "h-20 w-20" : "h-10 w-10"} items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100`}>
        {uploadedPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={uploadedPreviewUrl} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <ResolvedAvatar
            path={currentAvatarUrl}
            alt="Avatar"
            className="h-full w-full object-cover"
            fallback={<span className="text-sm font-semibold text-zinc-600">{initials}</span>}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className={inventory ? "inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50" : "text-xs font-semibold text-emerald-900 transition hover:text-emerald-700 disabled:opacity-50"}
        >
          {isUploading ? (inventory ? "Saving photo…" : "Uploading…") : inventory ? "Change photo" : "Change avatar"}
        </button>
        {savedToast ? (
          <span role="status" className={inventory ? "text-sm text-emerald-700" : "text-xs text-emerald-700"}>{inventory ? "Photo updated." : "Avatar updated."}</span>
        ) : null}
        {errorMsg ? (
          <span role="alert" className={inventory ? "text-sm text-red-700 [overflow-wrap:anywhere]" : "text-xs text-red-500"}>{errorMsg}</span>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload profile avatar"
      />
    </div>
  );
}
