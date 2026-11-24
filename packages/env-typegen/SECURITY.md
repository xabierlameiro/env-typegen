# Security Policy

## Supported versions

Security fixes are released for the latest minor version of `@xlameiro/env-typegen`.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## Reporting a vulnerability

Do not open a public issue.

Report it privately through
[GitHub Security Advisories](https://github.com/xabierlameiro/env-typegen/security/advisories/new).

Include:

- The affected version
- Steps to reproduce, or a proof of concept
- The impact you expect
- A suggested fix, if you have one

You will get an acknowledgement within 7 days. A fix is coordinated and released before
any public disclosure, and reporters are credited in the advisory unless they prefer not to be.

## Scope

In scope: the `@xlameiro/env-typegen` package, including the CLI and the code it
generates (for example, input in a `.env.example` file that leads to code execution in the
generated output).

Out of scope: the documentation site, and issues in dependencies that do not affect the
package. Report those upstream.
