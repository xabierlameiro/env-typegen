## Getting Started

### Installation

```bash
pnpm add -D @xlameiro/env-typegen
```

### Basic usage

```bash
# Default CLI behavior
env-typegen

# Equivalent explicit form
env-typegen --input .env.example --output src/env.ts --format ts
```

### Generate multiple outputs

```bash
env-typegen -i .env.example -o env.generated.ts -f ts -f zod -f t3 -f declaration
```

When multiple formats are specified, each generator writes a separate file:
`env.generated.typescript.ts`, `env.generated.zod.ts`, `env.generated.t3.ts`, `env.generated.declaration.d.ts`.

Use `--format` as the preferred generator flag. `--generator` is still accepted as a
backward-compatible alias.

### Watch mode

```bash
env-typegen -i .env.example -o env.generated.ts -f ts --watch
```

### Validate envs against contract

```bash
# Validate one environment file
env-typegen check --env .env --contract env.contract.mjs

# Compare drift across environments
env-typegen diff --targets .env,.env.example,.env.production --contract env.contract.mjs

# Aggregate and prioritize diagnostics
env-typegen doctor --env .env --targets .env,.env.example,.env.production --contract env.contract.mjs

# CI governance gate (fails on warnings and errors)
env-typegen verify --env .env --targets .env,.env.production --contract env.contract.mjs

# Read-only provider sync
env-typegen pull vercel --env preview

# Governance preflight (read-only)
env-typegen plan --env .env --contract env.contract.mjs

# Read-only sync simulation
env-typegen sync-preview vercel --env-file .env --config env-typegen.config.mjs
```

`pull` is read-only in v1 and does not write values back to cloud providers.

Apply mode in `sync-apply` requires a signed one-time `--confirmation-token` (nonce + ttl + signature with context binding) in addition to other guardrails. Create it with `env-typegen confirmation-token <provider>`. Apply mode also requires `ENV_TYPEGEN_EVIDENCE_SIGNING_KEY`.

### JSON output for CI

```bash
env-typegen verify --env .env --json=pretty --output-file reports/env-verify.json
```

All command paths are resolved from the current working directory where you run `env-typegen`.

## Operations references

- Package operations guide: `packages/env-typegen/docs/operations.md`
- Repository smoke command: `node qa-test/env-typegen-governance-smoke.mjs`
