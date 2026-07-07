"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveAvatarUrl } from "@/lib/supabase/avatar-url";

type ResolvedAvatarProps = {
  path: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
};

export function ResolvedAvatar({ path, alt, className, fallback }: ResolvedAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!path) {
      setSrc(null);
      return;
    }

    resolveAvatarUrl(createClient(), path).then((url) => {
      if (!cancelled) setSrc(url);
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!src) return <>{fallback}</>;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
