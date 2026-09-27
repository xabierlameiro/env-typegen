---
"@xlameiro/env-typegen": minor
---

Drop Node.js 20 support. The package now requires Node.js 22 or later and is built for the `node22` target.

Node.js 20 reached end of life in April 2026. On Node.js 20.0 to 20.11 the `--env-file` option of the CLI did not work, because Node.js took the option for itself.

`chokidar` is updated from 4 to 5. Only the `--watch` mode of the CLI uses it.
