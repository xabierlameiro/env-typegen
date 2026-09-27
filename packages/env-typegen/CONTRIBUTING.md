# Contributing to env-typegen

Thank you for your interest in contributing! This document covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Quality Gate](#quality-gate)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Releasing](#releasing)

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to uphold it. Violations can be reported via the repository security contacts.

---

## Getting Started

1. **Clone** the repository:
   ```bash
   git clone https://github.com/xlameiro/env-typegen.git
   cd env-typegen
   ```
2. **Install dependencies** (requires Node.js ≥ 22 and pnpm ≥ 9):
   ```bash
   pnpm install
   ```

---

## Development Setup

This is a pnpm workspace monorepo. The CLI package lives at `packages/env-typegen/`.

```bash
cd packages/env-typegen

# Build the package
pnpm build

# Run tests (Vitest)
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type-check without emitting
pnpm type-check

# Lint (ESLint — zero warnings allowed)
pnpm lint

# Run the full quality gate in one shot
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

> All four commands must pass before opening a PR. CI will block merges otherwise.

---

## Making Changes

### Branch naming

Use the pattern `<type>/<short-description>`:

| Type     | When               |
| -------- | ------------------ |
| `feat/`  | New feature        |
| `fix/`   | Bug fix            |
| `docs/`  | Documentation only |
| `chore/` | Tooling, deps, CI  |
| `test/`  | Tests only         |

Examples: `feat/array-input`, `fix/t3-description-escape`, `docs/api-examples`

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(env-typegen): add array input support
fix(env-typegen): escape double-quotes in t3 descriptions
docs(env-typegen): fix package name in api.md
test(env-typegen): add loadConfig unit tests
```

### Tests

- Add or update tests for any behavior change.
- Place unit tests next to the file under test (e.g. `src/config.ts` → `tests/config.test.ts`).
- Integration tests that exercise the built CLI live in `tests/integration/`.
- Do not skip failing tests — fix the underlying code.

### TypeScript

- Strict mode with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` — no `any`, no `!`.
- Use `type` (never `interface` or `enum`).
- Add JSDoc to all public exports in `src/index.ts`.

---

## Quality Gate

Before every PR:

```bash
pnpm lint        # zero ESLint errors/warnings
pnpm type-check  # zero TypeScript errors
pnpm test        # all tests pass
pnpm build       # clean production build
```

CI runs these same checks on every push and pull request.

---

## Submitting a Pull Request

1. Open the PR as a **draft** while work is in progress.
2. Fill in the PR description: what changed and why.
3. Mark it **Ready for Review** once the quality gate is green.
4. Address review feedback in follow-up commits (do not force-push after a review has started).

---

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for release management.

1. **Create a changeset** for your PR:
   ```bash
   pnpm changeset
   ```
   Follow the prompts to select the bump type (`patch`, `minor`, `major`) and write a summary.
2. **Commit the generated `.changeset/*.md` file** alongside your code changes.
3. When the PR is merged, the maintainer runs `pnpm changeset version` to bump `package.json` and update `CHANGELOG.md`, then publishes to npm.

You do **not** need to manually edit `CHANGELOG.md` or `package.json` version fields.
