"use client";

import Link, { type LinkProps } from "next/link";
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

type PendingLinkButtonProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> & {
    children: ReactNode;
    pendingLabel: ReactNode;
  };

export function PendingLinkButton({
  children,
  className,
  onClick,
  pendingLabel,
  ...props
}: PendingLinkButtonProps) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) return undefined;

    const timer = window.setTimeout(() => {
      setPending(false);
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setPending(true);
  }

  return (
    <Link
      {...props}
      aria-disabled={pending}
      className={`${className ?? ""}${pending ? " pointer-events-none opacity-80" : ""}`}
      onClick={handleClick}
    >
      {pending ? pendingLabel : children}
    </Link>
  );
}
