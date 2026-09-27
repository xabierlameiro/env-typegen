import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "packages/env-typegen": {
      entry: [
        // Primary public API and CLI.
        "src/index.ts",
        "src/cli.ts",
        // Sub-module public API — adapters, sync, trust, fleet, policy, etc.
        // are intentionally public; consumers can import these directly as
        // named or default imports for tree-shaking and advanced usage.
        "src/adapters/**/*.ts",
        "src/fleet/**/*.ts",
        "src/multi-repo/**/*.ts",
        "src/ops/**/*.ts",
        "src/policy/**/*.ts",
        "src/reporting/**/*.ts",
        "src/sync/**/*.ts",
        "src/templates/**/*.ts",
        "src/trust/**/*.ts",
        "src/config.ts",
      ],
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
    ".": {
      entry: [
        "app/**/{page,layout,loading,error,not-found,global-error,icon,template,default,route}.{ts,tsx}",
        "app/api/**/*.{ts,tsx}",
        "lib/env.ts",
        // Template public API — these files are the starter kit's library surface for
        // consumers. Exporting from them without internal usage is intentional.
        "components/ui/**/*.{ts,tsx}",
        "lib/constants.ts",
        "lib/dates.ts",
        "lib/utils.ts",
        "types/**/*.{ts,tsx}",
      ],
      project: [
        "app/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "store/**/*.{ts,tsx}",
        "types/**/*.{ts,tsx}",
      ],
    },
  },
  ignoreDependencies: [
    // Used via @tailwindcss/postcss in build tooling — not imported directly in code
    "tailwindcss",
    // Peer dep via @tailwindcss/postcss — referenced in postcss.config.mjs at runtime
    "postcss",
    // Used in qa-test/env-typegen.config.mjs (QA fixtures) — outside knip's project scope
    "@xlameiro/env-typegen",
  ],
  ignoreBinaries: [
    // Intentionally used via `npx vercel` — not installed as a project dep to avoid
    // pulling in its vulnerable transitive deps (tar, minimatch, ajv) into the lockfile
    "vercel",
  ],
  // Adapter files intentionally export the same value as both named and
  // default export to support `import adapter` and `import { adapter }` consumer
  // patterns — suppress the duplicate-export check project-wide.
  exclude: ["duplicates"],
  // knip 6 reports exported types that are only referenced in their own file. Those
  // types name the fields of other exported types, so they stay exported.
  ignoreExportsUsedInFile: { type: true },
};

export default config;
