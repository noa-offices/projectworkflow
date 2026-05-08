import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/quotations/[id]/download-pdf": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/quotations/[id]/download-specification": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
};

export default nextConfig;
