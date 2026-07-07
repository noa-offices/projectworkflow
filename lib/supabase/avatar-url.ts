import type { SupabaseClient } from "@supabase/supabase-js";

const AVATAR_BUCKET = "avatars";
const AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

function extractAvatarStoragePath(storedValue: string): string | null {
  if (!/^https?:/i.test(storedValue)) return storedValue;

  const match = storedValue.match(/\/object\/sign\/avatars\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function resolveAvatarUrl(
  supabase: SupabaseClient,
  storedValue: string | null,
): Promise<string | null> {
  if (!storedValue) return null;

  const storagePath = extractAvatarStoragePath(storedValue);
  if (!storagePath) return null;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(storagePath, AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
