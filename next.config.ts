import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/offline.html", headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ] },
    ];
  },
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
