import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ProjectWorkflowActivityTracker } from "@/components/activity-time/projectworkflow-activity-tracker";
import { GlobalLoadingIndicator } from "@/components/global-loading-indicator";
import { NoaAssistant } from "@/components/noa/noa-assistant";
import { PreserveUiState } from "@/components/preserve-ui-state";
import { PwaServiceWorkerRegister } from "@/components/pwa-service-worker-register";
import { getProfileForUser } from "@/lib/auth";
import type { NoaAuthContext } from "@/lib/noa/noa-types";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
          <GlobalLoadingIndicator />
        </Suspense>
        <Suspense fallback={null}>
          <NoaAssistant auth={noaAuth} />
        </Suspense>
        {noaAuth?.appRole ? (
          <Suspense fallback={null}>
            <ProjectWorkflowActivityTracker />
          </Suspense>
        ) : null}
        {children}
      </body>
    </html>
  );
}
