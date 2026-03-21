# env-typegen

Environment contract governance for modern TypeScript teams.

> If this project helps your team prevent config drift, consider starring the repository.

[![npm version](https://img.shields.io/npm/v/@xlameiro/env-typegen)](https://www.npmjs.com/package/@xlameiro/env-typegen)
[![npm downloads](https://img.shields.io/npm/dm/@xlameiro/env-typegen)](https://www.npmjs.com/package/@xlameiro/env-typegen)
[![CI](https://github.com/xlameiro/env-typegen/actions/workflows/ci.yml/badge.svg)](https://github.com/xlameiro/env-typegen/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/xlameiro/env-typegen?style=social)](https://github.com/xlameiro/env-typegen/stargazers)
[![Maintainer](https://img.shields.io/badge/maintainer-xlameiro-0ea5e9)](https://github.com/xlameiro)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why env-typegen

Teams often keep `.env.example`, runtime validation, and TypeScript types in separate places.
That creates drift, hidden deploy risk, and repetitive maintenance.

`env-typegen` solves this by:

- generating typed outputs from `.env.example`
- pulling provider state through adapters
- validating real sources against explicit contracts
- detecting drift across local and cloud snapshots
- enforcing deterministic CI gates with `verify`

## What it can do

| Capability                    | Outcome                                      |
| ----------------------------- | -------------------------------------------- |
| Generate TypeScript (`ts`)    | Compile-time env typing                      |
| Generate Zod (`zod`)          | Runtime validation schema                    |
| Generate `t3` output          | `@t3-oss/env-nextjs` config scaffold         |
| Generate `declaration` output | `NodeJS.ProcessEnv` augmentation             |
| `check` command               | Contract validation of one source            |
| `diff` command                | Drift analysis across multiple sources       |
| `doctor` command              | Consolidated diagnostics and recommendations |
| `pull` command                | Read-only provider sync into normalized map  |
| `verify` command              | CI gate that fails on warnings or errors     |
| Cloud snapshot support        | Vercel, Cloudflare, AWS parity checks        |
| Plugin hooks                  | Extend contract/source/report behavior       |

## Quick start

```bash
# Install as a dev dependency
pnpm add -D @xlameiro/env-typegen

# Default CLI behavior: auto-detect .env.example and write TypeScript output to src/env.ts
npx env-typegen

# Custom output path + multiple formats
# (use --format; --generator remains a backward-compatible alias)
npx env-typegen -i .env.example -o src/env.generated.ts -f ts -f zod -f t3 -f declaration

# Validate one env source against a contract
npx env-typegen check --env .env --contract env.contract.mjs

# CI gate (fails on warnings or errors)
npx env-typegen verify --env .env --contract env.contract.mjs
```

## Quick adoption path

1. Generate `ts` + `zod` outputs from `.env.example`.
2. Add `check` in CI as your first contract gate.
3. Add `pull` to read provider state without write side effects.
4. Add `verify` as the merge-blocking governance gate for pull requests and protected branches.

Use `--format` as the preferred generator flag in scripts and docs. Keep `--generator` for
backward compatibility with existing automation.

```bash
npx env-typegen -i .env.example -o src/env.generated.ts -f ts -f zod
npx env-typegen check --env .env --contract env.contract.mjs --json --output-file reports/env-check.json
npx env-typegen verify --env .env --contract env.contract.mjs --json=pretty --output-file reports/env-verify.json
```

## Governance workflow commands

```bash
# Pull provider values (requires provider config)
npx env-typegen pull vercel --env preview

# Compare drift across environments
npx env-typegen diff --targets .env,.env.production --contract env.contract.mjs

# Aggregated diagnostics
npx env-typegen doctor --env .env --targets .env,.env.production --contract env.contract.mjs

# Deterministic CI gate
npx env-typegen verify --env .env --targets .env,.env.production --contract env.contract.mjs

# CI-friendly JSON output
npx env-typegen verify --env .env --json=pretty --output-file reports/env-verify.json
```

`pull` is read-only by design in v1. It never writes provider values back to remote systems.

## Operations runbook

Operational guidance for CI and troubleshooting is available in:

- Website operations guide: [`content/docs/operations.mdx`](content/docs/operations.mdx)
- Package operations guide: [`packages/env-typegen/docs/operations.md`](packages/env-typegen/docs/operations.md)
- Policy pack guide: [`content/docs/policy-packs.mdx`](content/docs/policy-packs.mdx)
- Sync apply guide: [`content/docs/sync-apply.mdx`](content/docs/sync-apply.mdx)

Smoke validation command:

```bash
node qa-test/env-typegen-governance-smoke.mjs
```

Apply smoke validation command:

```bash
node qa-test/env-typegen-apply-smoke.mjs --mode=all
```

Smoke CI workflow:

- [`.github/workflows/env-governance-smoke.yml`](.github/workflows/env-governance-smoke.yml)
- [`.github/workflows/env-governance-apply-dry-run.yml`](.github/workflows/env-governance-apply-dry-run.yml)
- [`.github/workflows/env-governance-apply.yml`](.github/workflows/env-governance-apply.yml)
- [`.github/workflows/env-governance-promotion.yml`](.github/workflows/env-governance-promotion.yml)
- [`.github/workflows/env-governance-chaos.yml`](.github/workflows/env-governance-chaos.yml)
- [`.github/workflows/env-governance-forensics.yml`](.github/workflows/env-governance-forensics.yml)

Recommended CI policy:

- PRs to `main` and protected branches: block on `verify` failures.
- Feature branches: allow non-blocking diagnostics when teams need progressive rollout.
- PRs: run apply dry-run workflow only.
- Protected branches: allow apply workflow only with explicit guardrails and preflight artifacts.

## Governance promotion model

The enterprise rollout model is staged:

1. `advisory-enforce`: verify behavior and artifacts without enabling writes.
2. `enforce`: dry-run and policy gates must pass deterministically.
3. `apply`: guarded write path enabled only for controlled protected-branch contexts.

Promotion smoke validation command:

```bash
node qa-test/env-typegen-governance-promotion-smoke.mjs
```

Promotion report artifact:

- `qa-test/reports/env-governance-promotion-smoke.json`

Forensics smoke validation command:

```bash
node qa-test/env-typegen-forensics-smoke.mjs
```

Forensics report artifact:

- `qa-test/reports/env-governance-forensics-smoke.json`

## Governance conformance model

Conformance checks validate adapter contract v3 behavior and orchestration invariants before promotion.

Conformance smoke validation command:

```bash
node qa-test/env-typegen-conformance-smoke.mjs
```

Conformance workflow:

- [`.github/workflows/env-governance-conformance.yml`](.github/workflows/env-governance-conformance.yml)

Conformance report artifact:

- `qa-test/reports/env-governance-conformance-smoke.json`

## Multi-repo adoption references

- Promotion guide (website): [`content/docs/governance-promotion.mdx`](content/docs/governance-promotion.mdx)
- Promotion guide (package): [`packages/env-typegen/docs/governance-promotion.md`](packages/env-typegen/docs/governance-promotion.md)
- Conformance guide (website): [`content/docs/governance-conformance.mdx`](content/docs/governance-conformance.mdx)
- Conformance guide (package): [`packages/env-typegen/docs/governance-conformance.md`](packages/env-typegen/docs/governance-conformance.md)
- Trust model guide (website): [`content/docs/governance-trust-model.mdx`](content/docs/governance-trust-model.mdx)
- Trust model guide (package): [`packages/env-typegen/docs/governance-trust-model.md`](packages/env-typegen/docs/governance-trust-model.md)
- Chaos and SLO guide (website): [`content/docs/governance-chaos-and-slo.mdx`](content/docs/governance-chaos-and-slo.mdx)
- Chaos and SLO guide (package): [`packages/env-typegen/docs/governance-chaos-and-slo.md`](packages/env-typegen/docs/governance-chaos-and-slo.md)
- Roadmap (Part 5): [`docs/roadmap/infra-governance-part5-roadmap.md`](docs/roadmap/infra-governance-part5-roadmap.md)
- Roadmap (Part 6): [`docs/roadmap/infra-governance-part6-roadmap.md`](docs/roadmap/infra-governance-part6-roadmap.md)
- Roadmap (Part 7): [`docs/roadmap/infra-governance-part7-roadmap.md`](docs/roadmap/infra-governance-part7-roadmap.md)

Multi-repo bootstrap implementation:

- Fleet manifest loader: [`packages/env-typegen/src/multi-repo/repo-manifest.ts`](packages/env-typegen/src/multi-repo/repo-manifest.ts)
- Bootstrap planner: [`packages/env-typegen/src/multi-repo/bootstrap.ts`](packages/env-typegen/src/multi-repo/bootstrap.ts)

## Common use cases

- Standardize env contracts across multiple apps in a monorepo.
- Block pull requests when required variables are missing or mistyped.
- Detect deployment drift between staging and production.
- Keep TypeScript, Zod, and runtime env configuration in sync.
- Add a single governance gate to block risky deploys.

## Comparison: manual approach vs env-typegen

| Scenario               | Manual approach              | env-typegen                   |
| ---------------------- | ---------------------------- | ----------------------------- |
| Keep env types updated | Hand-maintained, error-prone | Generated from `.env.example` |
| Runtime checks         | Ad-hoc or inconsistent       | Contract-first commands       |
| Drift detection        | Usually custom scripts       | Built-in `diff` + `doctor`    |
| CI reporting           | Hard to standardize          | JSON output for automation    |

## Documentation map

- Website docs: [`/content/docs`](content/docs)
- Package docs: [`packages/env-typegen/README.md`](packages/env-typegen/README.md)
- Website route: `/docs/getting-started`
- Website route: `/docs/validation`
- Website route: `/docs/api`

## LLM and crawler discoverability

- [`llms.txt`](llms.txt): concise capability and navigation index for LLM crawlers
- [`llms-full.txt`](llms-full.txt): expanded, task-oriented map for agentic consumers

## Trust signals

- Maintained by [@xlameiro](https://github.com/xlameiro)
- CI status is public in [`ci.yml`](https://github.com/xlameiro/env-typegen/actions/workflows/ci.yml)
- Security disclosure process in [`SECURITY.md`](SECURITY.md)
- Contribution workflow in [`CONTRIBUTING.md`](CONTRIBUTING.md)

## KPI tracking (stars growth)

Track these weekly and ship one improvement action per metric trend.

| Metric                                           | Why it matters                                                    | Target direction                          | Collection source/tool                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Repo unique visitors                             | Shows top-of-funnel visibility from posts, shares, and docs links | Increase week over week                   | GitHub Insights → Traffic                                          |
| Star conversion rate (`stars ÷ unique visitors`) | Shows if your README/value proposition turns visits into stars    | Increase (aim 2–5% as an early benchmark) | GitHub Insights traffic + stars count (manual calc or spreadsheet) |
| Organic docs clicks                              | Shows SEO reach for problem-intent queries                        | Increase month over month                 | Google Search Console (queries/pages)                              |
| Core Web Vitals pass rate (LCP/INP/CLS)          | Better performance improves retention and search ranking          | Increase pass rate; decrease LCP/INP/CLS  | Search Console CWV + Lighthouse CI/PageSpeed Insights              |

## Contributing

Contributions are welcome.

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

Then open a pull request.

## License

MIT © [xlameiro](https://github.com/xlameiro)
