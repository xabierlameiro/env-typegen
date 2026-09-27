---
"@xlameiro/env-typegen": minor
---

`sync-apply --apply` now requires a signed confirmation token instead of a free-form string.

- The token is an HMAC-SHA256 signed value bound to the provider, the environment and the change-set hash, with an expiry of 15 minutes at most.
- `ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY` is required wherever a token is created or validated. It must be at least 32 characters long.
- A token is single use. Used tokens are recorded in `.env-typegen/confirmation-nonces`, or in the directory set with `writePolicy.confirmationNonceStorePath`.
- New exports: `createApplyConfirmationToken`, `validateApplyConfirmationToken` and `buildSyncApplyCorrelationId`.
- Evidence signatures are compared in constant time.
