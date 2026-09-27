# Changelog

## 0.1.10

### Patch Changes

- 52e5149: New docs
- 9cc3d1f: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

### Added since 0.1.9

- New commands: `pull`, `plan`, `sync-preview`, `sync-apply` and `verify`.
- Provider adapters for Vercel, AWS SSM, AWS Secrets Manager and Docker.
- `sync-apply` options `--strategy` (`fail-fast` or `fail-late`) and `--max-concurrency`.
- Governance modules: policy packs, audit events, trust and evidence reporting.

The `generate`, `check`, `diff` and `doctor` commands keep their flags and defaults.

## 0.1.9

### Patch Changes

- ddf2ea1: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

## 0.1.8

### Patch Changes

- c339449: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

## 0.1.7

### Patch Changes

- 97738bd: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

## 0.1.6

### Patch Changes

- 38a33eb: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

## 0.1.5

### Patch Changes

- 4ad0d2a: ## Fuzzy Dancers Find — env-typegen QA deficiency fixes (D1-D12)

## 0.1.4

### Patch Changes

- ad8f00d: Fix six QA-identified deficiencies in CLI behaviour and documentation
  - **D1 (critical)**: Fix crash when `.ts` config file is present — `loadConfig()` now throws an actionable error with a code snippet instead of silently failing. `CONFIG_FILE_NAMES` load order changed to `.mjs → .js → .ts` to prefer simpler formats first.
  - **D2**: Document multi-generator output suffix convention in `--output` / `-o` help text (e.g. `env.generated.typescript.ts`, `env.generated.zod.ts`).
  - **D3**: Add "Config file:" section to `--help` describing auto-discovery order (`.mjs → .js → .ts`), CLI flag override, and `defineConfig()` tip.
  - **D4**: Expand plugin load error to include the full expected interface shape (`name`, `transformSource?`, `transformReport?`, `transformContract?`) so users know exactly what to export.
  - **D5**: Add "Exit codes:" section to all four help texts (`generate`, `check`, `diff`, `doctor`).
  - **D6**: Fix `--watch` mode not propagating `output` path changes when config is reloaded — `handleConfigChange` now updates `runOptions.output` alongside `generators`, `format`, and `inferenceRules`.

## 0.1.3

### Patch Changes

- Refresh package and site documentation for the validation suite (`check`, `diff`, `doctor`), cloud snapshot sources, and plugin-based extension points. Expand public API examples to include `runValidationCommand`, `loadCloudSource`, and plugin loading helpers.

## 0.1.2

### Patch Changes

