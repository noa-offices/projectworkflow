import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ProjectWorkflowActivityTracker } from "@/components/activity-time/projectworkflow-activity-tracker";
import { GlobalLoadingIndicator } from "@/components/global-loading-indicator";
import { NoaAssistant } from "@/components/noa/noa-assistant";
import { PreserveUiState } from "@/components/preserve-ui-state";
import { PwaServiceWorkerRegister } from "@/components/pwa-service-worker-register";
import { LocalReadRuntime } from "@/components/local-read-cache/local-read-runtime";
import { getProfileForUser, getRequestUser } from "@/lib/auth";
import type { NoaAuthContext } from "@/lib/noa/noa-types";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "ProjectWorkflow",
  title: "ProjectWorkflow",
  description: "Quotation • Procurement • Project Workflow",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ProjectWorkflow",
  },
  icons: {
    apple: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#064e3b",
};

// Non-redirecting on purpose: this layout also wraps public routes (/login, /pending-approval),
// so it must never force a redirect the way requireActiveUser() does. It only determines whether
// <NoaAssistant> renders at all, reusing the same Supabase/profile lookup those helpers are built
// on rather than a second auth system.
async function currentNoaAuthContext(): Promise<NoaAuthContext | null> {
  const user = await getRequestUser();

  if (!user) {
    return null;
  }

  const profile = await getProfileForUser(user.id);

  return {
    appRole: profile?.role ?? null,
    displayName: profile?.full_name ?? user.user_metadata?.full_name ?? user.email ?? "User",
    userId: user.id,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const noaAuth = await currentNoaAuthContext();
  const isWarehouseStaff = noaAuth?.appRole === "warehouse_staff";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-stone-50 text-zinc-900" suppressHydrationWarning>
        <Suspense fallback={null}>
          <PreserveUiState />
        </Suspense>
        <PwaServiceWorkerRegister />
        <Suspense fallback={null}>
          <LocalReadRuntime key={isWarehouseStaff ? "inventory-only" : noaAuth?.userId ?? "signed-out"} userId={isWarehouseStaff ? null : noaAuth?.userId ?? null} />
        </Suspense>
        <Suspense fallback={null}>
          <GlobalLoadingIndicator />
        </Suspense>
        {!isWarehouseStaff ? (
          <Suspense fallback={null}>
            <NoaAssistant auth={noaAuth} />
          </Suspense>
        ) : null}
        {noaAuth?.appRole && !isWarehouseStaff ? (
          <Suspense fallback={null}>
            <ProjectWorkflowActivityTracker />
          </Suspense>
        ) : null}
        {children}
      </body>
    </html>
  );
}
