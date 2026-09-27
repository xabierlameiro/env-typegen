# env-typegen

> From `.env.example` to typed outputs and contract-based environment governance.
>
> If this package saves debugging time for your team, consider starring the repository.

[![npm version](https://badge.fury.io/js/%40xlameiro%2Fenv-typegen.svg)](https://npmjs.com/package/@xlameiro/env-typegen)
[![npm downloads](https://img.shields.io/npm/dm/@xlameiro/env-typegen)](https://npmjs.com/package/@xlameiro/env-typegen)
[![CI](https://github.com/xlameiro/env-typegen/actions/workflows/ci.yml/badge.svg)](https://github.com/xlameiro/env-typegen/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/xlameiro/env-typegen?style=social)](https://github.com/xlameiro/env-typegen/stargazers)
[![Maintainer](https://img.shields.io/badge/maintainer-xlameiro-0ea5e9)](https://github.com/xlameiro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What this package does

`@xlameiro/env-typegen` reads `.env.example` and helps you:

- generate TypeScript, Zod, t3-env, and declaration outputs
- pull provider state via adapters (read-only)
- validate real env files against explicit contracts
- detect drift across multiple targets
- produce CI-friendly JSON diagnostics
- enforce deterministic merge gates with `verify`

## Installation

```bash
pnpm add -D @xlameiro/env-typegen
# or
npm install --save-dev @xlameiro/env-typegen
```

## Quick Start

```bash
# Generate all outputs by default
npx env-typegen --input .env.example --output src/env.generated.ts

# Generate only Zod schema
npx env-typegen -i .env.example -o src/env.schema.ts -f zod

# Watch mode
npx env-typegen -i .env.example -o src/env.generated.ts --watch
```

## Generator formats

| Value                | Output                                       |
| -------------------- | -------------------------------------------- |
| `ts` or `typescript` | TypeScript env types                         |
| `zod`                | Zod v4 schema                                |
| `t3`                 | `@t3-oss/env-nextjs` `createEnv(...)` config |
| `declaration`        | Ambient `.d.ts` env declaration              |

`--generator` remains available as a backward-compatible alias for `--format`.

Multiple outputs in one run:

```bash
npx env-typegen -i .env.example -o src/env.ts -f typescript -f zod -f declaration
```

## Validation and governance commands

```bash
# Validate one source
npx env-typegen check --env .env --contract env.contract.mjs

# Compare drift across sources
npx env-typegen diff --targets .env,.env.production --contract env.contract.mjs

# Aggregated diagnostics
npx env-typegen doctor --env .env --targets .env,.env.production --contract env.contract.mjs

# Read-only provider sync
npx env-typegen pull vercel --env preview

# CI governance gate (fails on warnings and errors)
npx env-typegen verify --env .env --targets .env,.env.production --contract env.contract.mjs

# Controlled apply (dry-run default)
npx env-typegen sync-apply vercel --env-file .env --config env-typegen.config.mjs --json

# Controlled apply (write mode with explicit guards)
npx env-typegen sync-apply vercel \
  --env production \
  --env-file .env \
  --config env-typegen.config.mjs \
  --apply \
  --preflight-file reports/preflight.json \
  --confirmation-token "$(npx env-typegen confirmation-token vercel --env production --env-file .env --config env-typegen.config.mjs)" \
  --protected-branch \
  --json
```

`pull` is read-only in v1 and does not push values to providers.

`sync-apply` runs in dry-run mode by default and requires explicit guards for apply mode, including a structured, HMAC-signed one-time confirmation token bound to provider/environment/change-set context.

`confirmation-token` creates that token for the current change set. It needs `ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY` (32 characters or more). Apply mode also needs `ENV_TYPEGEN_EVIDENCE_SIGNING_KEY`, so the evidence of a write is signed.

Recommended CI policy:

- PRs to `main` and protected branches should treat `verify` as blocking.
- Feature branches can run the same command in advisory mode when needed.

JSON output for CI:

```bash
npx env-typegen verify --env .env --json=pretty --output-file reports/env-verify.json
```

Apply smoke check:

```bash
node qa-test/env-typegen-apply-smoke.mjs --mode=all
```

Promotion smoke check:

```bash
node qa-test/env-typegen-governance-promotion-smoke.mjs
```

Conformance smoke check:

```bash
node qa-test/env-typegen-conformance-smoke.mjs
```

Promotion policy:

- Stage repositories from advisory-enforce to enforce before enabling apply.
- Keep apply workflows restricted to protected branches with explicit guardrails.

Conformance policy:

- Run conformance smoke before promotion-stage transitions.
- Enforce adapter contract v3 metadata and orchestration strategy checks in CI.

Strict mode is enabled by default. Use `--no-strict` to downgrade undeclared variables to warnings.

## Cloud snapshots

Validation commands can include cloud snapshot sources:

```bash
npx env-typegen check --cloud-provider vercel --cloud-file vercel-env.json --contract env.contract.mjs
npx env-typegen diff --cloud-provider cloudflare --cloud-file cloudflare-env.json --contract env.contract.mjs
npx env-typegen doctor --cloud-provider aws --cloud-file aws-env.json --contract env.contract.mjs
```

Supported providers: `vercel`, `cloudflare`, `aws`.

## Plugin hooks

Use plugins to customize validation behavior:

- `transformContract`
- `transformSource`
- `transformReport`

Load plugins with repeated `--plugin` flags or via `plugins` in `env-typegen.config.mjs`.

## Programmatic API

```ts
import {
  runGenerate,
  runValidationCommand,
  parseEnvFile,
  generateTypeScriptTypes,
  loadCloudSource,
  loadPlugins,
} from "@xlameiro/env-typegen";
```

## Typical adoption path

1. Start with generation-only output (`ts`, `zod`).
2. Add `check` in CI for contract enforcement.
3. Add `pull` to read provider state through adapters.
4. Add `verify` as merge-blocking gate.
5. Add `diff`, `doctor`, cloud snapshots, and plugins for advanced workflows.

## FAQ

### Is this package only for Next.js?

No. It is framework-agnostic. The `t3` generator is optional.

### Can I use it without a contract file?

Yes, but explicit contracts are recommended for governance and CI reliability.

### Which command should I run in CI?

Use `verify` as the final gate. Keep `check`, `diff`, and `doctor` for stage-specific diagnostics.

## Docs and references

- Website docs source: [`/content/docs`](../../content/docs)
- Package docs index: [`/packages/env-typegen/docs`](./docs)
- Policy packs guide: [`/packages/env-typegen/docs/policy-packs.md`](./docs/policy-packs.md)
- Sync apply guide: [`/packages/env-typegen/docs/sync-apply.md`](./docs/sync-apply.md)
- Governance promotion guide: [`/packages/env-typegen/docs/governance-promotion.md`](./docs/governance-promotion.md)
- Governance conformance guide: [`/packages/env-typegen/docs/governance-conformance.md`](./docs/governance-conformance.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md)

## Trust signals

- Maintained by [@xlameiro](https://github.com/xlameiro)
- Security policy: [`SECURITY.md`](../../SECURITY.md)
- Contribution guide: [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
- Published releases: [npm package page](https://www.npmjs.com/package/@xlameiro/env-typegen)

## Status

`env-typegen` is actively maintained and published on npm.

## License

MIT
