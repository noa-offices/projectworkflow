import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
