---
"@xlameiro/env-typegen": minor
---

`env-typegen` now runs with no arguments. This changes the defaults of the `generate` command.

Breaking changes for users of 0.1.x who rely on defaults:

- The default output is `src/env.ts`. It was `env.generated.ts`.
- The default generator is `typescript` only. It was all four generators. Pass `--format` once per generator to get the others.
- When `--input` is omitted, the input is the first existing file among `.env.example`, `.env.example.local` and `.env`.

Added:

- `--check` exits with code 1 when the output file is out of sync with the input.
- `--mode augment` writes an `env.d.ts` augmentation instead of a module.
- `--help` lists the subcommands.

Explicit `--input`, `--output` and `--generator` values behave as before.
