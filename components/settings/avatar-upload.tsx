"use client";

import { useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { saveAvatarUrl } from "@/lib/settings/avatar-action";

type AvatarUploadProps = {
  currentAvatarUrl: string | null;
  userId: string;
  displayName: string;
};

export function AvatarUpload({ currentAvatarUrl, userId, displayName }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  const initials = (displayName ?? "").trim().charAt(0).toUpperCase() || "?";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsUploading(true);
    setErrorMsg(null);

    try {
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

      const result = await saveAvatarUrl(signedData.signedUrl);
      if (!result.ok) {
        setErrorMsg("Could not save avatar: " + result.error);
        return;
      }

      setPreviewUrl(signedData.signedUrl);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-zinc-600">{initials}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-700 disabled:opacity-50"
        >
          {isUploading ? "Uploading…" : "Change avatar"}
        </button>
        {savedToast ? (
          <span className="text-xs text-emerald-700">Avatar updated.</span>
        ) : null}
        {errorMsg ? (
          <span className="text-xs text-red-500">{errorMsg}</span>
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
