# Contributing

Thanks for your interest in contributing.

This repository is a pnpm workspace with two parts:

| Path                    | What it is                                              |
| ----------------------- | ------------------------------------------------------- |
| `packages/env-typegen/` | The published npm package `@xlameiro/env-typegen` (CLI) |
| `/` (root)              | The documentation site (Next.js + Fumadocs)             |

Most contributions touch the package. Its guide, with conventions, tests and the release
flow, is in [`packages/env-typegen/CONTRIBUTING.md`](packages/env-typegen/CONTRIBUTING.md).

## Setup

Requires Node.js 22 or later and pnpm 10 or later.

```bash
git clone https://github.com/xabierlameiro/env-typegen.git
cd env-typegen
pnpm install
```

## Quality gate

For changes to the package:

```bash
pnpm --filter @xlameiro/env-typegen lint
pnpm --filter @xlameiro/env-typegen type-check
pnpm --filter @xlameiro/env-typegen test
pnpm --filter @xlameiro/env-typegen build
```

For changes to the docs site:

```bash
pnpm generate
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Husky runs lint-staged, ESLint and the type check on each commit. CI runs both gates on
every pull request.

## Changesets

A change to the package that users will notice needs a changeset:

```bash
pnpm changeset
```

Commit the generated `.changeset/*.md` file with your change. Docs, tests and CI changes
do not need one.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint:

```
fix(generator): escape comment terminators in JSDoc descriptions
feat(cli): add --watch mode
docs: update contributing guide
```

- Subject line of 72 characters or fewer, no trailing period
- Body lines of 100 characters or fewer

## Pull requests

- Branch from `main` with a short name like `fix/jsdoc-escape` or `feat/array-input`.
- Fill in the PR template.
- Keep pull requests small and focused on one change.

## Issues

Use the [issue templates](https://github.com/xabierlameiro/env-typegen/issues/new/choose).
Issues labelled `good first issue` are a good place to start. Report security problems
privately, as described in [`SECURITY.md`](SECURITY.md).
