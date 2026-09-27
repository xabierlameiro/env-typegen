import withBundleAnalyzer from "@next/bundle-analyzer";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// Validates all env vars at build time and startup.
// Throws if a required variable is missing or malformed.
import "./lib/env";

const scriptSrc = ["'self'", "'unsafe-inline'"];
if (process.env.NODE_ENV !== "production") {
  scriptSrc.push("'unsafe-eval'");
}

const connectSrc =
  process.env.NODE_ENV === "production"
    ? "'self' https:"
    : "'self' https: http: ws: wss:";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : null,
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  // Cache Components: enables 'use cache' directive for fine-grained server-side caching.
  // See: https://nextjs.org/docs/app/api-reference/directives/use-cache
  cacheComponents: true,
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes
  typedRoutes: true,
  // React Compiler v1.0 (stable since Oct 2025) — automatically inserts
  // useMemo/useCallback/memo where beneficial. No manual memoization needed.
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler
  reactCompiler: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  logging: {
    browserToTerminal: true,
    fetches: {
      fullUrl: process.env.NODE_ENV !== "production",
    },
  },
};

const withMDX = createMDX();

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(
  withMDX(nextConfig),
);
