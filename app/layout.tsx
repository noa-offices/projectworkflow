import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { GlobalLoadingIndicator } from "@/components/global-loading-indicator";
import { PreserveUiState } from "@/components/preserve-ui-state";
import { PwaServiceWorkerRegister } from "@/components/pwa-service-worker-register";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        {children}
      </body>
    </html>
  );
}