- Refresh the published npm package metadata and README to match the current repository documentation.

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/) and uses
[Changesets](https://github.com/changesets/changesets) for release management.

<!-- Releases are added automatically by `changeset version` -->

## [0.1.1] — 2026-03-17

### Fixed

- **A1** — VERSION was hardcoded as `"0.1.0"` in `cli.ts`; now read dynamically from `package.json` via `createRequire` so it stays in sync without manual edits.
- **A2** — Double-quotes in `@description` annotations were not escaped in the t3-generator output, corrupting the generated `createEnv(...)` call. Fixed with `.replace(/"/g, '\\"')`.
- **A3** — Prettier parse errors in `formatOutput` were silently swallowed; a `console.warn` is now emitted before the raw-content fallback.
- **A4** — Watch mode only listened for `"change"` events; it now also handles `"add"` and `"unlink"` so editor save-with-delete patterns are covered.
- **A5** — Config file changes during `--watch` were silently ignored; a second chokidar watcher now monitors the config file and reloads it on change.
- **C1** — `formatOutput` (Prettier) was called unnecessarily in dry-run mode; formatting now runs only when actually writing to disk.
- **C3** — Removed duplicate alias exports (`generateTypeScript`, `generateZod`); the canonical names `generateTypeScriptTypes` and `generateZodSchema` are the only public exports.
- **E1–E3** — README badge URLs had `YOUR_USERNAME` placeholders; replaced with the real GitHub/npm identifiers. Package name aligned to `@xlameiro/env-typegen` throughout all docs.
- **E4** — README `--format` example was misleading; corrected to use `--generator`/`-f` for generator selection and document `--no-format` for disabling Prettier.
- **E5** — `parseEnvFile` was documented as `async`/awaitable but is synchronous; removed erroneous `await` from all examples.
- **DRY** — `CONFIG_FILE_NAMES` was duplicated between `config.ts` and `watch.ts`; exported from `config.ts` and imported in `watch.ts`.

### Added

- **B1** — `EnvTypegenConfig.input` now accepts `string | string[]`; CLI `--input`/`-i` can be repeated to process multiple `.env` files in one run.
- **B2** — `inferenceRules?: InferenceRule[]` added to `EnvTypegenConfig` and `RunGenerateOptions`; custom rules are prepended before the built-in ruleset.
- **B3** — Default generators changed from `["typescript"]` to all four: `["typescript", "zod", "t3", "declaration"]`, matching the spec.
- **B4** — Dry-run mode now prints each generated output block to stdout so users can preview content without touching the filesystem.
- **B5** — Watch mode debounces rapid file-change events (200 ms) to prevent multiple simultaneous pipeline runs on editor autosave.

### Tests

- Regression test for double-quotes in t3-generator descriptions (A2).
- CLI version tests read expected version from `package.json` (A1).
- Four `loadConfig()` unit tests with temp-dir fixtures (no stale state).
- Dry-run stdout spy test verifying preview content appears (B4).
- Integration tests expanded to five end-to-end scenarios via `execSync` against the built `dist/cli.js`.

[0.1.1]: https://github.com/xlameiro/env-typegen/compare/packages/env-typegen@0.1.0...packages/env-typegen@0.1.1

### Added

#### Foundation (Phase 1)

- TypeScript 5 strict mode with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
- Dual CJS + ESM build via tsup with full type declarations (`dist/index.d.ts`)
- Vitest test infrastructure with v8 coverage (thresholds: 85% lines, 80% branches)
- ESLint v9 flat config with `@typescript-eslint/recommended`

#### Parser (Phase 2)

- `parseEnvFile(path)` — reads a `.env.example` file from disk and returns a structured `ParsedEnvFile`
- `parseEnvFileContent(content)` — parses raw string content; useful in tests or pipelines
- `parseCommentBlock(block)` — extracts JSDoc-style annotations (`@type`, `@description`, `@example`, `@optional`) from comment lines above env var assignments
- `inferType(value)` — infers `EnvVarType` (`string` | `number` | `boolean` | `url` | `email`) from a raw env value

#### Generators (Phases 3 & 4)

- `generateTypeScriptTypes(parsed)` — produces a `type Env = { ... }` TypeScript declaration with inferred types
- `generateEnvValidation(parsed)` — produces a runtime validation helper alongside the type
- `generateZodSchema(parsed)` — produces a Zod v4 `z.object({ ... })` schema; numbers use `z.coerce.number()`, booleans `z.coerce.boolean()`
- `generateT3Env(parsed)` — produces a `@t3-oss/env-nextjs` `createEnv(...)` call; splits vars into `server` and `client` (`NEXT_PUBLIC_*`) buckets automatically
- `generateDeclaration(parsed)` — produces a `.d.ts` file that augments `NodeJS.ProcessEnv` with the parsed var names and types

#### Config & Utils (Phase 5)

- `defineConfig(config)` — type-safe config factory (identity function for editor inference)
- `loadConfig(cwd)` — discovers and loads `env-typegen.config.ts` / `env-typegen.config.js` / `env-typegen.config.mjs` starting from a given directory
- `readEnvFile(path)` / `writeOutput(path, content)` — file I/O utilities
- `formatOutput(content)` — formats generated source with Prettier
- `log()`, `error()`, `success()`, `warn()` — colourised logger helpers

#### CLI (Phase 6)

- `env-typegen` binary via `dist/cli.js`
- Flags: `--input` / `-i`, `--output` / `-o`, `--generator` / `-g` (repeatable), `--format` / `-f`, `--watch` / `-w`, `--config` / `-c`, `--version` / `-v`, `--help` / `-h`
- Multiple generators produce separate output files with the generator name inserted before the extension (e.g. `env.generated.typescript.ts`, `env.generated.zod.ts`)
- Watch mode via chokidar v4 — regenerates on every file change; SIGINT-safe
- `runGenerate(options)` — programmatic pipeline API; runs without a CLI process

#### Quality & Docs (Phase 7)

- Full TSDoc on every public export in `src/index.ts`
- README with Quick Start (CLI examples), Programmatic API, and Configuration sections

[0.1.0]: https://github.com/xlameiro/env-typegen/releases/tag/v0.1.0
