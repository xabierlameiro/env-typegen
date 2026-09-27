import { defineConfig } from "tsup";

export default defineConfig([
  // Library (dual CJS + ESM)
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    // tsup sets `baseUrl` for the declaration build and TypeScript 6 reports it as
    // deprecated (TS5101). The option stops working in TypeScript 7.
    dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
    clean: true,
    sourcemap: true,
    treeshake: true,
    splitting: false,
    target: "node20",
  },
  // CLI (ESM only, with shebang injected via banner)
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    // Bundle picocolors — it is CJS-only and has no ESM named exports,
    // so it must be inlined rather than left as an external ESM import.
    noExternal: ["picocolors"],
    banner: {
      js: "#!/usr/bin/env node",
    },
    target: "node20",
    onSuccess: "chmod +x dist/cli.js",
  },
]);
