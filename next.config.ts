import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  // Groups CSS per route, so the sales page does not download the checkout and members styles.
  experimental: { cssChunking: "graph" },
  // PGlite loads its WebAssembly files from its own package folder, which bundling would break.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Pages use plain <img> with files already sized at upload, so the image optimizer and its native library stay out of the image.
  images: { unoptimized: true },
  // demo/ is read at runtime by path and ships only in the image's demo target.
  outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**", "demo/**"] },
  // The Content-Security-Policy needs a nonce per request, so src/proxy.ts sets it.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
