"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function InstallAppCard() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalledState = () => {
      const inStandaloneMode = window.matchMedia("(display-mode: standalone)").matches;
      const isIosStandalone =
        "standalone" in window.navigator &&
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

      setIsInstalled(inStandaloneMode || isIosStandalone);
    };

    handleInstalledState();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalledState);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalledState);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  }

  if (isInstalled || !deferredPrompt) {
    return null;
  }

  return (
    <section className="mb-5 rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">Install ProjectWorkflow</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Open the dashboard in a standalone app window on desktop or mobile.
          </p>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          Install App
        </button>
      </div>
      {/* TODO: Phase 12C can add app-first sync, optimistic saving, and background queueing once install support is stable. */}
    </section>
  );
}
